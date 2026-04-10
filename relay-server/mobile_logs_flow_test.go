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
	"github.com/claudecode/relay-server/hub"
	"github.com/claudecode/relay-server/model"
	"github.com/claudecode/relay-server/store"
)

type deviceLoginResponse struct {
	Token string `json:"token"`
}

type uploadedMobileLog struct {
	ID             string   `json:"id"`
	Username       string   `json:"username"`
	DeviceID       string   `json:"device_id"`
	OriginalName   string   `json:"original_name"`
	Source         string   `json:"source"`
	TraceIDs       []string `json:"trace_ids"`
	WorkgroupIDs   []string `json:"workgroup_ids"`
	TaskIDs        []string `json:"task_ids"`
	DispatchRunIDs []string `json:"dispatch_run_ids"`
}

type uploadedMobileLogDetail struct {
	Metadata struct {
		ID             string   `json:"id"`
		DeviceID       string   `json:"device_id"`
		OriginalName   string   `json:"original_name"`
		Source         string   `json:"source"`
		ConnectionNote string   `json:"connection_note"`
		TraceIDs       []string `json:"trace_ids"`
		WorkgroupIDs   []string `json:"workgroup_ids"`
	} `json:"metadata"`
	Content string `json:"content"`
}

type uploadedMobileLogAnalysis struct {
	Summary        string   `json:"summary"`
	ErrorCount     int      `json:"error_count"`
	TraceIDs       []string `json:"trace_ids"`
	WorkgroupIDs   []string `json:"workgroup_ids"`
	TaskIDs        []string `json:"task_ids"`
	DispatchRunIDs []string `json:"dispatch_run_ids"`
	RecoveryPanels []struct {
		Key        string   `json:"key"`
		Status     string   `json:"status"`
		SignalCode string   `json:"signal_code"`
		Examples   []string `json:"examples"`
	} `json:"recovery_panels"`
	Signals []struct {
		Code  string `json:"code"`
		Count int    `json:"count"`
	} `json:"signals"`
}

