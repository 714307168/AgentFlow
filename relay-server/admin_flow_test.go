package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/handler"
	"github.com/claudecode/relay-server/hub"
	"github.com/claudecode/relay-server/store"
)

type adminLoginResponse struct {
	User struct {
		ID       int    `json:"id"`
		Username string `json:"username"`
		IsAdmin  bool   `json:"is_admin"`
	} `json:"user"`
}

type adminCreateUserResponse struct {
	User struct {
		ID       int    `json:"id"`
		Username string `json:"username"`
	} `json:"user"`
}

type adminListedUser struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
}

type adminListedAgent struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type adminListedDevice struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	AgentID  string `json:"agent_id"`
}

type adminOverviewResponse struct {
	Summary struct {
		Users   int `json:"users"`
		Agents  int `json:"agents"`
		Devices int `json:"devices"`
	} `json:"summary"`
}

type userLoginResponse struct {
	Token string `json:"token"`
}

func TestAdminFlow(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260322",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}

	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	mux := http.NewServeMux()
	mux.HandleFunc("/admin", handler.AdminUIHandler(cfg))
	mux.HandleFunc("/admin/", handler.AdminUIHandler(cfg))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/logout", handler.AdminLogoutHandler())
	mux.HandleFunc("/admin/api/check", handler.AdminCheckHandler(cfg))
	mux.HandleFunc("/admin/api/overview", handler.AdminOverviewHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/account/password", handler.AdminAccountPasswordHandler(cfg, database))
	mux.HandleFunc("/admin/api/agents", handler.AdminAgentsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/agents/", handler.AdminAgentsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/devices", handler.AdminDevicesHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/devices/", handler.AdminDevicesHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/users", handler.AdminUsersHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/users/", handler.AdminUsersHandler(cfg, database, h))
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))

	server := httptest.NewServer(mux)
	defer server.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}

	req, err := http.NewRequest(http.MethodGet, server.URL+"/admin", nil)
	if err != nil {
		t.Fatalf("new admin page request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("get admin page: %v", err)
	}
	pageBody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(pageBody), "Relay Admin") {
		t.Fatalf("unexpected admin page response: status=%d", resp.StatusCode)
	}

	var login adminLoginResponse
	doJSON(t, client, http.MethodPost, server.URL+"/admin/api/login", map[string]any{
		"username": "admin",
		"password": "Admin12345A",
	}, http.StatusOK, &login)
	if !login.User.IsAdmin {
		t.Fatal("expected admin login response")
	}

	var created adminCreateUserResponse
	doJSON(t, client, http.MethodPost, server.URL+"/admin/api/users", map[string]any{
		"username": "alice",
		"password": "Alice12345A",
		"is_admin": false,
	}, http.StatusCreated, &created)
	if created.User.Username != "alice" {
		t.Fatal("user creation did not return alice")
	}

	var users []adminListedUser
	doJSON(t, client, http.MethodGet, server.URL+"/admin/api/users", nil, http.StatusOK, &users)
	aliceID := 0
	for _, user := range users {
		if user.Username == "alice" {
			aliceID = user.ID
			break
		}
	}
	if aliceID == 0 {
		t.Fatal("alice missing from users list")
	}

	doJSON(t, client, http.MethodPost, server.URL+"/admin/api/agents", map[string]any{
		"id":      "agent-a",
		"note":    "Alice desktop",
		"user_id": aliceID,
	}, http.StatusCreated, nil)
	doJSON(t, client, http.MethodPost, server.URL+"/admin/api/devices", map[string]any{
		"id":       "device-a",
		"note":     "Alice phone",
		"agent_id": "agent-a",
		"user_id":  aliceID,
	}, http.StatusCreated, nil)

	var agents []adminListedAgent
	doJSON(t, client, http.MethodGet, server.URL+"/admin/api/agents", nil, http.StatusOK, &agents)
	foundAgent := false
	for _, agent := range agents {
		if agent.ID == "agent-a" && agent.Username == "alice" {
			foundAgent = true
			break
		}
	}
	if !foundAgent {
		t.Fatal("agents list missing alice ownership")
	}

	var devices []adminListedDevice
	doJSON(t, client, http.MethodGet, server.URL+"/admin/api/devices", nil, http.StatusOK, &devices)
	foundDevice := false
	for _, device := range devices {
		if device.ID == "device-a" && device.Username == "alice" && device.AgentID == "agent-a" {
			foundDevice = true
			break
		}
	}
	if !foundDevice {
		t.Fatal("devices list missing alice binding")
	}

	var overview adminOverviewResponse
	doJSON(t, client, http.MethodGet, server.URL+"/admin/api/overview", nil, http.StatusOK, &overview)
	if overview.Summary.Users < 2 || overview.Summary.Agents < 1 || overview.Summary.Devices < 1 {
		t.Fatalf("unexpected overview summary: %+v", overview.Summary)
	}

	doJSON(t, client, http.MethodPost, server.URL+"/admin/api/account/password", map[string]any{
		"old_password": "Admin12345A",
		"new_password": "Admin54321A",
	}, http.StatusOK, nil)
	doJSON(t, client, http.MethodPost, server.URL+"/admin/api/logout", map[string]any{}, http.StatusOK, nil)
	doJSON(t, client, http.MethodPost, server.URL+"/admin/api/login", map[string]any{
		"username": "admin",
		"password": "Admin54321A",
	}, http.StatusOK, &login)
	if !login.User.IsAdmin {
		t.Fatal("admin relogin with new password failed")
	}

	doJSON(t, client, http.MethodPost, server.URL+"/admin/api/users/"+strconv.Itoa(aliceID)+"/password", map[string]any{
		"password": "Alice98765A",
	}, http.StatusOK, nil)

	var userLogin userLoginResponse
	doJSON(t, client, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "alice",
		"password":    "Alice98765A",
		"client_type": "agent",
		"client_id":   "agent-a",
	}, http.StatusOK, &userLogin)
	if userLogin.Token == "" {
		t.Fatal("expected token after user password reset")
	}
}

func doJSON(t *testing.T, client *http.Client, method, url string, body any, wantStatus int, out any) {
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

	resp, err := client.Do(req)
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
