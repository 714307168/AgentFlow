package hub

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/model"
	"github.com/claudecode/relay-server/store"
)

func TestRegisterAgentBroadcastsOnlineStatusForKnownProjects(t *testing.T) {
	h := NewHub(&config.Config{}, nil)
	device := newTestClient(h, model.ClientTypeDevice, "agent-1", "device-1")
	h.RegisterDevice(device)

	h.projects.Store("project-1", "agent-1")
	h.projectInfos.Store("project-1", &ProjectInfo{
		ID:      "project-1",
		Name:    "Project 1",
		Path:    "/tmp/project-1",
		AgentID: "agent-1",
	})

	agent := newTestClient(h, model.ClientTypeAgent, "agent-1", "")
	h.RegisterAgent(agent)

	env := readEnvelope(t, device)
	if env.Event != model.EventAgentStatus {
		t.Fatalf("expected %q, got %q", model.EventAgentStatus, env.Event)
	}
	if env.ProjectID != "project-1" {
		t.Fatalf("expected project-1, got %q", env.ProjectID)
	}

	var payload model.AgentStatusPayload
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if !payload.Online {
		t.Fatal("expected online=true")
	}
	if payload.AgentID != "agent-1" {
		t.Fatalf("expected agent-1, got %q", payload.AgentID)
	}
}

func TestReplaceAgentProjectsBroadcastsOnlineProjectListAndStatus(t *testing.T) {
	h := NewHub(&config.Config{}, nil)
	device := newTestClient(h, model.ClientTypeDevice, "agent-1", "device-1")
	agent := newTestClient(h, model.ClientTypeAgent, "agent-1", "")

	h.RegisterDevice(device)
	h.RegisterAgent(agent)

	projects := []model.ProjectListItem{{
		ID:          "project-1",
		Name:        "Project 1",
		Path:        "/tmp/project-1",
		CLIProvider: "claude",
		CLIModel:    "sonnet",
	}}

	h.ReplaceAgentProjects("agent-1", projects)

	listed := readEnvelope(t, device)
	if listed.Event != model.EventProjectListed {
		t.Fatalf("expected first event %q, got %q", model.EventProjectListed, listed.Event)
	}

	var listPayload model.ProjectListPayload
	if err := json.Unmarshal(listed.Payload, &listPayload); err != nil {
		t.Fatalf("unmarshal project.listed payload: %v", err)
	}
	if len(listPayload.Projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(listPayload.Projects))
	}
	if !listPayload.Projects[0].Online {
		t.Fatal("expected listed project to be online")
	}

	status := readEnvelope(t, device)
	if status.Event != model.EventAgentStatus {
		t.Fatalf("expected second event %q, got %q", model.EventAgentStatus, status.Event)
	}

	var statusPayload model.AgentStatusPayload
	if err := json.Unmarshal(status.Payload, &statusPayload); err != nil {
		t.Fatalf("unmarshal agent.status payload: %v", err)
	}
	if !statusPayload.Online {
		t.Fatal("expected online=true")
	}
	if statusPayload.ProjectID != "project-1" {
		t.Fatalf("expected project-1, got %q", statusPayload.ProjectID)
	}
}

func TestUnregisterAgentDelaysOfflineStatus(t *testing.T) {
	previousGracePeriod := agentOfflineGracePeriod
	agentOfflineGracePeriod = 15 * time.Millisecond
	defer func() {
		agentOfflineGracePeriod = previousGracePeriod
	}()

	h := NewHub(&config.Config{}, nil)
	device := newTestClient(h, model.ClientTypeDevice, "agent-1", "device-1")
	agent := newTestClient(h, model.ClientTypeAgent, "agent-1", "")

	h.RegisterDevice(device)
	h.projects.Store("project-1", "agent-1")
	h.projectInfos.Store("project-1", &ProjectInfo{
		ID:      "project-1",
		Name:    "Project 1",
		Path:    "/tmp/project-1",
		AgentID: "agent-1",
	})
	h.RegisterAgent(agent)
	_ = readEnvelope(t, device)

	h.Unregister(agent)

	select {
	case raw := <-device.send:
		var env model.Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal envelope: %v", err)
		}
		t.Fatalf("expected no immediate offline event, got %q", env.Event)
	default:
	}

	time.Sleep(agentOfflineGracePeriod * 3)

	env := readEnvelope(t, device)
	if env.Event != model.EventAgentStatus {
		t.Fatalf("expected %q, got %q", model.EventAgentStatus, env.Event)
	}

	var payload model.AgentStatusPayload
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Online {
		t.Fatal("expected delayed offline status")
	}
}

