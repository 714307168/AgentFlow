package hub

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/model"
	"github.com/rs/zerolog/log"
)

// ProjectInfo stores project metadata
type ProjectInfo struct {
	ID      string
	Name    string
	Path    string
	AgentID string
}

// Hub is the central message router connecting agents and devices.
type Hub struct {
	agents       sync.Map // agentID  -> *Client
	devices      sync.Map // deviceID -> *Client
	projects     sync.Map // projectID -> agentID
	projectInfos sync.Map // projectID -> *ProjectInfo
	queues       sync.Map // projectID -> *Queue
	cfg          *config.Config
	seq          int64 // atomic sequence counter
}

// NewHub creates a Hub with the given configuration.
func NewHub(cfg *config.Config) *Hub {
	return &Hub{cfg: cfg}
}

// NextSeq atomically increments and returns the next sequence number.
func (h *Hub) NextSeq() int64 {
	return atomic.AddInt64(&h.seq, 1)
}

// GetOrCreateQueue returns the Queue for projectID, creating one if absent.
func (h *Hub) GetOrCreateQueue(projectID string) *Queue {
	q, _ := h.queues.LoadOrStore(projectID, NewQueue(h.cfg.QueueSize))
	return q.(*Queue)
}

// RegisterAgent stores the agent client.
func (h *Hub) RegisterAgent(client *Client) {
	h.agents.Store(client.AgentID, client)
	log.Info().Str("agent_id", client.AgentID).Msg("agent registered")
}

// RegisterDevice stores the device client.
func (h *Hub) RegisterDevice(client *Client) {
	h.devices.Store(client.DeviceID, client)
	log.Info().Str("device_id", client.DeviceID).Str("agent_id", client.AgentID).Msg("device registered")
}

// Unregister removes a client from all maps and notifies peers.
func (h *Hub) Unregister(client *Client) {
	client.Close()

	switch client.Type {
	case model.ClientTypeAgent:
		h.agents.Delete(client.AgentID)
		log.Info().Str("agent_id", client.AgentID).Msg("agent unregistered")

		// Notify all devices watching this agent's projects.
		h.projects.Range(func(k, v interface{}) bool {
			if v.(string) == client.AgentID {
				projectID := k.(string)
				payload, _ := json.Marshal(model.AgentStatusPayload{
					AgentID:   client.AgentID,
					Online:    false,
					ProjectID: projectID,
				})
				env := &model.Envelope{
					ID:        newID(),
					Event:     model.EventAgentStatus,
					ProjectID: projectID,
					Seq:       h.NextSeq(),
					Timestamp: time.Now().UnixMilli(),
					Payload:   payload,
				}
				h.BroadcastToDevices(env, projectID)
			}
			return true
		})

	case model.ClientTypeDevice:
		h.devices.Delete(client.DeviceID)
		log.Info().Str("device_id", client.DeviceID).Msg("device unregistered")
	}
}

// HandleMessage routes an inbound envelope from a client.
func (h *Hub) HandleMessage(from *Client, env *model.Envelope) {
	env.Seq = h.NextSeq()
	env.Timestamp = time.Now().UnixMilli()

	switch env.Event {
	case model.EventMessageSend:
		// Device -> Agent: route by project_id.
		agentID, ok := h.resolveAgent(env.ProjectID)
		if !ok {
			log.Warn().Str("project_id", env.ProjectID).Msg("no agent for project")
			h.sendError(from, env.ID, "no_agent", "no agent registered for project")
			return
		}
		// Track the resolved agent on the device connection so response broadcasts reach it.
		if from.Type == model.ClientTypeDevice {
			from.AgentID = agentID
		}
		h.Route(env, agentID)

	case model.EventMessageChunk, model.EventMessageDone, model.EventMessageError:
		// Agent -> Devices: broadcast to all devices wat the project.
		h.BroadcastToDevices(env, env.ProjectID)

	case model.EventProjectBind:
		var p model.ProjectBindPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			log.Warn().Err(err).Msg("invalid project.bind payload")
			return
		}
		h.projects.Store(p.ProjectID, from.AgentID)
		h.projectInfos.Store(p.ProjectID, &ProjectInfo{
			ID:      p.ProjectID,
			Name:    p.Name,
			Path:    p.Path,
			AgentID: from.AgentID,
		})
		from.ProjectIDs = append(from.ProjectIDs, p.ProjectID)
		log.Info().Str("project_id", p.ProjectID).Str("agent_id", from.AgentID).Msg("project bound")

		ack := &model.Envelope{
			ID:        newID(),
			Event:     model.EventProjectBound,
			ProjectID: p.ProjectID,
			Seq:       h.NextSeq(),
			Timestamp: time.Now().UnixMilli(),
		}
		_ = from.Send(ack)

	case model.EventPing:
		pong := &model.Envelope{
			ID:        newID(),
			Event:     model.EventPong,
			Seq:       h.NextSeq(),
			Timestamp: time.Now().UnixMilli(),
		}
		_ = from.Send(pong)

	case model.EventAuthRefresh:
		// Token refresh acknowledged; re-verification happens at the handler layer.
		log.Info().Str("client_id", from.ID).Msg("auth.refresh received")

	case model.EventFileSync:
		if from.Type == model.ClientTypeAgent {
			h.BroadcastToDevices(env, env.ProjectID)
		} else {
			agentID, ok := h.resolveAgent(env.ProjectID)
			if ok {
				h.Route(env, agentID)
			}
		}

	case model.EventFileUpload, model.EventFileChunk, model.EventFileDone, model.EventFileError:
		// Bidirectional file transfer: route based on sender type
		if from.Type == model.ClientTypeAgent {
			// Agent -> Devices
			h.BroadcastToDevices(env, env.ProjectID)
		} else {
			// Device -> Agent
			agentID, ok := h.resolveAgent(env.ProjectID)
			if ok {
				h.Route(env, agentID)
			}
		}

	case model.EventE2EOffer:
		// Forward public key offer: agent->devices or device->agent
		if from.Type == model.ClientTypeAgent {
			h.BroadcastToDevices(env, env.ProjectID)
		} else {
			agentID, ok := h.resolveAgent(env.ProjectID)
			if ok {
				h.Route(env, agentID)
			}
		}

	case model.EventE2EAnswer:
		// Forward public key answer: device->agent or agent->devices
		if from.Type == model.ClientTypeDevice {
			agentID, ok := h.resolveAgent(env.ProjectID)
			if ok {
				h.Route(env, agentID)
			}
		} else {
			h.BroadcastToDevices(env, env.ProjectID)
		}

	default:
		log.Warn().Str("event", env.Event).Str("client_id", from.ID).Msg("unhandled event")
	}
}

