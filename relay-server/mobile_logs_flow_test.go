package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/handler"
)

type deviceLoginResponse struct {
	Token string `json:"token"`
}

type uploadedMobileLog struct {
	ID           string   `json:"id"`
	Username     string   `json:"username"`
	DeviceID     string   `json:"device_id"`
	OriginalName string   `json:"original_name"`
	TraceIDs     []string `json:"trace_ids"`
	WorkgroupIDs []string `json:"workgroup_ids"`
}

type uploadedMobileLogDetail struct {
	Metadata struct {
		ID           string   `json:"id"`
		DeviceID     string   `json:"device_id"`
		OriginalName string   `json:"original_name"`
		TraceIDs     []string `json:"trace_ids"`
		WorkgroupIDs []string `json:"workgroup_ids"`
	} `json:"metadata"`
	Content string `json:"content"`
}

type uploadedMobileLogAnalysis struct {
	Summary      string   `json:"summary"`
	ErrorCount   int      `json:"error_count"`
	TraceIDs     []string `json:"trace_ids"`
	WorkgroupIDs []string `json:"workgroup_ids"`
	Signals      []struct {
		Code  string `json:"code"`
		Count int    `json:"count"`
	} `json:"signals"`
}

func TestMobileLogUploadAndAdminAnalysis(t *testing.T) {
	t.Setenv("ADMIN_PASSWORD", "Admin12345A")
	t.Setenv("ADMIN_USER", "")

	dataDir := t.TempDir()
	database, err := db.Open(dataDir)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	if err := database.InitializeDefaultUser(); err != nil {
		t.Fatalf("init default user: %v", err)
	}

	cfg := &config.Config{
		JWTSecret:    "relay-test-secret-20260401",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}

	if _, err := database.CreateUser("alice", "Alice12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	alice, err := database.GetUserByUsername("alice")
	if err != nil {
		t.Fatalf("get alice: %v", err)
	}
	if err := database.RegisterAgent("agent-a", alice.ID, "Alice desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-a", alice.ID, "agent-a", "Alice phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database))
	mux.HandleFunc("/admin/mobile-logs", handler.AdminMobileLogsPageHandler(cfg))
	mux.HandleFunc("/admin/mobile-logs/", handler.AdminMobileLogsPageHandler(cfg))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "alice",
		"password":    "Alice12345A",
		"client_type": "device",
		"client_id":   "device-a",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	uploadBody := map[string]any{
		"file_name":     "app-20260401.log",
		"content":       "[2026-04-01 18:00:00.000] ERROR [RelayConnectionService] Failed to refresh mobile token after auth error trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 18:00:01.000] ERROR [MainActivity] Failed to verify relay connection on resume trace_id=trace-alpha-001\n",
		"app_version":   "1.1.91",
		"app_build":     75,
		"device_model":  "Pixel Test",
		"source":        "android",
		"trace_ids":     []string{"trace-alpha-001", "trace-alpha-001"},
		"workgroup_ids": []string{"fyzy-workgroup"},
	}
	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, uploadBody, http.StatusOK, nil)
	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name":    "app-20260402.log",
		"content":      "[2026-04-02 10:00:00.000] WARN [RelayConnectionService] recovering stalled websocket trace_id=trace-beta-002 workgroup_id=other-workgroup\n",
		"app_version":  "1.1.92",
		"app_build":    76,
		"device_model": "Pixel Test",
		"source":       "android",
	}, http.StatusOK, nil)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	adminClient := &http.Client{Jar: jar}
	doJSON(t, adminClient, http.MethodPost, server.URL+"/admin/api/login", map[string]any{
		"username": "admin",
		"password": "Admin12345A",
	}, http.StatusOK, nil)

	req, err := http.NewRequest(http.MethodGet, server.URL+"/admin/mobile-logs", nil)
	if err != nil {
		t.Fatalf("new mobile logs page request: %v", err)
	}
	resp, err := adminClient.Do(req)
	if err != nil {
		t.Fatalf("get mobile logs page: %v", err)
	}
	pageBody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(pageBody), "Mobile Logs") {
		t.Fatalf("unexpected mobile logs page response: status=%d", resp.StatusCode)
	}

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs", nil, http.StatusOK, &logs)
	if len(logs) != 2 {
		t.Fatalf("expected 2 uploaded mobile logs, got %d", len(logs))
	}

	var alphaLog uploadedMobileLog
	var betaLog uploadedMobileLog
	for _, item := range logs {
		if item.Username != "alice" || item.DeviceID != "device-a" {
			t.Fatalf("unexpected uploaded log owner: %+v", item)
		}
		if len(item.TraceIDs) > 0 && item.TraceIDs[0] == "trace-alpha-001" {
			alphaLog = item
		}
		if len(item.TraceIDs) > 0 && item.TraceIDs[0] == "trace-beta-002" {
			betaLog = item
		}
	}
	if alphaLog.ID == "" || betaLog.ID == "" {
		t.Fatalf("expected both alpha and beta logs in list, got %+v", logs)
	}
	if len(alphaLog.WorkgroupIDs) == 0 || alphaLog.WorkgroupIDs[0] != "fyzy-workgroup" {
		t.Fatalf("expected alpha log to include extracted workgroup ids, got %+v", alphaLog)
	}

	var detail uploadedMobileLogDetail
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+alphaLog.ID, nil, http.StatusOK, &detail)
	if !strings.Contains(detail.Content, "Failed to refresh mobile token") {
		t.Fatalf("unexpected log content: %s", detail.Content)
	}
	if len(detail.Metadata.TraceIDs) != 1 || detail.Metadata.TraceIDs[0] != "trace-alpha-001" {
		t.Fatalf("expected detail metadata to persist trace ids, got %+v", detail.Metadata)
	}
	if len(detail.Metadata.WorkgroupIDs) != 1 || detail.Metadata.WorkgroupIDs[0] != "fyzy-workgroup" {
		t.Fatalf("expected detail metadata to persist workgroup ids, got %+v", detail.Metadata)
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+alphaLog.ID+"/analysis", nil, http.StatusOK, &analysis)
	if analysis.ErrorCount < 2 {
		t.Fatalf("expected analysis to count errors, got %+v", analysis)
	}
	if len(analysis.Signals) == 0 {
		t.Fatalf("expected analysis signals, got %+v", analysis)
	}
	if len(analysis.TraceIDs) == 0 || analysis.TraceIDs[0] != "trace-alpha-001" {
		t.Fatalf("expected analysis to expose trace ids, got %+v", analysis)
	}
	if len(analysis.WorkgroupIDs) == 0 || analysis.WorkgroupIDs[0] != "fyzy-workgroup" {
		t.Fatalf("expected analysis to expose workgroup ids, got %+v", analysis)
	}

	var traceFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?trace_id=trace-alpha-001", nil, http.StatusOK, &traceFiltered)
	if len(traceFiltered) != 1 || traceFiltered[0].ID != alphaLog.ID {
		t.Fatalf("expected trace filter to return first log, got %+v", traceFiltered)
	}

	var workgroupFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?workgroup_id=other-workgroup", nil, http.StatusOK, &workgroupFiltered)
	if len(workgroupFiltered) != 1 || workgroupFiltered[0].ID != betaLog.ID {
		t.Fatalf("expected workgroup filter to return second log, got %+v", workgroupFiltered)
	}
}

func doJSONWithBearer(t *testing.T, client *http.Client, method, url, token string, body any, wantStatus int, out any) {
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
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s %s: status=%d want=%d body=%s", method, url, resp.StatusCode, wantStatus, string(bodyBytes))
	}
	if out != nil && len(bodyBytes) > 0 {
		if err := json.Unmarshal(bodyBytes, out); err != nil {
			t.Fatalf("decode response: %v body=%s", err, string(bodyBytes))
		}
	}
}