func TestRegisterAgentCancelsPendingOfflineStatus(t *testing.T) {
	previousGracePeriod := agentOfflineGracePeriod
	agentOfflineGracePeriod = 15 * time.Millisecond
	defer func() {
		agentOfflineGracePeriod = previousGracePeriod
	}()

	h := NewHub(&config.Config{}, nil)
	device := newTestClient(h, model.ClientTypeDevice, "agent-1", "device-1")
	agent := newTestClient(h, model.ClientTypeAgent, "agent-1", "")

	h.RegisterDevice(device)
	h.projects.Store("project-1", "agent-1")
	h.projectInfos.Store("project-1", &ProjectInfo{
		ID:      "project-1",
		Name:    "Project 1",
		Path:    "/tmp/project-1",
		AgentID: "agent-1",
	})
	h.RegisterAgent(agent)
	_ = readEnvelope(t, device)

	h.Unregister(agent)
	h.RegisterAgent(newTestClient(h, model.ClientTypeAgent, "agent-1", ""))

	env := readEnvelope(t, device)
	if env.Event != model.EventAgentStatus {
		t.Fatalf("expected %q, got %q", model.EventAgentStatus, env.Event)
	}

	var payload model.AgentStatusPayload
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if !payload.Online {
		t.Fatal("expected reconnect to broadcast online status")
	}

	time.Sleep(agentOfflineGracePeriod * 3)

	select {
	case raw := <-device.send:
		var delayed model.Envelope
		if err := json.Unmarshal(raw, &delayed); err != nil {
			t.Fatalf("unmarshal delayed envelope: %v", err)
		}
		t.Fatalf("expected pending offline timer to be cancelled, got %q", delayed.Event)
	default:
	}
}

func TestDevicePresenceTracksBackgroundAndOfflineState(t *testing.T) {
	h := NewHub(&config.Config{}, nil)
	device := newTestClient(h, model.ClientTypeDevice, "agent-1", "device-1")

	h.RegisterDevice(device)

	initial := h.DevicePresence("device-1")
	if !initial.Online || initial.State != PresenceStateOnline {
		t.Fatalf("expected connected device to be online, got %+v", initial)
	}
	if initial.LastActiveAt.IsZero() || initial.LastSeenAt.IsZero() {
		t.Fatalf("expected connected device timestamps, got %+v", initial)
	}

	recordValue, ok := h.devicePresence.Load("device-1")
	if !ok {
		t.Fatal("expected device presence record")
	}
	record := recordValue.(*presenceRecord)
	staleAt := time.Now().Add(-(presenceActiveWindow + 5*time.Second))
	record.mu.Lock()
	record.connectedAt = staleAt
	record.lastInboundAt = staleAt
	record.lastTransportAt = time.Now()
	record.mu.Unlock()

	background := h.DevicePresence("device-1")
	if !background.Online || background.State != PresenceStateBackground {
		t.Fatalf("expected stale connected device to be background, got %+v", background)
	}

	h.Unregister(device)
	offline := h.DevicePresence("device-1")
	if offline.Online || offline.State != PresenceStateOffline {
		t.Fatalf("expected disconnected device to be offline, got %+v", offline)
	}
	if offline.LastSeenAt.IsZero() {
		t.Fatalf("expected offline device to keep last seen timestamp, got %+v", offline)
	}
}