// Route delivers env to the target agent, or queues it if the agent is offline.
func (h *Hub) Route(env *model.Envelope, targetAgentID string) {
	v, ok := h.agents.Load(targetAgentID)
	if !ok {
		if env.ProjectID != "" {
			q := h.GetOrCreateQueue(env.ProjectID)
			q.Push(env)
			log.Debug().
				Str("agent_id", targetAgentID).
				Str("project_id", env.ProjectID).
				Msg("message queued for offline agent")
		}
		return
	}
	agent := v.(*Client)
	if err := agent.Send(env); err != nil {
		log.Error().Err(err).Str("agent_id", targetAgentID).Msg("failed to send to agent")
	}
}

// BroadcastToDevices sends env to every device bound to the project's agent.
func (h *Hub) BroadcastToDevices(env *model.Envelope, projectID string) {
	agentID, ok := h.resolveAgent(projectID)
	if !ok {
		return
	}
	h.devices.Range(func(_, v interface{}) bool {
		d := v.(*Client)
		if d.AgentID == agentID {
			if err := d.Send(env); err != nil {
				log.Warn().Err(err).Str("device_id", d.DeviceID).Msg("broadcast send failed")
			}
		}
		return true
	})
}

// resolveAgent returns the agentID responsible for projectID.
func (h *Hub) resolveAgent(projectID string) (string, bool) {
	v, ok := h.projects.Load(projectID)
	if !ok {
		return "", false
	}
	return v.(string), true
}

// sendError sends an erope back to the originating client.
func (h *Hub) sendError(to *Client, refID, code, message string) {
	payload, _ := json.Marshal(model.ErrorPayload{Code: code, Message: message})
	env := &model.Envelope{
		ID:        newID(),
		Event:     model.EventError,
		Seq:       h.NextSeq(),
		Timestamp: time.Now().UnixMilli(),
		Payload:   payload,
	}
	_ = to.Send(env)
}

// BindProject registers a project->agent mapping (used by REST handler).
func (h *Hub) BindProject(projectID, agentID, name, path string) {
	h.projects.Store(projectID, agentID)
	h.projectInfos.Store(projectID, &ProjectInfo{
		ID:      projectID,
		Name:    name,
		Path:    path,
		AgentID: agentID,
	})
	log.Info().Str("project_id", projectID).Str("agent_id", agentID).Msg("project bound via REST")
}

// SendToAgent delivers env to the agent if online; returns true if delivered.
func (h *Hub) SendToAgent(agentID string, env *model.Envelope) bool {
	v, ok := h.agents.Load(agentID)
	if !ok {
		return false
	}
	agent := v.(*Client)
	_ = agent.Send(env)
	return true
}

// GetAgentProjects returns all projects bound to the given agent.
func (h *Hub) GetAgentProjects(agentID string) []map[string]string {
	projects := []map[string]string{}
	h.projectInfos.Range(func(k, v interface{}) bool {
		info := v.(*ProjectInfo)
		if info.AgentID == agentID {
			projects = append(projects, map[string]string{
				"id":   info.ID,
				"name": info.Name,
				"path": info.Path,
			})
		}
		return true
	})
	return projects
}

// GetProjectIDsByAgent returns all project IDs currently bound to agentID.
func (h *Hub) GetProjectIDsByAgent(agentID string) []string {
	projectIDs := []string{}
	h.projects.Range(func(k, v interface{}) bool {
		if v.(string) == agentID {
			projectIDs = append(projectIDs, k.(string))
		}
		return true
	})
	return projectIDs
}
