package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/hub"
	"github.com/claudecode/relay-server/model"
	"github.com/claudecode/relay-server/store"
)

func TestBuildSyncRevisionStableAcrossOrder(t *testing.T) {
	projectsA := []model.ProjectListItem{
		{AgentID: "agent-b", ID: "b", Name: "Beta", Path: "/beta", CLIProvider: "claude", Online: true},
		{AgentID: "agent-a", ID: "a", Name: "Alpha", Path: "/alpha", CLIProvider: "claude", Online: false},
	}
	projectsB := []model.ProjectListItem{
		{AgentID: "agent-a", ID: "a", Name: "Alpha", Path: "/alpha", CLIProvider: "claude", Online: false},
		{AgentID: "agent-b", ID: "b", Name: "Beta", Path: "/beta", CLIProvider: "claude", Online: true},
	}

	left := buildSyncRevision("owner-agent", projectsA)
	right := buildSyncRevision("owner-agent", projectsB)
	if left != right {
		t.Fatalf("expected stable revision across order, got %q vs %q", left, right)
	}
}

func TestSyncMetaHandlerReturnsChangedFlag(t *testing.T) {
	dataDir := t.TempDir()
	database, err := db.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	user, err := database.CreateUser("owner", "Owner12345A", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", user.ID, "Owner desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("owner-device", user.ID, "owner-agent", "Owner phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	cfg := &config.Config{
		JWTSecret:    "relay-test-secret-20260408",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}

	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)
	h.ReplaceAgentProjects("owner-agent", []model.ProjectListItem{
		{
			ID:          "project-1",
			AgentID:     "owner-agent",
			Name:        "Project One",
			Path:        "D:/project-one",
			CLIProvider: "claude",
			Online:      true,
		},
	})

	token, signErr := issueSessionToken(cfg, st, sessionRequest{
		Type:     model.ClientTypeDevice,
		DeviceID: "owner-device",
	})
	if signErr != nil {
		t.Fatalf("issue session token: %v", signErr)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/device/sync/meta", nil)
	request.Header.Set("Authorization", "Bearer "+token.Token)

	SyncMetaHandler(h, cfg, st).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload syncMetaResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Changed {
		t.Fatalf("expected initial meta response to be marked changed")
	}
	if payload.Revision == "" {
		t.Fatalf("expected revision to be populated")
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/device/sync/meta?since_revision="+payload.Revision, nil)
	request.Header.Set("Authorization", "Bearer "+token.Token)

	SyncMetaHandler(h, cfg, st).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode second response: %v", err)
	}
	if payload.Changed {
		t.Fatalf("expected unchanged revision to return changed=false")
	}
}

func TestBuildSyncProjectDeltaReturnsUpsertsAndRemoves(t *testing.T) {
	projects := []model.ProjectListItem{
		{
			ID:          "project-1",
			AgentID:     "owner-agent",
			Name:        "Project One",
			Path:        "D:/project-one",
			CLIProvider: "claude",
			Online:      true,
		},
		{
			ID:          "project-2",
			AgentID:     "owner-agent",
			Name:        "Project Two",
			Path:        "D:/project-two",
			CLIProvider: "claude",
			Online:      false,
		},
	}

	upserts, removes := buildSyncProjectDelta(projects, []syncKnownProject{
		{
			ProjectID: "project-1",
			Signature: buildProjectSyncSignature(projects[0]),
		},
		{
			ProjectID: "project-3",
			Signature: "obsolete",
		},
	})

	if len(upserts) != 1 || upserts[0].ID != "project-2" {
		t.Fatalf("expected project-2 upsert, got %+v", upserts)
	}
	if len(removes) != 1 || removes[0] != "project-3" {
		t.Fatalf("expected project-3 removal, got %+v", removes)
	}
}

func TestSyncDeltaHandlerReturnsNoChangesForMatchingKnownProjects(t *testing.T) {
	dataDir := t.TempDir()
	database, err := db.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	user, err := database.CreateUser("owner", "Owner12345A", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", user.ID, "Owner desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("owner-device", user.ID, "owner-agent", "Owner phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	cfg := &config.Config{
		JWTSecret:    "relay-test-secret-20260408",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}

	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)
	project := model.ProjectListItem{
		ID:          "project-1",
		AgentID:     "owner-agent",
		Name:        "Project One",
		Path:        "D:/project-one",
		CLIProvider: "claude",
		Online:      true,
	}
	h.ReplaceAgentProjects("owner-agent", []model.ProjectListItem{project})
	visibleProjects := h.GetAccessibleProjectsByDevice("owner-device")
	if len(visibleProjects) != 1 {
		t.Fatalf("expected one visible project, got %d", len(visibleProjects))
	}
	visibleProject := visibleProjects[0]

	token, signErr := issueSessionToken(cfg, st, sessionRequest{
		Type:     model.ClientTypeDevice,
		DeviceID: "owner-device",
	})
	if signErr != nil {
		t.Fatalf("issue session token: %v", signErr)
	}

	requestBody, err := json.Marshal(syncDeltaRequest{
		SinceRevision: buildSyncRevision("owner-agent", visibleProjects),
		KnownProjects: []syncKnownProject{
			{
				ProjectID: visibleProject.ID,
				Signature: buildProjectSyncSignature(visibleProject),
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/device/sync/delta", bytes.NewReader(requestBody))
	request.Header.Set("Authorization", "Bearer "+token.Token)
	request.Header.Set("Content-Type", "application/json")

	SyncDeltaHandler(h, cfg, st).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload syncDeltaResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Changed {
		t.Fatalf("expected changed=false for matching known project state")
	}
	if len(payload.ProjectUpserts) != 0 {
		t.Fatalf("expected no upserts, got %+v", payload.ProjectUpserts)
	}
	if len(payload.ProjectRemoves) != 0 {
		t.Fatalf("expected no removes, got %+v", payload.ProjectRemoves)
	}
}