func TestAgentPresenceTracksIdleState(t *testing.T) {
	h := NewHub(&config.Config{}, nil)
	agent := newTestClient(h, model.ClientTypeAgent, "agent-1", "")

	h.RegisterAgent(agent)

	recordValue, ok := h.agentPresence.Load("agent-1")
	if !ok {
		t.Fatal("expected agent presence record")
	}
	record := recordValue.(*presenceRecord)
	record.mu.Lock()
	staleAt := time.Now().Add(-(presenceActiveWindow + 5*time.Second))
	record.connectedAt = staleAt
	record.lastInboundAt = staleAt
	record.lastTransportAt = time.Now()
	record.mu.Unlock()

	presence := h.AgentPresence("agent-1")
	if !presence.Online || presence.State != PresenceStateIdle {
		t.Fatalf("expected stale connected agent to be idle, got %+v", presence)
	}
}

func TestMessageDoneBroadcastsSessionChangedHint(t *testing.T) {
	h := NewHub(&config.Config{QueueSize: 100}, nil)
	agent := newTestClient(h, model.ClientTypeAgent, "agent-1", "")
	device := newTestClient(h, model.ClientTypeDevice, "agent-1", "device-1")

	h.projects.Store("project-1", "agent-1")
	h.RegisterAgent(agent)
	h.RegisterDevice(device)

	h.HandleMessage(agent, &model.Envelope{
		ID:        "done-1",
		Event:     model.EventMessageDone,
		ProjectID: "project-1",
		StreamID:  "run-1",
	})

	done := readEnvelope(t, device)
	if done.Event != model.EventMessageDone {
		t.Fatalf("expected first event %q, got %q", model.EventMessageDone, done.Event)
	}

	changed := readEnvelope(t, device)
	if changed.Event != model.EventSessionChanged {
		t.Fatalf("expected second event %q, got %q", model.EventSessionChanged, changed.Event)
	}
	if changed.ProjectID != "project-1" || changed.AgentID != "agent-1" {
		t.Fatalf("unexpected session.changed routing: %+v", changed)
	}

	var payload model.SessionChangedPayload
	if err := json.Unmarshal(changed.Payload, &payload); err != nil {
		t.Fatalf("unmarshal session.changed payload: %v", err)
	}
	if payload.Reason != model.EventMessageDone || payload.ProjectID != "project-1" || payload.AgentID != "agent-1" {
		t.Fatalf("unexpected session.changed payload: %+v", payload)
	}
}

func TestDrainQueuedDeviceEventsReplaysOnlyAccessibleSessionChanged(t *testing.T) {
	h := NewHub(&config.Config{QueueSize: 100}, nil)
	device := newTestClient(h, model.ClientTypeDevice, "agent-1", "device-1")

	h.projects.Store("project-1", "agent-1")
	h.projects.Store("project-2", "agent-2")
	h.NotifySessionChanged("project-1", "agent-1", model.EventMessageDone)
	h.NotifySessionChanged("project-2", "agent-2", model.EventMessageDone)

	h.RegisterDevice(device)
	h.DrainQueuedDeviceEvents(device, 0)

	replayed := readEnvelope(t, device)
	if replayed.Event != model.EventSessionChanged || replayed.ProjectID != "project-1" {
		t.Fatalf("expected project-1 session.changed replay, got %+v", replayed)
	}
	assertNoEnvelope(t, device)
}

