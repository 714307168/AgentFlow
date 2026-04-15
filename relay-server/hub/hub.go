package hub

import (
	"encoding/json"
	"sort"
	"strings"
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
	ID            string
	Name          string
	Path          string
	GroupName     string
	AgentID       string
	CLIProvider   string
	CLIModel      string
	ProjectPrompt string
}

var agentOfflineGracePeriod = 6 * time.Second

// Hub is the central message router connecting agents and devices.
type Hub struct {
	agents              sync.Map // agentID  -> *Client
	devices             sync.Map // deviceID -> *Client
	agentPresence       sync.Map // agentID  -> *presenceRecord
	devicePresence      sync.Map // deviceID -> *presenceRecord
	projects            sync.Map // projectID -> agentID
	projectInfos        sync.Map // projectID -> *ProjectInfo
	queues              sync.Map // projectID -> *Queue
	pendingAgentOffline sync.Map // agentID -> *time.Timer
	trafficMu           sync.RWMutex
	trafficByEvent      map[string]*EventTrafficCounter
	cfg                 *config.Config
	store               *store.Store
	seq                 int64 // atomic sequence counter
}

type PresenceSnapshot struct {
	Agents  map[string]bool
	Devices map[string]bool
}

type EventTrafficCounter struct {
	Event         string `json:"event"`
	InboundCount  int64  `json:"inbound_count"`
	InboundBytes  int64  `json:"inbound_bytes"`
	OutboundCount int64  `json:"outbound_count"`
	OutboundBytes int64  `json:"outbound_bytes"`
}

func resolveEnvelopeAgentID(env *model.Envelope) string {
	if env == nil {
		return ""
	}
	if agentID := strings.TrimSpace(env.AgentID); agentID != "" {
		return agentID
	}
	if len(env.Payload) == 0 {
		return ""
	}
	var payload struct {
		AgentID string `json:"agent_id"`
	}
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.AgentID)
}

// NewHub creates a Hub with the given configuration.
func NewHub(cfg *config.Config, st *store.Store) *Hub {
	return &Hub{
		cfg:            cfg,
		store:          st,
		trafficByEvent: make(map[string]*EventTrafficCounter),
	}
}

func (h *Hub) PresenceSnapshot() PresenceSnapshot {
	snapshot := PresenceSnapshot{
		Agents:  map[string]bool{},
		Devices: map[string]bool{},
	}

	h.agents.Range(func(key, _ interface{}) bool {
		if id, ok := key.(string); ok && id != "" {
			snapshot.Agents[id] = true
		}
		return true
	})

	h.devices.Range(func(key, _ interface{}) bool {
		if id, ok := key.(string); ok && id != "" {
			snapshot.Devices[id] = true
		}
		return true
	})

	return snapshot
}

func (h *Hub) RecordInbound(event string, bytes int) {
	h.recordTraffic(event, int64(bytes), true)
}

func (h *Hub) RecordOutbound(event string, bytes int) {
	h.recordTraffic(event, int64(bytes), false)
}

func (h *Hub) recordTraffic(event string, bytes int64, inbound bool) {
	if event == "" {
		event = "unknown"
	}
	if bytes < 0 {
		bytes = 0
	}

	h.trafficMu.Lock()
	defer h.trafficMu.Unlock()

	counter, ok := h.trafficByEvent[event]
	if !ok {
		counter = &EventTrafficCounter{Event: event}
		h.trafficByEvent[event] = counter
	}
	if inbound {
		counter.InboundCount++
		counter.InboundBytes += bytes
		return
	}
	counter.OutboundCount++
	counter.OutboundBytes += bytes
}

