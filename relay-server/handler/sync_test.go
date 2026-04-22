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

func newScopedSyncFixture(t *testing.T) (*config.Config, *store.Store, *hub.Hub, string, []model.ProjectListItem) {
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
	controller, err := database.CreateUser("controller", "Controller12345A", false)
	if err != nil {
		t.Fatalf("create controller: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterDevice("controller-device", controller.ID, "", "Controller phone"); err != nil {
		t.Fatalf("register controller device: %v", err)
	}
	if err := database.CreateAgentAccessGrant(controller.ID, "owner-agent", owner.ID, "scoped grant", []string{"project-1"}); err != nil {
		t.Fatalf("create access grant: %v", err)
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
		{
			ID:          "project-2",
			AgentID:     "owner-agent",
			Name:        "Project Two",
			Path:        "D:/project-two",
			CLIProvider: "claude",
			Online:      true,
		},
	})

	token, signErr := issueSessionToken(cfg, st, sessionRequest{
		Type:     model.ClientTypeDevice,
		DeviceID: "controller-device",
	})
	if signErr != nil {
		t.Fatalf("issue session token: %v", signErr)
	}

	visibleProjects := h.GetAccessibleProjectsByDevice("controller-device")
	if len(visibleProjects) != 1 || visibleProjects[0].ID != "project-1" {
		t.Fatalf("expected scoped project visibility, got %+v", visibleProjects)
	}

	return cfg, st, h, token.Token, visibleProjects
}

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

