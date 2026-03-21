package hub

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/model"
	"github.com/claudecode/relay-server/store"
	"github.com/rs/zerolog/log"
)

// ProjectInfo stores project metadata
type ProjectInfo struct {
	ID          string
	Name        string
	Path        string
	AgentID     string
	CLIProvider string
	CLIModel    string
}

// Hub is the central message router connecting agents and devices.
type Hub struct {
	agents       sync.Map // agentID  -> *Client
	devices      sync.Map // deviceID -> *Client
	projects     sync.Map // projectID -> agentID
	projectInfos sync.Map // projectID -> *ProjectInfo
	queues       sync.Map // projectID -> *Queue
	cfg          *config.Config
	store        *store.Store
	seq          int64 // atomic sequence counter
}

// NewHub creates a Hub with the given configuration.
func NewHub(cfg *config.Config, st *store.Store) *Hub {
	return &Hub{cfg: cfg, store: st}
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
	h.broadcastAgentStatus(client.AgentID, true)
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
		h.broadcastAgentStatus(client.AgentID, false)

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
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env.ID, "forbidden", "only devices can send messages")
			return
		}
		agentID, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID)
		if !ok {
			return
		}
		h.Route(env, agentID)

	case model.EventMessageChunk, model.EventMessageDone, model.EventMessageError:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env.ID, "forbidden", "only agents can stream message responses")
			return
		}
		if _, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID); !ok {
			return
		}
		h.BroadcastToDevices(env, env.ProjectID)

	case model.EventTaskStop:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env.ID, "forbidden", "only devices can stop tasks")
			return
		}
		agentID, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID)
		if !ok {
			return
		}
		h.Route(env, agentID)

	case model.EventSessionSyncRequest:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env.ID, "forbidden", "only devices can request session sync")
			return
		}
		agentID, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID)
		if !ok {
			return
		}
		h.Route(env, agentID)

	case model.EventSessionSync:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env.ID, "forbidden", "only agents can publish session sync")
			return
		}
		if _, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID); !ok {
			return
		}
		h.BroadcastToDevices(env, env.ProjectID)

	case model.EventAgentStatus:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env.ID, "forbidden", "only agents can publish agent status")
			return
		}

		var p model.AgentStatusPayload
		if len(env.Payload) > 0 {
			if err := json.Unmarshal(env.Payload, &p); err != nil {
				log.Warn().Err(err).Msg("invalid agent.status payload")
				h.sendError(from, env.ID, "bad_request", "invalid agent.status payload")
				return
			}
		}

		p.AgentID = from.AgentID
		if p.ProjectID == "" {
			p.ProjectID = env.ProjectID
		}

		if p.ProjectID != "" {
			if _, ok := h.authorizeProjectAccess(from, env.ID, p.ProjectID); !ok {
				return
			}
			h.broadcastAgentStatus(from.AgentID, p.Online, p.ProjectID)
			return
		}

		h.broadcastAgentStatus(from.AgentID, p.Online)

	case model.EventProjectListRequest:
		if from.Type != model.ClientTypeDevice {
			log.Warn().Str("client_id", from.ID).Msg("project.list.request ignored for non-device client")
			return
		}
		if !h.refreshDeviceBinding(from, env.ID) {
			return
		}
		if from.AgentID == "" {
			h.sendError(from, env.ID, "no_agent", "device is not bound to an agent")
			return
		}
		h.Route(env, from.AgentID)

	case model.EventProjectBind:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env.ID, "forbidden", "only agents can bind projects")
			return
		}
		var p model.ProjectBindPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			log.Warn().Err(err).Msg("invalid project.bind payload")
			h.sendError(from, env.ID, "bad_request", "invalid project.bind payload")
			return
		}
		if p.ProjectID == "" {
			h.sendError(from, env.ID, "bad_request", "project_id is required")
			return
		}
		if env.ProjectID != "" && env.ProjectID != p.ProjectID {
			h.sendError(from, env.ID, "bad_request", "project_id mismatch")
			return
		}
		h.projects.Store(p.ProjectID, from.AgentID)
		h.projectInfos.Store(p.ProjectID, &ProjectInfo{
			ID:          p.ProjectID,
			Name:        p.Name,
			Path:        p.Path,
			AgentID:     from.AgentID,
			CLIProvider: p.CLIProvider,
			CLIModel:    p.CLIModel,
		})
		from.ProjectIDs = h.GetProjectIDsByAgent(from.AgentID)
		log.Info().Str("project_id", p.ProjectID).Str("agent_id", from.AgentID).Msg("project bound")
		h.broadcastProjectList(from.AgentID)
		h.broadcastAgentStatus(from.AgentID, true, p.ProjectID)

		ack := &model.Envelope{
			ID:        newID(),
			Event:     model.EventProjectBound,
			ProjectID: p.ProjectID,
			Seq:       h.NextSeq(),
			Timestamp: time.Now().UnixMilli(),
		}
		_ = from.Send(ack)

	case model.EventProjectBound:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env.ID, "forbidden", "only agents can acknowledge project bindings")
		}

	case model.EventProjectList:
		if from.Type != model.ClientTypeAgent {
			log.Warn().Str("client_id", from.ID).Msg("project.list ignored for non-agent client")
			return
		}

		var p model.ProjectListPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			log.Warn().Err(err).Msg("invalid project.list payload")
			return
		}

		agentID := from.AgentID
		if p.AgentID != "" && agentID != "" && p.AgentID != agentID {
			h.sendError(from, env.ID, "forbidden", "agent mismatch")
			return
		}
		if agentID == "" {
			log.Warn().Str("client_id", from.ID).Msg("project.list missing agent id")
			return
		}

		h.ReplaceAgentProjects(agentID, p.Projects)

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
			if _, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID); !ok {
				return
			}
			h.BroadcastToDevices(env, env.ProjectID)
		} else if from.Type == model.ClientTypeDevice {
			agentID, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID)
			if !ok {
				return
			}
			h.Route(env, agentID)
		} else {
			h.sendError(from, env.ID, "forbidden", "unknown client type")
		}

	case model.EventFileUpload, model.EventFileChunk, model.EventFileDone, model.EventFileError:
		if from.Type == model.ClientTypeAgent {
			if _, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID); !ok {
				return
			}
			h.BroadcastToDevices(env, env.ProjectID)
		} else if from.Type == model.ClientTypeDevice {
			agentID, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID)
			if !ok {
				return
			}
			h.Route(env, agentID)
		} else {
			h.sendError(from, env.ID, "forbidden", "unknown client type")
		}

	case model.EventE2EOffer:
		if from.Type == model.ClientTypeAgent {
			if _, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID); !ok {
				return
			}
			h.BroadcastToDevices(env, env.ProjectID)
		} else if from.Type == model.ClientTypeDevice {
			agentID, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID)
			if !ok {
				return
			}
			h.Route(env, agentID)
		} else {
			h.sendError(from, env.ID, "forbidden", "unknown client type")
		}

	case model.EventE2EAnswer:
		if from.Type == model.ClientTypeDevice {
			agentID, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID)
			if !ok {
				return
			}
			h.Route(env, agentID)
		} else if from.Type == model.ClientTypeAgent {
			if _, ok := h.authorizeProjectAccess(from, env.ID, env.ProjectID); !ok {
				return
			}
			h.BroadcastToDevices(env, env.ProjectID)
		} else {
			h.sendError(from, env.ID, "forbidden", "unknown client type")
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
	h.broadcastToDevicesByAgent(agentID, env)
}

