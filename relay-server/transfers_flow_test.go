package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/handler"
	"github.com/claudecode/relay-server/hub"
)

type transferTestResponse struct {
	ID          string `json:"id"`
	SenderType  string `json:"sender_type"`
	TargetType  string `json:"target_type"`
	TargetID    string `json:"target_id"`
	ProjectID   string `json:"project_id"`
	WorkgroupID string `json:"workgroup_id"`
	FileName    string `json:"file_name"`
	MimeType    string `json:"mime_type"`
	SizeBytes   int64  `json:"size_bytes"`
	SHA256      string `json:"sha256"`
	Status      string `json:"status"`
	DownloadURL string `json:"download_url"`
	Receipts    []struct {
		ID         int64  `json:"id"`
		ClientType string `json:"client_type"`
		AgentID    string `json:"agent_id"`
		DeviceID   string `json:"device_id"`
		Status     string `json:"status"`
		Note       string `json:"note"`
	} `json:"receipts"`
}

func TestTransferUploadListDownloadAndReceipts(t *testing.T) {
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
		JWTSecret:    "relay-transfer-test-secret-20260407",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	liveHub := hub.NewHub(cfg, nil)

	alice, err := database.CreateUser("alice", "Alice12345A", false)
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	if err := database.RegisterAgent("agent-a", alice.ID, "Alice desktop"); err != nil {
		t.Fatalf("register agent-a: %v", err)
	}
	if err := database.RegisterDevice("device-a", alice.ID, "agent-a", "Alice phone"); err != nil {
		t.Fatalf("register device-a: %v", err)
	}

	bob, err := database.CreateUser("bob", "Bob12345AA", false)
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}
	if err := database.RegisterAgent("agent-b", bob.ID, "Bob desktop"); err != nil {
		t.Fatalf("register agent-b: %v", err)
	}
	if err := database.RegisterDevice("device-b", bob.ID, "agent-b", "Bob phone"); err != nil {
		t.Fatalf("register device-b: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/devices", handler.ClientDevicesHandler(cfg, database, liveHub))
	mux.HandleFunc("/api/transfers", handler.TransfersHandler(cfg, database))
	mux.HandleFunc("/api/transfers/", handler.TransfersHandler(cfg, database))

	server := httptest.NewServer(mux)
	defer server.Close()

	var aliceAgent deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "alice",
		"password":    "Alice12345A",
		"client_type": "agent",
		"client_id":   "agent-a",
	}, http.StatusOK, &aliceAgent)
	if aliceAgent.Token == "" {
		t.Fatal("expected alice agent token")
	}

	var aliceDevice deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "alice",
		"password":    "Alice12345A",
		"client_type": "device",
		"client_id":   "device-a",
	}, http.StatusOK, &aliceDevice)
	if aliceDevice.Token == "" {
		t.Fatal("expected alice device token")
	}

	var devices []struct {
		ID            string  `json:"id"`
		AgentID       string  `json:"agent_id"`
		Note          string  `json:"note"`
		Online        bool    `json:"online"`
		PresenceState string  `json:"presence_state"`
		LastActiveAt  *string `json:"last_active_at"`
		LastSeenAt    *string `json:"last_seen_at"`
	}
	doJSONWithBearer(t, http.DefaultClient, http.MethodGet, server.URL+"/api/devices", aliceAgent.Token, nil, http.StatusOK, &devices)
	if len(devices) != 1 || devices[0].ID != "device-a" {
		t.Fatalf("unexpected device list: %+v", devices)
	}
	if devices[0].Online {
		t.Fatalf("expected offline presence for non-connected device, got %+v", devices[0])
	}
	if devices[0].PresenceState != "offline" {
		t.Fatalf("expected offline presence state, got %+v", devices[0])
	}
	if devices[0].LastActiveAt != nil || devices[0].LastSeenAt != nil {
		t.Fatalf("expected empty activity timestamps for never-connected device, got %+v", devices[0])
	}

	var bobDevice deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "bob",
		"password":    "Bob12345AA",
		"client_type": "device",
		"client_id":   "device-b",
	}, http.StatusOK, &bobDevice)
	if bobDevice.Token == "" {
		t.Fatal("expected bob device token")
	}

	content := []byte("desktop transfer payload for mobile client")
	var created transferTestResponse
	doMultipartWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/transfers", aliceAgent.Token, map[string]string{
		"target_type":      "device",
		"target_id":        "device-a",
		"project_id":       "project-remote-1",
		"workgroup_id":     "wg-demo-1",
		"expires_in_hours": "24",
	}, "file", "demo-plan.txt", "text/plain", content, http.StatusCreated, &created)
	if created.ID == "" {
		t.Fatal("expected transfer id")
	}
	if created.TargetType != "device" || created.TargetID != "device-a" {
		t.Fatalf("unexpected transfer target: %+v", created)
	}
	if created.ProjectID != "project-remote-1" || created.WorkgroupID != "wg-demo-1" {
		t.Fatalf("unexpected transfer scope: %+v", created)
	}
	if created.MimeType != "text/plain" {
		t.Fatalf("unexpected transfer mime type: %+v", created)
	}
	if created.Status != "available" {
		t.Fatalf("unexpected transfer status: %+v", created)
	}
	if created.SizeBytes != int64(len(content)) {
		t.Fatalf("unexpected transfer size: %+v", created)
	}
	if created.DownloadURL == "" || !strings.Contains(created.DownloadURL, "/api/transfers/"+created.ID+"/download") {
		t.Fatalf("unexpected download url: %+v", created)
	}

	var listed []transferTestResponse
	doJSONWithBearer(t, http.DefaultClient, http.MethodGet, server.URL+"/api/transfers?limit=10", aliceDevice.Token, nil, http.StatusOK, &listed)
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("unexpected transfer list: %+v", listed)
	}

	var detail transferTestResponse
	doJSONWithBearer(t, http.DefaultClient, http.MethodGet, server.URL+"/api/transfers/"+created.ID, aliceDevice.Token, nil, http.StatusOK, &detail)
	if detail.ID != created.ID || detail.FileName != "demo-plan.txt" {
		t.Fatalf("unexpected transfer detail: %+v", detail)
	}
	if len(detail.Receipts) != 0 {
		t.Fatalf("expected no receipts yet, got %+v", detail.Receipts)
	}

	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/transfers/"+created.ID+"/download", nil)
	if err != nil {
		t.Fatalf("new download request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+aliceDevice.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("download transfer: %v", err)
	}
	bodyBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected download status=%d body=%s", resp.StatusCode, string(bodyBytes))
	}
	if string(bodyBytes) != string(content) {
		t.Fatalf("unexpected download body: %q", string(bodyBytes))
	}
	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "text/plain") {
		t.Fatalf("unexpected download content type: %q", got)
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/transfers/"+created.ID+"/receipts", aliceDevice.Token, map[string]any{
		"status": "delivered",
		"note":   "synced on android",
	}, http.StatusCreated, nil)
	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/transfers/"+created.ID+"/receipts", aliceDevice.Token, map[string]any{
		"status": "opened",
	}, http.StatusCreated, nil)

	doJSONWithBearer(t, http.DefaultClient, http.MethodGet, server.URL+"/api/transfers?limit=10&project_id=project-remote-1&include_receipts=1", aliceAgent.Token, nil, http.StatusOK, &listed)
	if len(listed) != 1 || len(listed[0].Receipts) != 2 {
		t.Fatalf("expected filtered transfer list with receipts, got %+v", listed)
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodGet, server.URL+"/api/transfers?limit=10&workgroup_id=wg-missing", aliceAgent.Token, nil, http.StatusOK, &listed)
	if len(listed) != 0 {
		t.Fatalf("expected empty workgroup filtered list, got %+v", listed)
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodGet, server.URL+"/api/transfers/"+created.ID, aliceAgent.Token, nil, http.StatusOK, &detail)
	if len(detail.Receipts) != 2 {
		t.Fatalf("expected 2 receipts, got %+v", detail.Receipts)
	}
	if detail.Receipts[0].Status != "delivered" || detail.Receipts[0].DeviceID != "device-a" {
		t.Fatalf("unexpected first receipt: %+v", detail.Receipts[0])
	}
	if detail.Receipts[1].Status != "opened" {
		t.Fatalf("unexpected second receipt: %+v", detail.Receipts[1])
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodGet, server.URL+"/api/transfers/"+created.ID, bobDevice.Token, nil, http.StatusNotFound, nil)

	req, err = http.NewRequest(http.MethodGet, server.URL+"/api/transfers/"+created.ID+"/download", nil)
	if err != nil {
		t.Fatalf("new unauthorized download request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+bobDevice.Token)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("unauthorized download request: %v", err)
	}
	bodyBytes, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected bob download to be denied, got status=%d body=%s", resp.StatusCode, string(bodyBytes))
	}
}

func doMultipartWithBearer(t *testing.T, client *http.Client, method, url, token string, fields map[string]string, fileField, fileName, fileContentType string, fileContent []byte, wantStatus int, out any) {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatalf("write multipart field: %v", err)
		}
	}

	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Disposition", `form-data; name="`+fileField+`"; filename="`+fileName+`"`)
	partHeader.Set("Content-Type", fileContentType)
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		t.Fatalf("create multipart file part: %v", err)
	}
	if _, err := part.Write(fileContent); err != nil {
		t.Fatalf("write multipart file content: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req, err := http.NewRequest(method, url, &body)
	if err != nil {
		t.Fatalf("new multipart request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("send multipart request: %v", err)
	}
	defer resp.Body.Close()

	responseBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s %s: status=%d want=%d body=%s", method, url, resp.StatusCode, wantStatus, string(responseBody))
	}
	if out != nil && len(responseBody) > 0 {
		if err := json.Unmarshal(responseBody, out); err != nil {
			t.Fatalf("decode multipart response: %v body=%s", err, string(responseBody))
		}
	}
}