func TestWorkgroupCollabMessageSendAllowsJoinedMemberWithoutDirectAgentAccess(t *testing.T) {
	h, database, owner, member := newCollaborationTestHub(t)

	if err := database.RegisterDevice("member-device", member.ID, "", "Member phone"); err != nil {
		t.Fatalf("register member device: %v", err)
	}

	group, err := database.UpsertCollaborationGroup(owner.ID, "owner-agent", "wg-1", "Release Squad", "", "[]", "")
	if err != nil {
		t.Fatalf("upsert collaboration group: %v", err)
	}
	if _, err := database.JoinCollaborationGroup(member.ID, group.ID); err != nil {
		t.Fatalf("join collaboration group: %v", err)
	}

	ownerAgent := newTestClient(h, model.ClientTypeAgent, "owner-agent", "")
	memberDevice := newTestClient(h, model.ClientTypeDevice, "", "member-device")

	h.RegisterAgent(ownerAgent)
	h.RegisterDevice(memberDevice)

	payload, err := json.Marshal(model.WorkgroupCollaborationMessageSendPayload{
		AgentID:     "owner-agent",
		WorkgroupID: "wg-1",
		Content:     "ship it",
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	h.HandleMessage(memberDevice, &model.Envelope{
		ID:          "msg-1",
		Event:       model.EventWorkgroupCollabMessageSend,
		AgentID:     "owner-agent",
		WorkgroupID: "wg-1",
		Payload:     payload,
	})

	env := readEnvelope(t, ownerAgent)
	if env.Event != model.EventWorkgroupCollabMessageSend {
		t.Fatalf("expected %q, got %q", model.EventWorkgroupCollabMessageSend, env.Event)
	}
	if env.AgentID != "owner-agent" {
		t.Fatalf("expected agent owner-agent, got %q", env.AgentID)
	}
	if env.WorkgroupID != "wg-1" {
		t.Fatalf("expected workgroup wg-1, got %q", env.WorkgroupID)
	}

	var sent model.WorkgroupCollaborationMessageSendPayload
	if err := json.Unmarshal(env.Payload, &sent); err != nil {
		t.Fatalf("unmarshal forwarded payload: %v", err)
	}
	if sent.Content != "ship it" {
		t.Fatalf("expected content to be forwarded, got %q", sent.Content)
	}

	assertNoEnvelope(t, memberDevice)
}

func TestWorkgroupCollabSnapshotBroadcastsToJoinedMemberWithoutDirectAgentAccess(t *testing.T) {
	h, database, owner, member := newCollaborationTestHub(t)

	if err := database.RegisterDevice("member-device", member.ID, "", "Member phone"); err != nil {
		t.Fatalf("register member device: %v", err)
	}

	group, err := database.UpsertCollaborationGroup(owner.ID, "owner-agent", "wg-1", "Release Squad", "", "[]", "")
	if err != nil {
		t.Fatalf("upsert collaboration group: %v", err)
	}
	if _, err := database.JoinCollaborationGroup(member.ID, group.ID); err != nil {
		t.Fatalf("join collaboration group: %v", err)
	}

	ownerAgent := newTestClient(h, model.ClientTypeAgent, "owner-agent", "")
	memberDevice := newTestClient(h, model.ClientTypeDevice, "", "member-device")

	h.RegisterAgent(ownerAgent)
	h.RegisterDevice(memberDevice)

	h.HandleMessage(ownerAgent, &model.Envelope{
		ID:          "snapshot-1",
		Event:       model.EventWorkgroupCollabSnapshot,
		AgentID:     "owner-agent",
		WorkgroupID: "wg-1",
		Payload:     json.RawMessage(`{"status":"running"}`),
	})

	env := readEnvelope(t, memberDevice)
	if env.Event != model.EventWorkgroupCollabSnapshot {
		t.Fatalf("expected %q, got %q", model.EventWorkgroupCollabSnapshot, env.Event)
	}
	if env.AgentID != "owner-agent" {
		t.Fatalf("expected agent owner-agent, got %q", env.AgentID)
	}
	if env.WorkgroupID != "wg-1" {
		t.Fatalf("expected workgroup wg-1, got %q", env.WorkgroupID)
	}
	if string(env.Payload) != `{"status":"running"}` {
		t.Fatalf("unexpected snapshot payload: %s", string(env.Payload))
	}
}

func TestProjectScopedGrantFiltersProjectListAndStatusBroadcasts(t *testing.T) {
	dataDir := t.TempDir()
	database, err := db.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	owner, err := database.CreateUser("owner", "Owner12345A", false)
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	viewer, err := database.CreateUser("viewer", "Viewer12345A", false)
	if err != nil {
		t.Fatalf("create viewer: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterDevice("device-1", viewer.ID, "", "Viewer phone"); err != nil {
		t.Fatalf("register viewer device: %v", err)
	}
	if err := database.CreateAgentAccessGrant(viewer.ID, "owner-agent", owner.ID, "scoped", []string{"project-1"}); err != nil {
		t.Fatalf("create access grant: %v", err)
	}

	h := NewHub(&config.Config{}, store.NewStore(database))
	device := newTestClient(h, model.ClientTypeDevice, "", "device-1")
	device.UserID = viewer.ID
	device.AccessibleAgentIDs = map[string]struct{}{"owner-agent": {}}
	h.RegisterDevice(device)

	h.projects.Store("project-1", "owner-agent")
	h.projects.Store("project-2", "owner-agent")
	h.projectInfos.Store("project-1", &ProjectInfo{
		ID:      "project-1",
		Name:    "Project 1",
		Path:    "/tmp/project-1",
		AgentID: "owner-agent",
	})
	h.projectInfos.Store("project-2", &ProjectInfo{
		ID:      "project-2",
		Name:    "Project 2",
		Path:    "/tmp/project-2",
		AgentID: "owner-agent",
	})

	h.broadcastProjectList("owner-agent")

	listed := readEnvelope(t, device)
	if listed.Event != model.EventProjectListed {
		t.Fatalf("expected %q, got %q", model.EventProjectListed, listed.Event)
	}

	var listPayload model.ProjectListPayload
	if err := json.Unmarshal(listed.Payload, &listPayload); err != nil {
		t.Fatalf("unmarshal project.listed payload: %v", err)
	}
	if len(listPayload.Projects) != 1 || listPayload.Projects[0].ID != "project-1" {
		t.Fatalf("expected only project-1 in scoped project list, got %+v", listPayload.Projects)
	}

	h.broadcastAgentStatus("owner-agent", true, "project-1", "project-2")

	status := readEnvelope(t, device)
	if status.Event != model.EventAgentStatus {
		t.Fatalf("expected %q, got %q", model.EventAgentStatus, status.Event)
	}
	if status.ProjectID != "project-1" {
		t.Fatalf("expected only project-1 status event, got %q", status.ProjectID)
	}

	assertNoEnvelope(t, device)
}

func newCollaborationTestHub(t *testing.T) (*Hub, *db.DB, *db.User, *db.User) {
	t.Helper()

	dataDir := t.TempDir()
	database, err := db.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})

	owner, err := database.CreateUser("owner", "Owner12345A", false)
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	member, err := database.CreateUser("member", "Member12345A", false)
	if err != nil {
		t.Fatalf("create member: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}

	return NewHub(&config.Config{}, store.NewStore(database)), database, owner, member
}

func newTestClient(h *Hub, clientType model.ClientType, agentID, deviceID string) *Client {
	return &Client{
		ID:       "test-client",
		AgentID:  agentID,
		DeviceID: deviceID,
		Type:     clientType,
		send:     make(chan []byte, 8),
		hub:      h,
		closed:   make(chan struct{}),
	}
}

func assertNoEnvelope(t *testing.T, client *Client) {
	t.Helper()

	select {
	case raw := <-client.send:
		var env model.Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal unexpected envelope: %v", err)
		}
		t.Fatalf("expected no outbound envelope, got %q", env.Event)
	default:
	}
}

func readEnvelope(t *testing.T, client *Client) model.Envelope {
	t.Helper()

	select {
	case raw := <-client.send:
		var env model.Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal envelope: %v", err)
		}
		return env
	default:
		t.Fatal("expected outbound envelope")
		return model.Envelope{}
	}
}