func (h *Hub) broadcastToDevicesByAgent(agentID string, env *model.Envelope) {
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

func (h *Hub) authorizeProjectAccess(from *Client, refID, projectID string) (string, bool) {
	if projectID == "" {
		h.sendError(from, refID, "bad_request", "project_id is required")
		return "", false
	}

	agentID, ok := h.resolveAgent(projectID)
	if !ok {
		log.Warn().Str("project_id", projectID).Msg("no agent for project")
		h.sendError(from, refID, "no_agent", "no agent registered for project")
		return "", false
	}

	switch from.Type {
	case model.ClientTypeAgent:
		if from.AgentID == "" || from.AgentID != agentID {
			h.sendError(from, refID, "forbidden", "agent is not authorized for project")
			return "", false
		}
	case model.ClientTypeDevice:
		if !h.refreshDeviceBinding(from, refID) {
			return "", false
		}
		if from.AgentID == "" || from.AgentID != agentID {
			h.sendError(from, refID, "forbidden", "device is not authorized for project")
			return "", false
		}
	default:
		h.sendError(from, refID, "forbidden", "unknown client type")
		return "", false
	}

	return agentID, true
}

func (h *Hub) refreshDeviceBinding(from *Client, refID string) bool {
	if from.Type != model.ClientTypeDevice || from.DeviceID == "" || h.store == nil {
		return true
	}

	agentID, ok := h.store.GetDeviceAgentID(from.DeviceID)
	if !ok || agentID == "" {
		from.AgentID = ""
		h.sendError(from, refID, "no_agent", "device is not bound to an agent")
		return false
	}

	from.AgentID = agentID
	return true
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
func (h *Hub) BindProject(projectID, agentID, name, path, cliProvider, cliModel string) {
	h.projects.Store(projectID, agentID)
	h.projectInfos.Store(projectID, &ProjectInfo{
		ID:          projectID,
		Name:        name,
		Path:        path,
		AgentID:     agentID,
		CLIProvider: cliProvider,
		CLIModel:    cliModel,
	})
	log.Info().Str("project_id", projectID).Str("agent_id", agentID).Msg("project bound via REST")
	h.broadcastProjectList(agentID)
	if h.isAgentOnline(agentID) {
		h.broadcastAgentStatus(agentID, true, projectID)
	}
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
func (h *Hub) GetAgentProjects(agentID string) []model.ProjectListItem {
	return h.getAgentProjectListItems(agentID)
}

func (h *Hub) ReplaceAgentProjects(agentID string, projects []model.ProjectListItem) {
	keep := make(map[string]model.ProjectListItem, len(projects))
	for _, project := range projects {
		if project.ID == "" {
			continue
		}
		keep[project.ID] = project
	}

	h.projectInfos.Range(func(_, value interface{}) bool {
		info := value.(*ProjectInfo)
		if info.AgentID != agentID {
			return true
		}
		if _, ok := keep[info.ID]; ok {
			return true
		}
		h.projectInfos.Delete(info.ID)
		h.projects.Delete(info.ID)
		return true
	})

	for _, project := range projects {
		if project.ID == "" {
			continue
		}
		h.projects.Store(project.ID, agentID)
		h.projectInfos.Store(project.ID, &ProjectInfo{
			ID:          project.ID,
			Name:        project.Name,
			Path:        project.Path,
			AgentID:     agentID,
			CLIProvider: project.CLIProvider,
			CLIModel:    project.CLIModel,
		})
	}

	if value, ok := h.agents.Load(agentID); ok {
		agent := value.(*Client)
		projectIDs := make([]string, 0, len(keep))
		for _, project := range projects {
			if project.ID == "" {
				continue
			}
			projectIDs = append(projectIDs, project.ID)
		}
		agent.ProjectIDs = projectIDs
	}

	h.broadcastProjectList(agentID)
	if h.isAgentOnline(agentID) {
		projectIDs := make([]string, 0, len(keep))
		for _, project := range projects {
			if project.ID == "" {
				continue
			}
			projectIDs = append(projectIDs, project.ID)
		}
		h.broadcastAgentStatus(agentID, true, projectIDs...)
	}
}

func (h *Hub) broadcastProjectList(agentID string) {
	payload, err := json.Marshal(model.ProjectListPayload{
		AgentID:  agentID,
		Projects: h.getAgentProjectListItems(agentID),
	})
	if err != nil {
		log.Warn().Err(err).Str("agent_id", agentID).Msg("failed to marshal project.listed payload")
		return
	}

	env := &model.Envelope{
		ID:        newID(),
		Event:     model.EventProjectListed,
		Seq:       h.NextSeq(),
		Timestamp: time.Now().UnixMilli(),
		Payload:   payload,
	}
	h.broadcastToDevicesByAgent(agentID, env)
}

func (h *Hub) getAgentProjectListItems(agentID string) []model.ProjectListItem {
	projects := make([]model.ProjectListItem, 0)
	online := h.isAgentOnline(agentID)
	h.projectInfos.Range(func(_, value interface{}) bool {
		info := value.(*ProjectInfo)
		if info.AgentID != agentID {
			return true
		}
		projects = append(projects, model.ProjectListItem{
			ID:          info.ID,
			Name:        info.Name,
			Path:        info.Path,
			CLIProvider: info.CLIProvider,
			CLIModel:    info.CLIModel,
			Online:      online,
		})
		return true
	})
	return projects
}

func (h *Hub) broadcastAgentStatus(agentID string, online bool, projectIDs ...string) {
	if agentID == "" {
		return
	}

	if len(projectIDs) == 0 {
		projectIDs = h.GetProjectIDsByAgent(agentID)
	}

	for _, projectID := range projectIDs {
		if projectID == "" {
			continue
		}

		payload, err := json.Marshal(model.AgentStatusPayload{
			AgentID:   agentID,
			Online:    online,
			ProjectID: projectID,
		})
		if err != nil {
			log.Warn().Err(err).Str("agent_id", agentID).Str("project_id", projectID).Msg("failed to marshal agent.status payload")
			continue
		}

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
}

func (h *Hub) isAgentOnline(agentID string) bool {
	if agentID == "" {
		return false
	}
	_, ok := h.agents.Load(agentID)
	return ok
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