func (h *Hub) TrafficSnapshot() []EventTrafficCounter {
	h.trafficMu.RLock()
	items := make([]EventTrafficCounter, 0, len(h.trafficByEvent))
	for _, counter := range h.trafficByEvent {
		items = append(items, *counter)
	}
	h.trafficMu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		leftBytes := items[i].InboundBytes + items[i].OutboundBytes
		rightBytes := items[j].InboundBytes + items[j].OutboundBytes
		if leftBytes != rightBytes {
			return leftBytes > rightBytes
		}
		leftCount := items[i].InboundCount + items[i].OutboundCount
		rightCount := items[j].InboundCount + items[j].OutboundCount
		if leftCount != rightCount {
			return leftCount > rightCount
		}
		return items[i].Event < items[j].Event
	})

	return items
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
	h.cancelPendingAgentOffline(client.AgentID)
	h.recordClientConnected(client)
	if existingValue, ok := h.agents.Load(client.AgentID); ok {
		if existing, sameType := existingValue.(*Client); sameType && existing != client {
			log.Info().
				Str("agent_id", client.AgentID).
				Str("previous_client_id", existing.ID).
				Str("next_client_id", client.ID).
				Msg("replacing existing agent connection")
			existing.Close()
			_ = existing.conn.Close()
		}
	}
	h.agents.Store(client.AgentID, client)
	log.Info().Str("agent_id", client.AgentID).Msg("agent registered")
	h.broadcastAgentStatus(client.AgentID, true)
}

// RegisterDevice stores the device client.
func (h *Hub) RegisterDevice(client *Client) {
	_ = h.refreshDeviceAccess(client, "")
	h.recordClientConnected(client)
	if existingValue, ok := h.devices.Load(client.DeviceID); ok {
		if existing, sameType := existingValue.(*Client); sameType && existing != client {
			log.Info().
				Str("device_id", client.DeviceID).
				Str("previous_client_id", existing.ID).
				Str("next_client_id", client.ID).
				Msg("replacing existing device connection")
			existing.Close()
			_ = existing.conn.Close()
		}
	}
	h.devices.Store(client.DeviceID, client)
	log.Info().Str("device_id", client.DeviceID).Str("agent_id", client.AgentID).Msg("device registered")
}

// Unregister removes a client from all maps and notifies peers.
func (h *Hub) Unregister(client *Client) {
	client.Close()
	h.recordClientDisconnected(client)

	switch client.Type {
	case model.ClientTypeAgent:
		if existingValue, ok := h.agents.Load(client.AgentID); ok {
			if existing, sameType := existingValue.(*Client); sameType && existing == client {
				h.agents.Delete(client.AgentID)
				log.Info().Str("agent_id", client.AgentID).Msg("agent unregistered")
				h.scheduleAgentOffline(client.AgentID)
			} else {
				log.Info().
					Str("agent_id", client.AgentID).
					Str("client_id", client.ID).
					Msg("skipping stale agent unregister")
			}
		}

	case model.ClientTypeDevice:
		if existingValue, ok := h.devices.Load(client.DeviceID); ok {
			if existing, sameType := existingValue.(*Client); sameType && existing == client {
				h.devices.Delete(client.DeviceID)
				log.Info().Str("device_id", client.DeviceID).Msg("device unregistered")
			} else {
				log.Info().
					Str("device_id", client.DeviceID).
					Str("client_id", client.ID).
					Msg("skipping stale device unregister")
			}
		}
	}
}

