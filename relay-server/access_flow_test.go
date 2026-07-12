package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/handler"
)

type accessOverviewPayload struct {
	ControllableAgents []struct {
		AgentID           string   `json:"agent_id"`
		OwnerUsername     string   `json:"owner_username"`
		GrantedProjectIDs []string `json:"granted_project_ids"`
		ScopeType         string   `json:"scope_type"`
		CapabilityBundle  string   `json:"capability_bundle"`
		AllowFileDownload bool     `json:"allow_file_download"`
		AllowDiagnostics  bool     `json:"allow_diagnostics"`
		IsOwned           bool     `json:"is_owned"`
	} `json:"controllable_agents"`
	IncomingGrants []struct {
		ID                 string   `json:"id"`
		ControllerUsername string   `json:"controller_username"`
		TargetAgentID      string   `json:"target_agent_id"`
		GrantedProjectIDs  []string `json:"granted_project_ids"`
		ScopeType          string   `json:"scope_type"`
		CapabilityBundle   string   `json:"capability_bundle"`
		AllowFileDownload  bool     `json:"allow_file_download"`
		AllowDiagnostics   bool     `json:"allow_diagnostics"`
		Note               string   `json:"note"`
	} `json:"incoming_grants"`
}

type effectiveScopePayload struct {
	AccountID   int    `json:"account_id"`
	Username    string `json:"username"`
	ClientType  string `json:"client_type"`
	AgentID     string `json:"agent_id"`
	DeviceID    string `json:"device_id"`
	AgentScopes []struct {
		AgentID           string   `json:"agent_id"`
		OwnerUserID       int      `json:"owner_user_id"`
		OwnerUsername     string   `json:"owner_username"`
		IsOwned           bool     `json:"is_owned"`
		ScopeType         string   `json:"scope_type"`
		ProjectIDs        []string `json:"project_ids"`
		CapabilityBundle  string   `json:"capability_bundle"`
		AllowFileDownload bool     `json:"allow_file_download"`
		AllowDiagnostics  bool     `json:"allow_diagnostics"`
	} `json:"agent_scopes"`
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
	if err := database.CreateAgentAccessGrant(controller.ID, "owner-agent", owner.ID, "shared", []string{"project-alpha", "project-beta"}); err != nil {
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
	mux.HandleFunc("/api/access/grants/", handler.AccessGrantsHandler(cfg, database))
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))

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
	if len(ownerOverview.IncomingGrants[0].GrantedProjectIDs) != 2 {
		t.Fatalf("expected incoming grant project scope, got %+v", ownerOverview.IncomingGrants[0].GrantedProjectIDs)
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
	for _, agent := range controllerOverview.ControllableAgents {
		if agent.AgentID != "owner-agent" {
			continue
		}
		if len(agent.GrantedProjectIDs) != 2 {
			t.Fatalf("expected granted project scope for owner-agent, got %+v", agent.GrantedProjectIDs)
		}
		return
	}
	t.Fatalf("expected owner-agent in controller overview: %+v", controllerOverview.ControllableAgents)
}

func TestAccessGrantRejectsBlankProjectScope(t *testing.T) {
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
	if err := database.RegisterAgent("viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
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
	mux.HandleFunc("/api/access/grants/", handler.AccessGrantsHandler(cfg, database))
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))

	server := httptest.NewServer(mux)
	defer server.Close()

	ownerToken := mustLoginClientToken(t, server.URL, "owner", "Owner12345A", "agent", "owner-agent")

	reqBody := map[string]any{
		"controller_username": "viewer",
		"target_agent_id":     "owner-agent",
		"project_ids":         []string{" ", "\t", ""},
		"note":                "blank scope should fail",
	}

	req, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, server.URL+"/api/access/grants", bytes.NewReader(req))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+ownerToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for blank scoped project ids, got %d: %s", resp.StatusCode, string(body))
	}

	var ownerOverview accessOverviewPayload
	doBearerJSON(t, server.URL+"/api/access/grants", ownerToken, http.StatusOK, &ownerOverview)
	if len(ownerOverview.IncomingGrants) != 0 {
		t.Fatalf("expected no stored incoming grants after rejected request, got %+v", ownerOverview.IncomingGrants)
	}
}