type uploadedMobileLogOverview struct {
	Summary         string `json:"summary"`
	LogCount        int    `json:"log_count"`
	LogsWithSignals int    `json:"logs_with_signals"`
	ErrorCount      int    `json:"error_count"`
	WarningCount    int    `json:"warning_count"`
	PresenceSummary struct {
		MatchingAgents  int `json:"matching_agents"`
		OnlineAgents    int `json:"online_agents"`
		MatchingDevices int `json:"matching_devices"`
		OnlineDevices   int `json:"online_devices"`
	} `json:"presence_summary"`
	ConnectionSummary struct {
		LogsWithConnectionNotes int `json:"logs_with_connection_notes"`
		StructuredLogs          int `json:"structured_logs"`
		FreeformLogs            int `json:"freeform_logs"`
		AgentStates             []struct {
			Value    string `json:"value"`
			LogCount int    `json:"log_count"`
		} `json:"agent_states"`
		ControllerStates []struct {
			Value    string `json:"value"`
			LogCount int    `json:"log_count"`
		} `json:"controller_states"`
		Hosts []struct {
			Value    string `json:"value"`
			LogCount int    `json:"log_count"`
		} `json:"hosts"`
		Platforms []struct {
			Value    string `json:"value"`
			LogCount int    `json:"log_count"`
		} `json:"platforms"`
		FreeformNotes []struct {
			Value    string `json:"value"`
			LogCount int    `json:"log_count"`
		} `json:"freeform_notes"`
		Hotspots []struct {
			AgentState                 string `json:"agent_state"`
			ControllerState            string `json:"controller_state"`
			Host                       string `json:"host"`
			Platform                   string `json:"platform"`
			LogCount                   int    `json:"log_count"`
			LogsWithSignals            int    `json:"logs_with_signals"`
			CriticalCount              int    `json:"critical_count"`
			WarningCount               int    `json:"warning_count"`
			TopSignalCode              string `json:"top_signal_code"`
			TopSignalTitle             string `json:"top_signal_title"`
			TopRecoveryPanelKey        string `json:"top_recovery_panel_key"`
			TopRecoveryPanelTitle      string `json:"top_recovery_panel_title"`
			TopRecoveryPanelStatus     string `json:"top_recovery_panel_status"`
			TopRecoveryPanelSignalCode string `json:"top_recovery_panel_signal_code"`
			TopTraceID                 string `json:"top_trace_id"`
			TopWorkgroupID             string `json:"top_workgroup_id"`
			TopTaskID                  string `json:"top_task_id"`
			TopDispatchRunID           string `json:"top_dispatch_run_id"`
			ReplaySignalCode           string `json:"replay_signal_code"`
			ReplayTraceID              string `json:"replay_trace_id"`
			ReplayWorkgroupID          string `json:"replay_workgroup_id"`
			ReplayTaskID               string `json:"replay_task_id"`
			ReplayDispatchRunID        string `json:"replay_dispatch_run_id"`
		} `json:"hotspots"`
	} `json:"connection_summary"`
	LivePresence []struct {
		Kind         string `json:"kind"`
		ID           string `json:"id"`
		AgentID      string `json:"agent_id"`
		Username     string `json:"username"`
		Source       string `json:"source"`
		Online       bool   `json:"online"`
		LogCount     int    `json:"log_count"`
		LastUploaded string `json:"last_uploaded"`
	} `json:"live_presence"`
	SourceCounts []struct {
		Source   string `json:"source"`
		LogCount int    `json:"log_count"`
	} `json:"source_counts"`
	TopSignals []struct {
		Code       string `json:"code"`
		LogCount   int    `json:"log_count"`
		TotalCount int    `json:"total_count"`
	} `json:"top_signals"`
	TopTraceIDs []struct {
		Value    string `json:"value"`
		LogCount int    `json:"log_count"`
	} `json:"top_trace_ids"`
	TopTaskIDs []struct {
		Value    string `json:"value"`
		LogCount int    `json:"log_count"`
	} `json:"top_task_ids"`
	RecoveryPanels []struct {
		Key                   string `json:"key"`
		Status                string `json:"status"`
		SignalCode            string `json:"signal_code"`
		TopTraceID            string `json:"top_trace_id"`
		TopWorkgroupID        string `json:"top_workgroup_id"`
		TopAgentState         string `json:"top_agent_state"`
		TopControllerState    string `json:"top_controller_state"`
		TopHost               string `json:"top_host"`
		TopPlatform           string `json:"top_platform"`
		ReplayTraceID         string `json:"replay_trace_id"`
		ReplayWorkgroupID     string `json:"replay_workgroup_id"`
		ReplayAgentState      string `json:"replay_agent_state"`
		ReplayControllerState string `json:"replay_controller_state"`
		ReplayHost            string `json:"replay_host"`
		ReplayPlatform        string `json:"replay_platform"`
		LogCount              int    `json:"log_count"`
		HealthyCount          int    `json:"healthy_count"`
		WarningCount          int    `json:"warning_count"`
		CriticalCount         int    `json:"critical_count"`
		IdleCount             int    `json:"idle_count"`
	} `json:"recovery_panels"`
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
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

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

	onlineAgent := hub.NewClient(h, nil)
	onlineAgent.ID = "agent-online-1"
	onlineAgent.Type = model.ClientTypeAgent
	onlineAgent.AgentID = "agent-a"
	h.RegisterAgent(onlineAgent)

	onlineDevice := hub.NewClient(h, nil)
	onlineDevice.ID = "device-online-1"
	onlineDevice.Type = model.ClientTypeDevice
	onlineDevice.DeviceID = "device-a"
	h.RegisterDevice(onlineDevice)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))
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
		"content":       "[2026-04-01 17:59:58.000] INFO [MainActivity] Scheduling foreground recovery passes reason=activity-resume forceReconnectInitial=true passCount=3 trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 17:59:59.000] INFO [MainActivity] Running foreground recovery pass reason=activity-resume:0 forceReconnect=true trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 18:00:00.000] INFO [RelayConnectionService] Starting auth error recovery reason=auth-error trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 18:00:00.500] ERROR [RelayConnectionService] Failed to refresh mobile token after auth error trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 18:00:01.000] ERROR [MainActivity] Failed to verify relay connection on resume trace_id=trace-alpha-001\n[2026-04-01 18:00:01.500] INFO [RelayConnectionService] Starting post-auth session sync trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 18:00:01.700] ERROR [RelayConnectionService] Failed to sync sessions after relay authentication trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 18:00:01.900] INFO [MainActivity] Foreground session catalog refreshed reason=activity-resume:0 sessionCount=3 trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 18:00:02.000] INFO [MainActivity] Skipping foreground project sync because relay is not connected: activity-resume:0 trace_id=trace-alpha-001 workgroup_id=fyzy-workgroup\n[2026-04-01 18:00:02.500] INFO [MessageRepository] Detected incomplete local sync for projectId=p1 conversationId=conv-1 storedAfterSeq=88 earliest=0 latest=70 count=12; forcing full resync\n[2026-04-01 18:00:03.000] INFO [MessageRepository] Requesting sync backfill for projectId=p1 afterSeq=66 beforeSeq=82 lowerBound=67\n[2026-04-01 18:00:04.000] ERROR [WorkgroupChatViewModel] Failed to validate workgroup connection during sync\n[2026-04-01 18:00:05.000] ERROR [ChatViewModel] Error retrying pending send\n[2026-04-01 18:00:06.000] INFO [MessageRouter] Accepted duplicate project message.send using existing trace.\n",
		"app_version":   "1.1.91",
		"app_build":     75,
		"device_model":  "Pixel Test",
		"source":        "android",
		"trace_ids":     []string{"trace-alpha-001", "trace-alpha-001"},
		"workgroup_ids": []string{"fyzy-workgroup"},
	}
	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, uploadBody, http.StatusOK, nil)
	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name":       "app-20260402.log",
		"content":         "[2026-04-02 10:00:00.000] WARN [RelayConnectionService] recovering stalled websocket trace_id=trace-beta-002 workgroup_id=other-workgroup\n",
		"app_version":     "1.1.92",
		"app_build":       76,
		"device_model":    "Pixel Test",
		"source":          "android",
		"connection_note": "Uploaded from Android settings diagnostics.",
	}, http.StatusOK, nil)
	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name":       "desktop-20260402.log",
		"content":         "[2026-04-02T10:59:54.000Z] WARN [relay] Controller relay auth recovery aborted because token refresh failed. reason=controller-auth-failed trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T10:59:55.000Z] WARN [relay] Triggered relay watchdog recovery. reason=watchdog-agent-periodic state=disconnected disconnectedForMs=120000 consecutiveFailureCount=4 reconnectAttemptCount=3 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T10:59:56.000Z] WARN [RelayClient] Reconnecting stalled socket during health-check; state=connecting staleForMs=91234 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T10:59:57.000Z] WARN [scheduler] Recovered scheduled task with stale in-flight state. taskId=task-stale projectId=p-desktop runId=stale-run-1 previousStatus=running reason=startup recoveryState=restart-residue trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T10:59:58.000Z] WARN [scheduler] Recovered scheduled workgroup task with stale in-flight state. taskId=wg-stale-1 workgroupId=desktop-workgroup dispatchRunId=wg-run-stale previousStatus=assigned reason=startup recoveryState=restart-residue trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T10:59:59.000Z] INFO [relay] Scheduled relay follow-up refreshes. reason=controller-authenticated delaysMs=0,1500,5000 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:00.000Z] WARN [RelayClient] Reconnecting stalled socket during health-check; state=connecting staleForMs=91234 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:01.000Z] INFO [RelayClient] Reconnecting in 1000ms...\n[2026-04-02T11:00:01.500Z] INFO [relay] Running relay follow-up refresh. reason=controller-authenticated:0 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:01.700Z] INFO [relay] Requested remote project catalog refresh. reason=follow-up:controller-authenticated:0 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:01.900Z] INFO [relay] Remote project catalog updated. projectCount=4 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:02.000Z] INFO [relay] Requested active remote project sync. reason=remote-projects-changed force=false projectId=remote:project-1 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:02.200Z] INFO [workgroup] Completed remote workgroup catalog refresh. reason=follow-up:controller-authenticated:0 force=true recordCount=3 requestedSummaries=true trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:02.300Z] INFO [workgroup] Remote workgroup catalog updated. summaryCount=3 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:03.000Z] ERROR [workgroup] Delivery failed: no member accepted this message. qa: Remote dispatch failed. trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:04.000Z] INFO [scheduler] Queued scheduled task. taskId=task-1 projectId=p-desktop runId=run-1 trigger=scheduled scheduleType=daily trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:05.000Z] INFO [scheduler] Scheduled task started running. taskId=task-1 projectId=p-desktop runId=run-1 trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:06.000Z] WARN [scheduler] Scheduled task failed. taskId=task-1 projectId=p-desktop trigger=scheduled error=relay timeout retryCount=1 maxRetries=3 retryRunAt=2026-04-02T11:05:06.000Z trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:07.000Z] INFO [scheduler] Queued scheduled workgroup task. taskId=wg-task-1 workgroupId=desktop-workgroup assigneeMemberId=member-1 trigger=scheduled scheduleType=daily trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:00:08.000Z] WARN [scheduler] Scheduled workgroup task failed. taskId=wg-task-1 workgroupId=desktop-workgroup assigneeMemberId=member-1 trigger=scheduled error=no eligible member trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:15:08.000Z] WARN [scheduler] Scheduled workgroup task failed. taskId=wg-task-1 workgroupId=desktop-workgroup assigneeMemberId=member-1 trigger=scheduled error=no eligible member trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:16:08.000Z] WARN [scheduler] Scheduled workgroup task failed. taskId=wg-task-2 workgroupId=desktop-workgroup assigneeMemberId=null trigger=scheduled error=Task has no assignee. trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:17:08.000Z] WARN [scheduler] Scheduled workgroup task failed. taskId=wg-task-3 workgroupId=desktop-workgroup assigneeMemberId=member-2 trigger=scheduled error=Assignee's remote project is offline. trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:18:08.000Z] WARN [scheduler] Scheduled workgroup task failed. taskId=wg-task-4 workgroupId=desktop-workgroup assigneeMemberId=member-3 trigger=scheduled error=Task is already dispatched. Reset or finish it before dispatching again. trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:19:08.000Z] WARN [scheduler] Scheduled workgroup task failed. taskId=wg-task-5 workgroupId=desktop-workgroup assigneeMemberId=member-4 trigger=scheduled error=Remote dispatch failed trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:20:08.000Z] INFO [scheduler] Queued scheduled workgroup task. taskId=wg-task-6 workgroupId=desktop-workgroup assigneeMemberId=member-6 trigger=scheduled scheduleType=daily trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:20:18.000Z] INFO [scheduler] Queued scheduled workgroup task. taskId=wg-task-6 workgroupId=desktop-workgroup assigneeMemberId=member-6 trigger=scheduled scheduleType=daily trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:21:08.000Z] INFO [scheduler] Scheduled workgroup task dispatched. taskId=wg-task-7 workgroupId=desktop-workgroup assigneeMemberId=member-7 dispatchProjectId=project-7 dispatchRunId=dispatch-run-7 status=running trigger=manual_dispatch result=Assigned local member project is executing the task. trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:22:08.000Z] INFO [scheduler] Scheduled workgroup task dispatched. taskId=wg-task-8 workgroupId=desktop-workgroup assigneeMemberId=member-8 dispatchProjectId=project-8 dispatchRunId=dispatch-run-8 status=running trigger=manual_dispatch result=Assigned local member project is executing the task. trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:23:08.000Z] INFO [scheduler] Scheduled workgroup task completed. taskId=wg-task-8 workgroupId=desktop-workgroup assigneeMemberId=member-8 dispatchProjectId=project-8 dispatchRunId=dispatch-run-8 status=done trigger=manual_dispatch result=Completed by assigned member project. trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:24:08.000Z] INFO [scheduler] Scheduled workgroup task dispatched. taskId=wg-task-9 workgroupId=desktop-workgroup assigneeMemberId=member-9 dispatchProjectId=project-9 dispatchRunId=dispatch-run-9 status=assigned trigger=manual_dispatch result=Waiting in the assigned remote member project queue. trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n[2026-04-02T11:25:08.000Z] WARN [scheduler] Scheduled workgroup task downstream execution failed. taskId=wg-task-9 workgroupId=desktop-workgroup assigneeMemberId=member-9 dispatchProjectId=project-9 dispatchRunId=dispatch-run-9 status=error trigger=manual_dispatch error=Remote dispatch failed trace_id=trace-desktop-003 workgroup_id=desktop-workgroup\n",
		"app_version":     "1.1.102",
		"device_model":    "Desktop Test Host",
		"source":          "desktop",
		"connection_note": "host=test-host; platform=linux; agent=connected; controller=connected",
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
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(pageBody), "Device Logs") {
		t.Fatalf("unexpected mobile logs page response: status=%d", resp.StatusCode)
	}
	if !strings.Contains(string(pageBody), "log_id") || !strings.Contains(string(pageBody), "Copy Link") || !strings.Contains(string(pageBody), "history.replaceState") || !strings.Contains(string(pageBody), "Filter Text") || !strings.Contains(string(pageBody), "Filter Signal") || !strings.Contains(string(pageBody), "Apply Top Context") || !strings.Contains(string(pageBody), "Replay Hotspot Context") || !strings.Contains(string(pageBody), "data-filter-preset") || !strings.Contains(string(pageBody), "/admin/api/mobile-logs/overview") || !strings.Contains(string(pageBody), "Current Filter Overview") || !strings.Contains(string(pageBody), "Recovery Panels") || !strings.Contains(string(pageBody), "Recovery Health") || !strings.Contains(string(pageBody), "Live Presence") || !strings.Contains(string(pageBody), "Connection Snapshots") || !strings.Contains(string(pageBody), "Connection Hotspots") || !strings.Contains(string(pageBody), "Connection Note") || !strings.Contains(string(pageBody), "signal_code") {
		t.Fatalf("expected admin page to expose deep-link jump helpers, got %s", string(pageBody))
	}

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs", nil, http.StatusOK, &logs)
	if len(logs) != 3 {
		t.Fatalf("expected 3 uploaded device logs, got %d", len(logs))
	}

	var alphaLog uploadedMobileLog
	var betaLog uploadedMobileLog
	var desktopLog uploadedMobileLog
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
		if item.Source == "desktop" {
			desktopLog = item
		}
	}
	if alphaLog.ID == "" || betaLog.ID == "" || desktopLog.ID == "" {
		t.Fatalf("expected alpha, beta, and desktop logs in list, got %+v", logs)
	}
	if len(alphaLog.WorkgroupIDs) == 0 || alphaLog.WorkgroupIDs[0] != "fyzy-workgroup" {
		t.Fatalf("expected alpha log to include extracted workgroup ids, got %+v", alphaLog)
	}
	if len(desktopLog.TaskIDs) == 0 || len(desktopLog.DispatchRunIDs) == 0 {
		t.Fatalf("expected desktop log to expose extracted task and dispatch run ids, got %+v", desktopLog)
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
	if detail.Metadata.Source != "android" {
		t.Fatalf("expected detail metadata to expose source, got %+v", detail.Metadata)
	}
	if detail.Metadata.ConnectionNote != "" {
		t.Fatalf("expected alpha detail to keep empty connection note, got %+v", detail.Metadata)
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
	if !hasSignalCode(analysis.Signals, "project_sync_gap_recovery") {
		t.Fatalf("expected project sync gap recovery signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "workgroup_sync_failures") {
		t.Fatalf("expected workgroup sync failure signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "send_ack_retry_loops") {
		t.Fatalf("expected send ack / retry loop signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "auth_recovery_failures") {
		t.Fatalf("expected auth recovery failure signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "foreground_recovery_follow_up_gaps") {
		t.Fatalf("expected foreground recovery follow-up gap signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "post_auth_sync_incomplete") {
		t.Fatalf("expected post-auth sync incomplete signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "android_manual_reconnect_likely") {
		t.Fatalf("expected android manual reconnect signal, got %+v", analysis.Signals)
	}
	if len(analysis.RecoveryPanels) != 4 {
		t.Fatalf("expected android analysis to expose 4 recovery panels, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_auth_recovery", "critical", "auth_recovery_failures") {
		t.Fatalf("expected android auth panel to be critical, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_foreground_catalog", "healthy", "") {
		t.Fatalf("expected android foreground catalog panel to stay healthy, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_project_sync", "warning", "post_auth_sync_incomplete") {
		t.Fatalf("expected android project sync panel to warn, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_workgroup_refresh", "warning", "foreground_recovery_follow_up_gaps") {
		t.Fatalf("expected android workgroup refresh panel to warn, got %+v", analysis.RecoveryPanels)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview", nil, http.StatusOK, &overview)
	if overview.LogCount != 3 {
		t.Fatalf("expected overview to include all 3 logs, got %+v", overview)
	}
	if overview.LogsWithSignals < 3 {
		t.Fatalf("expected overview to count logs with signals, got %+v", overview)
	}
	if !hasOverviewSourceCount(overview.SourceCounts, "android", 2) || !hasOverviewSourceCount(overview.SourceCounts, "desktop", 1) {
		t.Fatalf("unexpected overview source counts: %+v", overview.SourceCounts)
	}
	if len(overview.TopSignals) == 0 || overview.TopSignals[0].Code != "android_manual_reconnect_likely" {
		t.Fatalf("expected overview to prioritize android manual reconnect signal, got %+v", overview.TopSignals)
	}
	if !hasOverviewBucketValue(overview.TopTraceIDs, "trace-alpha-001") {
		t.Fatalf("expected overview to expose top trace ids, got %+v", overview.TopTraceIDs)
	}
	if overview.PresenceSummary.MatchingAgents != 1 || overview.PresenceSummary.OnlineAgents != 1 || overview.PresenceSummary.MatchingDevices != 1 || overview.PresenceSummary.OnlineDevices != 1 {
		t.Fatalf("expected overview to expose live presence summary, got %+v", overview.PresenceSummary)
	}
	if overview.ConnectionSummary.LogsWithConnectionNotes != 2 || overview.ConnectionSummary.StructuredLogs != 1 || overview.ConnectionSummary.FreeformLogs != 1 {
		t.Fatalf("expected overview to expose connection note summary, got %+v", overview.ConnectionSummary)
	}
	if !hasOverviewConnectionItem(overview.ConnectionSummary.AgentStates, "connected", 1) {
		t.Fatalf("expected overview to expose agent connection state, got %+v", overview.ConnectionSummary.AgentStates)
	}
	if !hasOverviewConnectionItem(overview.ConnectionSummary.ControllerStates, "connected", 1) {
		t.Fatalf("expected overview to expose controller connection state, got %+v", overview.ConnectionSummary.ControllerStates)
	}
	if !hasOverviewConnectionItem(overview.ConnectionSummary.Hosts, "test-host", 1) {
		t.Fatalf("expected overview to expose host connection snapshot, got %+v", overview.ConnectionSummary.Hosts)
	}
	if !hasOverviewConnectionItem(overview.ConnectionSummary.Platforms, "linux", 1) {
		t.Fatalf("expected overview to expose platform connection snapshot, got %+v", overview.ConnectionSummary.Platforms)
	}
	if !hasOverviewConnectionItem(overview.ConnectionSummary.FreeformNotes, "Uploaded from Android settings diagnostics.", 1) {
		t.Fatalf("expected overview to expose freeform connection note, got %+v", overview.ConnectionSummary.FreeformNotes)
	}
	if !hasConnectionHotspot(overview.ConnectionSummary.Hotspots, "connected", "connected", "test-host", "linux", 1, 1, 1, 1, "desktop_resume_catchup_stalled", "trace-desktop-003", "desktop-workgroup", "task-1", "dispatch-run-7") {
		t.Fatalf("expected overview to expose connection hotspot, got %+v", overview.ConnectionSummary.Hotspots)
	}
	if !hasConnectionHotspotRecoveryStage(overview.ConnectionSummary.Hotspots, "test-host", "desktop_auth_recovery", "critical", "desktop_auth_recovery_failures") {
		t.Fatalf("expected overview hotspot to expose top recovery stage, got %+v", overview.ConnectionSummary.Hotspots)
	}
	if !hasOverviewPresence(overview.LivePresence, "agent", "agent-a", true, 3) {
		t.Fatalf("expected overview to expose live agent presence, got %+v", overview.LivePresence)
	}
	if !hasOverviewPresence(overview.LivePresence, "device", "device-a", true, 3) {
		t.Fatalf("expected overview to expose live device presence, got %+v", overview.LivePresence)
	}
	if len(overview.RecoveryPanels) != 7 {
		t.Fatalf("expected overview to expose aggregated recovery panels, got %+v", overview.RecoveryPanels)
	}
	if !hasOverviewRecoveryPanel(overview.RecoveryPanels, "android_auth_recovery", "critical", 1, 1, "auth_recovery_failures") {
		t.Fatalf("expected overview android auth panel aggregation, got %+v", overview.RecoveryPanels)
	}
	if !hasOverviewRecoveryPanelContext(overview.RecoveryPanels, "android_auth_recovery", "trace-alpha-001", "fyzy-workgroup", "", "", "", "") {
		t.Fatalf("expected overview android auth panel to expose top context, got %+v", overview.RecoveryPanels)
	}
	if !hasOverviewRecoveryPanel(overview.RecoveryPanels, "desktop_auth_recovery", "critical", 1, 1, "desktop_auth_recovery_failures") {
		t.Fatalf("expected overview auth panel aggregation, got %+v", overview.RecoveryPanels)
	}
	if !hasOverviewRecoveryPanelContext(overview.RecoveryPanels, "desktop_auth_recovery", "trace-desktop-003", "desktop-workgroup", "connected", "connected", "test-host", "linux") {
		t.Fatalf("expected overview desktop auth panel to expose top context, got %+v", overview.RecoveryPanels)
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

	var sourceFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=desktop", nil, http.StatusOK, &sourceFiltered)
	if len(sourceFiltered) != 1 || sourceFiltered[0].ID != desktopLog.ID {
		t.Fatalf("expected source filter to return desktop log, got %+v", sourceFiltered)
	}

	var taskFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?task_id=wg-task-7", nil, http.StatusOK, &taskFiltered)
	if len(taskFiltered) != 1 || taskFiltered[0].ID != desktopLog.ID {
		t.Fatalf("expected task filter to return desktop log, got %+v", taskFiltered)
	}

	var runFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?dispatch_run_id=dispatch-run-7", nil, http.StatusOK, &runFiltered)
	if len(runFiltered) != 1 || runFiltered[0].ID != desktopLog.ID {
		t.Fatalf("expected dispatch run filter to return desktop log, got %+v", runFiltered)
	}

	var signalFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?signal_code=android_manual_reconnect_likely", nil, http.StatusOK, &signalFiltered)
	if len(signalFiltered) != 1 || signalFiltered[0].ID != alphaLog.ID {
		t.Fatalf("expected signal filter to return alpha log, got %+v", signalFiltered)
	}

	var agentStateFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?agent_state=connected", nil, http.StatusOK, &agentStateFiltered)
	if len(agentStateFiltered) != 1 || agentStateFiltered[0].ID != desktopLog.ID {
		t.Fatalf("expected agent state filter to return desktop log, got %+v", agentStateFiltered)
	}

	var controllerStateFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?controller_state=connected", nil, http.StatusOK, &controllerStateFiltered)
	if len(controllerStateFiltered) != 1 || controllerStateFiltered[0].ID != desktopLog.ID {
		t.Fatalf("expected controller state filter to return desktop log, got %+v", controllerStateFiltered)
	}

	var hostFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?host=test-host", nil, http.StatusOK, &hostFiltered)
	if len(hostFiltered) != 1 || hostFiltered[0].ID != desktopLog.ID {
		t.Fatalf("expected host filter to return desktop log, got %+v", hostFiltered)
	}

	var platformFiltered []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?platform=linux", nil, http.StatusOK, &platformFiltered)
	if len(platformFiltered) != 1 || platformFiltered[0].ID != desktopLog.ID {
		t.Fatalf("expected platform filter to return desktop log, got %+v", platformFiltered)
	}

	var desktopAnalysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+desktopLog.ID+"/analysis", nil, http.StatusOK, &desktopAnalysis)
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_relay_recovery_loops") {
		t.Fatalf("expected desktop relay recovery signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_dispatch_breaks") {
		t.Fatalf("expected desktop dispatch break signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_task_failures") {
		t.Fatalf("expected desktop scheduled task failure signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_task_retry_loops") {
		t.Fatalf("expected desktop scheduled task retry loop signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_workgroup_task_failures") {
		t.Fatalf("expected desktop scheduled workgroup task failure signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_workgroup_task_config_gaps") {
		t.Fatalf("expected desktop scheduled workgroup task config gap signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_workgroup_task_dispatch_blocked") {
		t.Fatalf("expected desktop scheduled workgroup task blocked signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_workgroup_task_member_unavailable") {
		t.Fatalf("expected desktop scheduled workgroup task member unavailable signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_workgroup_task_dispatch_failures") {
		t.Fatalf("expected desktop scheduled workgroup task dispatch failure signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_workgroup_task_repeat_failures") {
		t.Fatalf("expected desktop scheduled workgroup task repeat failure signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_workgroup_task_reentry") {
		t.Fatalf("expected desktop scheduled workgroup task reentry signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_scheduled_workgroup_task_stalled_after_dispatch") {
		t.Fatalf("expected desktop scheduled workgroup task stalled-after-dispatch signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_restart_recovery_residue") {
		t.Fatalf("expected desktop restart recovery residue signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_recovery_jitter") {
		t.Fatalf("expected desktop recovery jitter signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_auth_recovery_failures") {
		t.Fatalf("expected desktop auth recovery failure signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected desktop remote snapshot gap signal, got %+v", desktopAnalysis.Signals)
	}
	if !hasSignalCode(desktopAnalysis.Signals, "desktop_resume_catchup_stalled") {
		t.Fatalf("expected desktop resume catch-up stalled signal, got %+v", desktopAnalysis.Signals)
	}
	if len(desktopAnalysis.RecoveryPanels) != 3 {
		t.Fatalf("expected desktop analysis to expose 3 controller recovery panels, got %+v", desktopAnalysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(desktopAnalysis.RecoveryPanels, "desktop_auth_recovery", "critical", "desktop_auth_recovery_failures") {
		t.Fatalf("expected auth recovery panel to be critical, got %+v", desktopAnalysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(desktopAnalysis.RecoveryPanels, "desktop_catalog_refresh", "healthy", "") {
		t.Fatalf("expected catalog recovery panel to be healthy, got %+v", desktopAnalysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(desktopAnalysis.RecoveryPanels, "desktop_active_snapshot", "warning", "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected active snapshot panel to warn, got %+v", desktopAnalysis.RecoveryPanels)
	}
	if len(desktopAnalysis.TaskIDs) == 0 || len(desktopAnalysis.DispatchRunIDs) == 0 {
		t.Fatalf("expected desktop analysis to expose task and dispatch run ids, got %+v", desktopAnalysis)
	}

	var desktopOverview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=desktop", nil, http.StatusOK, &desktopOverview)
	if desktopOverview.LogCount != 1 {
		t.Fatalf("expected desktop overview to narrow to one log, got %+v", desktopOverview)
	}
	if desktopOverview.ConnectionSummary.LogsWithConnectionNotes != 1 || desktopOverview.ConnectionSummary.StructuredLogs != 1 || desktopOverview.ConnectionSummary.FreeformLogs != 0 {
		t.Fatalf("expected desktop overview to expose structured connection snapshot, got %+v", desktopOverview.ConnectionSummary)
	}
	if !hasOverviewConnectionItem(desktopOverview.ConnectionSummary.ControllerStates, "connected", 1) {
		t.Fatalf("expected desktop overview to expose controller state, got %+v", desktopOverview.ConnectionSummary.ControllerStates)
	}
	if !hasConnectionHotspot(desktopOverview.ConnectionSummary.Hotspots, "connected", "connected", "test-host", "linux", 1, 1, 1, 1, "desktop_resume_catchup_stalled", "trace-desktop-003", "desktop-workgroup", "task-1", "dispatch-run-7") {
		t.Fatalf("expected desktop overview to expose hotspot correlation, got %+v", desktopOverview.ConnectionSummary.Hotspots)
	}
	if !hasConnectionHotspotRecoveryStage(desktopOverview.ConnectionSummary.Hotspots, "test-host", "desktop_auth_recovery", "critical", "desktop_auth_recovery_failures") {
		t.Fatalf("expected desktop overview hotspot to expose top recovery stage, got %+v", desktopOverview.ConnectionSummary.Hotspots)
	}
	if len(desktopOverview.TopSignals) == 0 || desktopOverview.TopSignals[0].Code != "desktop_resume_catchup_stalled" {
		t.Fatalf("expected desktop overview to prioritize resume catch-up stalled signal, got %+v", desktopOverview.TopSignals)
	}
	if len(desktopOverview.RecoveryPanels) != 3 {
		t.Fatalf("expected desktop overview to keep 3 desktop recovery panels, got %+v", desktopOverview.RecoveryPanels)
	}
	if !hasOverviewRecoveryPanel(desktopOverview.RecoveryPanels, "desktop_catalog_refresh", "healthy", 1, 0, "") {
		t.Fatalf("expected desktop overview to expose healthy catalog panel, got %+v", desktopOverview.RecoveryPanels)
	}
	if !hasOverviewRecoveryPanelContext(desktopOverview.RecoveryPanels, "desktop_active_snapshot", "trace-desktop-003", "desktop-workgroup", "connected", "connected", "test-host", "linux") {
		t.Fatalf("expected desktop overview active snapshot panel to expose top context, got %+v", desktopOverview.RecoveryPanels)
	}
	if !hasOverviewRecoveryPanel(desktopOverview.RecoveryPanels, "desktop_active_snapshot", "warning", 1, 0, "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected desktop overview to expose warning active snapshot panel, got %+v", desktopOverview.RecoveryPanels)
	}
	if !hasOverviewBucketValue(desktopOverview.TopTaskIDs, "wg-task-1") {
		t.Fatalf("expected desktop overview to expose top task ids, got %+v", desktopOverview.TopTaskIDs)
	}

	var androidOverview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=android", nil, http.StatusOK, &androidOverview)
	if androidOverview.LogCount != 2 {
		t.Fatalf("expected android overview to narrow to two logs, got %+v", androidOverview)
	}
	if androidOverview.ConnectionSummary.LogsWithConnectionNotes != 1 || androidOverview.ConnectionSummary.StructuredLogs != 0 || androidOverview.ConnectionSummary.FreeformLogs != 1 {
		t.Fatalf("expected android overview to expose freeform connection note, got %+v", androidOverview.ConnectionSummary)
	}
	if len(androidOverview.ConnectionSummary.Hotspots) != 0 {
		t.Fatalf("expected android overview to skip structured connection hotspots, got %+v", androidOverview.ConnectionSummary.Hotspots)
	}
	if !hasOverviewRecoveryPanel(androidOverview.RecoveryPanels, "android_project_sync", "warning", 1, 0, "post_auth_sync_incomplete") {
		t.Fatalf("expected android overview to expose warning project sync panel, got %+v", androidOverview.RecoveryPanels)
	}
	if !hasOverviewRecoveryPanel(androidOverview.RecoveryPanels, "android_workgroup_refresh", "warning", 1, 0, "foreground_recovery_follow_up_gaps") {
		t.Fatalf("expected android overview to expose warning workgroup panel, got %+v", androidOverview.RecoveryPanels)
	}
}

func TestMobileLogOverviewPrioritizesRecoverySignalsOverSchedulerNoise(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260405",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if _, err := database.CreateUser("bob", "Bob12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	bob, err := database.GetUserByUsername("bob")
	if err != nil {
		t.Fatalf("get bob: %v", err)
	}
	if err := database.RegisterAgent("agent-b", bob.ID, "Bob desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-b", bob.ID, "agent-b", "Bob phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "bob",
		"password":    "Bob12345A",
		"client_type": "device",
		"client_id":   "device-b",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name": "desktop-priority.log",
		"content": "[2026-04-05T10:00:00.000Z] WARN [scheduler] Recovered scheduled task with stale in-flight state. taskId=task-a projectId=p-a runId=run-a previousStatus=running reason=startup recoveryState=restart-residue trace_id=trace-priority-001 workgroup_id=priority-workgroup\n" +
			"[2026-04-05T10:00:01.000Z] WARN [scheduler] Scheduled task failed. taskId=task-a projectId=p-a trigger=scheduled error=relay timeout retryCount=1 maxRetries=3 retryRunAt=2026-04-05T10:05:01.000Z trace_id=trace-priority-001 workgroup_id=priority-workgroup\n" +
			"[2026-04-05T10:00:02.000Z] WARN [scheduler] Scheduled task failed. taskId=task-a projectId=p-a trigger=scheduled error=relay timeout retryCount=2 maxRetries=3 retryRunAt=2026-04-05T10:10:02.000Z trace_id=trace-priority-001 workgroup_id=priority-workgroup\n" +
			"[2026-04-05T10:00:03.000Z] WARN [scheduler] Scheduled workgroup task failed. taskId=wg-a workgroupId=priority-workgroup assigneeMemberId=member-a trigger=scheduled error=no eligible member trace_id=trace-priority-001 workgroup_id=priority-workgroup\n" +
			"[2026-04-05T10:00:04.000Z] WARN [scheduler] Scheduled workgroup task failed. taskId=wg-a workgroupId=priority-workgroup assigneeMemberId=member-a trigger=scheduled error=no eligible member trace_id=trace-priority-001 workgroup_id=priority-workgroup\n",
		"app_version":     "1.1.116",
		"device_model":    "Desktop Test Host",
		"source":          "desktop",
		"connection_note": "host=priority-host; platform=linux; agent=connected; controller=connected",
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

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=desktop", nil, http.StatusOK, &logs)
	if len(logs) != 1 {
		t.Fatalf("expected 1 uploaded desktop log, got %d", len(logs))
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+logs[0].ID+"/analysis", nil, http.StatusOK, &analysis)
	if !hasSignalCode(analysis.Signals, "desktop_restart_recovery_residue") {
		t.Fatalf("expected recovery residue signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "desktop_scheduled_task_failures") {
		t.Fatalf("expected scheduler failure signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "desktop_scheduled_workgroup_task_failures") {
		t.Fatalf("expected scheduler workgroup failure signal, got %+v", analysis.Signals)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=desktop", nil, http.StatusOK, &overview)
	if len(overview.TopSignals) == 0 || overview.TopSignals[0].Code != "desktop_restart_recovery_residue" {
		t.Fatalf("expected recovery residue to outrank scheduler noise, got %+v", overview.TopSignals)
	}
	if !hasConnectionHotspot(overview.ConnectionSummary.Hotspots, "connected", "connected", "priority-host", "linux", 1, 1, 0, 0, "desktop_restart_recovery_residue", "trace-priority-001", "priority-workgroup", "task-a", "run-a") {
		t.Fatalf("expected hotspot top signal to prefer recovery residue, got %+v", overview.ConnectionSummary.Hotspots)
	}
}

func TestMobileLogAnalysisFlagsMissingDesktopActiveSyncAfterFollowUpCompletion(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260406",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if _, err := database.CreateUser("carl", "Carl12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	carl, err := database.GetUserByUsername("carl")
	if err != nil {
		t.Fatalf("get carl: %v", err)
	}
	if err := database.RegisterAgent("agent-c", carl.ID, "Carl desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-c", carl.ID, "agent-c", "Carl phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "carl",
		"password":    "Carl12345A",
		"client_type": "device",
		"client_id":   "device-c",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name": "desktop-followup-gap.log",
		"content": "[2026-04-06T02:00:00.000Z] INFO [relay] Scheduled relay follow-up refreshes. reason=controller-authenticated delaysMs=0,1500,5000 trace_id=trace-desktop-004 workgroup_id=desktop-workgroup-gap\n" +
			"[2026-04-06T02:00:01.000Z] INFO [relay] Running relay follow-up refresh. reason=controller-authenticated:0 trace_id=trace-desktop-004 workgroup_id=desktop-workgroup-gap\n" +
			"[2026-04-06T02:00:01.100Z] INFO [relay] Requested remote project catalog refresh. reason=follow-up:controller-authenticated:0 trace_id=trace-desktop-004 workgroup_id=desktop-workgroup-gap\n" +
			"[2026-04-06T02:00:01.300Z] INFO [relay] Remote project catalog updated. projectCount=3 trace_id=trace-desktop-004 workgroup_id=desktop-workgroup-gap\n" +
			"[2026-04-06T02:00:01.500Z] INFO [workgroup] Completed remote workgroup catalog refresh. reason=follow-up:controller-authenticated:0 force=true recordCount=2 requestedSummaries=true trace_id=trace-desktop-004 workgroup_id=desktop-workgroup-gap\n" +
			"[2026-04-06T02:00:01.700Z] INFO [workgroup] Remote workgroup catalog updated. summaryCount=2 trace_id=trace-desktop-004 workgroup_id=desktop-workgroup-gap\n" +
			"[2026-04-06T02:00:02.000Z] INFO [relay] Completed relay follow-up refresh. reason=controller-authenticated:0 requestedActiveProjectSync=true trace_id=trace-desktop-004 workgroup_id=desktop-workgroup-gap\n",
		"app_version":     "1.1.117",
		"device_model":    "Desktop Follow-Up Gap Host",
		"source":          "desktop",
		"connection_note": "host=snapshot-gap-host; platform=linux; agent=connected; controller=connected",
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

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=desktop", nil, http.StatusOK, &logs)
	if len(logs) != 1 {
		t.Fatalf("expected 1 uploaded desktop log, got %d", len(logs))
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+logs[0].ID+"/analysis", nil, http.StatusOK, &analysis)
	if !hasSignalCode(analysis.Signals, "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected desktop remote snapshot gap signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "desktop_resume_catchup_stalled") {
		t.Fatalf("expected desktop resume catch-up stalled signal, got %+v", analysis.Signals)
	}
	if len(analysis.RecoveryPanels) != 3 {
		t.Fatalf("expected desktop analysis to expose 3 controller recovery panels, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "desktop_catalog_refresh", "healthy", "") {
		t.Fatalf("expected catalog refresh panel to stay healthy, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "desktop_active_snapshot", "warning", "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected active snapshot panel to warn about missing active sync completion, got %+v", analysis.RecoveryPanels)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=desktop", nil, http.StatusOK, &overview)
	if len(overview.TopSignals) == 0 || overview.TopSignals[0].Code != "desktop_resume_catchup_stalled" {
		t.Fatalf("expected overview to prioritize stalled desktop catch-up, got %+v", overview.TopSignals)
	}
	if !hasConnectionHotspot(overview.ConnectionSummary.Hotspots, "connected", "connected", "snapshot-gap-host", "linux", 1, 1, 0, 1, "desktop_resume_catchup_stalled", "trace-desktop-004", "desktop-workgroup-gap", "", "") {
		t.Fatalf("expected hotspot to surface missing active sync follow-up, got %+v", overview.ConnectionSummary.Hotspots)
	}
	if !hasConnectionHotspotRecoveryStage(overview.ConnectionSummary.Hotspots, "snapshot-gap-host", "desktop_active_snapshot", "warning", "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected snapshot-gap hotspot to expose top recovery stage, got %+v", overview.ConnectionSummary.Hotspots)
	}
}

func TestMobileLogAnalysisFlagsMissingDesktopActiveWorkgroupSyncAfterFollowUpCompletion(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260406",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if _, err := database.CreateUser("dora", "Dora12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	dora, err := database.GetUserByUsername("dora")
	if err != nil {
		t.Fatalf("get dora: %v", err)
	}
	if err := database.RegisterAgent("agent-d", dora.ID, "Dora desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-d", dora.ID, "agent-d", "Dora phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "dora",
		"password":    "Dora12345A",
		"client_type": "device",
		"client_id":   "device-d",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name": "desktop-followup-workgroup-gap.log",
		"content": "[2026-04-06T03:00:00.000Z] INFO [relay] Scheduled relay follow-up refreshes. reason=controller-authenticated delaysMs=0,1500,5000 trace_id=trace-desktop-005 workgroup_id=desktop-workgroup-active-gap\n" +
			"[2026-04-06T03:00:01.000Z] INFO [relay] Running relay follow-up refresh. reason=controller-authenticated:0 trace_id=trace-desktop-005 workgroup_id=desktop-workgroup-active-gap\n" +
			"[2026-04-06T03:00:01.100Z] INFO [relay] Requested remote project catalog refresh. reason=follow-up:controller-authenticated:0 trace_id=trace-desktop-005 workgroup_id=desktop-workgroup-active-gap\n" +
			"[2026-04-06T03:00:01.300Z] INFO [relay] Remote project catalog updated. projectCount=3 trace_id=trace-desktop-005 workgroup_id=desktop-workgroup-active-gap\n" +
			"[2026-04-06T03:00:01.500Z] INFO [workgroup] Completed remote workgroup catalog refresh. reason=follow-up:controller-authenticated:0 force=true recordCount=2 requestedSummaries=true trace_id=trace-desktop-005 workgroup_id=desktop-workgroup-active-gap\n" +
			"[2026-04-06T03:00:01.700Z] INFO [workgroup] Remote workgroup catalog updated. summaryCount=2 trace_id=trace-desktop-005 workgroup_id=desktop-workgroup-active-gap\n" +
			"[2026-04-06T03:00:01.900Z] INFO [workgroup] Requested remote workgroup session sync. reason=follow-up:controller-authenticated:0 force=true workgroupId=remote:wg-active-gap isActiveWorkgroup=true trace_id=trace-desktop-005 workgroup_id=desktop-workgroup-active-gap\n" +
			"[2026-04-06T03:00:02.000Z] INFO [relay] Completed relay follow-up refresh. reason=controller-authenticated:0 requestedActiveProjectSync=false requestedActiveWorkgroupSync=true trace_id=trace-desktop-005 workgroup_id=desktop-workgroup-active-gap\n",
		"app_version":     "1.1.117",
		"device_model":    "Desktop Follow-Up Workgroup Gap Host",
		"source":          "desktop",
		"connection_note": "host=snapshot-gap-workgroup-host; platform=linux; agent=connected; controller=connected",
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

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=desktop", nil, http.StatusOK, &logs)
	if len(logs) != 1 {
		t.Fatalf("expected 1 uploaded desktop log, got %d", len(logs))
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+logs[0].ID+"/analysis", nil, http.StatusOK, &analysis)
	if !hasSignalCode(analysis.Signals, "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected desktop remote snapshot gap signal for workgroup path, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "desktop_resume_catchup_stalled") {
		t.Fatalf("expected desktop resume catch-up stalled signal for workgroup path, got %+v", analysis.Signals)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "desktop_active_snapshot", "warning", "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected active snapshot panel to warn about missing active workgroup sync completion, got %+v", analysis.RecoveryPanels)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=desktop", nil, http.StatusOK, &overview)
	if len(overview.TopSignals) == 0 || overview.TopSignals[0].Code != "desktop_resume_catchup_stalled" {
		t.Fatalf("expected overview to prioritize stalled desktop workgroup catch-up, got %+v", overview.TopSignals)
	}
	if !hasConnectionHotspot(overview.ConnectionSummary.Hotspots, "connected", "connected", "snapshot-gap-workgroup-host", "linux", 1, 1, 0, 1, "desktop_resume_catchup_stalled", "trace-desktop-005", "desktop-workgroup-active-gap", "", "") {
		t.Fatalf("expected hotspot to surface missing active workgroup sync follow-up, got %+v", overview.ConnectionSummary.Hotspots)
	}
	if !hasConnectionHotspotRecoveryStage(overview.ConnectionSummary.Hotspots, "snapshot-gap-workgroup-host", "desktop_active_snapshot", "warning", "desktop_remote_snapshot_gaps") {
		t.Fatalf("expected workgroup snapshot-gap hotspot to expose top recovery stage, got %+v", overview.ConnectionSummary.Hotspots)
	}
}

func TestMobileLogAnalysisFlagsMissingAndroidPostAuthRecoveryStart(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260406-android",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if _, err := database.CreateUser("dora", "Dora12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	dora, err := database.GetUserByUsername("dora")
	if err != nil {
		t.Fatalf("get dora: %v", err)
	}
	if err := database.RegisterAgent("agent-d", dora.ID, "Dora desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-d", dora.ID, "agent-d", "Dora phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "dora",
		"password":    "Dora12345A",
		"client_type": "device",
		"client_id":   "device-d",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name": "android-missing-post-auth.log",
		"content": "[2026-04-06 08:00:00.000] INFO [MainActivity] Scheduling foreground recovery passes reason=activity-resume forceReconnectInitial=true passCount=3 trace_id=trace-android-005 workgroup_id=android-gap-workgroup\n" +
			"[2026-04-06 08:00:00.500] INFO [MainActivity] Running foreground recovery pass reason=activity-resume:0 forceReconnect=true trace_id=trace-android-005 workgroup_id=android-gap-workgroup\n" +
			"[2026-04-06 08:00:01.000] INFO [RelayConnectionService] Starting auth error recovery reason=auth-error trace_id=trace-android-005 workgroup_id=android-gap-workgroup\n" +
			"[2026-04-06 08:00:01.300] ERROR [RelayConnectionService] Failed to reconnect relay after token refresh trace_id=trace-android-005 workgroup_id=android-gap-workgroup\n" +
			"[2026-04-06 08:00:01.600] ERROR [MainActivity] Failed to verify relay connection on resume trace_id=trace-android-005 workgroup_id=android-gap-workgroup\n" +
			"[2026-04-06 08:00:01.900] INFO [MainActivity] Foreground session catalog refreshed reason=activity-resume:0 sessionCount=4 trace_id=trace-android-005 workgroup_id=android-gap-workgroup\n" +
			"[2026-04-06 08:00:02.100] INFO [MainActivity] Skipping foreground project sync because relay is not connected: activity-resume:0 trace_id=trace-android-005 workgroup_id=android-gap-workgroup\n",
		"app_version":  "1.2.11",
		"app_build":    95,
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

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=android", nil, http.StatusOK, &logs)
	if len(logs) != 1 {
		t.Fatalf("expected 1 uploaded android log, got %d", len(logs))
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+logs[0].ID+"/analysis", nil, http.StatusOK, &analysis)
	if !hasSignalCode(analysis.Signals, "post_auth_sync_incomplete") {
		t.Fatalf("expected post-auth incomplete signal, got %+v", analysis.Signals)
	}
	if !hasSignalCode(analysis.Signals, "android_manual_reconnect_likely") {
		t.Fatalf("expected android manual reconnect likely signal, got %+v", analysis.Signals)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_auth_recovery", "critical", "auth_recovery_failures") {
		t.Fatalf("expected android auth recovery to be critical, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_project_sync", "warning", "post_auth_sync_incomplete") {
		t.Fatalf("expected android project sync panel to warn, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_workgroup_refresh", "warning", "foreground_recovery_follow_up_gaps") {
		t.Fatalf("expected android workgroup refresh panel to warn, got %+v", analysis.RecoveryPanels)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=android", nil, http.StatusOK, &overview)
	if len(overview.TopSignals) == 0 || overview.TopSignals[0].Code != "android_manual_reconnect_likely" {
		t.Fatalf("expected android overview to prioritize manual reconnect likely, got %+v", overview.TopSignals)
	}
	if !hasOverviewRecoveryPanel(overview.RecoveryPanels, "android_project_sync", "warning", 1, 0, "post_auth_sync_incomplete") {
		t.Fatalf("expected android overview project sync aggregation to warn, got %+v", overview.RecoveryPanels)
	}
}

func TestMobileLogAnalysisFlagsForegroundProjectSyncDispatchFailures(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260406-android-project-sync",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if _, err := database.CreateUser("erin", "Erin12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	erin, err := database.GetUserByUsername("erin")
	if err != nil {
		t.Fatalf("get erin: %v", err)
	}
	if err := database.RegisterAgent("agent-e", erin.ID, "Erin desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-e", erin.ID, "agent-e", "Erin phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "erin",
		"password":    "Erin12345A",
		"client_type": "device",
		"client_id":   "device-e",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name": "android-foreground-project-sync-failure.log",
		"content": "[2026-04-06 09:00:00.000] INFO [MainActivity] Scheduling foreground recovery passes reason=activity-resume forceReconnectInitial=false passCount=3 trace_id=trace-android-006 workgroup_id=android-project-sync-gap\n" +
			"[2026-04-06 09:00:00.500] INFO [MainActivity] Running foreground recovery pass reason=activity-resume:0 forceReconnect=false trace_id=trace-android-006 workgroup_id=android-project-sync-gap\n" +
			"[2026-04-06 09:00:01.000] INFO [MainActivity] Starting foreground sync reason=activity-resume:0 trace_id=trace-android-006 workgroup_id=android-project-sync-gap\n" +
			"[2026-04-06 09:00:01.300] INFO [MainActivity] Foreground session catalog refreshed reason=activity-resume:0 sessionCount=5 trace_id=trace-android-006 workgroup_id=android-project-sync-gap\n" +
			"[2026-04-06 09:00:01.700] ERROR [MainActivity] Failed to request project syncs on foreground: activity-resume:0 trace_id=trace-android-006 workgroup_id=android-project-sync-gap\n" +
			"[2026-04-06 09:00:02.100] INFO [MainActivity] Foreground workgroup refresh completed reason=activity-resume:0 trackedAgentCount=2 trace_id=trace-android-006 workgroup_id=android-project-sync-gap\n",
		"app_version":  "1.2.11",
		"app_build":    95,
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

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=android", nil, http.StatusOK, &logs)
	if len(logs) != 1 {
		t.Fatalf("expected 1 uploaded android log, got %d", len(logs))
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+logs[0].ID+"/analysis", nil, http.StatusOK, &analysis)
	if !hasSignalCode(analysis.Signals, "foreground_project_sync_failures") {
		t.Fatalf("expected foreground project sync failure signal, got %+v", analysis.Signals)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_project_sync", "warning", "foreground_project_sync_failures") {
		t.Fatalf("expected android project sync panel to warn with foreground project sync failure, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_foreground_catalog", "healthy", "") {
		t.Fatalf("expected android foreground catalog panel to remain healthy, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_workgroup_refresh", "healthy", "") {
		t.Fatalf("expected android workgroup refresh panel to remain healthy, got %+v", analysis.RecoveryPanels)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=android", nil, http.StatusOK, &overview)
	if !hasOverviewSignalCode(overview.TopSignals, "foreground_project_sync_failures") {
		t.Fatalf("expected overview to include foreground project sync failure signal, got %+v", overview.TopSignals)
	}
	if !hasOverviewRecoveryPanel(overview.RecoveryPanels, "android_project_sync", "warning", 1, 0, "foreground_project_sync_failures") {
		t.Fatalf("expected android overview project sync aggregation to warn on foreground project sync failure, got %+v", overview.RecoveryPanels)
	}
}

func TestMobileLogAnalysisFlagsForegroundWorkgroupRefreshFailures(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260406-android-workgroup-refresh",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if _, err := database.CreateUser("fiona", "Fiona12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	fiona, err := database.GetUserByUsername("fiona")
	if err != nil {
		t.Fatalf("get fiona: %v", err)
	}
	if err := database.RegisterAgent("agent-f", fiona.ID, "Fiona desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-f", fiona.ID, "agent-f", "Fiona phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "fiona",
		"password":    "Fiona12345A",
		"client_type": "device",
		"client_id":   "device-f",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name": "android-foreground-workgroup-refresh-failure.log",
		"content": "[2026-04-06 09:30:00.000] INFO [MainActivity] Scheduling foreground recovery passes reason=activity-resume forceReconnectInitial=false passCount=3 trace_id=trace-android-007 workgroup_id=android-workgroup-gap\n" +
			"[2026-04-06 09:30:00.500] INFO [MainActivity] Running foreground recovery pass reason=activity-resume:0 forceReconnect=false trace_id=trace-android-007 workgroup_id=android-workgroup-gap\n" +
			"[2026-04-06 09:30:01.000] INFO [MainActivity] Starting foreground sync reason=activity-resume:0 trace_id=trace-android-007 workgroup_id=android-workgroup-gap\n" +
			"[2026-04-06 09:30:01.300] INFO [MainActivity] Foreground session catalog refreshed reason=activity-resume:0 sessionCount=5 trace_id=trace-android-007 workgroup_id=android-workgroup-gap\n" +
			"[2026-04-06 09:30:01.600] INFO [MainActivity] Foreground project sync requested reason=activity-resume:0 sessionCount=5 trace_id=trace-android-007 workgroup_id=android-workgroup-gap\n" +
			"[2026-04-06 09:30:02.000] ERROR [MainActivity] Failed to refresh workgroups on foreground: activity-resume:0 trace_id=trace-android-007 workgroup_id=android-workgroup-gap\n",
		"app_version":  "1.2.11",
		"app_build":    95,
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

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=android", nil, http.StatusOK, &logs)
	if len(logs) != 1 {
		t.Fatalf("expected 1 uploaded android log, got %d", len(logs))
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+logs[0].ID+"/analysis", nil, http.StatusOK, &analysis)
	if !hasSignalCode(analysis.Signals, "foreground_workgroup_refresh_failures") {
		t.Fatalf("expected foreground workgroup refresh failure signal, got %+v", analysis.Signals)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_foreground_catalog", "healthy", "") {
		t.Fatalf("expected android foreground catalog panel to remain healthy, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_project_sync", "healthy", "") {
		t.Fatalf("expected android project sync panel to remain healthy, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_workgroup_refresh", "warning", "foreground_workgroup_refresh_failures") {
		t.Fatalf("expected android workgroup refresh panel to warn with foreground workgroup refresh failure, got %+v", analysis.RecoveryPanels)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=android", nil, http.StatusOK, &overview)
	if !hasOverviewSignalCode(overview.TopSignals, "foreground_workgroup_refresh_failures") {
		t.Fatalf("expected overview to include foreground workgroup refresh failure signal, got %+v", overview.TopSignals)
	}
	if !hasOverviewRecoveryPanel(overview.RecoveryPanels, "android_workgroup_refresh", "warning", 1, 0, "foreground_workgroup_refresh_failures") {
		t.Fatalf("expected android overview workgroup refresh aggregation to warn on foreground workgroup refresh failure, got %+v", overview.RecoveryPanels)
	}
}

func TestMobileLogAnalysisFlagsPostAuthProjectSyncFailures(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260406-post-auth-project",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if _, err := database.CreateUser("gina", "Gina12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	gina, err := database.GetUserByUsername("gina")
	if err != nil {
		t.Fatalf("get gina: %v", err)
	}
	if err := database.RegisterAgent("agent-g", gina.ID, "Gina desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-g", gina.ID, "agent-g", "Gina phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "gina",
		"password":    "Gina12345A",
		"client_type": "device",
		"client_id":   "device-g",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name": "android-post-auth-project-sync-failure.log",
		"content": "[2026-04-06 10:00:00.000] INFO [RelayConnectionService] Starting post-auth session sync trace_id=trace-android-008 workgroup_id=android-post-auth-project-gap\n" +
			"[2026-04-06 10:00:00.400] INFO [RelayConnectionService] Post-auth session catalog refreshed sessionCount=4 trace_id=trace-android-008 workgroup_id=android-post-auth-project-gap\n" +
			"[2026-04-06 10:00:00.900] ERROR [RelayConnectionService] Failed to sync sessions after relay authentication trace_id=trace-android-008 workgroup_id=android-post-auth-project-gap\n",
		"app_version":  "1.2.11",
		"app_build":    95,
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

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=android", nil, http.StatusOK, &logs)
	if len(logs) != 1 {
		t.Fatalf("expected 1 uploaded android log, got %d", len(logs))
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+logs[0].ID+"/analysis", nil, http.StatusOK, &analysis)
	if !hasSignalCode(analysis.Signals, "post_auth_project_sync_failures") {
		t.Fatalf("expected post-auth project sync failure signal, got %+v", analysis.Signals)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_auth_recovery", "healthy", "") {
		t.Fatalf("expected android auth recovery panel to remain healthy, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_project_sync", "warning", "post_auth_project_sync_failures") {
		t.Fatalf("expected android project sync panel to warn with post-auth project sync failure, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_workgroup_refresh", "warning", "foreground_recovery_follow_up_gaps") {
		t.Fatalf("expected android workgroup refresh panel to reflect missing post-auth workgroup completion, got %+v", analysis.RecoveryPanels)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=android", nil, http.StatusOK, &overview)
	if !hasOverviewSignalCode(overview.TopSignals, "post_auth_project_sync_failures") {
		t.Fatalf("expected overview to include post-auth project sync failure signal, got %+v", overview.TopSignals)
	}
	if !hasOverviewRecoveryPanel(overview.RecoveryPanels, "android_project_sync", "warning", 1, 0, "post_auth_project_sync_failures") {
		t.Fatalf("expected android overview project sync aggregation to warn on post-auth project sync failure, got %+v", overview.RecoveryPanels)
	}
}

func TestMobileLogAnalysisFlagsPostAuthWorkgroupRefreshFailures(t *testing.T) {
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
		JWTSecret:    "relay-test-secret-20260406-post-auth-workgroup",
		PingInterval: 30,
		QueueSize:    100,
		CORSOrigins:  "*",
		DataDir:      dataDir,
		DatabasePath: dataDir,
	}
	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if _, err := database.CreateUser("helen", "Helen12345A", false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	helen, err := database.GetUserByUsername("helen")
	if err != nil {
		t.Fatalf("get helen: %v", err)
	}
	if err := database.RegisterAgent("agent-h", helen.ID, "Helen desktop"); err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := database.RegisterDevice("device-h", helen.ID, "agent-h", "Helen phone"); err != nil {
		t.Fatalf("register device: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/device/logs", handler.DeviceLogUploadHandler(cfg, database))
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/mobile-logs", handler.AdminMobileLogsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/mobile-logs/", handler.AdminMobileLogsHandler(cfg, database, h))

	server := httptest.NewServer(mux)
	defer server.Close()

	var deviceLogin deviceLoginResponse
	doJSON(t, http.DefaultClient, http.MethodPost, server.URL+"/api/auth/login", map[string]any{
		"username":    "helen",
		"password":    "Helen12345A",
		"client_type": "device",
		"client_id":   "device-h",
	}, http.StatusOK, &deviceLogin)
	if deviceLogin.Token == "" {
		t.Fatal("expected device token")
	}

	doJSONWithBearer(t, http.DefaultClient, http.MethodPost, server.URL+"/api/device/logs", deviceLogin.Token, map[string]any{
		"file_name": "android-post-auth-workgroup-refresh-failure.log",
		"content": "[2026-04-06 10:30:00.000] INFO [RelayConnectionService] Starting post-auth session sync trace_id=trace-android-009 workgroup_id=android-post-auth-workgroup-gap\n" +
			"[2026-04-06 10:30:00.400] INFO [RelayConnectionService] Post-auth session catalog refreshed sessionCount=4 trace_id=trace-android-009 workgroup_id=android-post-auth-workgroup-gap\n" +
			"[2026-04-06 10:30:00.700] INFO [RelayConnectionService] Requested project syncs after relay authentication sessionCount=4 trace_id=trace-android-009 workgroup_id=android-post-auth-workgroup-gap\n" +
			"[2026-04-06 10:30:01.200] ERROR [RelayConnectionService] Failed to sync sessions after relay authentication trace_id=trace-android-009 workgroup_id=android-post-auth-workgroup-gap\n",
		"app_version":  "1.2.11",
		"app_build":    95,
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

	var logs []uploadedMobileLog
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs?source=android", nil, http.StatusOK, &logs)
	if len(logs) != 1 {
		t.Fatalf("expected 1 uploaded android log, got %d", len(logs))
	}

	var analysis uploadedMobileLogAnalysis
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/"+logs[0].ID+"/analysis", nil, http.StatusOK, &analysis)
	if !hasSignalCode(analysis.Signals, "post_auth_workgroup_refresh_failures") {
		t.Fatalf("expected post-auth workgroup refresh failure signal, got %+v", analysis.Signals)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_project_sync", "healthy", "") {
		t.Fatalf("expected android project sync panel to remain healthy, got %+v", analysis.RecoveryPanels)
	}
	if !hasRecoveryPanelStatus(analysis.RecoveryPanels, "android_workgroup_refresh", "warning", "post_auth_workgroup_refresh_failures") {
		t.Fatalf("expected android workgroup refresh panel to warn with post-auth workgroup refresh failure, got %+v", analysis.RecoveryPanels)
	}

	var overview uploadedMobileLogOverview
	doJSON(t, adminClient, http.MethodGet, server.URL+"/admin/api/mobile-logs/overview?source=android", nil, http.StatusOK, &overview)
	if !hasOverviewSignalCode(overview.TopSignals, "post_auth_workgroup_refresh_failures") {
		t.Fatalf("expected overview to include post-auth workgroup refresh failure signal, got %+v", overview.TopSignals)
	}
	if !hasOverviewRecoveryPanel(overview.RecoveryPanels, "android_workgroup_refresh", "warning", 1, 0, "post_auth_workgroup_refresh_failures") {
		t.Fatalf("expected android overview workgroup refresh aggregation to warn on post-auth workgroup refresh failure, got %+v", overview.RecoveryPanels)
	}
}

func hasSignalCode(signals []struct {
	Code  string `json:"code"`
	Count int    `json:"count"`
}, code string) bool {
	for _, signal := range signals {
		if signal.Code == code {
			return true
		}
	}
	return false
}

func hasOverviewSignalCode(signals []struct {
	Code       string `json:"code"`
	LogCount   int    `json:"log_count"`
	TotalCount int    `json:"total_count"`
}, code string) bool {
	for _, signal := range signals {
		if signal.Code == code {
			return true
		}
	}
	return false
}

func hasOverviewBucketValue(items []struct {
	Value    string `json:"value"`
	LogCount int    `json:"log_count"`
}, value string) bool {
	for _, item := range items {
		if item.Value == value {
			return true
		}
	}
	return false
}

func hasOverviewSourceCount(items []struct {
	Source   string `json:"source"`
	LogCount int    `json:"log_count"`
}, source string, count int) bool {
	for _, item := range items {
		if item.Source == source && item.LogCount == count {
			return true
		}
	}
	return false
}

func hasOverviewRecoveryPanel(items []struct {
	Key                   string `json:"key"`
	Status                string `json:"status"`
	SignalCode            string `json:"signal_code"`
	TopTraceID            string `json:"top_trace_id"`
	TopWorkgroupID        string `json:"top_workgroup_id"`
	TopAgentState         string `json:"top_agent_state"`
	TopControllerState    string `json:"top_controller_state"`
	TopHost               string `json:"top_host"`
	TopPlatform           string `json:"top_platform"`
	ReplayTraceID         string `json:"replay_trace_id"`
	ReplayWorkgroupID     string `json:"replay_workgroup_id"`
	ReplayAgentState      string `json:"replay_agent_state"`
	ReplayControllerState string `json:"replay_controller_state"`
	ReplayHost            string `json:"replay_host"`
	ReplayPlatform        string `json:"replay_platform"`
	LogCount              int    `json:"log_count"`
	HealthyCount          int    `json:"healthy_count"`
	WarningCount          int    `json:"warning_count"`
	CriticalCount         int    `json:"critical_count"`
	IdleCount             int    `json:"idle_count"`
}, key, status string, logCount int, criticalCount int, signalCode string) bool {
	for _, item := range items {
		if item.Key != key {
			continue
		}
		if item.Status != status || item.LogCount != logCount || item.CriticalCount != criticalCount {
			return false
		}
		if signalCode != "" && item.SignalCode != signalCode {
			return false
		}
		if signalCode == "" && item.SignalCode != "" {
			return false
		}
		return true
	}
	return false
}

func hasOverviewRecoveryPanelContext(items []struct {
	Key                   string `json:"key"`
	Status                string `json:"status"`
	SignalCode            string `json:"signal_code"`
	TopTraceID            string `json:"top_trace_id"`
	TopWorkgroupID        string `json:"top_workgroup_id"`
	TopAgentState         string `json:"top_agent_state"`
	TopControllerState    string `json:"top_controller_state"`
	TopHost               string `json:"top_host"`
	TopPlatform           string `json:"top_platform"`
	ReplayTraceID         string `json:"replay_trace_id"`
	ReplayWorkgroupID     string `json:"replay_workgroup_id"`
	ReplayAgentState      string `json:"replay_agent_state"`
	ReplayControllerState string `json:"replay_controller_state"`
	ReplayHost            string `json:"replay_host"`
	ReplayPlatform        string `json:"replay_platform"`
	LogCount              int    `json:"log_count"`
	HealthyCount          int    `json:"healthy_count"`
	WarningCount          int    `json:"warning_count"`
	CriticalCount         int    `json:"critical_count"`
	IdleCount             int    `json:"idle_count"`
}, key, traceID, workgroupID, agentState, controllerState, host, platform string) bool {
	for _, item := range items {
		if item.Key != key {
			continue
		}
		if traceID != "" && item.TopTraceID != traceID {
			return false
		}
		if workgroupID != "" && item.TopWorkgroupID != workgroupID {
			return false
		}
		if agentState != "" && item.TopAgentState != agentState {
			return false
		}
		if controllerState != "" && item.TopControllerState != controllerState {
			return false
		}
		if host != "" && item.TopHost != host {
			return false
		}
		if platform != "" && item.TopPlatform != platform {
			return false
		}
		return true
	}
	return false
}

func hasOverviewConnectionItem(items []struct {
	Value    string `json:"value"`
	LogCount int    `json:"log_count"`
}, value string, logCount int) bool {
	for _, item := range items {
		if item.Value == value && item.LogCount == logCount {
			return true
		}
	}
	return false
}

func hasConnectionHotspot(items []struct {
	AgentState                 string `json:"agent_state"`
	ControllerState            string `json:"controller_state"`
	Host                       string `json:"host"`
	Platform                   string `json:"platform"`
	LogCount                   int    `json:"log_count"`
	LogsWithSignals            int    `json:"logs_with_signals"`
	CriticalCount              int    `json:"critical_count"`
	WarningCount               int    `json:"warning_count"`
	TopSignalCode              string `json:"top_signal_code"`
	TopSignalTitle             string `json:"top_signal_title"`
	TopRecoveryPanelKey        string `json:"top_recovery_panel_key"`
	TopRecoveryPanelTitle      string `json:"top_recovery_panel_title"`
	TopRecoveryPanelStatus     string `json:"top_recovery_panel_status"`
	TopRecoveryPanelSignalCode string `json:"top_recovery_panel_signal_code"`
	TopTraceID                 string `json:"top_trace_id"`
	TopWorkgroupID             string `json:"top_workgroup_id"`
	TopTaskID                  string `json:"top_task_id"`
	TopDispatchRunID           string `json:"top_dispatch_run_id"`
	ReplaySignalCode           string `json:"replay_signal_code"`
	ReplayTraceID              string `json:"replay_trace_id"`
	ReplayWorkgroupID          string `json:"replay_workgroup_id"`
	ReplayTaskID               string `json:"replay_task_id"`
	ReplayDispatchRunID        string `json:"replay_dispatch_run_id"`
}, agentState, controllerState, host, platform string, logCount, logsWithSignals, criticalCount, warningCount int, topSignalCode string, topTraceID string, topWorkgroupID string, topTaskID string, topDispatchRunID string) bool {
	for _, item := range items {
		if item.AgentState == agentState &&
			item.ControllerState == controllerState &&
			item.Host == host &&
			item.Platform == platform &&
			item.LogCount == logCount &&
			item.LogsWithSignals == logsWithSignals &&
			item.CriticalCount == criticalCount &&
			item.WarningCount == warningCount &&
			item.TopSignalCode == topSignalCode &&
			item.TopTraceID == topTraceID &&
			item.TopWorkgroupID == topWorkgroupID &&
			item.TopTaskID == topTaskID &&
			item.TopDispatchRunID == topDispatchRunID {
			return true
		}
	}
	return false
}

func hasConnectionHotspotRecoveryStage(items []struct {
	AgentState                 string `json:"agent_state"`
	ControllerState            string `json:"controller_state"`
	Host                       string `json:"host"`
	Platform                   string `json:"platform"`
	LogCount                   int    `json:"log_count"`
	LogsWithSignals            int    `json:"logs_with_signals"`
	CriticalCount              int    `json:"critical_count"`
	WarningCount               int    `json:"warning_count"`
	TopSignalCode              string `json:"top_signal_code"`
	TopSignalTitle             string `json:"top_signal_title"`
	TopRecoveryPanelKey        string `json:"top_recovery_panel_key"`
	TopRecoveryPanelTitle      string `json:"top_recovery_panel_title"`
	TopRecoveryPanelStatus     string `json:"top_recovery_panel_status"`
	TopRecoveryPanelSignalCode string `json:"top_recovery_panel_signal_code"`
	TopTraceID                 string `json:"top_trace_id"`
	TopWorkgroupID             string `json:"top_workgroup_id"`
	TopTaskID                  string `json:"top_task_id"`
	TopDispatchRunID           string `json:"top_dispatch_run_id"`
	ReplaySignalCode           string `json:"replay_signal_code"`
	ReplayTraceID              string `json:"replay_trace_id"`
	ReplayWorkgroupID          string `json:"replay_workgroup_id"`
	ReplayTaskID               string `json:"replay_task_id"`
	ReplayDispatchRunID        string `json:"replay_dispatch_run_id"`
}, host, panelKey, status, signalCode string) bool {
	for _, item := range items {
		if item.Host != host {
			continue
		}
		if item.TopRecoveryPanelKey != panelKey || item.TopRecoveryPanelStatus != status {
			return false
		}
		if signalCode != "" && item.TopRecoveryPanelSignalCode != signalCode {
			return false
		}
		if signalCode == "" && item.TopRecoveryPanelSignalCode != "" {
			return false
		}
		return true
	}
	return false
}

func hasOverviewPresence(items []struct {
	Kind         string `json:"kind"`
	ID           string `json:"id"`
	AgentID      string `json:"agent_id"`
	Username     string `json:"username"`
	Source       string `json:"source"`
	Online       bool   `json:"online"`
	LogCount     int    `json:"log_count"`
	LastUploaded string `json:"last_uploaded"`
}, kind, id string, online bool, logCount int) bool {
	for _, item := range items {
		if item.Kind == kind && item.ID == id && item.Online == online && item.LogCount == logCount {
			return true
		}
	}
	return false
}

func hasRecoveryPanelStatus(items []struct {
	Key        string   `json:"key"`
	Status     string   `json:"status"`
	SignalCode string   `json:"signal_code"`
	Examples   []string `json:"examples"`
}, key, status, signalCode string) bool {
	for _, item := range items {
		if item.Key != key {
			continue
		}
		if item.Status != status {
			return false
		}
		if signalCode != "" && item.SignalCode != signalCode {
			return false
		}
		if signalCode == "" && item.SignalCode != "" {
			return false
		}
		return true
	}
	return false
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
