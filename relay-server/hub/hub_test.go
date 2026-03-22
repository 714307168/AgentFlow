package hub

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/model"
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
