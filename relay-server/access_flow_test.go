package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/handler"
)

type accessOverviewPayload struct {
	ControllableAgents []struct {
		AgentID       string `json:"agent_id"`
		OwnerUsername string `json:"owner_username"`
		IsOwned       bool   `json:"is_owned"`
	} `json:"controllable_agents"`
	IncomingGrants []struct {
		ControllerUsername string `json:"controller_username"`
		TargetAgentID      string `json:"target_agent_id"`
	} `json:"incoming_grants"`
}

func TestAccessGrantsHandlerListsOwnedAndGrantedAgents(t *testing.T) {
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
	controller, err := database.CreateUser("viewer", "Viewer12345A", false)
	if err != nil {
		t.Fatalf("create controller: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterAgent("viewer-agent", controller.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}
	if err := database.CreateAgentAccessGrant(controller.ID, "owner-agent", owner.ID, "shared"); err != nil {
		t.Fatalf("create access grant: %v", err)
	}

	cfg := &config.Config{
		JWTSecret:    "relay-test-secret-20260324",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/access/grants", handler.AccessGrantsHandler(cfg, database))

	server := httptest.NewServer(mux)
	defer server.Close()

	ownerToken := mustLoginClientToken(t, server.URL, "owner", "Owner12345A", "agent", "owner-agent")
	controllerToken := mustLoginClientToken(t, server.URL, "viewer", "Viewer12345A", "agent", "viewer-agent")

	var ownerOverview accessOverviewPayload
	doBearerJSON(t, server.URL+"/api/access/grants", ownerToken, http.StatusOK, &ownerOverview)
	if len(ownerOverview.IncomingGrants) != 1 {
		t.Fatalf("expected 1 incoming grant for owner, got %d", len(ownerOverview.IncomingGrants))
	}
	if ownerOverview.IncomingGrants[0].ControllerUsername != "viewer" || ownerOverview.IncomingGrants[0].TargetAgentID != "owner-agent" {
		t.Fatalf("unexpected owner incoming grant payload: %+v", ownerOverview.IncomingGrants[0])
	}
	if len(ownerOverview.ControllableAgents) != 1 || ownerOverview.ControllableAgents[0].AgentID != "owner-agent" || !ownerOverview.ControllableAgents[0].IsOwned {
		t.Fatalf("unexpected owner controllable agents payload: %+v", ownerOverview.ControllableAgents)
	}

	var controllerOverview accessOverviewPayload
	doBearerJSON(t, server.URL+"/api/access/grants", controllerToken, http.StatusOK, &controllerOverview)
	if len(controllerOverview.IncomingGrants) != 0 {
		t.Fatalf("expected no incoming grants for controller, got %d", len(controllerOverview.IncomingGrants))
	}
	if len(controllerOverview.ControllableAgents) != 2 {
		t.Fatalf("expected 2 controllable agents for controller, got %d", len(controllerOverview.ControllableAgents))
	}
}

func mustLoginClientToken(t *testing.T, baseURL, username, password, clientType, clientID string) string {
	t.Helper()

	var response struct {
		Token string `json:"token"`
	}
	doJSONRequest(t, http.MethodPost, baseURL+"/api/auth/login", map[string]any{
		"username":    username,
		"password":    password,
		"client_type": clientType,
		"client_id":   clientID,
	}, http.StatusOK, "", &response)
	if response.Token == "" {
		t.Fatalf("empty token for %s", username)
	}
	return response.Token
}

func doBearerJSON(t *testing.T, url, token string, wantStatus int, out any) {
	t.Helper()
	doJSONRequest(t, http.MethodGet, url, nil, wantStatus, token, out)
}

func doJSONRequest(t *testing.T, method, url string, body any, wantStatus int, bearerToken string, out any) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+bearerToken)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		t.Fatalf("unexpected status %d for %s %s: %s", resp.StatusCode, method, url, string(raw))
	}

	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			t.Fatalf("decode response: %v; body=%s", err, string(raw))
		}
	}
}