func TestAccessGrantPatchUpdatesScopeAndPermissions(t *testing.T) {
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
	if err := database.RegisterAgent("viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}
	if err := database.CreateAgentAccessGrantWithInput(db.AccessGrantInput{
		ControllerUserID:  viewer.ID,
		TargetAgentID:     "owner-agent",
		CreatedByUserID:   owner.ID,
		Note:              "initial",
		ProjectIDs:        []string{"project-alpha", "project-beta"},
		ScopeType:         "selected_projects",
		CapabilityBundle:  "collaborate",
		AllowFileDownload: true,
		AllowDiagnostics:  true,
	}); err != nil {
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
	mux.HandleFunc("/api/access/grants/", handler.AccessGrantsHandler(cfg, database))
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))
	server := httptest.NewServer(mux)
	defer server.Close()

	ownerToken := mustLoginClientToken(t, server.URL, "owner", "Owner12345A", "agent", "owner-agent")
	viewerToken := mustLoginClientToken(t, server.URL, "viewer", "Viewer12345A", "device", "viewer-device")

	var ownerOverview accessOverviewPayload
	doBearerJSON(t, server.URL+"/api/access/grants", ownerToken, http.StatusOK, &ownerOverview)
	if len(ownerOverview.IncomingGrants) != 1 || ownerOverview.IncomingGrants[0].ID == "" {
		t.Fatalf("expected one editable incoming grant, got %+v", ownerOverview.IncomingGrants)
	}
	grantID := ownerOverview.IncomingGrants[0].ID
	expiresAt := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)

	doJSONRequest(t, http.MethodPatch, server.URL+"/api/access/grants/"+grantID, map[string]any{
		"project_ids":         []string{"project-beta"},
		"scope_type":          "selected_projects",
		"capability_bundle":   "observe",
		"allow_file_download": false,
		"allow_diagnostics":   false,
		"expires_at":          expiresAt,
		"note":                "tightened",
	}, http.StatusOK, ownerToken, &map[string]any{})

	doBearerJSON(t, server.URL+"/api/access/grants", ownerToken, http.StatusOK, &ownerOverview)
	if len(ownerOverview.IncomingGrants) != 1 {
		t.Fatalf("expected one incoming grant after patch, got %+v", ownerOverview.IncomingGrants)
	}
	updatedGrant := ownerOverview.IncomingGrants[0]
	if updatedGrant.CapabilityBundle != "observe" || updatedGrant.AllowFileDownload || updatedGrant.AllowDiagnostics {
		t.Fatalf("unexpected updated grant flags: %+v", updatedGrant)
	}
	if updatedGrant.Note != "tightened" || len(updatedGrant.GrantedProjectIDs) != 1 || updatedGrant.GrantedProjectIDs[0] != "project-beta" {
		t.Fatalf("unexpected updated grant payload: %+v", updatedGrant)
	}

	var payload effectiveScopePayload
	doBearerJSON(t, server.URL+"/api/access/effective-scope", viewerToken, http.StatusOK, &payload)
	for _, item := range payload.AgentScopes {
		if item.AgentID != "owner-agent" {
			continue
		}
		if item.ScopeType != "selected_projects" || item.CapabilityBundle != "observe" {
			t.Fatalf("unexpected updated scope payload: %+v", item)
		}
		if item.AllowFileDownload || item.AllowDiagnostics {
			t.Fatalf("expected updated restrictions in effective scope, got %+v", item)
		}
		if len(item.ProjectIDs) != 1 || item.ProjectIDs[0] != "project-beta" {
			t.Fatalf("unexpected updated project scope: %+v", item.ProjectIDs)
		}
		return
	}
	t.Fatalf("expected owner-agent in viewer effective scope: %+v", payload.AgentScopes)
}