// HandleMessage routes an inbound envelope from a client.
func (h *Hub) HandleMessage(from *Client, env *model.Envelope) {
	env.Seq = h.NextSeq()
	env.Timestamp = time.Now().UnixMilli()

	switch env.Event {
	case model.EventMessageSend:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can send messages")
			return
		}
		agentID, ok := h.authorizeProjectAccess(from, env)
		if !ok {
			return
		}
		h.Route(env, agentID)

	case model.EventMessageChunk, model.EventMessageDone, model.EventMessageError:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env, "forbidden", "only agents can stream message responses")
			return
		}
		if _, ok := h.authorizeProjectAccess(from, env); !ok {
			return
		}
		h.BroadcastToDevices(env, env.ProjectID)

	case model.EventTaskStop:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can stop tasks")
			return
		}
		agentID, ok := h.authorizeProjectAccess(from, env)
		if !ok {
			return
		}
		h.Route(env, agentID)

	case model.EventSessionSyncRequest:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can request session sync")
			return
		}
		agentID, ok := h.authorizeProjectAccess(from, env)
		if !ok {
			return
		}
		h.Route(env, agentID)

	case model.EventSessionSync:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env, "forbidden", "only agents can publish session sync")
			return
		}
		if _, ok := h.authorizeProjectAccess(from, env); !ok {
			return
		}
		h.BroadcastToDevices(env, env.ProjectID)

	case model.EventWorkgroupListRequest:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can request workgroup data")
			return
		}
		agentID := resolveEnvelopeAgentID(env)
		if agentID == "" {
			agentID = from.AgentID
		}
		if !h.authorizeAgentAccess(from, env, agentID) {
			return
		}
		if !h.SendToAgent(agentID, env) {
			h.sendError(from, env, "agent_offline", "agent is offline")
		}

	case model.EventWorkgroupCommand:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can send workgroup commands")
			return
		}
		agentID := resolveEnvelopeAgentID(env)
		if agentID == "" {
			agentID = from.AgentID
		}
		if !h.authorizeAgentAccess(from, env, agentID) {
			return
		}
		if !h.SendToAgent(agentID, env) {
			h.sendError(from, env, "agent_offline", "agent is offline")
		}

	case model.EventWorkgroupList, model.EventWorkgroupCommandResult:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env, "forbidden", "only agents can publish workgroup updates")
			return
		}
		agentID := resolveEnvelopeAgentID(env)
		if agentID == "" {
			agentID = from.AgentID
		}
		if !h.authorizeAgentAccess(from, env, agentID) {
			return
		}
		h.broadcastToDevicesByAgent(agentID, env)

	case model.EventWorkgroupCollabListRequest:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can request workgroup collaboration data")
			return
		}
		agentID := resolveEnvelopeAgentID(env)
		if agentID == "" {
			agentID = from.AgentID
		}
		if !h.authorizeCollaborationAccess(from, env, agentID, env.WorkgroupID, true) {
			return
		}
		if !h.SendToAgent(agentID, env) {
			h.sendError(from, env, "agent_offline", "agent is offline")
		}

	case model.EventWorkgroupCollabSessionRequest:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can request workgroup collaboration sessions")
			return
		}
		agentID := resolveEnvelopeAgentID(env)
		if agentID == "" {
			agentID = from.AgentID
		}
		if !h.authorizeCollaborationAccess(from, env, agentID, env.WorkgroupID, false) {
			return
		}
		if !h.SendToAgent(agentID, env) {
			h.sendError(from, env, "agent_offline", "agent is offline")
		}

	case model.EventWorkgroupCollabMessageSend:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can send workgroup collaboration messages")
			return
		}
		agentID := resolveEnvelopeAgentID(env)
		if agentID == "" {
			agentID = from.AgentID
		}
		if !h.authorizeCollaborationAccess(from, env, agentID, env.WorkgroupID, false) {
			return
		}
		if !h.SendToAgent(agentID, env) {
			h.sendError(from, env, "agent_offline", "agent is offline")
		}

	case model.EventWorkgroupCollabList, model.EventWorkgroupCollabSession, model.EventWorkgroupCollabMessageResult, model.EventWorkgroupCollabSnapshot:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env, "forbidden", "only agents can publish workgroup collaboration updates")
			return
		}
		agentID := resolveEnvelopeAgentID(env)
		if agentID == "" {
			agentID = from.AgentID
		}
		if !h.authorizeAgentAccess(from, env, agentID) {
			return
		}
		h.broadcastToCollaborationDevices(agentID, env.WorkgroupID, env)

	case model.EventAgentStatus:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env, "forbidden", "only agents can publish agent status")
			return
		}

		var p model.AgentStatusPayload
		if len(env.Payload) > 0 {
			if err := json.Unmarshal(env.Payload, &p); err != nil {
				log.Warn().Err(err).Msg("invalid agent.status payload")
				h.sendError(from, env, "bad_request", "invalid agent.status payload")
				return
			}
		}

		p.AgentID = from.AgentID
		if p.ProjectID == "" {
			p.ProjectID = env.ProjectID
		}

		if p.ProjectID != "" {
			projectEnv := *env
			projectEnv.ProjectID = p.ProjectID
			if _, ok := h.authorizeProjectAccess(from, &projectEnv); !ok {
				return
			}
			if p.Online {
				h.cancelPendingAgentOffline(from.AgentID)
				h.broadcastAgentStatus(from.AgentID, true, p.ProjectID)
			} else {
				h.scheduleAgentOffline(from.AgentID, p.ProjectID)
			}
			return
		}

		if p.Online {
			h.cancelPendingAgentOffline(from.AgentID)
			h.broadcastAgentStatus(from.AgentID, true)
		} else {
			h.scheduleAgentOffline(from.AgentID)
		}

	case model.EventProjectListRequest:
		if from.Type != model.ClientTypeDevice {
			log.Warn().Str("client_id", from.ID).Msg("project.list.request ignored for non-device client")
			return
		}
		if !h.refreshDeviceAccess(from, env.ID) {
			return
		}
		accessibleAgentIDs := h.getSortedAccessibleAgentIDs(from)
		if len(accessibleAgentIDs) == 0 {
			payload, _ := json.Marshal(model.ProjectListPayload{
				Projects: []model.ProjectListItem{},
			})
			_ = from.Send(&model.Envelope{
				ID:        newID(),
				Event:     model.EventProjectListed,
				Seq:       h.NextSeq(),
				Timestamp: time.Now().UnixMilli(),
				Payload:   payload,
			})
			return
		}
		for _, agentID := range accessibleAgentIDs {
			h.sendProjectListToClient(from, agentID)
		}

	case model.EventProjectBind:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env, "forbidden", "only agents can bind projects")
			return
		}
		var p model.ProjectBindPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			log.Warn().Err(err).Msg("invalid project.bind payload")
			h.sendError(from, env, "bad_request", "invalid project.bind payload")
			return
		}
		if p.ProjectID == "" {
			h.sendError(from, env, "bad_request", "project_id is required")
			return
		}
		if env.ProjectID != "" && env.ProjectID != p.ProjectID {
			h.sendError(from, env, "bad_request", "project_id mismatch")
			return
		}
		h.projects.Store(p.ProjectID, from.AgentID)
		h.projectInfos.Store(p.ProjectID, &ProjectInfo{
			ID:            p.ProjectID,
			Name:          p.Name,
			Path:          p.Path,
			GroupName:     p.GroupName,
			AgentID:       from.AgentID,
			CLIProvider:   p.CLIProvider,
			CLIModel:      p.CLIModel,
			ProjectPrompt: p.ProjectPrompt,
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
			h.sendError(from, env, "forbidden", "only agents can acknowledge project bindings")
		}

	case model.EventE2EOffer:
		if from.Type != model.ClientTypeDevice {
			h.sendError(from, env, "forbidden", "only devices can initiate e2e key exchange")
			return
		}

		var payload model.E2EOfferPayload
		if len(env.Payload) > 0 {
			if err := json.Unmarshal(env.Payload, &payload); err != nil {
				h.sendError(from, env, "bad_request", "invalid e2e.offer payload")
				return
			}
		}

		agentID := payload.AgentID
		if agentID == "" {
			agentID = from.AgentID
		}
		if !h.authorizeAgentAccess(from, env, agentID) {
			return
		}

		payload.AgentID = agentID
		payload.DeviceID = from.DeviceID
		nextPayload, err := json.Marshal(payload)
		if err != nil {
			h.sendError(from, env, "bad_request", "failed to marshal e2e.offer payload")
			return
		}
		env.Payload = nextPayload

		if !h.SendToAgent(agentID, env) {
			h.sendError(from, env, "agent_offline", "agent is offline")
		}

	case model.EventE2EAnswer:
		if from.Type != model.ClientTypeAgent {
			h.sendError(from, env, "forbidden", "only agents can answer e2e key exchange")
			return
		}

		var payload model.E2EAnswerPayload
		if len(env.Payload) > 0 {
			if err := json.Unmarshal(env.Payload, &payload); err != nil {
				h.sendError(from, env, "bad_request", "invalid e2e.answer payload")
				return
			}
		}

		if payload.DeviceID == "" {
			h.sendError(from, env, "bad_request", "device_id is required for e2e.answer")
			return
		}

		payload.AgentID = from.AgentID
		nextPayload, err := json.Marshal(payload)
		if err != nil {
			h.sendError(from, env, "bad_request", "failed to marshal e2e.answer payload")
			return
		}
		env.Payload = nextPayload

		if !h.SendToDevice(payload.DeviceID, env, from.AgentID) {
			h.sendError(from, env, "device_offline", "device is offline or unauthorized")
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
			h.sendError(from, env, "forbidden", "agent mismatch")
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
			if _, ok := h.authorizeProjectAccess(from, env); !ok {
				return
			}
			h.BroadcastToDevices(env, env.ProjectID)
		} else if from.Type == model.ClientTypeDevice {
			agentID, ok := h.authorizeProjectAccess(from, env)
			if !ok {
				return
			}
			h.Route(env, agentID)
		} else {
			h.sendError(from, env, "forbidden", "unknown client type")
		}

	case model.EventFileUpload, model.EventFileChunk, model.EventFileDone, model.EventFileError:
		if from.Type == model.ClientTypeAgent {
			if _, ok := h.authorizeProjectAccess(from, env); !ok {
				return
			}
			h.BroadcastToDevices(env, env.ProjectID)
		} else if from.Type == model.ClientTypeDevice {
			agentID, ok := h.authorizeProjectAccess(from, env)
			if !ok {
				return
			}
			h.Route(env, agentID)
		} else {
			h.sendError(from, env, "forbidden", "unknown client type")
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
	h.broadcastToDevicesByProject(agentID, projectID, env)
}

func (h *Hub) broadcastToDevicesByAgent(agentID string, env *model.Envelope) {
	h.devices.Range(func(_, v interface{}) bool {
		d := v.(*Client)
		if d.CanAccessAgent(agentID) {
			if err := d.Send(env); err != nil {
				log.Warn().Err(err).Str("device_id", d.DeviceID).Msg("broadcast send failed")
			}
		}
		return true
	})
}

func (h *Hub) broadcastToDevicesByProject(agentID string, projectID string, env *model.Envelope) {
	if strings.TrimSpace(projectID) == "" {
		h.broadcastToDevicesByAgent(agentID, env)
		return
	}
	h.devices.Range(func(_, v interface{}) bool {
		device := v.(*Client)
		if !h.deviceCanAccessProject(device, agentID, projectID) {
			return true
		}
		if err := device.Send(env); err != nil {
			log.Warn().Err(err).Str("device_id", device.DeviceID).Msg("project broadcast send failed")
		}
		return true
	})
}

func (h *Hub) broadcastToCollaborationDevices(agentID string, workgroupID string, env *model.Envelope) {
	normalizedAgentID := strings.TrimSpace(agentID)
	normalizedWorkgroupID := strings.TrimSpace(workgroupID)
	h.devices.Range(func(_, v interface{}) bool {
		device := v.(*Client)
		if device.CanAccessAgent(normalizedAgentID) {
			if err := device.Send(env); err != nil {
				log.Warn().Err(err).Str("device_id", device.DeviceID).Msg("collaboration broadcast send failed")
			}
			return true
		}

		if h.store == nil || device.UserID <= 0 {
			return true
		}

		allowed := false
		if normalizedWorkgroupID != "" {
			exists, canAccess := h.store.CheckCollaborationGroupAccess(device.UserID, normalizedAgentID, normalizedWorkgroupID)
			allowed = exists && canAccess
		} else {
			allowed = h.store.HasAnyCollaborationGroupAccess(device.UserID, normalizedAgentID)
		}
		if !allowed {
			return true
		}

		if err := device.Send(env); err != nil {
			log.Warn().Err(err).Str("device_id", device.DeviceID).Msg("collaboration membership broadcast send failed")
		}
		return true
	})
}

func (h *Hub) SendToDevice(deviceID string, env *model.Envelope, agentID string) bool {
	if deviceID == "" {
		return false
	}

	value, ok := h.devices.Load(deviceID)
	if !ok {
		return false
	}

	device := value.(*Client)
	if !h.refreshDeviceAccess(device, env.ID) {
		return false
	}
	if env.ProjectID != "" && !h.deviceCanAccessProject(device, agentID, env.ProjectID) {
		return false
	}
	if agentID != "" && !device.CanAccessAgent(agentID) {
		return false
	}

	if err := device.Send(env); err != nil {
		log.Warn().Err(err).Str("device_id", deviceID).Msg("targeted device send failed")
		return false
	}
	return true
}

func (h *Hub) authorizeProjectAccess(from *Client, env *model.Envelope) (string, bool) {
	projectID := env.ProjectID
	if projectID == "" {
		h.sendError(from, env, "bad_request", "project_id is required")
		return "", false
	}

	agentID, ok := h.resolveAgent(projectID)
	if !ok {
		log.Warn().Str("project_id", projectID).Msg("no agent for project")
		h.sendError(from, env, "no_agent", "no agent registered for project")
		return "", false
	}

	switch from.Type {
	case model.ClientTypeAgent:
		if from.AgentID == "" || from.AgentID != agentID {
			h.sendError(from, env, "forbidden", "agent is not authorized for project")
			return "", false
		}
	case model.ClientTypeDevice:
		if !h.refreshDeviceAccess(from, env.ID) {
			return "", false
		}
		if !h.deviceCanAccessProject(from, agentID, projectID) {
			h.sendError(from, env, "forbidden", "device is not authorized for project")
			return "", false
		}
	default:
		h.sendError(from, env, "forbidden", "unknown client type")
		return "", false
	}

	return agentID, true
}

func (h *Hub) authorizeAgentAccess(from *Client, env *model.Envelope, agentID string) bool {
	if agentID == "" {
		h.sendError(from, env, "bad_request", "agent_id is required")
		return false
	}

	switch from.Type {
	case model.ClientTypeAgent:
		if from.AgentID == "" || from.AgentID != agentID {
			h.sendError(from, env, "forbidden", "agent is not authorized for agent scope")
			return false
		}
	case model.ClientTypeDevice:
		if !h.refreshDeviceAccess(from, env.ID) {
			return false
		}
		if !from.CanAccessAgent(agentID) {
			h.sendError(from, env, "forbidden", "device is not authorized for agent")
			return false
		}
	default:
		h.sendError(from, env, "forbidden", "unknown client type")
		return false
	}

	return true
}

func (h *Hub) authorizePublishedWorkgroupAccess(from *Client, env *model.Envelope, agentID, workgroupID string) bool {
	if from == nil || from.Type != model.ClientTypeDevice {
		return true
	}
	if strings.TrimSpace(agentID) == "" || strings.TrimSpace(workgroupID) == "" || h.store == nil || from.UserID <= 0 {
		return true
	}

	exists, allowed := h.store.CheckCollaborationGroupAccess(from.UserID, agentID, workgroupID)
	if !exists {
		return true
	}
	if allowed {
		return true
	}

	h.sendError(from, env, "forbidden", "device is not authorized for workgroup")
	return false
}

func (h *Hub) authorizeCollaborationAccess(from *Client, env *model.Envelope, agentID, workgroupID string, allowAgentWideMembership bool) bool {
	if strings.TrimSpace(agentID) == "" {
		h.sendError(from, env, "bad_request", "agent_id is required")
		return false
	}

	switch from.Type {
	case model.ClientTypeAgent:
		if from.AgentID == "" || from.AgentID != agentID {
			h.sendError(from, env, "forbidden", "agent is not authorized for collaboration scope")
			return false
		}
		return true

	case model.ClientTypeDevice:
		if !h.refreshDeviceAccess(from, env.ID) {
			return false
		}
		if from.CanAccessAgent(agentID) {
			return true
		}
		if strings.TrimSpace(workgroupID) != "" {
			return h.authorizePublishedWorkgroupAccess(from, env, agentID, workgroupID)
		}
		if allowAgentWideMembership && h.store != nil && from.UserID > 0 && h.store.HasAnyCollaborationGroupAccess(from.UserID, agentID) {
			return true
		}
		h.sendError(from, env, "forbidden", "device is not authorized for collaboration")
		return false

	default:
		h.sendError(from, env, "forbidden", "unknown client type")
		return false
	}
}

func (h *Hub) refreshDeviceAccess(from *Client, refID string) bool {
	if from.Type != model.ClientTypeDevice || from.DeviceID == "" || h.store == nil {
		return true
	}

	userID, ok := h.store.GetDeviceUserID(from.DeviceID)
	if !ok || userID <= 0 {
		from.UserID = 0
		from.AgentID = ""
		from.AccessibleAgentIDs = nil
		h.sendError(from, &model.Envelope{ID: refID}, "auth_failed", "device owner is unavailable")
		return false
	}

	accessibleAgentIDs := h.store.ListAccessibleAgentIDsForUser(userID)
	nextAccessible := make(map[string]struct{}, len(accessibleAgentIDs))
	for _, agentID := range accessibleAgentIDs {
		if agentID != "" {
			nextAccessible[agentID] = struct{}{}
		}
	}

	from.UserID = userID
	from.AccessibleAgentIDs = nextAccessible

	primaryAgentID := ""
	if agentID, bound := h.store.GetDeviceAgentID(from.DeviceID); bound {
		primaryAgentID = agentID
	}
	if primaryAgentID != "" {
		if _, allowed := nextAccessible[primaryAgentID]; allowed {
			from.AgentID = primaryAgentID
			return true
		}
	}

	from.AgentID = ""
	for agentID := range nextAccessible {
		from.AgentID = agentID
		break
	}
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

// sendError sends an error back to the originating client.
func (h *Hub) sendError(to *Client, source *model.Envelope, code, message string) {
	payload, _ := json.Marshal(model.ErrorPayload{
		Code:        code,
		Message:     message,
		RefID:       source.ID,
		AgentID:     source.AgentID,
		WorkgroupID: source.WorkgroupID,
		ProjectID:   source.ProjectID,
		StreamID:    source.StreamID,
	})
	env := &model.Envelope{
		ID:          newID(),
		Event:       model.EventError,
		AgentID:     source.AgentID,
		WorkgroupID: source.WorkgroupID,
		ProjectID:   source.ProjectID,
		StreamID:    source.StreamID,
		Seq:         h.NextSeq(),
		Timestamp:   time.Now().UnixMilli(),
		Payload:     payload,
	}
	_ = to.Send(env)
}

// BindProject registers a project->agent mapping (used by REST handler).
func (h *Hub) BindProject(projectID, agentID, name, path, groupName, cliProvider, cliModel string) {
	h.projects.Store(projectID, agentID)
	h.projectInfos.Store(projectID, &ProjectInfo{
		ID:            projectID,
		Name:          name,
		Path:          path,
		GroupName:     groupName,
		AgentID:       agentID,
		CLIProvider:   cliProvider,
		CLIModel:      cliModel,
		ProjectPrompt: "",
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

func (h *Hub) GetAccessibleProjectsByDevice(deviceID string) []model.ProjectListItem {
	if h.store == nil || deviceID == "" {
		return nil
	}

	agentIDs := h.store.ListAccessibleAgentIDsForDevice(deviceID)
	projects := make([]model.ProjectListItem, 0)
	for _, agentID := range agentIDs {
		projects = append(projects, h.getAgentProjectListItems(agentID)...)
	}
	return projects
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
			ID:            project.ID,
			Name:          project.Name,
			Path:          project.Path,
			GroupName:     project.GroupName,
			AgentID:       agentID,
			CLIProvider:   project.CLIProvider,
			CLIModel:      project.CLIModel,
			ProjectPrompt: project.ProjectPrompt,
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
	h.devices.Range(func(_, value interface{}) bool {
		device := value.(*Client)
		if !device.CanAccessAgent(agentID) {
			return true
		}
		h.sendProjectListToClient(device, agentID)
		return true
	})
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
			ID:            info.ID,
			AgentID:       info.AgentID,
			Name:          info.Name,
			Path:          info.Path,
			GroupName:     info.GroupName,
			CLIProvider:   info.CLIProvider,
			CLIModel:      info.CLIModel,
			ProjectPrompt: info.ProjectPrompt,
			Online:        online,
		})
		return true
	})
	return projects
}

func (h *Hub) sendProjectListToClient(client *Client, agentID string) {
	if client == nil {
		return
	}

	payload, err := json.Marshal(model.ProjectListPayload{
		AgentID:  agentID,
		Projects: h.getClientProjectListItems(client, agentID),
	})
	if err != nil {
		log.Warn().Err(err).Str("agent_id", agentID).Msg("failed to marshal targeted project.listed payload")
		return
	}

	_ = client.Send(&model.Envelope{
		ID:        newID(),
		Event:     model.EventProjectListed,
		Seq:       h.NextSeq(),
		Timestamp: time.Now().UnixMilli(),
		Payload:   payload,
	})
}

func (h *Hub) getClientProjectListItems(client *Client, agentID string) []model.ProjectListItem {
	projects := h.getAgentProjectListItems(agentID)
	if client == nil || client.Type != model.ClientTypeDevice || h.store == nil || client.UserID <= 0 {
		return projects
	}

	filtered := make([]model.ProjectListItem, 0, len(projects))
	for _, item := range projects {
		if item.ID == "" || h.store.UserCanAccessProject(client.UserID, agentID, item.ID) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func (h *Hub) deviceCanAccessProject(client *Client, agentID string, projectID string) bool {
	if client == nil || !client.CanAccessAgent(agentID) {
		return false
	}
	if strings.TrimSpace(projectID) == "" || h.store == nil || client.UserID <= 0 {
		return true
	}
	return h.store.UserCanAccessProject(client.UserID, agentID, projectID)
}

func (h *Hub) getSortedAccessibleAgentIDs(client *Client) []string {
	if client == nil || len(client.AccessibleAgentIDs) == 0 {
		return nil
	}

	agentIDs := make([]string, 0, len(client.AccessibleAgentIDs))
	for agentID := range client.AccessibleAgentIDs {
		if agentID != "" {
			agentIDs = append(agentIDs, agentID)
		}
	}
	sort.Strings(agentIDs)
	return agentIDs
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

func (h *Hub) recordClientInbound(client *Client) {
	record := h.presenceRecordForClient(client)
	if record == nil {
		return
	}
	record.markInbound(time.Now())
}

func (h *Hub) recordClientTransport(client *Client) {
	record := h.presenceRecordForClient(client)
	if record == nil {
		return
	}
	record.markTransport(time.Now())
}

func (h *Hub) recordClientConnected(client *Client) {
	record := h.presenceRecordForClient(client)
	if record == nil {
		return
	}
	record.markConnected(time.Now())
}

func (h *Hub) recordClientDisconnected(client *Client) {
	record := h.presenceRecordForClient(client)
	if record == nil {
		return
	}
	record.markDisconnected(time.Now())
}

func (h *Hub) presenceRecordForClient(client *Client) *presenceRecord {
	if client == nil {
		return nil
	}
	switch client.Type {
	case model.ClientTypeAgent:
		if client.AgentID == "" {
			return nil
		}
		record, _ := h.agentPresence.LoadOrStore(client.AgentID, newPresenceRecord(model.ClientTypeAgent))
		return record.(*presenceRecord)
	case model.ClientTypeDevice:
		if client.DeviceID == "" {
			return nil
		}
		record, _ := h.devicePresence.LoadOrStore(client.DeviceID, newPresenceRecord(model.ClientTypeDevice))
		return record.(*presenceRecord)
	default:
		return nil
	}
}

func (h *Hub) AgentPresence(agentID string) PresenceInfo {
	if strings.TrimSpace(agentID) == "" {
		return PresenceInfo{State: PresenceStateOffline}
	}
	if value, ok := h.agentPresence.Load(agentID); ok {
		return value.(*presenceRecord).snapshot(time.Now())
	}
	return PresenceInfo{State: PresenceStateOffline}
}

func (h *Hub) DevicePresence(deviceID string) PresenceInfo {
	if strings.TrimSpace(deviceID) == "" {
		return PresenceInfo{State: PresenceStateOffline}
	}
	if value, ok := h.devicePresence.Load(deviceID); ok {
		return value.(*presenceRecord).snapshot(time.Now())
	}
	return PresenceInfo{State: PresenceStateOffline}
}

func (h *Hub) cancelPendingAgentOffline(agentID string) {
	if agentID == "" {
		return
	}
	if value, ok := h.pendingAgentOffline.LoadAndDelete(agentID); ok {
		if timer, ok := value.(*time.Timer); ok {
			timer.Stop()
		}
	}
}

func (h *Hub) scheduleAgentOffline(agentID string, projectIDs ...string) {
	if agentID == "" {
		return
	}

	h.cancelPendingAgentOffline(agentID)
	if len(projectIDs) == 0 {
		projectIDs = h.GetProjectIDsByAgent(agentID)
	}
	targetProjectIDs := append([]string(nil), projectIDs...)

	timer := time.AfterFunc(agentOfflineGracePeriod, func() {
		h.pendingAgentOffline.Delete(agentID)
		if h.isAgentOnline(agentID) {
			return
		}
		h.broadcastAgentStatus(agentID, false, targetProjectIDs...)
	})
	h.pendingAgentOffline.Store(agentID, timer)
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