func TestSyncHandlerFiltersProjectsByGrantScope(t *testing.T) {
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
	controller, err := database.CreateUser("controller", "Controller12345A", false)
	if err != nil {
		t.Fatalf("create controller: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterDevice("controller-device", controller.ID, "", "Controller phone"); err != nil {
		t.Fatalf("register controller device: %v", err)
	}
	if err := database.CreateAgentAccessGrant(controller.ID, "owner-agent", owner.ID, "scoped grant", []string{"project-1"}); err != nil {
		t.Fatalf("create access grant: %v", err)
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
		{
			ID:          "project-2",
			AgentID:     "owner-agent",
			Name:        "Project Two",
			Path:        "D:/project-two",
			CLIProvider: "claude",
			Online:      true,
		},
	})

	token, signErr := issueSessionToken(cfg, st, sessionRequest{
		Type:     model.ClientTypeDevice,
		DeviceID: "controller-device",
	})
	if signErr != nil {
		t.Fatalf("issue session token: %v", signErr)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/device/sync", nil)
	request.Header.Set("Authorization", "Bearer "+token.Token)

	SyncHandler(h, cfg, st).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload syncResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ProjectCount != 1 {
		t.Fatalf("expected exactly one scoped project, got %d", payload.ProjectCount)
	}
	if len(payload.Projects) != 1 || payload.Projects[0].ID != "project-1" {
		t.Fatalf("expected only project-1 in scoped sync payload, got %+v", payload.Projects)
	}
}

func TestSyncDeltaHandlerRemovesProjectsThatFallOutsideGrantScope(t *testing.T) {
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
	controller, err := database.CreateUser("controller", "Controller12345A", false)
	if err != nil {
		t.Fatalf("create controller: %v", err)
	}
	if err := database.RegisterAgent("owner-agent", owner.ID, "Owner desktop"); err != nil {
		t.Fatalf("register owner agent: %v", err)
	}
	if err := database.RegisterDevice("controller-device", controller.ID, "", "Controller phone"); err != nil {
		t.Fatalf("register controller device: %v", err)
	}
	if err := database.CreateAgentAccessGrant(controller.ID, "owner-agent", owner.ID, "scoped grant", []string{"project-1"}); err != nil {
		t.Fatalf("create access grant: %v", err)
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
		{
			ID:          "project-2",
			AgentID:     "owner-agent",
			Name:        "Project Two",
			Path:        "D:/project-two",
			CLIProvider: "claude",
			Online:      true,
		},
	})
	visibleProjects := h.GetAccessibleProjectsByDevice("controller-device")
	if len(visibleProjects) != 1 || visibleProjects[0].ID != "project-1" {
		t.Fatalf("expected scoped project visibility before delta, got %+v", visibleProjects)
	}
	visibleProject := visibleProjects[0]

	token, signErr := issueSessionToken(cfg, st, sessionRequest{
		Type:     model.ClientTypeDevice,
		DeviceID: "controller-device",
	})
	if signErr != nil {
		t.Fatalf("issue session token: %v", signErr)
	}

	requestBody, err := json.Marshal(syncDeltaRequest{
		SinceRevision: "stale-revision",
		KnownProjects: []syncKnownProject{
			{
				ProjectID: "project-1",
				Signature: buildProjectSyncSignature(visibleProject),
			},
		},
		KnownProjectIDs: []string{"project-1", "project-2"},
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
	if !payload.Changed {
		t.Fatalf("expected scoped delta cleanup to be marked changed")
	}
	if len(payload.ProjectUpserts) != 0 {
		t.Fatalf("expected no upserts for unchanged scoped project, got %+v", payload.ProjectUpserts)
	}
	if len(payload.ProjectRemoves) != 1 || payload.ProjectRemoves[0] != "project-2" {
		t.Fatalf("expected project-2 to be removed from scoped delta, got %+v", payload.ProjectRemoves)
	}
}

func TestSyncDeltaHandlerMatchesFullSyncForScopedInitialSnapshot(t *testing.T) {
	cfg, st, h, token, _ := newScopedSyncFixture(t)

	fullRecorder := httptest.NewRecorder()
	fullRequest := httptest.NewRequest(http.MethodGet, "/api/device/sync", nil)
	fullRequest.Header.Set("Authorization", "Bearer "+token)
	SyncHandler(h, cfg, st).ServeHTTP(fullRecorder, fullRequest)

	if fullRecorder.Code != http.StatusOK {
		t.Fatalf("expected full sync 200, got %d", fullRecorder.Code)
	}

	var fullPayload syncResponse
	if err := json.Unmarshal(fullRecorder.Body.Bytes(), &fullPayload); err != nil {
		t.Fatalf("decode full sync response: %v", err)
	}
	if len(fullPayload.Projects) != 1 || fullPayload.Projects[0].ID != "project-1" {
		t.Fatalf("expected full sync to expose scoped project-1 only, got %+v", fullPayload.Projects)
	}

	deltaBody, err := json.Marshal(syncDeltaRequest{
		SinceRevision: "stale-revision",
	})
	if err != nil {
		t.Fatalf("marshal delta request: %v", err)
	}

	deltaRecorder := httptest.NewRecorder()
	deltaRequest := httptest.NewRequest(http.MethodPost, "/api/device/sync/delta", bytes.NewReader(deltaBody))
	deltaRequest.Header.Set("Authorization", "Bearer "+token)
	deltaRequest.Header.Set("Content-Type", "application/json")
	SyncDeltaHandler(h, cfg, st).ServeHTTP(deltaRecorder, deltaRequest)

	if deltaRecorder.Code != http.StatusOK {
		t.Fatalf("expected delta sync 200, got %d", deltaRecorder.Code)
	}

	var deltaPayload syncDeltaResponse
	if err := json.Unmarshal(deltaRecorder.Body.Bytes(), &deltaPayload); err != nil {
		t.Fatalf("decode delta response: %v", err)
	}
	if !deltaPayload.Changed {
		t.Fatalf("expected stale delta request to be marked changed")
	}
	if deltaPayload.Revision != fullPayload.Revision {
		t.Fatalf("expected delta revision %q to match full sync revision %q", deltaPayload.Revision, fullPayload.Revision)
	}
	if deltaPayload.ProjectCount != fullPayload.ProjectCount {
		t.Fatalf("expected delta project count %d to match full sync %d", deltaPayload.ProjectCount, fullPayload.ProjectCount)
	}
	if len(deltaPayload.ProjectUpserts) != len(fullPayload.Projects) || deltaPayload.ProjectUpserts[0].ID != fullPayload.Projects[0].ID {
		t.Fatalf("expected delta upserts to match full sync payload, got %+v vs %+v", deltaPayload.ProjectUpserts, fullPayload.Projects)
	}
	if len(deltaPayload.ProjectRemoves) != 0 {
		t.Fatalf("expected no removes for initial scoped snapshot, got %+v", deltaPayload.ProjectRemoves)
	}
}

func TestSyncDeltaHandlerRemovesStaleScopedProjectsEvenWhenRevisionMatches(t *testing.T) {
	cfg, st, h, token, visibleProjects := newScopedSyncFixture(t)
	visibleProject := visibleProjects[0]
	revision := buildSyncRevision("", visibleProjects)

	requestBody, err := json.Marshal(syncDeltaRequest{
		SinceRevision: revision,
		KnownProjects: []syncKnownProject{
			{
				ProjectID: visibleProject.ID,
				Signature: buildProjectSyncSignature(visibleProject),
			},
		},
		KnownProjectIDs: []string{visibleProject.ID, "project-2"},
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/device/sync/delta", bytes.NewReader(requestBody))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")

	SyncDeltaHandler(h, cfg, st).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload syncDeltaResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Changed {
		t.Fatalf("expected matching revision with stale known ids to still return cleanup delta")
	}
	if len(payload.ProjectUpserts) != 0 {
		t.Fatalf("expected no upserts for unchanged scoped project, got %+v", payload.ProjectUpserts)
	}
	if len(payload.ProjectRemoves) != 1 || payload.ProjectRemoves[0] != "project-2" {
		t.Fatalf("expected project-2 removal for stale scoped cache, got %+v", payload.ProjectRemoves)
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
	}, nil)

	if len(upserts) != 1 || upserts[0].ID != "project-2" {
		t.Fatalf("expected project-2 upsert, got %+v", upserts)
	}
	if len(removes) != 1 || removes[0] != "project-3" {
		t.Fatalf("expected project-3 removal, got %+v", removes)
	}
}

func TestBuildSyncProjectDeltaSupportsPartialKnownSignatures(t *testing.T) {
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
		{
			ID:          "project-4",
			AgentID:     "owner-agent",
			Name:        "Project Four",
			Path:        "D:/project-four",
			CLIProvider: "claude",
			Online:      true,
		},
	}

	upserts, removes := buildSyncProjectDelta(
		projects,
		[]syncKnownProject{
			{
				ProjectID: "project-1",
				Signature: buildProjectSyncSignature(projects[0]),
			},
		},
		[]string{"project-1", "project-2", "project-3"},
	)

	if len(upserts) != 1 || upserts[0].ID != "project-4" {
		t.Fatalf("expected only new project-4 upsert, got %+v", upserts)
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
		KnownProjectIDs: []string{visibleProject.ID},
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

func TestSyncDeltaHandlerShortCircuitsMatchingRevisionWithoutKnownProjects(t *testing.T) {
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
	revision := buildSyncRevision("owner-agent", visibleProjects)

	token, signErr := issueSessionToken(cfg, st, sessionRequest{
		Type:     model.ClientTypeDevice,
		DeviceID: "owner-device",
	})
	if signErr != nil {
		t.Fatalf("issue session token: %v", signErr)
	}

	requestBody, err := json.Marshal(syncDeltaRequest{
		SinceRevision: revision,
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
		t.Fatalf("expected changed=false for matching revision")
	}
	if len(payload.ProjectUpserts) != 0 || len(payload.ProjectRemoves) != 0 {
		t.Fatalf("expected empty delta for matching revision, got upserts=%+v removes=%+v", payload.ProjectUpserts, payload.ProjectRemoves)
	}
}