func TestAccessGrantRevokeEndpointRemovesGrantFromOverviewAndEffectiveScope(t *testing.T) {
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
	if err := database.RegisterAgent("viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}
	if err := database.CreateAgentAccessGrantWithInput(db.AccessGrantInput{
		ControllerUserID:  viewer.ID,
		TargetAgentID:     "owner-agent",
		CreatedByUserID:   owner.ID,
		Note:              "revoke-me",
		ProjectIDs:        []string{"project-alpha"},
		ScopeType:         "selected_projects",
		CapabilityBundle:  "collaborate",
		AllowFileDownload: true,
		AllowDiagnostics:  true,
	}); err != nil {
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
	mux.HandleFunc("/api/access/grants/", handler.AccessGrantsHandler(cfg, database))
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))
	server := httptest.NewServer(mux)
	defer server.Close()

	ownerToken := mustLoginClientToken(t, server.URL, "owner", "Owner12345A", "agent", "owner-agent")
	viewerToken := mustLoginClientToken(t, server.URL, "viewer", "Viewer12345A", "device", "viewer-device")

	var ownerOverview accessOverviewPayload
	doBearerJSON(t, server.URL+"/api/access/grants", ownerToken, http.StatusOK, &ownerOverview)
	if len(ownerOverview.IncomingGrants) != 1 || ownerOverview.IncomingGrants[0].ID == "" {
		t.Fatalf("expected one incoming grant before revoke, got %+v", ownerOverview.IncomingGrants)
	}
	grantID := ownerOverview.IncomingGrants[0].ID

	doJSONRequest(t, http.MethodPost, server.URL+"/api/access/grants/"+grantID+"/revoke", map[string]any{}, http.StatusOK, ownerToken, &map[string]any{})

	doBearerJSON(t, server.URL+"/api/access/grants", ownerToken, http.StatusOK, &ownerOverview)
	if len(ownerOverview.IncomingGrants) != 0 {
		t.Fatalf("expected no incoming grants after revoke, got %+v", ownerOverview.IncomingGrants)
	}

	var viewerOverview accessOverviewPayload
	doBearerJSON(t, server.URL+"/api/access/grants", viewerToken, http.StatusOK, &viewerOverview)
	for _, item := range viewerOverview.ControllableAgents {
		if item.AgentID == "owner-agent" {
			t.Fatalf("revoked grant should not expose owner-agent in controllable list: %+v", viewerOverview.ControllableAgents)
		}
	}

	var payload effectiveScopePayload
	doBearerJSON(t, server.URL+"/api/access/effective-scope", viewerToken, http.StatusOK, &payload)
	for _, item := range payload.AgentScopes {
		if item.AgentID == "owner-agent" {
			t.Fatalf("revoked grant should not expose owner-agent in effective scope: %+v", payload.AgentScopes)
		}
	}
}

func TestWorkgroupLeaveRevokesGrantedAccess(t *testing.T) {
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
	member, err := database.CreateUser("member", "Member12345A", false)
	if err != nil {
		t.Fatalf("create member: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterAgent("member-agent", member.ID, "Member desktop"); err != nil {
		t.Fatalf("register member agent: %v", err)
	}

	server := newAccessAndWorkgroupTestServer(t, database, dataDir)
	defer server.Close()

	ownerToken := mustLoginClientToken(t, server.URL, "owner", "Owner12345A", "agent", "owner-agent")
	memberToken := mustLoginClientToken(t, server.URL, "member", "Member12345A", "agent", "member-agent")
	groupNumber := mustPublishWorkgroupRegistry(t, server.URL, ownerToken, "wg-release", "Release Squad")

	doJSONRequest(t, http.MethodPost, server.URL+"/api/workgroups/registry/join", map[string]any{
		"group_number": groupNumber,
	}, http.StatusOK, memberToken, &map[string]any{})

	assertControllableAgent(t, server.URL, memberToken, "owner-agent", true)

	doJSONRequest(t, http.MethodPost, server.URL+"/api/workgroups/registry/leave", map[string]any{
		"group_number": groupNumber,
	}, http.StatusOK, memberToken, &map[string]any{})

	assertControllableAgent(t, server.URL, memberToken, "owner-agent", false)
}

func TestEffectiveScopeListsOwnedAndGrantedAgentScopesForDevice(t *testing.T) {
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
	if err := database.RegisterAgent("viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}
	if err := database.CreateAgentAccessGrant(viewer.ID, "owner-agent", owner.ID, "scoped", []string{"project-alpha", "project-beta"}); err != nil {
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
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))

	server := httptest.NewServer(mux)
	defer server.Close()

	deviceToken := mustLoginClientToken(t, server.URL, "viewer", "Viewer12345A", "device", "viewer-device")

	var payload effectiveScopePayload
	doBearerJSON(t, server.URL+"/api/access/effective-scope", deviceToken, http.StatusOK, &payload)

	if payload.AccountID != viewer.ID || payload.Username != "viewer" {
		t.Fatalf("unexpected account payload: %+v", payload)
	}
	if payload.ClientType != "device" || payload.DeviceID != "viewer-device" || payload.AgentID != "viewer-agent" {
		t.Fatalf("unexpected client scope payload: %+v", payload)
	}
	if len(payload.AgentScopes) != 2 {
		t.Fatalf("expected 2 agent scopes, got %+v", payload.AgentScopes)
	}

	var foundOwned bool
	var foundGranted bool
	for _, item := range payload.AgentScopes {
		switch item.AgentID {
		case "viewer-agent":
			foundOwned = true
			if !item.IsOwned || item.ScopeType != "all_projects" || len(item.ProjectIDs) != 0 {
				t.Fatalf("unexpected owned scope: %+v", item)
			}
		case "owner-agent":
			foundGranted = true
			if item.IsOwned || item.ScopeType != "selected_projects" {
				t.Fatalf("unexpected granted scope flags: %+v", item)
			}
			if len(item.ProjectIDs) != 2 || item.ProjectIDs[0] != "project-alpha" || item.ProjectIDs[1] != "project-beta" {
				t.Fatalf("unexpected granted project scope: %+v", item.ProjectIDs)
			}
		}
	}
	if !foundOwned || !foundGranted {
		t.Fatalf("missing expected agent scopes: %+v", payload.AgentScopes)
	}
}

func TestEffectiveScopeTreatsLegacyGrantWithoutProjectRowsAsAllProjects(t *testing.T) {
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
	if err := database.RegisterAgent("viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}
	if err := database.CreateAgentAccessGrant(viewer.ID, "owner-agent", owner.ID, "legacy full access", nil); err != nil {
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
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))

	server := httptest.NewServer(mux)
	defer server.Close()

	deviceToken := mustLoginClientToken(t, server.URL, "viewer", "Viewer12345A", "device", "viewer-device")

	var payload effectiveScopePayload
	doBearerJSON(t, server.URL+"/api/access/effective-scope", deviceToken, http.StatusOK, &payload)

	for _, item := range payload.AgentScopes {
		if item.AgentID != "owner-agent" {
			continue
		}
		if item.ScopeType != "all_projects" || len(item.ProjectIDs) != 0 {
			t.Fatalf("expected legacy grant to expand to all_projects, got %+v", item)
		}
		return
	}
	t.Fatalf("expected owner-agent in effective scope: %+v", payload.AgentScopes)
}

func TestEffectiveScopeIncludesCapabilityAndPermissionFlags(t *testing.T) {
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
	if err := database.RegisterAgent("viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}
	if err := database.CreateAgentAccessGrantWithInput(db.AccessGrantInput{
		ControllerUserID:  viewer.ID,
		TargetAgentID:     "owner-agent",
		CreatedByUserID:   owner.ID,
		Note:              "restricted",
		ProjectIDs:        []string{"project-alpha"},
		ScopeType:         "selected_projects",
		CapabilityBundle:  "observe",
		AllowFileDownload: false,
		AllowDiagnostics:  false,
	}); err != nil {
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
	mux.HandleFunc("/api/access/grants/", handler.AccessGrantsHandler(cfg, database))
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))
	server := httptest.NewServer(mux)
	defer server.Close()

	viewerToken := mustLoginClientToken(t, server.URL, "viewer", "Viewer12345A", "device", "viewer-device")

	var payload effectiveScopePayload
	doBearerJSON(t, server.URL+"/api/access/effective-scope", viewerToken, http.StatusOK, &payload)
	for _, item := range payload.AgentScopes {
		if item.AgentID != "owner-agent" {
			continue
		}
		if item.ScopeType != "selected_projects" || item.CapabilityBundle != "observe" {
			t.Fatalf("unexpected scope payload: %+v", item)
		}
		if item.AllowFileDownload || item.AllowDiagnostics {
			t.Fatalf("expected restricted capability flags, got %+v", item)
		}
		return
	}
	t.Fatalf("expected owner-agent in effective scope: %+v", payload.AgentScopes)
}

func TestExpiredGrantDoesNotAppearInOverviewOrEffectiveScope(t *testing.T) {
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
	if err := database.RegisterAgent("viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}
	expiredAt := time.Now().Add(-time.Hour).UTC()
	if err := database.CreateAgentAccessGrantWithInput(db.AccessGrantInput{
		ControllerUserID:  viewer.ID,
		TargetAgentID:     "owner-agent",
		CreatedByUserID:   owner.ID,
		Note:              "expired",
		ProjectIDs:        []string{"project-alpha"},
		ScopeType:         "selected_projects",
		CapabilityBundle:  "collaborate",
		AllowFileDownload: true,
		AllowDiagnostics:  true,
		ExpiresAt:         &expiredAt,
	}); err != nil {
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
	mux.HandleFunc("/api/access/grants/", handler.AccessGrantsHandler(cfg, database))
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))
	server := httptest.NewServer(mux)
	defer server.Close()

	viewerToken := mustLoginClientToken(t, server.URL, "viewer", "Viewer12345A", "device", "viewer-device")

	var overview accessOverviewPayload
	doBearerJSON(t, server.URL+"/api/access/grants", viewerToken, http.StatusOK, &overview)
	for _, item := range overview.ControllableAgents {
		if item.AgentID == "owner-agent" {
			t.Fatalf("expired grant should not expose owner-agent in overview: %+v", overview.ControllableAgents)
		}
	}

	var payload effectiveScopePayload
	doBearerJSON(t, server.URL+"/api/access/effective-scope", viewerToken, http.StatusOK, &payload)
	for _, item := range payload.AgentScopes {
		if item.AgentID == "owner-agent" {
			t.Fatalf("expired grant should not expose owner-agent in effective scope: %+v", payload.AgentScopes)
		}
	}
}

func TestWorkgroupKickRevokesGrantedAccess(t *testing.T) {
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
	member, err := database.CreateUser("member", "Member12345A", false)
	if err != nil {
		t.Fatalf("create member: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterAgent("member-agent", member.ID, "Member desktop"); err != nil {
		t.Fatalf("register member agent: %v", err)
	}

	server := newAccessAndWorkgroupTestServer(t, database, dataDir)
	defer server.Close()

	ownerToken := mustLoginClientToken(t, server.URL, "owner", "Owner12345A", "agent", "owner-agent")
	memberToken := mustLoginClientToken(t, server.URL, "member", "Member12345A", "agent", "member-agent")
	groupNumber := mustPublishWorkgroupRegistry(t, server.URL, ownerToken, "wg-release", "Release Squad")

	doJSONRequest(t, http.MethodPost, server.URL+"/api/workgroups/registry/join", map[string]any{
		"group_number": groupNumber,
	}, http.StatusOK, memberToken, &map[string]any{})

	assertControllableAgent(t, server.URL, memberToken, "owner-agent", true)

	doJSONRequest(t, http.MethodPost, server.URL+"/api/workgroups/registry/kick", map[string]any{
		"group_number": groupNumber,
		"user_id":      member.ID,
	}, http.StatusOK, ownerToken, &map[string]any{})

	assertControllableAgent(t, server.URL, memberToken, "owner-agent", false)
}

func TestTemporaryAccessLinkRedeemsIntoScopedGrantOnce(t *testing.T) {
	dataDir := t.TempDir()
	database, err := db.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	owner, err := database.CreateUser("temp-owner", "Owner12345A", false)
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	viewer, err := database.CreateUser("temp-viewer", "Viewer12345A", false)
	if err != nil {
		t.Fatalf("create viewer: %v", err)
	}
	secondViewer, err := database.CreateUser("temp-second", "Second12345A", false)
	if err != nil {
		t.Fatalf("create second viewer: %v", err)
	}
	if err := database.RegisterAgent("temp-owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterAgent("temp-viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}
	if err := database.RegisterAgent("temp-second-agent", secondViewer.ID, "Second desktop"); err != nil {
		t.Fatalf("register second agent: %v", err)
	}

	server := newAccessAndWorkgroupTestServer(t, database, dataDir)
	defer server.Close()

	ownerToken := mustLoginClientToken(t, server.URL, "temp-owner", "Owner12345A", "agent", "temp-owner-agent")
	viewerToken := mustLoginClientToken(t, server.URL, "temp-viewer", "Viewer12345A", "agent", "temp-viewer-agent")
	secondToken := mustLoginClientToken(t, server.URL, "temp-second", "Second12345A", "agent", "temp-second-agent")

	var createResponse struct {
		Success       bool   `json:"success"`
		Token         string `json:"token"`
		URL           string `json:"url"`
		APIURL        string `json:"api_url"`
		RemainingUses int    `json:"remaining_uses"`
	}
	doJSONRequest(t, http.MethodPost, server.URL+"/api/access/temp-links", map[string]any{
		"target_agent_id":     "temp-owner-agent",
		"project_ids":         []string{"project-alpha"},
		"scope_type":          "selected_projects",
		"capability_bundle":   "collaborate",
		"allow_file_download": true,
		"allow_diagnostics":   true,
		"max_uses":            1,
		"expires_at":          time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
		"note":                "handoff",
	}, http.StatusOK, ownerToken, &createResponse)
	if !createResponse.Success || createResponse.Token == "" || createResponse.RemainingUses != 1 {
		t.Fatalf("unexpected create response: %+v", createResponse)
	}
	if createResponse.URL == "" || createResponse.APIURL == "" {
		t.Fatalf("expected share and api urls, got %+v", createResponse)
	}

	doJSONRequest(t, http.MethodPost, server.URL+"/api/access/temp-links/"+createResponse.Token+"/redeem", map[string]any{}, http.StatusOK, viewerToken, &map[string]any{})

	var scope effectiveScopePayload
	doBearerJSON(t, server.URL+"/api/access/effective-scope", viewerToken, http.StatusOK, &scope)
	var sharedProjectIDs []string
	for _, item := range scope.AgentScopes {
		if item.AgentID == "temp-owner-agent" {
			sharedProjectIDs = item.ProjectIDs
			if item.ScopeType != "selected_projects" {
				t.Fatalf("expected selected project scope, got %+v", item)
			}
			break
		}
	}
	if len(sharedProjectIDs) != 1 || sharedProjectIDs[0] != "project-alpha" {
		t.Fatalf("expected scoped temp grant, got %+v", scope.AgentScopes)
	}

	doJSONRequest(t, http.MethodPost, server.URL+"/api/access/temp-links/"+createResponse.Token+"/redeem", map[string]any{}, http.StatusBadRequest, secondToken, nil)
	assertControllableAgent(t, server.URL, secondToken, "temp-owner-agent", false)
}

func TestTemporaryAccessLinkRejectsNonOwnerAndExpiredLinks(t *testing.T) {
	dataDir := t.TempDir()
	database, err := db.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	owner, err := database.CreateUser("expire-owner", "Owner12345A", false)
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	viewer, err := database.CreateUser("expire-viewer", "Viewer12345A", false)
	if err != nil {
		t.Fatalf("create viewer: %v", err)
	}
	if err := database.RegisterAgent("expire-owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterAgent("expire-viewer-agent", viewer.ID, "Viewer desktop"); err != nil {
		t.Fatalf("register viewer agent: %v", err)
	}

	server := newAccessAndWorkgroupTestServer(t, database, dataDir)
	defer server.Close()

	ownerToken := mustLoginClientToken(t, server.URL, "expire-owner", "Owner12345A", "agent", "expire-owner-agent")
	viewerToken := mustLoginClientToken(t, server.URL, "expire-viewer", "Viewer12345A", "agent", "expire-viewer-agent")

	doJSONRequest(t, http.MethodPost, server.URL+"/api/access/temp-links", map[string]any{
		"target_agent_id": "expire-owner-agent",
		"project_ids":     []string{"project-alpha"},
		"max_uses":        1,
		"expires_at":      time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}, http.StatusForbidden, viewerToken, nil)

	var createResponse struct {
		Token string `json:"token"`
	}
	doJSONRequest(t, http.MethodPost, server.URL+"/api/access/temp-links", map[string]any{
		"target_agent_id": "expire-owner-agent",
		"project_ids":     []string{"project-alpha"},
		"max_uses":        1,
		"expires_at":      time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}, http.StatusOK, ownerToken, &createResponse)
	if createResponse.Token == "" {
		t.Fatalf("expected token")
	}
	if _, err := database.Exec("UPDATE temporary_access_links SET expires_at = ? WHERE target_agent_id = ?", time.Now().Add(-time.Minute), "expire-owner-agent"); err != nil {
		t.Fatalf("expire link: %v", err)
	}
	doJSONRequest(t, http.MethodPost, server.URL+"/api/access/temp-links/"+createResponse.Token+"/redeem", map[string]any{}, http.StatusBadRequest, viewerToken, nil)
	assertControllableAgent(t, server.URL, viewerToken, "expire-owner-agent", false)
}

func newAccessAndWorkgroupTestServer(t *testing.T, database *db.DB, dataDir string) *httptest.Server {
	t.Helper()

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
	mux.HandleFunc("/api/access/grants/", handler.AccessGrantsHandler(cfg, database))
	mux.HandleFunc("/api/access/temp-links", handler.TemporaryAccessLinksHandler(cfg, database))
	mux.HandleFunc("/api/access/temp-links/", handler.TemporaryAccessLinksHandler(cfg, database))
	mux.HandleFunc("/api/access/effective-scope", handler.EffectiveScopeHandler(cfg, database))
	mux.HandleFunc("/api/workgroups/registry/publish", handler.WorkgroupRegistryHandler(cfg, database))
	mux.HandleFunc("/api/workgroups/registry/join", handler.WorkgroupRegistryHandler(cfg, database))
	mux.HandleFunc("/api/workgroups/registry/leave", handler.WorkgroupRegistryHandler(cfg, database))
	mux.HandleFunc("/api/workgroups/registry/kick", handler.WorkgroupRegistryHandler(cfg, database))
	mux.HandleFunc("/api/workgroups/registry", handler.WorkgroupRegistryHandler(cfg, database))
	return httptest.NewServer(mux)
}

func mustPublishWorkgroupRegistry(t *testing.T, baseURL, bearerToken, workgroupID, name string) string {
	t.Helper()

	var response struct {
		Record struct {
			GroupNumber string `json:"groupNumber"`
		} `json:"record"`
	}
	doJSONRequest(t, http.MethodPost, baseURL+"/api/workgroups/registry/publish", map[string]any{
		"workgroup_id": workgroupID,
		"name":         name,
		"description":  "release verification",
		"members":      []map[string]any{},
	}, http.StatusOK, bearerToken, &response)
	if response.Record.GroupNumber == "" {
		t.Fatalf("expected published group number")
	}
	return response.Record.GroupNumber
}

func assertControllableAgent(t *testing.T, baseURL, bearerToken, agentID string, want bool) {
	t.Helper()

	var overview accessOverviewPayload
	doBearerJSON(t, baseURL+"/api/access/grants", bearerToken, http.StatusOK, &overview)
	got := false
	for _, item := range overview.ControllableAgents {
		if item.AgentID == agentID {
			got = true
			break
		}
	}
	if got != want {
		t.Fatalf("controllable agent %s presence=%v, want %v; payload=%+v", agentID, got, want, overview.ControllableAgents)
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
