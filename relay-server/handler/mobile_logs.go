package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/claudecode/relay-server/auth"
	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/hub"
)

const maxMobileLogUploadBytes int64 = 2 << 20

type mobileLogUploadRequest struct {
	FileName       string   `json:"file_name"`
	Content        string   `json:"content"`
	AppVersion     string   `json:"app_version"`
	AppBuild       int      `json:"app_build"`
	DeviceModel    string   `json:"device_model"`
	ClientTime     string   `json:"client_time"`
	Source         string   `json:"source"`
	ConnectionNote string   `json:"connection_note"`
	TraceIDs       []string `json:"trace_ids"`
	WorkgroupIDs   []string `json:"workgroup_ids"`
}

type mobileLogUploadResponse struct {
	Success    bool   `json:"success"`
	LogID      string `json:"log_id"`
	UploadedAt string `json:"uploaded_at"`
}

type storedMobileLogMetadata struct {
	ID             string   `json:"id"`
	UserID         int      `json:"user_id"`
	Username       string   `json:"username"`
	DeviceID       string   `json:"device_id"`
	AgentID        string   `json:"agent_id,omitempty"`
	OriginalName   string   `json:"original_name"`
	StoredFileName string   `json:"stored_file_name"`
	SizeBytes      int64    `json:"size_bytes"`
	SHA256         string   `json:"sha256"`
	AppVersion     string   `json:"app_version,omitempty"`
	AppBuild       int      `json:"app_build,omitempty"`
	DeviceModel    string   `json:"device_model,omitempty"`
	ClientTime     string   `json:"client_time,omitempty"`
	Source         string   `json:"source,omitempty"`
	ConnectionNote string   `json:"connection_note,omitempty"`
	TraceIDs       []string `json:"trace_ids,omitempty"`
	WorkgroupIDs   []string `json:"workgroup_ids,omitempty"`
	UploadedAt     string   `json:"uploaded_at"`
}

type adminMobileLogListItem struct {
	ID             string   `json:"id"`
	UserID         int      `json:"user_id"`
	Username       string   `json:"username"`
	DeviceID       string   `json:"device_id"`
	AgentID        string   `json:"agent_id,omitempty"`
	OriginalName   string   `json:"original_name"`
	SizeBytes      int64    `json:"size_bytes"`
	AppVersion     string   `json:"app_version,omitempty"`
	AppBuild       int      `json:"app_build,omitempty"`
	DeviceModel    string   `json:"device_model,omitempty"`
	ClientTime     string   `json:"client_time,omitempty"`
	Source         string   `json:"source,omitempty"`
	UploadedAt     string   `json:"uploaded_at"`
	TraceIDs       []string `json:"trace_ids,omitempty"`
	WorkgroupIDs   []string `json:"workgroup_ids,omitempty"`
	TaskIDs        []string `json:"task_ids,omitempty"`
	DispatchRunIDs []string `json:"dispatch_run_ids,omitempty"`
}

type adminMobileLogDetailResponse struct {
	Metadata storedMobileLogMetadata `json:"metadata"`
	Content  string                  `json:"content"`
}

type mobileLogSignal struct {
	Code           string   `json:"code"`
	Title          string   `json:"title"`
	Count          int      `json:"count"`
	Recommendation string   `json:"recommendation"`
	Examples       []string `json:"examples"`
}

type mobileLogAnalysisResponse struct {
	Summary        string                   `json:"summary"`
	ErrorCount     int                      `json:"error_count"`
	WarningCount   int                      `json:"warning_count"`
	Signals        []mobileLogSignal        `json:"signals"`
	RecoveryPanels []mobileLogRecoveryPanel `json:"recovery_panels,omitempty"`
	RecentErrors   []string                 `json:"recent_errors"`
	TraceIDs       []string                 `json:"trace_ids,omitempty"`
	WorkgroupIDs   []string                 `json:"workgroup_ids,omitempty"`
	TaskIDs        []string                 `json:"task_ids,omitempty"`
	DispatchRunIDs []string                 `json:"dispatch_run_ids,omitempty"`
}

type mobileLogRecoveryPanel struct {
	Key            string   `json:"key"`
	Title          string   `json:"title"`
	Status         string   `json:"status"`
	Summary        string   `json:"summary"`
	Recommendation string   `json:"recommendation"`
	SignalCode     string   `json:"signal_code,omitempty"`
	Examples       []string `json:"examples,omitempty"`
}

type mobileLogOverviewSource struct {
	Source   string `json:"source"`
	LogCount int    `json:"log_count"`
}

type mobileLogOverviewSignal struct {
	Code       string `json:"code"`
	Title      string `json:"title"`
	LogCount   int    `json:"log_count"`
	TotalCount int    `json:"total_count"`
}

type mobileLogOverviewBucket struct {
	Value        string `json:"value"`
	LogCount     int    `json:"log_count"`
	ErrorCount   int    `json:"error_count"`
	WarningCount int    `json:"warning_count"`
	SignalCount  int    `json:"signal_count"`
}

type mobileLogOverviewRecoveryPanel struct {
	Key           string `json:"key"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	Summary       string `json:"summary"`
	SignalCode    string `json:"signal_code,omitempty"`
	LogCount      int    `json:"log_count"`
	HealthyCount  int    `json:"healthy_count"`
	WarningCount  int    `json:"warning_count"`
	CriticalCount int    `json:"critical_count"`
	IdleCount     int    `json:"idle_count"`
}

type mobileLogOverviewPresenceSummary struct {
	MatchingAgents  int `json:"matching_agents"`
	OnlineAgents    int `json:"online_agents"`
	MatchingDevices int `json:"matching_devices"`
	OnlineDevices   int `json:"online_devices"`
}

type mobileLogOverviewPresenceItem struct {
	Kind         string `json:"kind"`
	ID           string `json:"id"`
	AgentID      string `json:"agent_id,omitempty"`
	Username     string `json:"username"`
	Source       string `json:"source,omitempty"`
	Online       bool   `json:"online"`
	LogCount     int    `json:"log_count"`
	LastUploaded string `json:"last_uploaded,omitempty"`
}

type mobileLogOverviewConnectionItem struct {
	Value    string `json:"value"`
	LogCount int    `json:"log_count"`
}

type mobileLogOverviewConnectionAccumulator struct {
	Value    string
	LogCount int
}

type connectionHotspotAccumulator struct {
	AgentState      string
	ControllerState string
	Host            string
	Platform        string
	LogCount        int
	LogsWithSignals int
	CriticalCount   int
	WarningCount    int
	SignalTotals    map[string]int
	SignalTitles    map[string]string
	TraceTotals     map[string]int
	WorkgroupTotals map[string]int
	TaskTotals      map[string]int
	DispatchTotals  map[string]int
}

type mobileLogOverviewConnectionSummary struct {
	LogsWithConnectionNotes int                                  `json:"logs_with_connection_notes"`
	StructuredLogs          int                                  `json:"structured_logs"`
	FreeformLogs            int                                  `json:"freeform_logs"`
	AgentStates             []mobileLogOverviewConnectionItem    `json:"agent_states,omitempty"`
	ControllerStates        []mobileLogOverviewConnectionItem    `json:"controller_states,omitempty"`
	Hosts                   []mobileLogOverviewConnectionItem    `json:"hosts,omitempty"`
	Platforms               []mobileLogOverviewConnectionItem    `json:"platforms,omitempty"`
	FreeformNotes           []mobileLogOverviewConnectionItem    `json:"freeform_notes,omitempty"`
	Hotspots                []mobileLogOverviewConnectionHotspot `json:"hotspots,omitempty"`
}

type mobileLogOverviewConnectionHotspot struct {
	AgentState       string `json:"agent_state,omitempty"`
	ControllerState  string `json:"controller_state,omitempty"`
	Host             string `json:"host,omitempty"`
	Platform         string `json:"platform,omitempty"`
	LogCount         int    `json:"log_count"`
	LogsWithSignals  int    `json:"logs_with_signals"`
	CriticalCount    int    `json:"critical_count"`
	WarningCount     int    `json:"warning_count"`
	TopSignalCode    string `json:"top_signal_code,omitempty"`
	TopSignalTitle   string `json:"top_signal_title,omitempty"`
	TopTraceID       string `json:"top_trace_id,omitempty"`
	TopWorkgroupID   string `json:"top_workgroup_id,omitempty"`
	TopTaskID        string `json:"top_task_id,omitempty"`
	TopDispatchRunID string `json:"top_dispatch_run_id,omitempty"`
}

type mobileLogOverviewResponse struct {
	Summary           string                             `json:"summary"`
	LogCount          int                                `json:"log_count"`
	LogsWithSignals   int                                `json:"logs_with_signals"`
	ErrorCount        int                                `json:"error_count"`
	WarningCount      int                                `json:"warning_count"`
	PresenceSummary   mobileLogOverviewPresenceSummary   `json:"presence_summary"`
	LivePresence      []mobileLogOverviewPresenceItem    `json:"live_presence,omitempty"`
	ConnectionSummary mobileLogOverviewConnectionSummary `json:"connection_summary"`
	SourceCounts      []mobileLogOverviewSource          `json:"source_counts"`
	TopSignals        []mobileLogOverviewSignal          `json:"top_signals"`
	RecoveryPanels    []mobileLogOverviewRecoveryPanel   `json:"recovery_panels,omitempty"`
	TopTraceIDs       []mobileLogOverviewBucket          `json:"top_trace_ids,omitempty"`
	TopWorkgroupIDs   []mobileLogOverviewBucket          `json:"top_workgroup_ids,omitempty"`
	TopTaskIDs        []mobileLogOverviewBucket          `json:"top_task_ids,omitempty"`
	TopDispatchRunIDs []mobileLogOverviewBucket          `json:"top_dispatch_run_ids,omitempty"`
}

type mobileLogFilter struct {
	Query           string
	Source          string
	SignalCode      string
	TraceID         string
	WorkgroupID     string
	TaskID          string
	DispatchRunID   string
	AgentState      string
	ControllerState string
	Host            string
	Platform        string
}

func DeviceLogUploadHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		token, err := readBearerToken(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		claims, err := auth.VerifyToken(cfg.JWTSecret, token)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		if claims.Type != "device" {
			http.Error(w, "only devices can upload logs", http.StatusForbidden)
			return
		}

		bodyReader := http.MaxBytesReader(w, r.Body, maxMobileLogUploadBytes)
		defer bodyReader.Close()

		var req mobileLogUploadRequest
		if err := json.NewDecoder(bodyReader).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		req.FileName = strings.TrimSpace(req.FileName)
		req.Content = strings.ReplaceAll(req.Content, "\r\n", "\n")
		req.Source = strings.TrimSpace(req.Source)
		if req.FileName == "" || strings.TrimSpace(req.Content) == "" {
			http.Error(w, "file_name and content are required", http.StatusBadRequest)
			return
		}
		if req.Source == "" {
			req.Source = "android"
		}
		req.TraceIDs = normalizeProvidedLogIDs(req.TraceIDs, 20)
		req.WorkgroupIDs = normalizeProvidedLogIDs(req.WorkgroupIDs, 20)
		if len(req.TraceIDs) == 0 || len(req.WorkgroupIDs) == 0 {
			extractedTraceIDs, extractedWorkgroupIDs, _, _ := extractTraceAndWorkgroupIDs(req.Content)
			if len(req.TraceIDs) == 0 {
				req.TraceIDs = extractedTraceIDs
			}
			if len(req.WorkgroupIDs) == 0 {
				req.WorkgroupIDs = extractedWorkgroupIDs
			}
		}

		userID, err := database.GetDeviceUserID(claims.DeviceID)
		if err != nil {
			http.Error(w, "device not found", http.StatusUnauthorized)
			return
		}
		user, err := database.GetUserByID(userID)
		if err != nil {
			http.Error(w, "user not found", http.StatusUnauthorized)
			return
		}

		logID, err := randomID()
		if err != nil {
			http.Error(w, "failed to allocate log id", http.StatusInternalServerError)
			return
		}

		storageDir := filepath.Join(cfg.DataDir, "mobile-logs")
		if err := os.MkdirAll(storageDir, 0o755); err != nil {
			http.Error(w, "failed to create storage directory", http.StatusInternalServerError)
			return
		}

		ext := sanitizeLogExtension(filepath.Ext(req.FileName))
		storedFileName := logID + ext
		targetPath := filepath.Join(storageDir, storedFileName)
		contentBytes := []byte(req.Content)
		hash := sha256.Sum256(contentBytes)
		if err := os.WriteFile(targetPath, contentBytes, 0o644); err != nil {
			http.Error(w, "failed to store log file", http.StatusInternalServerError)
			return
		}

		uploadedAt := time.Now().UTC()
		metadata := storedMobileLogMetadata{
			ID:             logID,
			UserID:         user.ID,
			Username:       user.Username,
			DeviceID:       claims.DeviceID,
			AgentID:        claims.AgentID,
			OriginalName:   sanitizeOriginalName(req.FileName),
			StoredFileName: storedFileName,
			SizeBytes:      int64(len(contentBytes)),
			SHA256:         hex.EncodeToString(hash[:]),
			AppVersion:     strings.TrimSpace(req.AppVersion),
			AppBuild:       req.AppBuild,
			DeviceModel:    strings.TrimSpace(req.DeviceModel),
			ClientTime:     strings.TrimSpace(req.ClientTime),
			Source:         req.Source,
			ConnectionNote: strings.TrimSpace(req.ConnectionNote),
			TraceIDs:       req.TraceIDs,
			WorkgroupIDs:   req.WorkgroupIDs,
			UploadedAt:     uploadedAt.Format(time.RFC3339),
		}
		if err := writeMobileLogMetadata(storageDir, metadata); err != nil {
			_ = os.Remove(targetPath)
			http.Error(w, "failed to store log metadata", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(mobileLogUploadResponse{
			Success:    true,
			LogID:      logID,
			UploadedAt: metadata.UploadedAt,
		})
	}
}

func AdminMobileLogsHandler(cfg *config.Config, database *db.DB, h *hub.Hub) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		session, ok := currentAdminSession(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		remainder := strings.Trim(strings.TrimPrefix(r.URL.Path, "/admin/api/mobile-logs"), "/")
		records, err := listStoredMobileLogs(filepath.Join(cfg.DataDir, "mobile-logs"))
		if err != nil {
			http.Error(w, "failed to read mobile logs", http.StatusInternalServerError)
			return
		}
		records = filterMobileLogsForAdmin(records, session)
		filter := mobileLogFilter{
			Query:           strings.TrimSpace(r.URL.Query().Get("q")),
			Source:          strings.TrimSpace(r.URL.Query().Get("source")),
			SignalCode:      strings.TrimSpace(r.URL.Query().Get("signal_code")),
			TraceID:         strings.TrimSpace(r.URL.Query().Get("trace_id")),
			WorkgroupID:     strings.TrimSpace(r.URL.Query().Get("workgroup_id")),
			TaskID:          strings.TrimSpace(r.URL.Query().Get("task_id")),
			DispatchRunID:   strings.TrimSpace(r.URL.Query().Get("dispatch_run_id")),
			AgentState:      strings.TrimSpace(r.URL.Query().Get("agent_state")),
			ControllerState: strings.TrimSpace(r.URL.Query().Get("controller_state")),
			Host:            strings.TrimSpace(r.URL.Query().Get("host")),
			Platform:        strings.TrimSpace(r.URL.Query().Get("platform")),
		}
		if filter.Query != "" || filter.Source != "" || filter.SignalCode != "" || filter.TraceID != "" || filter.WorkgroupID != "" || filter.TaskID != "" || filter.DispatchRunID != "" || filter.AgentState != "" || filter.ControllerState != "" || filter.Host != "" || filter.Platform != "" {
			records = filterStoredMobileLogs(records, filepath.Join(cfg.DataDir, "mobile-logs"), filter)
		}

		if remainder == "overview" {
			presence := hub.PresenceSnapshot{
				Agents:  map[string]bool{},
				Devices: map[string]bool{},
			}
			if h != nil {
				presence = h.PresenceSnapshot()
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(buildMobileLogOverview(records, filepath.Join(cfg.DataDir, "mobile-logs"), presence))
			return
		}

		if remainder == "" {
			items := make([]adminMobileLogListItem, 0, len(records))
			for _, record := range records {
				traceIDs, workgroupIDs, taskIDs, dispatchRunIDs := resolveStoredMobileLogIDs(filepath.Join(cfg.DataDir, "mobile-logs"), record)
				items = append(items, adminMobileLogListItem{
					ID:             record.ID,
					UserID:         record.UserID,
					Username:       record.Username,
					DeviceID:       record.DeviceID,
					AgentID:        record.AgentID,
					OriginalName:   record.OriginalName,
					SizeBytes:      record.SizeBytes,
					AppVersion:     record.AppVersion,
					AppBuild:       record.AppBuild,
					DeviceModel:    record.DeviceModel,
					ClientTime:     record.ClientTime,
					Source:         record.Source,
					UploadedAt:     record.UploadedAt,
					TraceIDs:       traceIDs,
					WorkgroupIDs:   workgroupIDs,
					TaskIDs:        taskIDs,
					DispatchRunIDs: dispatchRunIDs,
				})
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(items)
			return
		}

		if strings.HasSuffix(remainder, "/analysis") {
			logID := strings.TrimSuffix(remainder, "/analysis")
			record, content, ok := findStoredMobileLog(records, filepath.Join(cfg.DataDir, "mobile-logs"), logID)
			if !ok {
				http.NotFound(w, r)
				return
			}
			traceIDs, workgroupIDs, taskIDs, dispatchRunIDs := mergeStoredAndExtractedIDs(record, content)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(analyzeMobileLog(content, traceIDs, workgroupIDs, taskIDs, dispatchRunIDs))
			return
		}

		record, content, ok := findStoredMobileLog(records, filepath.Join(cfg.DataDir, "mobile-logs"), remainder)
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(adminMobileLogDetailResponse{
			Metadata: record,
			Content:  content,
		})
	})
}

func AdminMobileLogsPageHandler(cfg *config.Config) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(mobileLogsAdminHTML))
	})
}

func writeMobileLogMetadata(storageDir string, metadata storedMobileLogMetadata) error {
	metaPath := filepath.Join(storageDir, metadata.ID+".json")
	payload, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(metaPath, payload, 0o644)
}

func listStoredMobileLogs(storageDir string) ([]storedMobileLogMetadata, error) {
	entries, err := os.ReadDir(storageDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []storedMobileLogMetadata{}, nil
		}
		return nil, err
	}

	records := make([]storedMobileLogMetadata, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(storageDir, entry.Name()))
		if err != nil {
			continue
		}
		var metadata storedMobileLogMetadata
		if err := json.Unmarshal(payload, &metadata); err != nil {
			continue
		}
		if metadata.ID == "" || metadata.StoredFileName == "" {
			continue
		}
		records = append(records, metadata)
	}

	sort.Slice(records, func(i, j int) bool {
		return records[i].UploadedAt > records[j].UploadedAt
	})
	return records, nil
}

func filterMobileLogsForAdmin(records []storedMobileLogMetadata, session adminSession) []storedMobileLogMetadata {
	if session.IsAdmin {
		return records
	}
	filtered := make([]storedMobileLogMetadata, 0, len(records))
	for _, record := range records {
		if record.UserID == session.UserID {
			filtered = append(filtered, record)
		}
	}
	return filtered
}

func findStoredMobileLog(records []storedMobileLogMetadata, storageDir, logID string) (storedMobileLogMetadata, string, bool) {
	for _, record := range records {
		if record.ID != logID {
			continue
		}
		content, err := readStoredMobileLogContent(storageDir, record)
		if err != nil {
			return storedMobileLogMetadata{}, "", false
		}
		return record, content, true
	}
	return storedMobileLogMetadata{}, "", false
}

func readStoredMobileLogContent(storageDir string, record storedMobileLogMetadata) (string, error) {
	content, err := os.ReadFile(filepath.Join(storageDir, record.StoredFileName))
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func filterStoredMobileLogs(records []storedMobileLogMetadata, storageDir string, filter mobileLogFilter) []storedMobileLogMetadata {
	if filter.Query == "" && filter.Source == "" && filter.SignalCode == "" && filter.TraceID == "" && filter.WorkgroupID == "" && filter.TaskID == "" && filter.DispatchRunID == "" && filter.AgentState == "" && filter.ControllerState == "" && filter.Host == "" && filter.Platform == "" {
		return records
	}

	query := strings.ToLower(strings.TrimSpace(filter.Query))
	source := strings.ToLower(strings.TrimSpace(filter.Source))
	signalCode := strings.ToLower(strings.TrimSpace(filter.SignalCode))
	traceID := strings.ToLower(strings.TrimSpace(filter.TraceID))
	workgroupID := strings.ToLower(strings.TrimSpace(filter.WorkgroupID))
	taskID := strings.ToLower(strings.TrimSpace(filter.TaskID))
	dispatchRunID := strings.ToLower(strings.TrimSpace(filter.DispatchRunID))
	agentState := strings.ToLower(strings.TrimSpace(filter.AgentState))
	controllerState := strings.ToLower(strings.TrimSpace(filter.ControllerState))
	host := strings.TrimSpace(filter.Host)
	hostLower := strings.ToLower(host)
	platform := strings.ToLower(strings.TrimSpace(filter.Platform))
	filtered := make([]storedMobileLogMetadata, 0, len(records))

	for _, record := range records {
		var content string
		var err error
		needsContent := query != "" || signalCode != "" || taskID != "" || dispatchRunID != "" || len(record.TraceIDs) == 0 || len(record.WorkgroupIDs) == 0
		if needsContent {
			content, err = readStoredMobileLogContent(storageDir, record)
			if err != nil {
				continue
			}
		}
		traceIDs, workgroupIDs, taskIDs, dispatchRunIDs := mergeStoredAndExtractedIDs(record, content)
		if query != "" {
			haystack := strings.ToLower(strings.Join([]string{
				record.ID,
				record.Username,
				record.DeviceID,
				record.AgentID,
				record.OriginalName,
				record.Source,
				record.ConnectionNote,
				content,
			}, "\n"))
			if !strings.Contains(haystack, query) {
				continue
			}
		}
		if source != "" && strings.ToLower(strings.TrimSpace(record.Source)) != source {
			continue
		}
		if signalCode != "" {
			analysis := analyzeMobileLog(content, traceIDs, workgroupIDs, taskIDs, dispatchRunIDs)
			if !containsSignalCode(analysis.Signals, signalCode) {
				continue
			}
		}
		if traceID != "" && !containsNormalizedID(traceIDs, traceID) {
			continue
		}
		if workgroupID != "" && !containsNormalizedID(workgroupIDs, workgroupID) {
			continue
		}
		if taskID != "" && !containsNormalizedID(taskIDs, taskID) {
			continue
		}
		if dispatchRunID != "" && !containsNormalizedID(dispatchRunIDs, dispatchRunID) {
			continue
		}
		if agentState != "" || controllerState != "" || hostLower != "" || platform != "" {
			fields, _ := parseConnectionNote(record.ConnectionNote)
			if agentState != "" && strings.ToLower(strings.TrimSpace(fields["agent"])) != agentState {
				continue
			}
			if controllerState != "" && strings.ToLower(strings.TrimSpace(fields["controller"])) != controllerState {
				continue
			}
			if hostLower != "" && strings.ToLower(strings.TrimSpace(fields["host"])) != hostLower {
				continue
			}
			if platform != "" && strings.ToLower(strings.TrimSpace(fields["platform"])) != platform {
				continue
			}
		}
		filtered = append(filtered, record)
	}

	return filtered
}

func buildMobileLogOverview(records []storedMobileLogMetadata, storageDir string, presence hub.PresenceSnapshot) mobileLogOverviewResponse {
	if len(records) == 0 {
		return mobileLogOverviewResponse{
			Summary: "No device logs matched the current filter.",
		}
	}

	type signalAccumulator struct {
		Code       string
		Title      string
		LogCount   int
		TotalCount int
	}
	type recoveryPanelAccumulator struct {
		Key           string
		Title         string
		LogCount      int
		HealthyCount  int
		WarningCount  int
		CriticalCount int
		IdleCount     int
		SignalCode    string
	}
	type presenceAccumulator struct {
		Kind         string
		ID           string
		AgentID      string
		Username     string
		Source       string
		Online       bool
		LogCount     int
		LastUploaded string
	}
	sourceCounts := make(map[string]int)
	signalTotals := make(map[string]*signalAccumulator)
	recoveryPanelTotals := make(map[string]*recoveryPanelAccumulator)
	presenceTotals := make(map[string]*presenceAccumulator)
	agentStateTotals := make(map[string]*mobileLogOverviewConnectionAccumulator)
	controllerStateTotals := make(map[string]*mobileLogOverviewConnectionAccumulator)
	hostTotals := make(map[string]*mobileLogOverviewConnectionAccumulator)
	platformTotals := make(map[string]*mobileLogOverviewConnectionAccumulator)
	freeformConnectionTotals := make(map[string]*mobileLogOverviewConnectionAccumulator)
	traceBuckets := make(map[string]*mobileLogOverviewBucket)
	workgroupBuckets := make(map[string]*mobileLogOverviewBucket)
	taskBuckets := make(map[string]*mobileLogOverviewBucket)
	dispatchRunBuckets := make(map[string]*mobileLogOverviewBucket)
	logsWithSignals := 0
	errorCount := 0
	warningCount := 0
	connectionSummary := mobileLogOverviewConnectionSummary{}

	updateBucket := func(target map[string]*mobileLogOverviewBucket, values []string, analysis mobileLogAnalysisResponse) {
		signalWeight := 0
		for _, signal := range analysis.Signals {
			signalWeight += signal.Count
		}
		for _, value := range values {
			key := strings.ToLower(strings.TrimSpace(value))
			if key == "" {
				continue
			}
			item := target[key]
			if item == nil {
				item = &mobileLogOverviewBucket{Value: strings.TrimSpace(value)}
				target[key] = item
			}
			item.LogCount++
			item.ErrorCount += analysis.ErrorCount
			item.WarningCount += analysis.WarningCount
			item.SignalCount += signalWeight
		}
	}
	updatePresence := func(kind string, record storedMobileLogMetadata, id string, online bool) {
		cleanID := strings.TrimSpace(id)
		if cleanID == "" {
			return
		}
		key := kind + ":" + cleanID
		item := presenceTotals[key]
		if item == nil {
			item = &presenceAccumulator{
				Kind:     kind,
				ID:       cleanID,
				AgentID:  strings.TrimSpace(record.AgentID),
				Username: strings.TrimSpace(record.Username),
				Source:   strings.TrimSpace(record.Source),
				Online:   online,
			}
			presenceTotals[key] = item
		}
		item.LogCount++
		if record.UploadedAt > item.LastUploaded {
			item.LastUploaded = record.UploadedAt
		}
		if online {
			item.Online = true
		}
	}
	updateConnectionCount := func(target map[string]*mobileLogOverviewConnectionAccumulator, value string, canonicalize bool) {
		cleanValue := strings.TrimSpace(value)
		if cleanValue == "" {
			return
		}
		key := cleanValue
		displayValue := cleanValue
		if canonicalize {
			key = strings.ToLower(cleanValue)
			displayValue = key
		}
		item := target[key]
		if item == nil {
			item = &mobileLogOverviewConnectionAccumulator{Value: displayValue}
			target[key] = item
		}
		item.LogCount++
	}
	connectionHotspotTotals := make(map[string]*connectionHotspotAccumulator)
	updateConnectionHotspot := func(fields map[string]string, analysis mobileLogAnalysisResponse, traceIDs []string, workgroupIDs []string, taskIDs []string, dispatchRunIDs []string) {
		if len(fields) == 0 {
			return
		}
		agent := strings.ToLower(strings.TrimSpace(fields["agent"]))
		controller := strings.ToLower(strings.TrimSpace(fields["controller"]))
		host := strings.TrimSpace(fields["host"])
		platform := strings.ToLower(strings.TrimSpace(fields["platform"]))
		key := strings.Join([]string{
			"agent=" + agent,
			"controller=" + controller,
			"host=" + strings.ToLower(host),
			"platform=" + platform,
		}, "|")
		item := connectionHotspotTotals[key]
		if item == nil {
			item = &connectionHotspotAccumulator{
				AgentState:      agent,
				ControllerState: controller,
				Host:            host,
				Platform:        platform,
				SignalTotals:    make(map[string]int),
				SignalTitles:    make(map[string]string),
				TraceTotals:     make(map[string]int),
				WorkgroupTotals: make(map[string]int),
				TaskTotals:      make(map[string]int),
				DispatchTotals:  make(map[string]int),
			}
			connectionHotspotTotals[key] = item
		}
		item.LogCount++
		if len(analysis.Signals) > 0 {
			item.LogsWithSignals++
		}
		hasCritical := false
		hasWarning := false
		for _, panel := range analysis.RecoveryPanels {
			switch strings.ToLower(strings.TrimSpace(panel.Status)) {
			case "critical":
				hasCritical = true
			case "warning":
				hasWarning = true
			}
		}
		if hasCritical {
			item.CriticalCount++
		}
		if hasWarning {
			item.WarningCount++
		}
		for _, signal := range analysis.Signals {
			item.SignalTotals[signal.Code] += signal.Count
			if item.SignalTitles[signal.Code] == "" && strings.TrimSpace(signal.Title) != "" {
				item.SignalTitles[signal.Code] = signal.Title
			}
		}
		for _, value := range traceIDs {
			cleanValue := strings.TrimSpace(value)
			if cleanValue != "" {
				item.TraceTotals[cleanValue]++
			}
		}
		for _, value := range workgroupIDs {
			cleanValue := strings.TrimSpace(value)
			if cleanValue != "" {
				item.WorkgroupTotals[cleanValue]++
			}
		}
		for _, value := range taskIDs {
			cleanValue := strings.TrimSpace(value)
			if cleanValue != "" {
				item.TaskTotals[cleanValue]++
			}
		}
		for _, value := range dispatchRunIDs {
			cleanValue := strings.TrimSpace(value)
			if cleanValue != "" {
				item.DispatchTotals[cleanValue]++
			}
		}
	}

	for _, record := range records {
		content, err := readStoredMobileLogContent(storageDir, record)
		if err != nil {
			continue
		}
		traceIDs, workgroupIDs, taskIDs, dispatchRunIDs := mergeStoredAndExtractedIDs(record, content)
		analysis := analyzeMobileLog(content, traceIDs, workgroupIDs, taskIDs, dispatchRunIDs)

		source := strings.TrimSpace(record.Source)
		if source == "" {
			source = "unknown"
		}
		sourceCounts[source]++
		errorCount += analysis.ErrorCount
		warningCount += analysis.WarningCount
		if len(analysis.Signals) > 0 {
			logsWithSignals++
		}
		for _, signal := range analysis.Signals {
			item := signalTotals[signal.Code]
			if item == nil {
				item = &signalAccumulator{
					Code:  signal.Code,
					Title: signal.Title,
				}
				signalTotals[signal.Code] = item
			}
			item.LogCount++
			item.TotalCount += signal.Count
		}
		for _, panel := range analysis.RecoveryPanels {
			item := recoveryPanelTotals[panel.Key]
			if item == nil {
				item = &recoveryPanelAccumulator{
					Key:   panel.Key,
					Title: panel.Title,
				}
				recoveryPanelTotals[panel.Key] = item
			}
			item.LogCount++
			switch strings.ToLower(strings.TrimSpace(panel.Status)) {
			case "critical":
				item.CriticalCount++
			case "warning":
				item.WarningCount++
			case "healthy":
				item.HealthyCount++
			default:
				item.IdleCount++
			}
			if item.SignalCode == "" && strings.TrimSpace(panel.SignalCode) != "" {
				item.SignalCode = panel.SignalCode
			}
		}
		updatePresence("agent", record, record.AgentID, presence.Agents[strings.TrimSpace(record.AgentID)])
		updatePresence("device", record, record.DeviceID, presence.Devices[strings.TrimSpace(record.DeviceID)])
		if strings.TrimSpace(record.ConnectionNote) != "" {
			connectionSummary.LogsWithConnectionNotes++
			fields, freeform := parseConnectionNote(record.ConnectionNote)
			if len(fields) > 0 {
				connectionSummary.StructuredLogs++
				updateConnectionCount(agentStateTotals, fields["agent"], true)
				updateConnectionCount(controllerStateTotals, fields["controller"], true)
				updateConnectionCount(hostTotals, fields["host"], false)
				updateConnectionCount(platformTotals, fields["platform"], true)
				updateConnectionHotspot(fields, analysis, traceIDs, workgroupIDs, taskIDs, dispatchRunIDs)
			}
			if freeform != "" {
				connectionSummary.FreeformLogs++
				updateConnectionCount(freeformConnectionTotals, freeform, false)
			}
		}

		updateBucket(traceBuckets, traceIDs, analysis)
		updateBucket(workgroupBuckets, workgroupIDs, analysis)
		updateBucket(taskBuckets, taskIDs, analysis)
		updateBucket(dispatchRunBuckets, dispatchRunIDs, analysis)
	}

	sourceItems := make([]mobileLogOverviewSource, 0, len(sourceCounts))
	for source, count := range sourceCounts {
		sourceItems = append(sourceItems, mobileLogOverviewSource{
			Source:   source,
			LogCount: count,
		})
	}
	sort.Slice(sourceItems, func(i, j int) bool {
		if sourceItems[i].LogCount == sourceItems[j].LogCount {
			return sourceItems[i].Source < sourceItems[j].Source
		}
		return sourceItems[i].LogCount > sourceItems[j].LogCount
	})

	topSignals := make([]mobileLogOverviewSignal, 0, len(signalTotals))
	for _, item := range signalTotals {
		topSignals = append(topSignals, mobileLogOverviewSignal{
			Code:       item.Code,
			Title:      item.Title,
			LogCount:   item.LogCount,
			TotalCount: item.TotalCount,
		})
	}
	sort.Slice(topSignals, func(i, j int) bool {
		leftPriority := signalPriority(topSignals[i].Code)
		rightPriority := signalPriority(topSignals[j].Code)
		if leftPriority != rightPriority {
			return leftPriority > rightPriority
		}
		if topSignals[i].LogCount == topSignals[j].LogCount {
			if topSignals[i].TotalCount == topSignals[j].TotalCount {
				return topSignals[i].Title < topSignals[j].Title
			}
			return topSignals[i].TotalCount > topSignals[j].TotalCount
		}
		return topSignals[i].LogCount > topSignals[j].LogCount
	})
	if len(topSignals) > 6 {
		topSignals = topSignals[:6]
	}

	recoveryPanels := make([]mobileLogOverviewRecoveryPanel, 0, len(recoveryPanelTotals))
	for _, item := range recoveryPanelTotals {
		status := "idle"
		summary := fmt.Sprintf("No desktop recovery stage was observed across %d matching log(s).", item.LogCount)
		if item.CriticalCount > 0 {
			status = "critical"
			summary = fmt.Sprintf("%d log(s) reached a critical state in this stage.", item.CriticalCount)
		} else if item.WarningCount > 0 {
			status = "warning"
			summary = fmt.Sprintf("%d log(s) hit warnings in this stage; %d remained healthy.", item.WarningCount, item.HealthyCount)
		} else if item.HealthyCount > 0 {
			status = "healthy"
			summary = fmt.Sprintf("%d log(s) completed this stage cleanly.", item.HealthyCount)
		}
		recoveryPanels = append(recoveryPanels, mobileLogOverviewRecoveryPanel{
			Key:           item.Key,
			Title:         item.Title,
			Status:        status,
			Summary:       summary,
			SignalCode:    item.SignalCode,
			LogCount:      item.LogCount,
			HealthyCount:  item.HealthyCount,
			WarningCount:  item.WarningCount,
			CriticalCount: item.CriticalCount,
			IdleCount:     item.IdleCount,
		})
	}
	sort.Slice(recoveryPanels, func(i, j int) bool {
		leftPriority := recoveryPanelKeyPriority(recoveryPanels[i].Key)
		rightPriority := recoveryPanelKeyPriority(recoveryPanels[j].Key)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		if recoveryPanels[i].CriticalCount == recoveryPanels[j].CriticalCount {
			if recoveryPanels[i].WarningCount == recoveryPanels[j].WarningCount {
				return recoveryPanels[i].Title < recoveryPanels[j].Title
			}
			return recoveryPanels[i].WarningCount > recoveryPanels[j].WarningCount
		}
		return recoveryPanels[i].CriticalCount > recoveryPanels[j].CriticalCount
	})

	presenceItems := make([]mobileLogOverviewPresenceItem, 0, len(presenceTotals))
	presenceSummary := mobileLogOverviewPresenceSummary{}
	for _, item := range presenceTotals {
		presenceItems = append(presenceItems, mobileLogOverviewPresenceItem{
			Kind:         item.Kind,
			ID:           item.ID,
			AgentID:      item.AgentID,
			Username:     item.Username,
			Source:       item.Source,
			Online:       item.Online,
			LogCount:     item.LogCount,
			LastUploaded: item.LastUploaded,
		})
		if item.Kind == "agent" {
			presenceSummary.MatchingAgents++
			if item.Online {
				presenceSummary.OnlineAgents++
			}
			continue
		}
		if item.Kind == "device" {
			presenceSummary.MatchingDevices++
			if item.Online {
				presenceSummary.OnlineDevices++
			}
		}
	}
	sort.Slice(presenceItems, func(i, j int) bool {
		if presenceItems[i].Online != presenceItems[j].Online {
			return presenceItems[i].Online
		}
		if presenceItems[i].LogCount == presenceItems[j].LogCount {
			if presenceItems[i].LastUploaded == presenceItems[j].LastUploaded {
				if presenceItems[i].Kind == presenceItems[j].Kind {
					return presenceItems[i].ID < presenceItems[j].ID
				}
				return presenceItems[i].Kind < presenceItems[j].Kind
			}
			return presenceItems[i].LastUploaded > presenceItems[j].LastUploaded
		}
		return presenceItems[i].LogCount > presenceItems[j].LogCount
	})
	connectionSummary.AgentStates = buildConnectionOverviewItems(agentStateTotals, 4)
	connectionSummary.ControllerStates = buildConnectionOverviewItems(controllerStateTotals, 4)
	connectionSummary.Hosts = buildConnectionOverviewItems(hostTotals, 4)
	connectionSummary.Platforms = buildConnectionOverviewItems(platformTotals, 4)
	connectionSummary.FreeformNotes = buildConnectionOverviewItems(freeformConnectionTotals, 4)
	connectionSummary.Hotspots = buildConnectionHotspots(connectionHotspotTotals, 6)

	summary := fmt.Sprintf("Current filter matched %d logs.", len(records))
	switch {
	case len(topSignals) > 0:
		summary = fmt.Sprintf("Current filter matched %d logs; %d logs contain diagnostic signals. Most common: %s.", len(records), logsWithSignals, topSignals[0].Title)
	case errorCount > 0:
		summary = fmt.Sprintf("Current filter matched %d logs and %d total errors; no high-confidence signal matched yet.", len(records), errorCount)
	case warningCount > 0:
		summary = fmt.Sprintf("Current filter matched %d logs and %d total warnings; narrow further with trace_id or workgroup_id.", len(records), warningCount)
	}

	return mobileLogOverviewResponse{
		Summary:           summary,
		LogCount:          len(records),
		LogsWithSignals:   logsWithSignals,
		ErrorCount:        errorCount,
		WarningCount:      warningCount,
		PresenceSummary:   presenceSummary,
		LivePresence:      presenceItems,
		ConnectionSummary: connectionSummary,
		SourceCounts:      sourceItems,
		TopSignals:        topSignals,
		RecoveryPanels:    recoveryPanels,
		TopTraceIDs:       limitOverviewBuckets(traceBuckets, 6),
		TopWorkgroupIDs:   limitOverviewBuckets(workgroupBuckets, 6),
		TopTaskIDs:        limitOverviewBuckets(taskBuckets, 6),
		TopDispatchRunIDs: limitOverviewBuckets(dispatchRunBuckets, 6),
	}
}

func parseConnectionNote(note string) (map[string]string, string) {
	cleanNote := strings.TrimSpace(note)
	if cleanNote == "" {
		return nil, ""
	}
	fields := make(map[string]string)
	freeformParts := make([]string, 0, 2)
	for _, rawPart := range strings.Split(cleanNote, ";") {
		part := strings.TrimSpace(rawPart)
		if part == "" {
			continue
		}
		separator := strings.Index(part, "=")
		if separator <= 0 || separator >= len(part)-1 {
			freeformParts = append(freeformParts, part)
			continue
		}
		key := strings.ToLower(strings.TrimSpace(part[:separator]))
		value := strings.TrimSpace(part[separator+1:])
		if key == "" || value == "" {
			freeformParts = append(freeformParts, part)
			continue
		}
		if _, exists := fields[key]; !exists {
			fields[key] = value
		}
	}
	if len(fields) == 0 && len(freeformParts) == 0 {
		freeformParts = append(freeformParts, cleanNote)
	}
	return fields, strings.Join(freeformParts, "; ")
}

func buildConnectionOverviewItems(values map[string]*mobileLogOverviewConnectionAccumulator, limit int) []mobileLogOverviewConnectionItem {
	items := make([]mobileLogOverviewConnectionItem, 0, len(values))
	for _, value := range values {
		items = append(items, mobileLogOverviewConnectionItem{
			Value:    value.Value,
			LogCount: value.LogCount,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].LogCount == items[j].LogCount {
			return items[i].Value < items[j].Value
		}
		return items[i].LogCount > items[j].LogCount
	})
	if limit > 0 && len(items) > limit {
		return items[:limit]
	}
	return items
}

func buildConnectionHotspots(values map[string]*connectionHotspotAccumulator, limit int) []mobileLogOverviewConnectionHotspot {
	items := make([]mobileLogOverviewConnectionHotspot, 0, len(values))
	for _, value := range values {
		topSignalCode := ""
		topSignalTitle := ""
		topSignalWeight := 0
		for code, weight := range value.SignalTotals {
			title := strings.TrimSpace(value.SignalTitles[code])
			if topSignalCode == "" {
				topSignalCode = code
				topSignalTitle = title
				topSignalWeight = weight
				continue
			}
			currentPriority := signalPriority(code)
			bestPriority := signalPriority(topSignalCode)
			if currentPriority > bestPriority || (currentPriority == bestPriority && (weight > topSignalWeight || (weight == topSignalWeight && code < topSignalCode))) {
				topSignalCode = code
				topSignalTitle = title
				topSignalWeight = weight
			}
		}
		topTraceID := topConnectionHotspotValue(value.TraceTotals)
		topWorkgroupID := topConnectionHotspotValue(value.WorkgroupTotals)
		topTaskID := topConnectionHotspotValue(value.TaskTotals)
		topDispatchRunID := topConnectionHotspotValue(value.DispatchTotals)
		items = append(items, mobileLogOverviewConnectionHotspot{
			AgentState:       value.AgentState,
			ControllerState:  value.ControllerState,
			Host:             value.Host,
			Platform:         value.Platform,
			LogCount:         value.LogCount,
			LogsWithSignals:  value.LogsWithSignals,
			CriticalCount:    value.CriticalCount,
			WarningCount:     value.WarningCount,
			TopSignalCode:    topSignalCode,
			TopSignalTitle:   topSignalTitle,
			TopTraceID:       topTraceID,
			TopWorkgroupID:   topWorkgroupID,
			TopTaskID:        topTaskID,
			TopDispatchRunID: topDispatchRunID,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CriticalCount != items[j].CriticalCount {
			return items[i].CriticalCount > items[j].CriticalCount
		}
		if items[i].WarningCount != items[j].WarningCount {
			return items[i].WarningCount > items[j].WarningCount
		}
		if items[i].LogsWithSignals != items[j].LogsWithSignals {
			return items[i].LogsWithSignals > items[j].LogsWithSignals
		}
		if items[i].LogCount != items[j].LogCount {
			return items[i].LogCount > items[j].LogCount
		}
		return items[i].Host < items[j].Host
	})
	if limit > 0 && len(items) > limit {
		return items[:limit]
	}
	return items
}

func topConnectionHotspotValue(values map[string]int) string {
	bestValue := ""
	bestCount := 0
	for value, count := range values {
		if bestValue == "" || count > bestCount || (count == bestCount && value < bestValue) {
			bestValue = value
			bestCount = count
		}
	}
	return bestValue
}

func sanitizeOriginalName(name string) string {
	clean := strings.TrimSpace(filepath.Base(name))
	if clean == "" {
		return "mobile.log"
	}
	return clean
}

func sanitizeLogExtension(ext string) string {
	normalized := strings.ToLower(strings.TrimSpace(ext))
	switch normalized {
	case ".txt", ".log", ".json":
		return normalized
	default:
		return ".log"
	}
}

func randomID() (string, error) {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func analyzeMobileLog(content string, traceIDs []string, workgroupIDs []string, taskIDs []string, dispatchRunIDs []string) mobileLogAnalysisResponse {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	errorCount := 0
	warningCount := 0
	recentErrors := make([]string, 0, 6)
	schedulerFailedCount := 0
	schedulerRetryLoopCount := 0
	schedulerFailureExamples := make([]string, 0, 3)
	schedulerRetryExamples := make([]string, 0, 3)
	workgroupSchedulerFailedCount := 0
	workgroupSchedulerRepeatFailureCount := 0
	workgroupSchedulerConfigFailureCount := 0
	workgroupSchedulerBlockedFailureCount := 0
	workgroupSchedulerMemberUnavailableCount := 0
	workgroupSchedulerDispatchFailureCount := 0
	workgroupSchedulerFailureExamples := make([]string, 0, 3)
	workgroupSchedulerRepeatExamples := make([]string, 0, 3)
	workgroupSchedulerConfigExamples := make([]string, 0, 3)
	workgroupSchedulerBlockedExamples := make([]string, 0, 3)
	workgroupSchedulerMemberUnavailableExamples := make([]string, 0, 3)
	workgroupSchedulerDispatchFailureExamples := make([]string, 0, 3)
	workgroupSchedulerFailuresByTaskID := map[string]int{}
	workgroupSchedulerQueuedCountByTaskID := map[string]int{}
	workgroupSchedulerStalledCount := 0
	workgroupSchedulerQueuedExamples := make([]string, 0, 3)
	workgroupSchedulerStalledExamples := make([]string, 0, 3)
	workgroupSchedulerReentryCount := 0
	workgroupSchedulerReentryExamples := make([]string, 0, 3)
	workgroupSchedulerOpenDispatches := make(map[string]string)
	restartResidueCount := 0
	restartResidueExamples := make([]string, 0, 3)
	recoveryJitterCount := 0
	recoveryJitterExamples := make([]string, 0, 3)
	authRecoveryFailureCount := 0
	authRecoveryFailureExamples := make([]string, 0, 3)
	foregroundRecoveryPassCount := 0
	foregroundSessionCatalogCount := 0
	foregroundProjectSyncRequestedCount := 0
	foregroundWorkgroupRefreshCount := 0
	foregroundProjectSyncSkippedCount := 0
	foregroundRecoveryFailureCount := 0
	foregroundRecoveryExamples := make([]string, 0, 3)
	postAuthSyncStartCount := 0
	postAuthSessionCatalogCount := 0
	postAuthProjectSyncRequestedCount := 0
	postAuthWorkgroupRefreshCount := 0
	postAuthSyncFailureCount := 0
	postAuthSyncExamples := make([]string, 0, 3)
	desktopAuthRecoveryFailureCount := 0
	desktopAuthRecoveryFailureExamples := make([]string, 0, 3)
	desktopFollowUpRefreshCount := 0
	desktopProjectCatalogUpdatedCount := 0
	desktopActiveProjectSyncRequestedCount := 0
	desktopActiveProjectSyncExamples := make([]string, 0, 3)
	desktopRemoteSessionSnapshotCount := 0
	desktopRemoteSessionSnapshotExamples := make([]string, 0, 3)
	desktopWorkgroupCatalogRefreshCount := 0
	desktopWorkgroupCatalogUpdatedCount := 0
	desktopCatalogRefreshFailureCount := 0
	desktopCatalogRefreshExamples := make([]string, 0, 3)

	type signalPattern struct {
		code           string
		title          string
		recommendation string
		matches        []string
	}

	patterns := []signalPattern{
		{
			code:           "auth_refresh_failures",
			title:          "认证或 token 刷新失败",
			recommendation: "优先检查登录 token 是否过期、设备 ID 是否被变更，以及服务端登录接口是否正常返回。",
			matches: []string{
				"auth-error",
				"invalid token",
				"authentication failed",
				"failed to refresh mobile token",
				"failed to refresh relay token",
				"no valid token available for relay connection",
			},
		},
		{
			code:           "websocket_failures",
			title:          "WebSocket 连接恢复不稳定",
			recommendation: "重点看前后台切换后是否出现长时间 reconnect、socket failure 或连接虽恢复但没有新入站数据。",
			matches: []string{
				"websocket failure",
				"recovering stalled websocket",
				"force reconnecting websocket",
				"failed to restore relay connection on foreground",
				"failed to verify relay connection on resume",
				"relay is not connected",
			},
		},
		{
			code:           "session_sync_failures",
			title:          "会话或消息同步失败",
			recommendation: "检查 syncDevice、project.list.request 和 session.sync.request 前后的错误，确认连上后是否真的触发了补同步。",
			matches: []string{
				"syncfromserver failed",
				"failed to refresh session catalog on foreground",
				"failed to request project syncs on foreground",
				"error requesting desktop sync",
				"failed to sync sessions after relay authentication",
				"failed to request project syncs on foreground",
			},
		},
		{
			code:           "project_sync_gap_recovery",
			title:          "Project sync gap recovery is unstable",
			recommendation: "Inspect session.sync windows, backfill requests, and item-detail fetches. Repeated gap recovery usually means local bounds are stale or the relay resumed without a clean incremental baseline.",
			matches: []string{
				"detected incomplete local sync",
				"requesting sync backfill",
				"error requesting full sync item",
				"desktop sync contained no parsable messages",
				"failed to parse sync item",
			},
		},
		{
			code:           "workgroup_sync_failures",
			title:          "Workgroup session recovery is failing",
			recommendation: "Focus on workgroup refresh recovery, active sync validation, and send-result envelopes. If these cluster around foreground or resume, treat relay health and workgroup snapshot refresh as one chain.",
			matches: []string{
				"failed to restore workgroup connection during refresh recovery",
				"failed to validate workgroup connection during sync",
				"failed to send workgroup message",
				"workgroup session unavailable",
				"workgroup message failed",
			},
		},
		{
			code:           "send_ack_retry_loops",
			title:          "Send acknowledgement or retry loop detected",
			recommendation: "Check whether message.accepted arrived in time, whether the client retried with the same clientMessageId, and whether the desktop accepted a duplicate send instead of starting a second run.",
			matches: []string{
				"error restoring connection for retried send",
				"error retrying pending send",
				"failed to send; queueing for retry",
				"accepted duplicate project message.send using existing trace",
				"accepted duplicate workgroup collaboration message",
			},
		},
		{
			code:           "desktop_relay_recovery_loops",
			title:          "Desktop relay recovery loop detected",
			recommendation: "Inspect stale-socket recovery, reconnect backoff, and whether the desktop stayed connected but unauthenticated. If these cluster together, focus on relay health checks and controller token refresh during desktop resume.",
			matches: []string{
				"reconnecting stalled socket during",
				"reconnecting unauthenticated socket during",
				"reconnecting stale socket during",
				"reconnecting in ",
			},
		},
		{
			code:           "desktop_dispatch_breaks",
			title:          "Desktop accepted work but execution broke later",
			recommendation: "Trace the chain after acceptance. Check whether the desktop queued the run, then failed during runtime dispatch, member dispatch, or post-accept execution.",
			matches: []string{
				"project message run failed after acceptance",
				"local dispatch failed",
				"remote dispatch failed",
				"delivery failed: no member accepted this message",
				"delivery partial:",
			},
		},
		{
			code:           "envelope_parse_failures",
			title:          "消息包解析失败",
			recommendation: "如果有 parse envelope 失败，要检查服务端 payload 结构和客户端版本是否匹配。",
			matches: []string{
				"failed to parse envelope",
				"failed to parse conversation list",
				"failed to parse queue list",
			},
		},
	}

	type signalAccumulator struct {
		pattern  signalPattern
		count    int
		examples []string
	}
	accumulators := make(map[string]*signalAccumulator, len(patterns))
	for _, pattern := range patterns {
		copyPattern := pattern
		accumulators[pattern.code] = &signalAccumulator{pattern: copyPattern, examples: []string{}}
	}

	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		lowerLine := strings.ToLower(line)
		if strings.Contains(lowerLine, " error ") || strings.Contains(lowerLine, "] error [") || strings.Contains(lowerLine, "exception") {
			errorCount++
			if len(recentErrors) < 6 {
				recentErrors = append(recentErrors, line)
			}
		} else if strings.Contains(lowerLine, " warn ") || strings.Contains(lowerLine, "] warn [") {
			warningCount++
		}

		if strings.Contains(lowerLine, "scheduled workgroup task failed.") {
			workgroupSchedulerFailedCount++
			if len(workgroupSchedulerFailureExamples) < 3 {
				workgroupSchedulerFailureExamples = append(workgroupSchedulerFailureExamples, line)
			}
			switch classifyWorkgroupSchedulerFailure(lowerLine) {
			case "config":
				workgroupSchedulerConfigFailureCount++
				if len(workgroupSchedulerConfigExamples) < 3 {
					workgroupSchedulerConfigExamples = append(workgroupSchedulerConfigExamples, line)
				}
			case "blocked":
				workgroupSchedulerBlockedFailureCount++
				if len(workgroupSchedulerBlockedExamples) < 3 {
					workgroupSchedulerBlockedExamples = append(workgroupSchedulerBlockedExamples, line)
				}
			case "member_unavailable":
				workgroupSchedulerMemberUnavailableCount++
				if len(workgroupSchedulerMemberUnavailableExamples) < 3 {
					workgroupSchedulerMemberUnavailableExamples = append(workgroupSchedulerMemberUnavailableExamples, line)
				}
			case "dispatch":
				workgroupSchedulerDispatchFailureCount++
				if len(workgroupSchedulerDispatchFailureExamples) < 3 {
					workgroupSchedulerDispatchFailureExamples = append(workgroupSchedulerDispatchFailureExamples, line)
				}
			}
			if taskID := extractTaskID(line); taskID != "" {
				delete(workgroupSchedulerOpenDispatches, taskID)
				workgroupSchedulerFailuresByTaskID[taskID]++
				if workgroupSchedulerFailuresByTaskID[taskID] > 1 {
					workgroupSchedulerRepeatFailureCount++
					if len(workgroupSchedulerRepeatExamples) < 3 {
						workgroupSchedulerRepeatExamples = append(workgroupSchedulerRepeatExamples, line)
					}
				}
			}
		} else if strings.Contains(lowerLine, "queued scheduled workgroup task.") {
			if taskID := extractTaskID(line); taskID != "" {
				workgroupSchedulerQueuedCountByTaskID[taskID]++
				if len(workgroupSchedulerQueuedExamples) < 3 {
					workgroupSchedulerQueuedExamples = append(workgroupSchedulerQueuedExamples, line)
				}
				if workgroupSchedulerQueuedCountByTaskID[taskID] > 1 {
					workgroupSchedulerReentryCount++
					if len(workgroupSchedulerReentryExamples) < 3 {
						workgroupSchedulerReentryExamples = append(workgroupSchedulerReentryExamples, line)
					}
				}
			}
		} else if strings.Contains(lowerLine, "scheduled workgroup task dispatched.") {
			if taskID := extractTaskID(line); taskID != "" {
				workgroupSchedulerOpenDispatches[taskID] = line
			}
		} else if strings.Contains(lowerLine, "scheduled workgroup task completed.") ||
			strings.Contains(lowerLine, "scheduled workgroup task downstream execution failed.") {
			if taskID := extractTaskID(line); taskID != "" {
				delete(workgroupSchedulerOpenDispatches, taskID)
			}
		} else if strings.Contains(lowerLine, "scheduled task failed.") {
			schedulerFailedCount++
			if len(schedulerFailureExamples) < 3 {
				schedulerFailureExamples = append(schedulerFailureExamples, line)
			}
			if strings.Contains(lowerLine, "retrycount") || strings.Contains(lowerLine, "retryrunat") {
				schedulerRetryLoopCount++
				if len(schedulerRetryExamples) < 3 {
					schedulerRetryExamples = append(schedulerRetryExamples, line)
				}
			}
		} else if strings.Contains(lowerLine, "retrycount") || strings.Contains(lowerLine, "retryrunat") {
			schedulerRetryLoopCount++
			if len(schedulerRetryExamples) < 3 {
				schedulerRetryExamples = append(schedulerRetryExamples, line)
			}
		}

		if strings.Contains(lowerLine, "recovered scheduled task with stale in-flight state") ||
			strings.Contains(lowerLine, "recovered scheduled workgroup task with stale in-flight state") ||
			strings.Contains(lowerLine, "desktop restarted before the scheduled task finished") ||
			strings.Contains(lowerLine, "desktop restarted before the scheduled workgroup task finished") {
			restartResidueCount++
			if len(restartResidueExamples) < 3 {
				restartResidueExamples = append(restartResidueExamples, line)
			}
		}

		if strings.Contains(lowerLine, "triggered relay watchdog recovery") ||
			strings.Contains(lowerLine, "recovering stalled websocket") ||
			strings.Contains(lowerLine, "force reconnecting websocket") ||
			strings.Contains(lowerLine, "reconnecting stalled socket during") ||
			strings.Contains(lowerLine, "reconnecting unauthenticated socket during") ||
			strings.Contains(lowerLine, "reconnecting stale socket during") {
			recoveryJitterCount++
			if len(recoveryJitterExamples) < 3 {
				recoveryJitterExamples = append(recoveryJitterExamples, line)
			}
		}

		if strings.Contains(lowerLine, "failed to refresh mobile token after auth error") ||
			strings.Contains(lowerLine, "failed to reconnect relay after auth error recovery") ||
			strings.Contains(lowerLine, "failed to reconnect relay after token refresh") ||
			strings.Contains(lowerLine, "failed to refresh mobile token in background") ||
			strings.Contains(lowerLine, "failed to refresh relay token on foreground restore") {
			authRecoveryFailureCount++
			if len(authRecoveryFailureExamples) < 3 {
				authRecoveryFailureExamples = append(authRecoveryFailureExamples, line)
			}
		}

		if strings.Contains(lowerLine, "running foreground recovery pass") {
			foregroundRecoveryPassCount++
			if len(foregroundRecoveryExamples) < 3 {
				foregroundRecoveryExamples = append(foregroundRecoveryExamples, line)
			}
		}
		if strings.Contains(lowerLine, "foreground session catalog refreshed") {
			foregroundSessionCatalogCount++
		}
		if strings.Contains(lowerLine, "foreground project sync requested") {
			foregroundProjectSyncRequestedCount++
		}
		if strings.Contains(lowerLine, "foreground workgroup refresh completed") {
			foregroundWorkgroupRefreshCount++
		}
		if strings.Contains(lowerLine, "skipping foreground project sync because relay is not connected") {
			foregroundProjectSyncSkippedCount++
			if len(foregroundRecoveryExamples) < 3 {
				foregroundRecoveryExamples = append(foregroundRecoveryExamples, line)
			}
		}
		if strings.Contains(lowerLine, "failed to verify relay connection on resume") ||
			strings.Contains(lowerLine, "failed to refresh session catalog on foreground") ||
			strings.Contains(lowerLine, "failed to request project syncs on foreground") ||
			strings.Contains(lowerLine, "failed to refresh workgroups on foreground") {
			foregroundRecoveryFailureCount++
			if len(foregroundRecoveryExamples) < 3 {
				foregroundRecoveryExamples = append(foregroundRecoveryExamples, line)
			}
		}

		if strings.Contains(lowerLine, "starting post-auth session sync") {
			postAuthSyncStartCount++
			if len(postAuthSyncExamples) < 3 {
				postAuthSyncExamples = append(postAuthSyncExamples, line)
			}
		}
		if strings.Contains(lowerLine, "post-auth session catalog refreshed") {
			postAuthSessionCatalogCount++
		}
		if strings.Contains(lowerLine, "requested project syncs after relay authentication") {
			postAuthProjectSyncRequestedCount++
		}
		if strings.Contains(lowerLine, "completed post-auth workgroup refresh") {
			postAuthWorkgroupRefreshCount++
		}
		if strings.Contains(lowerLine, "failed to sync sessions after relay authentication") {
			postAuthSyncFailureCount++
			if len(postAuthSyncExamples) < 3 {
				postAuthSyncExamples = append(postAuthSyncExamples, line)
			}
		}

		if strings.Contains(lowerLine, "agent relay auth recovery aborted because token refresh failed") ||
			strings.Contains(lowerLine, "controller relay auth recovery aborted because token refresh failed") {
			desktopAuthRecoveryFailureCount++
			if len(desktopAuthRecoveryFailureExamples) < 3 {
				desktopAuthRecoveryFailureExamples = append(desktopAuthRecoveryFailureExamples, line)
			}
		}
		if strings.Contains(lowerLine, "running relay follow-up refresh") {
			desktopFollowUpRefreshCount++
			if len(desktopCatalogRefreshExamples) < 3 {
				desktopCatalogRefreshExamples = append(desktopCatalogRefreshExamples, line)
			}
		}
		if strings.Contains(lowerLine, "remote project catalog updated") {
			desktopProjectCatalogUpdatedCount++
		}
		if strings.Contains(lowerLine, "requested active remote project sync") {
			desktopActiveProjectSyncRequestedCount++
			if len(desktopActiveProjectSyncExamples) < 3 {
				desktopActiveProjectSyncExamples = append(desktopActiveProjectSyncExamples, line)
			}
		}
		if strings.Contains(lowerLine, "remote session snapshot updated") {
			desktopRemoteSessionSnapshotCount++
			if len(desktopRemoteSessionSnapshotExamples) < 3 {
				desktopRemoteSessionSnapshotExamples = append(desktopRemoteSessionSnapshotExamples, line)
			}
		}
		if strings.Contains(lowerLine, "completed remote workgroup catalog refresh") {
			desktopWorkgroupCatalogRefreshCount++
		}
		if strings.Contains(lowerLine, "remote workgroup catalog updated") {
			desktopWorkgroupCatalogUpdatedCount++
		}
		if strings.Contains(lowerLine, "failed to refresh remote workgroup catalog") {
			desktopCatalogRefreshFailureCount++
			if len(desktopCatalogRefreshExamples) < 3 {
				desktopCatalogRefreshExamples = append(desktopCatalogRefreshExamples, line)
			}
		}

		for _, pattern := range patterns {
			matched := false
			for _, token := range pattern.matches {
				if strings.Contains(lowerLine, token) {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
			acc := accumulators[pattern.code]
			acc.count++
			if len(acc.examples) < 3 {
				acc.examples = append(acc.examples, line)
			}
		}
	}

	signals := make([]mobileLogSignal, 0, len(patterns))
	for _, pattern := range patterns {
		acc := accumulators[pattern.code]
		if acc.count == 0 {
			continue
		}
		signals = append(signals, mobileLogSignal{
			Code:           pattern.code,
			Title:          pattern.title,
			Count:          acc.count,
			Recommendation: pattern.recommendation,
			Examples:       acc.examples,
		})
	}

	if schedulerFailedCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_task_failures",
			Title:          "Desktop scheduled task failures detected",
			Count:          schedulerFailedCount,
			Recommendation: "Inspect scheduler taskId/runId pairs, the task payload, and the downstream runtime path. If failures cluster after acceptance, compare retryCount and the next retryRunAt to confirm whether the task is recovering or stuck.",
			Examples:       schedulerFailureExamples,
		})
	}

	if schedulerRetryLoopCount > 0 {
		examples := schedulerRetryExamples
		if len(examples) == 0 {
			examples = schedulerFailureExamples
		}
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_task_retry_loops",
			Title:          "Desktop scheduled task retry loop detected",
			Count:          schedulerRetryLoopCount,
			Recommendation: "Check whether the same scheduled task keeps failing with increasing retryCount or a moving retryRunAt. Repeated retries usually mean the runtime path is broken even though the scheduler itself is alive.",
			Examples:       examples,
		})
	}

	if restartResidueCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_restart_recovery_residue",
			Title:          "Desktop restart left scheduled-task residue behind",
			Count:          restartResidueCount,
			Recommendation: "Check the restart window around startup or resume. These logs show queued/running scheduled tasks that were only cleaned up after reconciliation, which usually means the previous process exited before completion callbacks cleared task state.",
			Examples:       restartResidueExamples,
		})
	}

	if recoveryJitterCount > 1 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_recovery_jitter",
			Title:          "Desktop recovery jitter detected",
			Count:          recoveryJitterCount,
			Recommendation: "Inspect whether relay recovery is oscillating between watchdog recovery, stale-socket reconnects, and forced reconnects. When these cluster tightly, the client is not settling into a stable connected state after resume or network change.",
			Examples:       recoveryJitterExamples,
		})
	}

	if authRecoveryFailureCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "auth_recovery_failures",
			Title:          "Auth recovery chain is failing",
			Count:          authRecoveryFailureCount,
			Recommendation: "Inspect token refresh and reconnect together. If these failures cluster after auth-error, foreground restore, or token-refresh, the client is failing before it can re-enter a healthy relay session.",
			Examples:       authRecoveryFailureExamples,
		})
	}

	if foregroundRecoveryPassCount > 0 && (foregroundRecoveryFailureCount > 0 || foregroundProjectSyncSkippedCount > 0 || foregroundSessionCatalogCount < foregroundRecoveryPassCount || foregroundProjectSyncRequestedCount == 0 || foregroundWorkgroupRefreshCount == 0) {
		signals = append(signals, mobileLogSignal{
			Code:           "foreground_recovery_follow_up_gaps",
			Title:          "Foreground recovery did not complete follow-up sync",
			Count:          foregroundRecoveryFailureCount + foregroundProjectSyncSkippedCount + maxInt(1, foregroundRecoveryPassCount-foregroundProjectSyncRequestedCount),
			Recommendation: "Compare each foreground recovery pass with the later catalog refresh, project sync request, and workgroup refresh logs. If the pass starts but these follow-up logs do not appear, the app resumed without completing its catch-up chain.",
			Examples:       foregroundRecoveryExamples,
		})
	}

	if postAuthSyncStartCount > 0 && (postAuthSyncFailureCount > 0 || postAuthSessionCatalogCount < postAuthSyncStartCount || postAuthProjectSyncRequestedCount < postAuthSyncStartCount || postAuthWorkgroupRefreshCount < postAuthSyncStartCount) {
		signals = append(signals, mobileLogSignal{
			Code:           "post_auth_sync_incomplete",
			Title:          "Post-auth sync chain did not settle",
			Count:          postAuthSyncFailureCount + maxInt(1, postAuthSyncStartCount-postAuthProjectSyncRequestedCount),
			Recommendation: "Inspect the post-auth chain in order: session catalog refresh, project sync request, and workgroup refresh. If authentication succeeded but these follow-up steps are missing, the relay resumed without rebuilding catalogs and session state.",
			Examples:       postAuthSyncExamples,
		})
	}

	if foregroundRecoveryPassCount > 0 && postAuthSyncStartCount > 0 &&
		(foregroundRecoveryFailureCount > 0 || foregroundProjectSyncSkippedCount > 0) &&
		(postAuthSyncFailureCount > 0 || postAuthProjectSyncRequestedCount < postAuthSyncStartCount || postAuthWorkgroupRefreshCount < postAuthSyncStartCount) {
		signals = append(signals, mobileLogSignal{
			Code:           "android_manual_reconnect_likely",
			Title:          "Android resume likely still needed a manual reconnect",
			Count:          foregroundRecoveryFailureCount + foregroundProjectSyncSkippedCount + postAuthSyncFailureCount + maxInt(1, postAuthSyncStartCount-postAuthProjectSyncRequestedCount),
			Recommendation: "Treat foreground recovery, auth resume, and catch-up sync as one broken chain. When resume verification fails, project sync is skipped, and post-auth sync still does not settle, the app usually recovered transport only partially and still needed a manual reconnect to refresh messages.",
			Examples:       mergeExampleLists(4, foregroundRecoveryExamples, postAuthSyncExamples, authRecoveryFailureExamples),
		})
	}

	if desktopAuthRecoveryFailureCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_auth_recovery_failures",
			Title:          "Desktop auth recovery could not refresh credentials",
			Count:          desktopAuthRecoveryFailureCount,
			Recommendation: "Inspect controller or agent token refresh around auth-failed. If recovery aborts here, the desktop will reconnect repeatedly without ever re-establishing a valid authenticated relay session.",
			Examples:       desktopAuthRecoveryFailureExamples,
		})
	}

	if desktopFollowUpRefreshCount > 0 && (desktopCatalogRefreshFailureCount > 0 || desktopProjectCatalogUpdatedCount == 0 || desktopWorkgroupCatalogRefreshCount == 0 || desktopWorkgroupCatalogUpdatedCount == 0) {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_catalog_refresh_gaps",
			Title:          "Desktop follow-up refresh did not rebuild catalogs",
			Count:          desktopCatalogRefreshFailureCount + maxInt(1, desktopFollowUpRefreshCount-desktopProjectCatalogUpdatedCount),
			Recommendation: "Compare follow-up refresh runs with the later project-catalog update and workgroup-catalog refresh logs. If the desktop requests follow-up refreshes but catalog updates never land, the controller relay recovered without settling the remote indexes.",
			Examples:       desktopCatalogRefreshExamples,
		})
	}

	if desktopActiveProjectSyncRequestedCount > 0 && desktopRemoteSessionSnapshotCount < desktopActiveProjectSyncRequestedCount {
		examples := desktopActiveProjectSyncExamples
		if len(examples) == 0 {
			examples = desktopRemoteSessionSnapshotExamples
		}
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_remote_snapshot_gaps",
			Title:          "Desktop active remote project sync did not settle into a snapshot",
			Count:          maxInt(1, desktopActiveProjectSyncRequestedCount-desktopRemoteSessionSnapshotCount),
			Recommendation: "Compare the active remote project sync request with later remote session snapshot updates. If the desktop requests an active project sync but no snapshot lands, the controller relay recovered only up to catalog refresh and never rebuilt the active conversation state.",
			Examples:       examples,
		})
	}

	if desktopFollowUpRefreshCount > 0 &&
		(desktopAuthRecoveryFailureCount > 0 || desktopCatalogRefreshFailureCount > 0 || desktopActiveProjectSyncRequestedCount > desktopRemoteSessionSnapshotCount) {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_resume_catchup_stalled",
			Title:          "Desktop reconnect recovered transport but not active state",
			Count:          desktopAuthRecoveryFailureCount + desktopCatalogRefreshFailureCount + maxInt(1, desktopActiveProjectSyncRequestedCount-desktopRemoteSessionSnapshotCount),
			Recommendation: "Inspect desktop resume as a full chain: auth recovery, follow-up catalog refresh, active project sync request, and remote snapshot update. If transport came back but the snapshot never landed, operators usually see a desktop that looks connected yet still needs a manual reconnect or relaunch before chats catch up.",
			Examples:       mergeExampleLists(4, desktopAuthRecoveryFailureExamples, desktopCatalogRefreshExamples, desktopActiveProjectSyncExamples, desktopRemoteSessionSnapshotExamples),
		})
	}

	if workgroupSchedulerFailedCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_workgroup_task_failures",
			Title:          "Desktop scheduled workgroup task failures detected",
			Count:          workgroupSchedulerFailedCount,
			Recommendation: "Inspect the workgroup taskId, assignee mapping, and dispatch path after the scheduler queued the workgroup task. If failures cluster on one workgroup, compare workgroup membership, member online state, and the dispatchBlockedReason carried by later snapshots.",
			Examples:       workgroupSchedulerFailureExamples,
		})
	}

	if workgroupSchedulerConfigFailureCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_workgroup_task_config_gaps",
			Title:          "Desktop scheduled workgroup tasks have configuration gaps",
			Count:          workgroupSchedulerConfigFailureCount,
			Recommendation: "Inspect the task's assignee, workgroup binding, and project mapping. These failures usually mean the scheduler ran on time, but the task itself is incomplete or points to a missing member or project.",
			Examples:       workgroupSchedulerConfigExamples,
		})
	}

	if workgroupSchedulerBlockedFailureCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_workgroup_task_dispatch_blocked",
			Title:          "Desktop scheduled workgroup task dispatch was blocked",
			Count:          workgroupSchedulerBlockedFailureCount,
			Recommendation: "Check whether the task was already running or still assigned when the scheduler fired again. If this clusters, inspect overlapping schedules, stale task status, and whether completion callbacks are clearing dispatch state correctly.",
			Examples:       workgroupSchedulerBlockedExamples,
		})
	}

	if workgroupSchedulerMemberUnavailableCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_workgroup_task_member_unavailable",
			Title:          "Desktop scheduled workgroup task member was unavailable",
			Count:          workgroupSchedulerMemberUnavailableCount,
			Recommendation: "Focus on assignee availability, online state, and member-to-project binding. These failures usually mean the task is valid, but the target member or project was unavailable when the scheduler fired.",
			Examples:       workgroupSchedulerMemberUnavailableExamples,
		})
	}

	if workgroupSchedulerDispatchFailureCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_workgroup_task_dispatch_failures",
			Title:          "Desktop scheduled workgroup task dispatch failed downstream",
			Count:          workgroupSchedulerDispatchFailureCount,
			Recommendation: "Inspect downstream local or remote dispatch after the scheduler queued the task. If these failures repeat, compare dispatchRunId, project connectivity, and runtime enqueue logs to confirm where the handoff broke.",
			Examples:       workgroupSchedulerDispatchFailureExamples,
		})
	}

	if workgroupSchedulerRepeatFailureCount > 0 {
		examples := workgroupSchedulerRepeatExamples
		if len(examples) == 0 {
			examples = workgroupSchedulerFailureExamples
		}
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_workgroup_task_repeat_failures",
			Title:          "Desktop scheduled workgroup task repeated failures detected",
			Count:          workgroupSchedulerRepeatFailureCount,
			Recommendation: "Focus on the repeated taskId and confirm whether the same scheduled workgroup task keeps failing across multiple dispatch windows. Repeated failures usually mean the scheduler is alive but member dispatch or downstream execution is consistently broken.",
			Examples:       examples,
		})
	}

	for _, line := range workgroupSchedulerOpenDispatches {
		workgroupSchedulerStalledCount++
		if len(workgroupSchedulerStalledExamples) < 3 {
			workgroupSchedulerStalledExamples = append(workgroupSchedulerStalledExamples, line)
		}
	}

	if workgroupSchedulerStalledCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_workgroup_task_stalled_after_dispatch",
			Title:          "Desktop scheduled workgroup tasks stalled after dispatch",
			Count:          workgroupSchedulerStalledCount,
			Recommendation: "Inspect taskId and dispatchRunId after downstream acceptance. These tasks were dispatched but no matching completion or downstream failure event appeared in the same log window, which usually means the task is stuck in assigned/running state or the completion path stopped reporting.",
			Examples:       workgroupSchedulerStalledExamples,
		})
	}

	if workgroupSchedulerReentryCount > 0 {
		signals = append(signals, mobileLogSignal{
			Code:           "desktop_scheduled_workgroup_task_reentry",
			Title:          "Desktop scheduled workgroup task reentry detected",
			Count:          workgroupSchedulerReentryCount,
			Recommendation: "Check whether the same taskId was queued again before the previous run fully settled. Reentry usually points to overlapping schedules, stale nextRunAt computation, or a task that never cleared its in-flight state cleanly.",
			Examples:       workgroupSchedulerReentryExamples,
		})
	}

	sort.Slice(signals, func(i, j int) bool {
		return signals[i].Count > signals[j].Count
	})

	summary := "日志里没有发现明显的连接异常特征。"
	switch {
	case len(signals) > 0:
		summary = fmt.Sprintf("检测到 %d 类重点异常信号，最突出的是“%s”。", len(signals), signals[0].Title)
	case errorCount > 0:
		summary = fmt.Sprintf("日志里有 %d 条错误，但暂时没有命中特定的诊断规则，建议优先查看最近错误行。", errorCount)
	case warningCount > 0:
		summary = fmt.Sprintf("日志里有 %d 条警告，没有看到明确错误，可以结合最近一次前后台切换时间继续比对。", warningCount)
	}

	return mobileLogAnalysisResponse{
		Summary:      summary,
		ErrorCount:   errorCount,
		WarningCount: warningCount,
		Signals:      signals,
		RecoveryPanels: append(
			buildAndroidRecoveryPanels(
				authRecoveryFailureCount,
				authRecoveryFailureExamples,
				foregroundRecoveryPassCount,
				foregroundSessionCatalogCount,
				foregroundProjectSyncRequestedCount,
				foregroundWorkgroupRefreshCount,
				foregroundProjectSyncSkippedCount,
				foregroundRecoveryFailureCount,
				foregroundRecoveryExamples,
				postAuthSyncStartCount,
				postAuthSessionCatalogCount,
				postAuthProjectSyncRequestedCount,
				postAuthWorkgroupRefreshCount,
				postAuthSyncFailureCount,
				postAuthSyncExamples,
			),
			buildDesktopRecoveryPanels(
				desktopAuthRecoveryFailureCount,
				desktopAuthRecoveryFailureExamples,
				desktopFollowUpRefreshCount,
				desktopProjectCatalogUpdatedCount,
				desktopWorkgroupCatalogRefreshCount,
				desktopWorkgroupCatalogUpdatedCount,
				desktopCatalogRefreshFailureCount,
				desktopCatalogRefreshExamples,
				desktopActiveProjectSyncRequestedCount,
				desktopRemoteSessionSnapshotCount,
				desktopActiveProjectSyncExamples,
				desktopRemoteSessionSnapshotExamples,
			)...,
		),
		RecentErrors:   recentErrors,
		TraceIDs:       traceIDs,
		WorkgroupIDs:   workgroupIDs,
		TaskIDs:        taskIDs,
		DispatchRunIDs: dispatchRunIDs,
	}
}

func normalizeProvidedLogIDs(values []string, limit int) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		clean := strings.Trim(strings.TrimSpace(value), `"'.,;:()[]{}<>`)
		if clean == "" {
			continue
		}
		key := strings.ToLower(clean)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, clean)
		if limit > 0 && len(normalized) >= limit {
			break
		}
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func mergeLogIDs(primary []string, secondary []string, limit int) []string {
	if len(primary) == 0 && len(secondary) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(primary)+len(secondary))
	merged := make([]string, 0, len(primary)+len(secondary))
	appendValue := func(value string) bool {
		clean := strings.Trim(strings.TrimSpace(value), `"'.,;:()[]{}<>`)
		if clean == "" {
			return false
		}
		key := strings.ToLower(clean)
		if _, exists := seen[key]; exists {
			return false
		}
		seen[key] = struct{}{}
		merged = append(merged, clean)
		return limit > 0 && len(merged) >= limit
	}
	for _, value := range primary {
		if appendValue(value) {
			return merged
		}
	}
	for _, value := range secondary {
		if appendValue(value) {
			return merged
		}
	}
	return merged
}

func mergeStoredAndExtractedIDs(record storedMobileLogMetadata, content string) ([]string, []string, []string, []string) {
	if content == "" {
		return record.TraceIDs, record.WorkgroupIDs, nil, nil
	}
	extractedTraceIDs, extractedWorkgroupIDs, extractedTaskIDs, extractedDispatchRunIDs := extractTraceAndWorkgroupIDs(content)
	traceIDs := mergeLogIDs(record.TraceIDs, extractedTraceIDs, 20)
	workgroupIDs := mergeLogIDs(record.WorkgroupIDs, extractedWorkgroupIDs, 20)
	taskIDs := mergeLogIDs(nil, extractedTaskIDs, 50)
	dispatchRunIDs := mergeLogIDs(nil, extractedDispatchRunIDs, 50)
	return traceIDs, workgroupIDs, taskIDs, dispatchRunIDs
}

func resolveStoredMobileLogIDs(storageDir string, record storedMobileLogMetadata) ([]string, []string, []string, []string) {
	if len(record.TraceIDs) > 0 && len(record.WorkgroupIDs) > 0 {
		content, err := readStoredMobileLogContent(storageDir, record)
		if err != nil {
			return record.TraceIDs, record.WorkgroupIDs, nil, nil
		}
		return mergeStoredAndExtractedIDs(record, content)
	}
	content, err := readStoredMobileLogContent(storageDir, record)
	if err != nil {
		return record.TraceIDs, record.WorkgroupIDs, nil, nil
	}
	return mergeStoredAndExtractedIDs(record, content)
}

func containsNormalizedID(values []string, target string) bool {
	needle := strings.ToLower(strings.TrimSpace(target))
	if needle == "" {
		return true
	}
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), needle) {
			return true
		}
	}
	return false
}

func containsSignalCode(signals []mobileLogSignal, target string) bool {
	needle := strings.ToLower(strings.TrimSpace(target))
	if needle == "" {
		return true
	}
	for _, signal := range signals {
		if strings.EqualFold(strings.TrimSpace(signal.Code), needle) {
			return true
		}
	}
	return false
}

func limitOverviewBuckets(values map[string]*mobileLogOverviewBucket, limit int) []mobileLogOverviewBucket {
	items := make([]mobileLogOverviewBucket, 0, len(values))
	for _, value := range values {
		if value == nil || strings.TrimSpace(value.Value) == "" {
			continue
		}
		items = append(items, *value)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].LogCount == items[j].LogCount {
			if items[i].SignalCount == items[j].SignalCount {
				if items[i].ErrorCount == items[j].ErrorCount {
					return items[i].Value < items[j].Value
				}
				return items[i].ErrorCount > items[j].ErrorCount
			}
			return items[i].SignalCount > items[j].SignalCount
		}
		return items[i].LogCount > items[j].LogCount
	})
	if limit > 0 && len(items) > limit {
		return items[:limit]
	}
	return items
}

func mergeExampleLists(limit int, groups ...[]string) []string {
	if limit <= 0 {
		limit = 3
	}
	seen := make(map[string]struct{}, limit)
	merged := make([]string, 0, limit)
	for _, group := range groups {
		for _, value := range group {
			clean := strings.TrimSpace(value)
			if clean == "" {
				continue
			}
			if _, exists := seen[clean]; exists {
				continue
			}
			seen[clean] = struct{}{}
			merged = append(merged, clean)
			if len(merged) >= limit {
				return merged
			}
		}
	}
	return merged
}

func signalPriority(code string) int {
	switch strings.TrimSpace(code) {
	case "android_manual_reconnect_likely", "desktop_resume_catchup_stalled":
		return 300
	case "foreground_recovery_follow_up_gaps", "post_auth_sync_incomplete", "desktop_catalog_refresh_gaps", "desktop_remote_snapshot_gaps":
		return 250
	case "auth_recovery_failures", "desktop_auth_recovery_failures", "websocket_failures", "session_sync_failures":
		return 200
	case "project_sync_gap_recovery", "workgroup_sync_failures", "send_ack_retry_loops", "desktop_relay_recovery_loops", "desktop_dispatch_breaks":
		return 160
	default:
		return 100
	}
}

func buildDesktopRecoveryPanels(
	authFailureCount int,
	authExamples []string,
	followUpRefreshCount int,
	projectCatalogUpdatedCount int,
	workgroupCatalogRefreshCount int,
	workgroupCatalogUpdatedCount int,
	catalogRefreshFailureCount int,
	catalogExamples []string,
	activeProjectSyncRequestedCount int,
	remoteSessionSnapshotCount int,
	activeProjectSyncExamples []string,
	remoteSessionSnapshotExamples []string,
) []mobileLogRecoveryPanel {
	if authFailureCount == 0 &&
		followUpRefreshCount == 0 &&
		projectCatalogUpdatedCount == 0 &&
		workgroupCatalogRefreshCount == 0 &&
		workgroupCatalogUpdatedCount == 0 &&
		catalogRefreshFailureCount == 0 &&
		activeProjectSyncRequestedCount == 0 &&
		remoteSessionSnapshotCount == 0 {
		return nil
	}

	authStatus := "healthy"
	authSummary := "No auth recovery failure was detected in this log window."
	authSignalCode := ""
	authExamplesOut := []string(nil)
	if authFailureCount > 0 {
		authStatus = "critical"
		authSummary = fmt.Sprintf("Credential refresh failed %d time(s) during controller relay recovery.", authFailureCount)
		authSignalCode = "desktop_auth_recovery_failures"
		authExamplesOut = authExamples
	} else if followUpRefreshCount > 0 || activeProjectSyncRequestedCount > 0 {
		authSummary = "The desktop progressed past auth recovery and reached later follow-up stages."
	}

	catalogStatus := "idle"
	catalogSummary := "No follow-up catalog refresh was observed in this log window."
	catalogSignalCode := ""
	catalogExamplesOut := []string(nil)
	if followUpRefreshCount > 0 || projectCatalogUpdatedCount > 0 || workgroupCatalogRefreshCount > 0 || workgroupCatalogUpdatedCount > 0 || catalogRefreshFailureCount > 0 {
		catalogStatus = "healthy"
		catalogSummary = fmt.Sprintf("Follow-up refresh=%d, project catalog updates=%d, workgroup refresh=%d, workgroup updates=%d.", followUpRefreshCount, projectCatalogUpdatedCount, workgroupCatalogRefreshCount, workgroupCatalogUpdatedCount)
		if catalogRefreshFailureCount > 0 || projectCatalogUpdatedCount == 0 || workgroupCatalogRefreshCount == 0 || workgroupCatalogUpdatedCount == 0 {
			catalogStatus = "warning"
			catalogSignalCode = "desktop_catalog_refresh_gaps"
			catalogExamplesOut = catalogExamples
			catalogSummary = fmt.Sprintf("Follow-up refresh started %d time(s), but catalog rebuild did not settle cleanly.", followUpRefreshCount)
		}
	}

	snapshotStatus := "idle"
	snapshotSummary := "No active project sync request was observed in this log window."
	snapshotSignalCode := ""
	snapshotExamplesOut := []string(nil)
	if activeProjectSyncRequestedCount > 0 || remoteSessionSnapshotCount > 0 {
		snapshotStatus = "healthy"
		snapshotSummary = fmt.Sprintf("Active sync requests=%d, remote snapshots=%d.", activeProjectSyncRequestedCount, remoteSessionSnapshotCount)
		if activeProjectSyncRequestedCount > remoteSessionSnapshotCount {
			snapshotStatus = "warning"
			snapshotSignalCode = "desktop_remote_snapshot_gaps"
			snapshotExamplesOut = mergeExampleLists(4, activeProjectSyncExamples, remoteSessionSnapshotExamples)
			snapshotSummary = fmt.Sprintf("Requested %d active project sync(s), but only %d remote snapshot update(s) landed.", activeProjectSyncRequestedCount, remoteSessionSnapshotCount)
		}
	}

	return []mobileLogRecoveryPanel{
		{
			Key:            "desktop_auth_recovery",
			Title:          "1. Auth Recovery",
			Status:         authStatus,
			Summary:        authSummary,
			Recommendation: "Check controller token refresh and relay re-auth first. If this stage is not healthy, later catalog and snapshot signals are downstream symptoms.",
			SignalCode:     authSignalCode,
			Examples:       authExamplesOut,
		},
		{
			Key:            "desktop_catalog_refresh",
			Title:          "2. Catalog Refresh",
			Status:         catalogStatus,
			Summary:        catalogSummary,
			Recommendation: "Confirm follow-up refresh leads to both project catalog and workgroup catalog updates before you debug missing chats.",
			SignalCode:     catalogSignalCode,
			Examples:       catalogExamplesOut,
		},
		{
			Key:            "desktop_active_snapshot",
			Title:          "3. Active Snapshot",
			Status:         snapshotStatus,
			Summary:        snapshotSummary,
			Recommendation: "Compare active project sync requests with later remote session snapshot updates. Missing snapshots usually explain why transport looked healthy but the visible conversation stayed stale.",
			SignalCode:     snapshotSignalCode,
			Examples:       snapshotExamplesOut,
		},
	}
}

func buildAndroidRecoveryPanels(
	authFailureCount int,
	authExamples []string,
	foregroundRecoveryPassCount int,
	foregroundSessionCatalogCount int,
	foregroundProjectSyncRequestedCount int,
	foregroundWorkgroupRefreshCount int,
	foregroundProjectSyncSkippedCount int,
	foregroundRecoveryFailureCount int,
	foregroundRecoveryExamples []string,
	postAuthSyncStartCount int,
	postAuthSessionCatalogCount int,
	postAuthProjectSyncRequestedCount int,
	postAuthWorkgroupRefreshCount int,
	postAuthSyncFailureCount int,
	postAuthSyncExamples []string,
) []mobileLogRecoveryPanel {
	if authFailureCount == 0 &&
		foregroundRecoveryPassCount == 0 &&
		foregroundSessionCatalogCount == 0 &&
		foregroundProjectSyncRequestedCount == 0 &&
		foregroundWorkgroupRefreshCount == 0 &&
		foregroundProjectSyncSkippedCount == 0 &&
		foregroundRecoveryFailureCount == 0 &&
		postAuthSyncStartCount == 0 &&
		postAuthSessionCatalogCount == 0 &&
		postAuthProjectSyncRequestedCount == 0 &&
		postAuthWorkgroupRefreshCount == 0 &&
		postAuthSyncFailureCount == 0 {
		return nil
	}

	authStatus := "healthy"
	authSummary := "No auth recovery failure was detected in this log window."
	authSignalCode := ""
	authExamplesOut := []string(nil)
	if authFailureCount > 0 {
		authStatus = "critical"
		authSummary = fmt.Sprintf("Mobile token refresh failed %d time(s) during resume recovery.", authFailureCount)
		authSignalCode = "auth_recovery_failures"
		authExamplesOut = authExamples
	} else if foregroundRecoveryPassCount > 0 || postAuthSyncStartCount > 0 {
		authSummary = "The app progressed past auth recovery and reached later catch-up stages."
	}

	catalogStatus := "idle"
	catalogSummary := "No foreground session catalog refresh was observed in this log window."
	catalogSignalCode := ""
	catalogExamplesOut := []string(nil)
	if foregroundRecoveryPassCount > 0 || foregroundSessionCatalogCount > 0 || foregroundRecoveryFailureCount > 0 {
		catalogStatus = "healthy"
		catalogSummary = fmt.Sprintf("Foreground recovery passes=%d, session catalog refreshes=%d.", foregroundRecoveryPassCount, foregroundSessionCatalogCount)
		if foregroundRecoveryFailureCount > 0 || foregroundSessionCatalogCount < foregroundRecoveryPassCount {
			catalogStatus = "warning"
			catalogSignalCode = "foreground_recovery_follow_up_gaps"
			catalogExamplesOut = foregroundRecoveryExamples
			catalogSummary = fmt.Sprintf("Foreground recovery ran %d time(s), but catalog refresh only completed %d time(s).", foregroundRecoveryPassCount, foregroundSessionCatalogCount)
		}
	}

	projectSyncStatus := "idle"
	projectSyncSummary := "No Android project sync request was observed in this log window."
	projectSyncSignalCode := ""
	projectSyncExamplesOut := []string(nil)
	if foregroundProjectSyncRequestedCount > 0 || foregroundProjectSyncSkippedCount > 0 || postAuthProjectSyncRequestedCount > 0 || postAuthSyncFailureCount > 0 {
		projectSyncStatus = "healthy"
		projectSyncSummary = fmt.Sprintf("Foreground project syncs=%d, post-auth project syncs=%d.", foregroundProjectSyncRequestedCount, postAuthProjectSyncRequestedCount)
		if foregroundProjectSyncSkippedCount > 0 || postAuthSyncFailureCount > 0 || (postAuthSyncStartCount > 0 && postAuthProjectSyncRequestedCount < postAuthSyncStartCount) {
			projectSyncStatus = "warning"
			projectSyncSignalCode = "post_auth_sync_incomplete"
			projectSyncExamplesOut = mergeExampleLists(4, foregroundRecoveryExamples, postAuthSyncExamples)
			projectSyncSummary = fmt.Sprintf("Project sync requests did not settle cleanly. foreground skipped=%d, post-auth failures=%d.", foregroundProjectSyncSkippedCount, postAuthSyncFailureCount)
		}
	}

	workgroupStatus := "idle"
	workgroupSummary := "No Android workgroup refresh was observed in this log window."
	workgroupSignalCode := ""
	workgroupExamplesOut := []string(nil)
	if foregroundWorkgroupRefreshCount > 0 || postAuthWorkgroupRefreshCount > 0 || foregroundRecoveryPassCount > 0 || postAuthSyncStartCount > 0 {
		workgroupStatus = "healthy"
		workgroupSummary = fmt.Sprintf("Foreground workgroup refreshes=%d, post-auth workgroup refreshes=%d.", foregroundWorkgroupRefreshCount, postAuthWorkgroupRefreshCount)
		if (foregroundRecoveryPassCount > 0 && foregroundWorkgroupRefreshCount == 0) || (postAuthSyncStartCount > 0 && postAuthWorkgroupRefreshCount < postAuthSyncStartCount) {
			workgroupStatus = "warning"
			workgroupSignalCode = "foreground_recovery_follow_up_gaps"
			workgroupExamplesOut = mergeExampleLists(4, foregroundRecoveryExamples, postAuthSyncExamples)
			workgroupSummary = "Workgroup refresh did not keep pace with resume/post-auth recovery."
		}
	}

	return []mobileLogRecoveryPanel{
		{
			Key:            "android_auth_recovery",
			Title:          "Android 1. Auth Recovery",
			Status:         authStatus,
			Summary:        authSummary,
			Recommendation: "Start with token refresh and relay re-auth. If auth is unhealthy, later catalog and sync panels are secondary symptoms.",
			SignalCode:     authSignalCode,
			Examples:       authExamplesOut,
		},
		{
			Key:            "android_foreground_catalog",
			Title:          "Android 2. Foreground Catalog",
			Status:         catalogStatus,
			Summary:        catalogSummary,
			Recommendation: "Confirm each foreground recovery pass is followed by a session catalog refresh before judging message freshness.",
			SignalCode:     catalogSignalCode,
			Examples:       catalogExamplesOut,
		},
		{
			Key:            "android_project_sync",
			Title:          "Android 3. Project Sync",
			Status:         projectSyncStatus,
			Summary:        projectSyncSummary,
			Recommendation: "Check whether foreground or post-auth recovery actually requested project syncs, rather than only restoring the transport.",
			SignalCode:     projectSyncSignalCode,
			Examples:       projectSyncExamplesOut,
		},
		{
			Key:            "android_workgroup_refresh",
			Title:          "Android 4. Workgroup Refresh",
			Status:         workgroupStatus,
			Summary:        workgroupSummary,
			Recommendation: "If workgroup refresh stays behind resume recovery, collaboration messages often look stale even when project chat appears connected.",
			SignalCode:     workgroupSignalCode,
			Examples:       workgroupExamplesOut,
		},
	}
}

func recoveryPanelKeyPriority(key string) int {
	switch strings.TrimSpace(key) {
	case "android_auth_recovery":
		return 1
	case "android_foreground_catalog":
		return 2
	case "android_project_sync":
		return 3
	case "android_workgroup_refresh":
		return 4
	case "desktop_auth_recovery":
		return 11
	case "desktop_catalog_refresh":
		return 12
	case "desktop_active_snapshot":
		return 13
	default:
		return 100
	}
}

var (
	traceIDPattern       = regexp.MustCompile(`(?i)(?:trace[_-]?id["=: ]+|traceId["=: ]+)([a-z0-9:-]{6,})`)
	workgroupIDPattern   = regexp.MustCompile(`(?i)(?:workgroup[_-]?id["=: ]+|workgroupId["=: ]+)([a-z0-9._:-]{3,})`)
	taskIDPattern        = regexp.MustCompile(`(?i)(?:task[_-]?id["=: ]+|taskId["=: ]+)([a-z0-9._:-]{3,})`)
	dispatchRunIDPattern = regexp.MustCompile(`(?i)(?:dispatch[_-]?run[_-]?id["=: ]+|dispatchRunId["=: ]+|run[_-]?id["=: ]+|runId["=: ]+)([a-z0-9._:-]{3,})`)
)

func extractTraceAndWorkgroupIDs(content string) ([]string, []string, []string, []string) {
	traceIDs := collectUniqueMatches(traceIDPattern, content)
	workgroupIDs := collectUniqueMatches(workgroupIDPattern, content)
	taskIDs := collectUniqueMatches(taskIDPattern, content)
	dispatchRunIDs := collectUniqueMatches(dispatchRunIDPattern, content)
	return traceIDs, workgroupIDs, taskIDs, dispatchRunIDs
}

func collectUniqueMatches(pattern *regexp.Regexp, content string) []string {
	matches := pattern.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(matches))
	values := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		value := strings.Trim(strings.TrimSpace(match[1]), `"'.,;:()[]{}<>`)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	sort.Strings(values)
	return values
}

func extractTaskID(content string) string {
	match := taskIDPattern.FindStringSubmatch(content)
	if len(match) < 2 {
		return ""
	}
	return strings.Trim(strings.TrimSpace(match[1]), `"'.,;:()[]{}<>`)
}

func classifyWorkgroupSchedulerFailure(lowerLine string) string {
	switch {
	case strings.Contains(lowerLine, "task has no assignee"),
		strings.Contains(lowerLine, "assignee not found"),
		strings.Contains(lowerLine, "assignee is not bound to an available project"),
		strings.Contains(lowerLine, "assigned project is unavailable"),
		strings.Contains(lowerLine, "workgroup not found"),
		strings.Contains(lowerLine, "task not found"):
		return "config"
	case strings.Contains(lowerLine, "task is already dispatched"),
		strings.Contains(lowerLine, "already running"),
		strings.Contains(lowerLine, "already assigned"):
		return "blocked"
	case strings.Contains(lowerLine, "remote project is offline"),
		strings.Contains(lowerLine, "no eligible member"),
		strings.Contains(lowerLine, "no member accepted"):
		return "member_unavailable"
	case strings.Contains(lowerLine, "remote dispatch failed"),
		strings.Contains(lowerLine, "local dispatch failed"),
		strings.Contains(lowerLine, "dispatch failed"):
		return "dispatch"
	default:
		return ""
	}
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

const mobileLogsAdminHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mobile Logs</title>
<style>
  :root {
    --bg: #f4f0e8;
    --surface: rgba(255,252,248,0.9);
    --border: rgba(111,87,55,0.16);
    --text: #1f1a14;
    --muted: #74695b;
    --accent: #0f6a5b;
    --shadow: 0 18px 50px rgba(78,56,31,0.12);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 22px;
    font: 14px/1.5 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--text);
    background:
      radial-gradient(circle at top left, rgba(16,106,90,0.12), transparent 30%),
      linear-gradient(160deg, #f4f0e8, #efe5d7);
  }
  .shell {
    max-width: 1360px;
    margin: 0 auto;
    background: rgba(255,252,248,0.78);
    border: 1px solid rgba(111,87,55,0.12);
    border-radius: 28px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    padding: 22px 26px;
    background: rgba(255,252,248,0.95);
    border-bottom: 1px solid rgba(111,87,55,0.10);
  }
  .topbar p { margin: 4px 0 0; color: var(--muted); }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .filters {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 14px;
  }
  .filters input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid rgba(111,87,55,0.16);
    background: rgba(255,255,255,0.72);
    font: inherit;
    color: var(--text);
  }
  .btn, button {
    border: 0;
    border-radius: 999px;
    padding: 10px 16px;
    cursor: pointer;
    font: inherit;
    text-decoration: none;
  }
  .ghost {
    background: rgba(255,255,255,0.72);
    border: 1px solid rgba(111,87,55,0.16);
    color: var(--text);
  }
  .primary {
    background: linear-gradient(135deg, var(--accent), #16826f);
    color: #fff;
  }
  .content {
    display: grid;
    grid-template-columns: 360px minmax(0, 1fr);
    gap: 18px;
    padding: 22px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 22px;
    box-shadow: var(--shadow);
  }
  .list-panel { padding: 18px; }
  .detail-panel { padding: 18px; display: grid; gap: 14px; }
  .list {
    display: grid;
    gap: 10px;
    max-height: 72vh;
    overflow: auto;
  }
  .item {
    width: 100%;
    text-align: left;
    background: rgba(255,255,255,0.7);
    border: 1px solid rgba(111,87,55,0.12);
    border-radius: 16px;
    padding: 14px;
    cursor: pointer;
  }
  .item.active {
    border-color: rgba(15,106,91,0.35);
    background: rgba(214,241,235,0.78);
  }
  .muted { color: var(--muted); }
  .mono {
    font-family: "SF Mono", "Consolas", monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
  }
  .meta-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .pane {
    background: rgba(255,255,255,0.7);
    border: 1px solid rgba(111,87,55,0.12);
    border-radius: 18px;
    padding: 14px;
  }
  .signal {
    border-left: 3px solid rgba(15,106,91,0.5);
    padding-left: 12px;
    margin-bottom: 12px;
  }
  .panel-grid {
    display: grid;
    gap: 10px;
    margin-top: 10px;
  }
  .recovery-panel {
    border: 1px solid rgba(111,87,55,0.12);
    border-radius: 16px;
    padding: 12px;
    background: rgba(255,255,255,0.74);
  }
  .recovery-panel.healthy {
    border-color: rgba(15,106,91,0.25);
    background: rgba(226,245,239,0.72);
  }
  .recovery-panel.warning {
    border-color: rgba(190,124,42,0.28);
    background: rgba(253,244,224,0.78);
  }
  .recovery-panel.critical {
    border-color: rgba(176,70,70,0.3);
    background: rgba(252,236,233,0.82);
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: rgba(255,255,255,0.8);
    border: 1px solid rgba(111,87,55,0.12);
  }
  .status-pill.online {
    color: var(--accent);
    border-color: rgba(15,106,91,0.22);
    background: rgba(226,245,239,0.82);
  }
  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }
  .stat-card {
    background: rgba(255,255,255,0.72);
    border: 1px solid rgba(111,87,55,0.12);
    border-radius: 16px;
    padding: 12px;
  }
  .stat-card strong {
    display: block;
    font-size: 20px;
    line-height: 1.1;
    margin-top: 4px;
  }
  .overview-list {
    display: grid;
    gap: 8px;
    margin-top: 8px;
  }
  .overview-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(255,255,255,0.72);
    border: 1px solid rgba(111,87,55,0.12);
  }
  .overview-row .meta {
    font-size: 12px;
    color: var(--muted);
  }
  .chip {
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid rgba(111,87,55,0.16);
    background: rgba(255,255,255,0.72);
    font-size: 12px;
  }
  .chip.actionable {
    cursor: pointer;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .toolbar-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .inline-link {
    color: var(--accent);
    text-decoration: none;
    font-size: 12px;
  }
  .inline-link:hover {
    text-decoration: underline;
  }
  .empty {
    padding: 28px 16px;
    text-align: center;
    color: var(--muted);
  }
  @media (max-width: 980px) {
    body { padding: 10px; }
    .content { grid-template-columns: 1fr; padding: 16px; }
    .meta-grid { grid-template-columns: 1fr; }
    .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .topbar { flex-direction: column; align-items: flex-start; }
    .filters { grid-template-columns: 1fr; width: 100%; }
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div>
        <h1>Device Logs</h1>
        <p>Uploaded Android and desktop logs can be filtered by text, source, trace_id, workgroup_id, task_id, and dispatch_run_id for faster diagnosis.</p>
        <div class="filters">
          <input type="text" id="queryInput" placeholder="Search text, device, user, or error">
          <select id="sourceInput">
            <option value="">All sources</option>
            <option value="android">Android</option>
            <option value="desktop">Desktop</option>
          </select>
          <input type="text" id="traceInput" placeholder="Filter by trace_id">
          <input type="text" id="workgroupInput" placeholder="Filter by workgroup_id">
          <input type="text" id="taskInput" placeholder="Filter by task_id">
          <input type="text" id="dispatchRunInput" placeholder="Filter by dispatch_run_id">
        </div>
      </div>
      <div class="actions">
        <a class="btn ghost" href="/admin">Back to Admin</a>
        <button class="btn ghost" type="button" id="clearFiltersBtn">Clear Filters</button>
        <button class="btn ghost" type="button" id="copyLinkBtn">Copy Link</button>
        <button class="btn primary" type="button" id="refreshBtn">Refresh</button>
      </div>
    </div>
    <div class="content">
      <section class="card list-panel">
        <h2 style="margin:0 0 6px;">Uploaded Logs</h2>
        <p class="muted" style="margin:0 0 14px;">Newest first. Source, trace, and workgroup chips help pivot quickly.</p>
        <div id="activeFilters"></div>
        <div class="list" id="logList"></div>
      </section>
      <section class="card detail-panel">
        <div>
          <h2 style="margin:0 0 6px;">Details</h2>
          <p class="muted" style="margin:0;">Metadata, extracted identifiers, automated analysis, and raw log content are shown together.</p>
        </div>
        <div class="pane" id="overviewPane"><div class="empty">Loading current filter overview.</div></div>
        <div class="pane" id="metaPane"><div class="empty">Select a log from the left list.</div></div>
        <div class="pane" id="analysisPane"></div>
        <div class="pane"><div class="mono" id="contentPane">No log selected.</div></div>
      </section>
    </div>
  </div>
<script>
const state = {
  logs: [],
  selectedId: "",
  detail: null,
  analysis: null,
  overview: null,
  filters: {
    q: "",
    source: "",
    signal_code: "",
    trace_id: "",
    workgroup_id: "",
    task_id: "",
    dispatch_run_id: "",
    agent_state: "",
    controller_state: "",
    host: "",
    platform: "",
  },
};

async function api(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(await response.text() || ("HTTP " + response.status));
  }
  return response.json();
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(2) + " MB";
}

function buildListUrl() {
  const params = new URLSearchParams();
  if (state.filters.q) params.set("q", state.filters.q);
  if (state.filters.source) params.set("source", state.filters.source);
  if (state.filters.signal_code) params.set("signal_code", state.filters.signal_code);
  if (state.filters.trace_id) params.set("trace_id", state.filters.trace_id);
  if (state.filters.workgroup_id) params.set("workgroup_id", state.filters.workgroup_id);
  if (state.filters.task_id) params.set("task_id", state.filters.task_id);
  if (state.filters.dispatch_run_id) params.set("dispatch_run_id", state.filters.dispatch_run_id);
  if (state.filters.agent_state) params.set("agent_state", state.filters.agent_state);
  if (state.filters.controller_state) params.set("controller_state", state.filters.controller_state);
  if (state.filters.host) params.set("host", state.filters.host);
  if (state.filters.platform) params.set("platform", state.filters.platform);
  const query = params.toString();
  return "/admin/api/mobile-logs" + (query ? ("?" + query) : "");
}

function buildOverviewUrl() {
  const params = new URLSearchParams();
  if (state.filters.q) params.set("q", state.filters.q);
  if (state.filters.source) params.set("source", state.filters.source);
  if (state.filters.signal_code) params.set("signal_code", state.filters.signal_code);
  if (state.filters.trace_id) params.set("trace_id", state.filters.trace_id);
  if (state.filters.workgroup_id) params.set("workgroup_id", state.filters.workgroup_id);
  if (state.filters.task_id) params.set("task_id", state.filters.task_id);
  if (state.filters.dispatch_run_id) params.set("dispatch_run_id", state.filters.dispatch_run_id);
  if (state.filters.agent_state) params.set("agent_state", state.filters.agent_state);
  if (state.filters.controller_state) params.set("controller_state", state.filters.controller_state);
  if (state.filters.host) params.set("host", state.filters.host);
  if (state.filters.platform) params.set("platform", state.filters.platform);
  const query = params.toString();
  return "/admin/api/mobile-logs/overview" + (query ? ("?" + query) : "");
}

function buildPageUrl(overrides = {}) {
  const params = new URLSearchParams();
  const filters = Object.assign({}, state.filters, overrides.filters || {});
  if (filters.q) params.set("q", filters.q);
  if (filters.source) params.set("source", filters.source);
  if (filters.signal_code) params.set("signal_code", filters.signal_code);
  if (filters.trace_id) params.set("trace_id", filters.trace_id);
  if (filters.workgroup_id) params.set("workgroup_id", filters.workgroup_id);
  if (filters.task_id) params.set("task_id", filters.task_id);
  if (filters.dispatch_run_id) params.set("dispatch_run_id", filters.dispatch_run_id);
  if (filters.agent_state) params.set("agent_state", filters.agent_state);
  if (filters.controller_state) params.set("controller_state", filters.controller_state);
  if (filters.host) params.set("host", filters.host);
  if (filters.platform) params.set("platform", filters.platform);
  const selectedId = overrides.selectedId !== undefined ? overrides.selectedId : state.selectedId;
  if (selectedId) params.set("log_id", selectedId);
  const query = params.toString();
  return "/admin/mobile-logs" + (query ? ("?" + query) : "");
}

function syncInputsFromState() {
  document.getElementById("queryInput").value = state.filters.q || "";
  document.getElementById("sourceInput").value = state.filters.source || "";
  document.getElementById("traceInput").value = state.filters.trace_id || "";
  document.getElementById("workgroupInput").value = state.filters.workgroup_id || "";
  document.getElementById("taskInput").value = state.filters.task_id || "";
  document.getElementById("dispatchRunInput").value = state.filters.dispatch_run_id || "";
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  state.filters.q = params.get("q") || "";
  state.filters.source = params.get("source") || "";
  state.filters.signal_code = params.get("signal_code") || "";
  state.filters.trace_id = params.get("trace_id") || "";
  state.filters.workgroup_id = params.get("workgroup_id") || "";
  state.filters.task_id = params.get("task_id") || "";
  state.filters.dispatch_run_id = params.get("dispatch_run_id") || "";
  state.filters.agent_state = params.get("agent_state") || "";
  state.filters.controller_state = params.get("controller_state") || "";
  state.filters.host = params.get("host") || "";
  state.filters.platform = params.get("platform") || "";
  state.selectedId = params.get("log_id") || "";
  syncInputsFromState();
}

function syncUrlState() {
  const nextUrl = buildPageUrl();
  const currentUrl = window.location.pathname + window.location.search;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function renderChips(values, kind) {
  if (!Array.isArray(values) || values.length === 0) {
    return '<div class="muted">-</div>';
  }
  return '<div class="chips">' + values.map((value) =>
    '<button type="button" class="chip actionable" data-filter-kind="' + esc(kind) + '" data-filter-value="' + esc(value) + '">' + esc(value) + '</button>'
  ).join("") + '</div>';
}

function renderQueryChip(label, value) {
  if (!value) {
    return "";
  }
  return '<button type="button" class="chip actionable" data-query-value="' + esc(value) + '">' + esc(label) + '</button>';
}

function renderSignalChip(label, signal) {
  if (!signal || !signal.code) {
    return "";
  }
  return '<button type="button" class="chip actionable" data-signal-code="' + esc(signal.code) + '">' + esc(label) + '</button>';
}

function applyFilter(kind, value) {
  if (kind === "trace_id") {
    state.filters.trace_id = value;
  } else if (kind === "workgroup_id") {
    state.filters.workgroup_id = value;
  } else if (kind === "task_id") {
    state.filters.task_id = value;
  } else if (kind === "dispatch_run_id") {
    state.filters.dispatch_run_id = value;
  } else if (kind === "agent_state") {
    state.filters.agent_state = value;
  } else if (kind === "controller_state") {
    state.filters.controller_state = value;
  } else if (kind === "host") {
    state.filters.host = value;
  } else if (kind === "platform") {
    state.filters.platform = value;
  }
  syncInputsFromState();
}

function applyQueryFilter(value) {
  state.filters.q = String(value || "").trim();
  syncInputsFromState();
}

function applySignalFilter(value) {
  state.filters.signal_code = String(value || "").trim();
  syncInputsFromState();
}

function bindFilterChipHandlers(root) {
  root.querySelectorAll("[data-filter-kind]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const kind = button.getAttribute("data-filter-kind");
      const value = button.getAttribute("data-filter-value") || "";
      applyFilter(kind, value);
      await refresh();
    });
  });
  root.querySelectorAll("[data-query-value]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const value = button.getAttribute("data-query-value") || "";
      applyQueryFilter(value);
      await refresh();
    });
  });
  root.querySelectorAll("[data-signal-code]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const value = button.getAttribute("data-signal-code") || "";
      applySignalFilter(value);
      await refresh();
    });
  });
}

function renderActiveFilters() {
  const root = document.getElementById("activeFilters");
  const items = [];
  if (state.filters.q) items.push({ label: "q", value: state.filters.q });
  if (state.filters.source) items.push({ label: "source", value: state.filters.source });
  if (state.filters.signal_code) items.push({ label: "signal_code", value: state.filters.signal_code });
  if (state.filters.trace_id) items.push({ label: "trace_id", value: state.filters.trace_id });
  if (state.filters.workgroup_id) items.push({ label: "workgroup_id", value: state.filters.workgroup_id });
  if (state.filters.task_id) items.push({ label: "task_id", value: state.filters.task_id });
  if (state.filters.dispatch_run_id) items.push({ label: "dispatch_run_id", value: state.filters.dispatch_run_id });
  if (state.filters.agent_state) items.push({ label: "agent_state", value: state.filters.agent_state });
  if (state.filters.controller_state) items.push({ label: "controller_state", value: state.filters.controller_state });
  if (state.filters.host) items.push({ label: "host", value: state.filters.host });
  if (state.filters.platform) items.push({ label: "platform", value: state.filters.platform });
  if (items.length === 0) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = '<div class="toolbar"><div><strong>Active Filters</strong>' +
    '<div class="chips">' + items.map((item) =>
      '<span class="chip">' + esc(item.label) + ' = ' + esc(item.value) + '</span>'
    ).join("") + '</div></div>' +
    '<div class="toolbar-actions"><a class="inline-link" href="' + esc(buildPageUrl()) + '">Open Current View</a></div></div>';
}

function renderItemJumpLinks(item) {
  const links = [];
  if (Array.isArray(item.trace_ids) && item.trace_ids[0]) {
    links.push('<button type="button" class="chip actionable" data-filter-kind="trace_id" data-filter-value="' + esc(item.trace_ids[0]) + '">trace_id: ' + esc(item.trace_ids[0]) + '</button>');
  }
  if (Array.isArray(item.workgroup_ids) && item.workgroup_ids[0]) {
    links.push('<button type="button" class="chip actionable" data-filter-kind="workgroup_id" data-filter-value="' + esc(item.workgroup_ids[0]) + '">workgroup_id: ' + esc(item.workgroup_ids[0]) + '</button>');
  }
  if (Array.isArray(item.task_ids) && item.task_ids[0]) {
    links.push('<button type="button" class="chip actionable" data-filter-kind="task_id" data-filter-value="' + esc(item.task_ids[0]) + '">task_id: ' + esc(item.task_ids[0]) + '</button>');
  }
  if (Array.isArray(item.dispatch_run_ids) && item.dispatch_run_ids[0]) {
    links.push('<button type="button" class="chip actionable" data-filter-kind="dispatch_run_id" data-filter-value="' + esc(item.dispatch_run_ids[0]) + '">dispatch_run_id: ' + esc(item.dispatch_run_ids[0]) + '</button>');
  }
  if (links.length === 0) {
    return "";
  }
  return '<div class="chips" style="margin-top:8px;">' + links.join("") + '</div>';
}

function extractLineIdentifiers(line) {
  const source = String(line || "");
  const definitions = [
    { kind: "trace_id", label: "trace_id", patterns: [/trace_id=([^\s]+)/i] },
    { kind: "workgroup_id", label: "workgroup_id", patterns: [/workgroup_id=([^\s]+)/i] },
    { kind: "task_id", label: "task_id", patterns: [/task_id=([^\s]+)/i, /taskId=([^\s]+)/i] },
    { kind: "dispatch_run_id", label: "dispatch_run_id", patterns: [/dispatch_run_id=([^\s]+)/i, /dispatchRunId=([^\s]+)/i] },
  ];
  const results = [];
  definitions.forEach((definition) => {
    for (const pattern of definition.patterns) {
      const match = source.match(pattern);
      if (match && match[1]) {
        results.push({
          kind: definition.kind,
          label: definition.label,
          value: match[1].replace(/["',;:()\[\]{}<>]+$/g, ""),
        });
        break;
      }
    }
  });
  return results;
}

function renderExampleLine(line) {
  const identifiers = extractLineIdentifiers(line);
  const chips = [
    renderQueryChip("Filter Text", line),
    ...identifiers.map((item) =>
      '<button type="button" class="chip actionable" data-filter-kind="' + esc(item.kind) + '" data-filter-value="' + esc(item.value) + '">' + esc(item.label + ": " + item.value) + '</button>'
    ),
  ].filter(Boolean);
  return '<div style="margin-top:8px;">' +
    '<div class="mono">' + esc(line) + '</div>' +
    (chips.length === 0 ? '' : '<div class="chips" style="margin-top:6px;">' + chips.join("") + '</div>') +
    '</div>';
}

function renderExampleBlock(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return '<div class="muted">-</div>';
  }
  return lines.map((line) => renderExampleLine(line)).join("");
}

function renderRecoveryPanels(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  return '<div style="margin-top:12px;"><strong>Recovery Panels</strong><div class="panel-grid">' + items.map((item) => {
    const status = String(item.status || 'idle').toLowerCase();
    const chips = [];
    if (item.signal_code) {
      chips.push(renderSignalChip("Filter Signal", { code: item.signal_code }));
    }
    return '<div class="recovery-panel ' + esc(status) + '">' +
      '<div class="toolbar" style="margin:0 0 6px;"><div><strong>' + esc(item.title || "-") + '</strong></div><div class="status-pill">' + esc(status) + '</div></div>' +
      '<div>' + esc(item.summary || "-") + '</div>' +
      '<div class="muted" style="margin-top:6px;">' + esc(item.recommendation || "") + '</div>' +
      (chips.length === 0 ? '' : '<div class="chips">' + chips.join("") + '</div>') +
      ((Array.isArray(item.examples) && item.examples.length > 0) ? '<div style="margin-top:8px;">' + renderExampleBlock(item.examples) + '</div>' : '') +
      '</div>';
  }).join('') + '</div></div>';
}

function renderOverviewRecoveryPanels(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  return '<div style="margin-top:10px;"><strong>Recovery Health</strong><div class="panel-grid">' + items.map((item) => {
    const status = String(item.status || 'idle').toLowerCase();
    const chips = [];
    if (item.signal_code) {
      chips.push(renderSignalChip("Filter Signal", { code: item.signal_code }));
    }
    chips.push('<span class="chip">logs ' + esc(item.log_count || 0) + '</span>');
    chips.push('<span class="chip">critical ' + esc(item.critical_count || 0) + '</span>');
    chips.push('<span class="chip">warning ' + esc(item.warning_count || 0) + '</span>');
    chips.push('<span class="chip">healthy ' + esc(item.healthy_count || 0) + '</span>');
    return '<div class="recovery-panel ' + esc(status) + '">' +
      '<div class="toolbar" style="margin:0 0 6px;"><div><strong>' + esc(item.title || "-") + '</strong></div><div class="status-pill">' + esc(status) + '</div></div>' +
      '<div>' + esc(item.summary || "-") + '</div>' +
      '<div class="chips">' + chips.join('') + '</div>' +
      '</div>';
  }).join('') + '</div></div>';
}

function renderOverviewPresence(summary, items) {
  const presenceSummary = summary || {};
  const rows = Array.isArray(items) ? items : [];
  if ((presenceSummary.matching_agents || 0) === 0 && (presenceSummary.matching_devices || 0) === 0) {
    return '';
  }
  return '<div style="margin-top:10px;"><strong>Live Presence</strong>' +
    '<div class="chips">' +
      '<span class="chip">agents ' + esc(presenceSummary.online_agents || 0) + '/' + esc(presenceSummary.matching_agents || 0) + ' online</span>' +
      '<span class="chip">devices ' + esc(presenceSummary.online_devices || 0) + '/' + esc(presenceSummary.matching_devices || 0) + ' online</span>' +
    '</div>' +
    (rows.length === 0 ? '' : '<div class="overview-list">' + rows.map((item) =>
      '<div class="overview-row">' +
        '<div><strong>' + esc((item.kind || '-').toUpperCase()) + '</strong> <span class="mono">' + esc(item.id || '-') + '</span><div class="meta" style="margin-top:4px;">user ' + esc(item.username || '-') + ' | source ' + esc((item.source || '-').toUpperCase()) + (item.agent_id ? ' | agent ' + esc(item.agent_id) : '') + '</div></div>' +
        '<div style="text-align:right;"><div class="meta">logs ' + esc(item.log_count || 0) + ' | last ' + esc(item.last_uploaded || '-') + '</div><div class="status-pill ' + (item.online ? 'online' : '') + '">' + esc(item.online ? 'online' : 'offline') + '</div></div>' +
      '</div>'
    ).join('') + '</div>') +
    '</div>';
}

function renderConnectionItemChips(title, items, filterKind) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  return '<div style="margin-top:8px;"><div class="meta-label">' + esc(title) + '</div><div class="chips">' + items.map((item) =>
    (filterKind
      ? '<button type="button" class="chip actionable" data-filter-kind="' + esc(filterKind) + '" data-filter-value="' + esc(item.value || '') + '">' + esc(item.value || '-') + ' ? ' + esc(item.log_count || 0) + '</button>'
      : '<span class="chip">' + esc(item.value || '-') + ' ? ' + esc(item.log_count || 0) + '</span>')
  ).join('') + '</div></div>';
}

function renderOverviewConnection(summary) {
  const connectionSummary = summary || {};
  if (!(connectionSummary.logs_with_connection_notes > 0)) {
    return '';
  }
  return '<div style="margin-top:10px;"><strong>Connection Snapshots</strong>' +
    '<div class="chips">' +
      '<span class="chip">notes ' + esc(connectionSummary.logs_with_connection_notes || 0) + '</span>' +
      '<span class="chip">structured ' + esc(connectionSummary.structured_logs || 0) + '</span>' +
      '<span class="chip">freeform ' + esc(connectionSummary.freeform_logs || 0) + '</span>' +
    '</div>' +
    renderConnectionItemChips("Agent State", connectionSummary.agent_states || [], "agent_state") +
    renderConnectionItemChips("Controller State", connectionSummary.controller_states || [], "controller_state") +
    renderConnectionItemChips("Hosts", connectionSummary.hosts || [], "host") +
    renderConnectionItemChips("Platforms", connectionSummary.platforms || [], "platform") +
    renderConnectionItemChips("Notes", connectionSummary.freeform_notes || []) +
    '</div>';
}

function renderConnectionHotspots(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  return '<div style="margin-top:10px;"><strong>Connection Hotspots</strong><div class="overview-list">' + items.map((item) => {
    const chips = [];
    if (item.agent_state) {
      chips.push('<button type="button" class="chip actionable" data-filter-kind="agent_state" data-filter-value="' + esc(item.agent_state) + '">agent=' + esc(item.agent_state) + '</button>');
    }
    if (item.controller_state) {
      chips.push('<button type="button" class="chip actionable" data-filter-kind="controller_state" data-filter-value="' + esc(item.controller_state) + '">controller=' + esc(item.controller_state) + '</button>');
    }
    if (item.host) {
      chips.push('<button type="button" class="chip actionable" data-filter-kind="host" data-filter-value="' + esc(item.host) + '">host=' + esc(item.host) + '</button>');
    }
    if (item.platform) {
      chips.push('<button type="button" class="chip actionable" data-filter-kind="platform" data-filter-value="' + esc(item.platform) + '">platform=' + esc(item.platform) + '</button>');
    }
    if (item.top_trace_id) {
      chips.push('<button type="button" class="chip actionable" data-filter-kind="trace_id" data-filter-value="' + esc(item.top_trace_id) + '">trace_id=' + esc(item.top_trace_id) + '</button>');
    }
    if (item.top_workgroup_id) {
      chips.push('<button type="button" class="chip actionable" data-filter-kind="workgroup_id" data-filter-value="' + esc(item.top_workgroup_id) + '">workgroup_id=' + esc(item.top_workgroup_id) + '</button>');
    }
    if (item.top_task_id) {
      chips.push('<button type="button" class="chip actionable" data-filter-kind="task_id" data-filter-value="' + esc(item.top_task_id) + '">task_id=' + esc(item.top_task_id) + '</button>');
    }
    if (item.top_dispatch_run_id) {
      chips.push('<button type="button" class="chip actionable" data-filter-kind="dispatch_run_id" data-filter-value="' + esc(item.top_dispatch_run_id) + '">dispatch_run_id=' + esc(item.top_dispatch_run_id) + '</button>');
    }
    const right = [
      '<span class="chip">logs ' + esc(item.log_count || 0) + '</span>',
      '<span class="chip">signals ' + esc(item.logs_with_signals || 0) + '</span>',
      '<span class="chip">critical ' + esc(item.critical_count || 0) + '</span>',
      '<span class="chip">warning ' + esc(item.warning_count || 0) + '</span>',
      renderSignalChip('Top Signal', { code: item.top_signal_code || '' }),
    ].filter(Boolean);
    return '<div class="overview-row">' +
      '<div><div class="chips">' + chips.join('') + '</div>' +
      '<div class="meta" style="margin-top:4px;">' + esc(item.top_signal_title || 'No dominant signal yet') + '</div></div>' +
      '<div class="chips" style="justify-content:flex-end;">' + right.join('') + '</div>' +
      '</div>';
  }).join('') + '</div></div>';
}

function renderOverviewBucketSection(title, items, kind) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div style="margin-top:10px;"><strong>' + esc(title) + '</strong><div class="muted" style="margin-top:6px;">-</div></div>';
  }
  return '<div style="margin-top:10px;"><strong>' + esc(title) + '</strong><div class="overview-list">' + items.map((item) =>
    '<div class="overview-row">' +
      '<div><button type="button" class="chip actionable" data-filter-kind="' + esc(kind) + '" data-filter-value="' + esc(item.value) + '">' + esc(item.value) + '</button></div>' +
      '<div class="meta">logs ' + esc(item.log_count || 0) + ' | signals ' + esc(item.signal_count || 0) + ' | errors ' + esc(item.error_count || 0) + '</div>' +
    '</div>'
  ).join("") + '</div></div>';
}

function renderOverviewSignals(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div class="muted" style="margin-top:6px;">No aggregated signal matched the current filter.</div>';
  }
  return '<div class="overview-list">' + items.map((item) =>
    '<div class="overview-row">' +
      '<div><strong>' + esc(item.title || item.code || "-") + '</strong><div class="meta" style="margin-top:4px;">code: ' + esc(item.code || "-") + '</div></div>' +
      '<div style="text-align:right;"><div class="meta">logs ' + esc(item.log_count || 0) + ' | hits ' + esc(item.total_count || 0) + '</div><div class="chips" style="justify-content:flex-end;">' + renderSignalChip("Filter Signal", item) + '</div></div>' +
    '</div>'
  ).join("") + '</div>';
}

function renderList() {
  const root = document.getElementById("logList");
  if (!Array.isArray(state.logs) || state.logs.length === 0) {
    root.innerHTML = '<div class="empty">No uploaded device logs matched the current filter.</div>';
    return;
  }
  root.innerHTML = state.logs.map((item) => {
    const active = item.id === state.selectedId ? "active" : "";
    return '<div class="item ' + active + '" data-id="' + esc(item.id) + '" role="button" tabindex="0">' +
      '<div><strong>' + esc(item.original_name || item.id) + '</strong></div>' +
      '<div class="muted">User ' + esc(item.username) + ' | Device ' + esc(item.device_id) + '</div>' +
      '<div class="muted">' + esc((item.source || "-").toUpperCase()) + ' | ' + esc(item.app_version || "-") + ' | ' + esc(item.uploaded_at || "-") + '</div>' +
      renderItemJumpLinks(item) +
      '<div class="muted">' + esc(fmtBytes(item.size_bytes)) + '</div>' +
      '</div>';
  }).join("");
  root.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectLog(button.getAttribute("data-id")));
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectLog(button.getAttribute("data-id"));
      }
    });
  });
  bindFilterChipHandlers(root);
}

function renderMeta() {
  const pane = document.getElementById("metaPane");
  if (!state.detail) {
    pane.innerHTML = '<div class="empty">Select a log from the left list.</div>';
    return;
  }
  const meta = state.detail.metadata;
  pane.innerHTML = '<div class="meta-grid">' +
    '<div><div class="meta-label">Log ID</div><div class="mono">' + esc(meta.id) + '</div></div>' +
    '<div><div class="meta-label">Uploaded At</div><div>' + esc(meta.uploaded_at) + '</div></div>' +
    '<div><div class="meta-label">User</div><div>' + esc(meta.username) + ' (#' + esc(meta.user_id) + ')</div></div>' +
    '<div><div class="meta-label">Device</div><div class="mono">' + esc(meta.device_id) + '</div></div>' +
    '<div><div class="meta-label">Agent</div><div class="mono">' + esc(meta.agent_id || "-") + '</div></div>' +
    '<div><div class="meta-label">Source</div><div>' + esc((meta.source || "-").toUpperCase()) + '</div></div>' +
    '<div><div class="meta-label">Connection Note</div><div>' + esc(meta.connection_note || "-") + '</div></div>' +
    '<div><div class="meta-label">Trace IDs</div><div>' + renderChips((state.analysis && state.analysis.trace_ids) || [], "trace_id") + '</div></div>' +
    '<div><div class="meta-label">Workgroup IDs</div><div>' + renderChips((state.analysis && state.analysis.workgroup_ids) || [], "workgroup_id") + '</div></div>' +
    '<div><div class="meta-label">Task IDs</div><div>' + renderChips((state.analysis && state.analysis.task_ids) || [], "task_id") + '</div></div>' +
    '<div><div class="meta-label">Dispatch Run IDs</div><div>' + renderChips((state.analysis && state.analysis.dispatch_run_ids) || [], "dispatch_run_id") + '</div></div>' +
    '<div><div class="meta-label">App Version</div><div>' + esc(meta.app_version || "-") + (meta.app_build ? ' (build ' + esc(meta.app_build) + ')' : '') + '</div></div>' +
    '<div><div class="meta-label">Device Model</div><div>' + esc(meta.device_model || "-") + '</div></div>' +
    '<div><div class="meta-label">Client Time</div><div>' + esc(meta.client_time || "-") + '</div></div>' +
    '<div><div class="meta-label">Original File</div><div>' + esc(meta.original_name) + '</div></div>' +
    '<div><div class="meta-label">Size / SHA256</div><div class="mono">' + esc(fmtBytes(meta.size_bytes)) + '
' + esc(meta.sha256) + '</div></div>' +
    '</div>' +
    '<div class="toolbar" style="margin-top:14px;"><div class="muted">Deep link to the current log and filters.</div><div class="toolbar-actions"><a class="inline-link" href="' + esc(buildPageUrl()) + '">Open Current View</a></div></div>';
}

function renderAnalysis() {
  const pane = document.getElementById("analysisPane");
  if (!state.analysis) {
    pane.innerHTML = '<div class="empty">No analysis loaded.</div>';
    return;
  }
  const signals = Array.isArray(state.analysis.signals) ? state.analysis.signals : [];
  const recoveryPanels = Array.isArray(state.analysis.recovery_panels) ? state.analysis.recovery_panels : [];
  const recentErrors = Array.isArray(state.analysis.recent_errors) ? state.analysis.recent_errors : [];
  pane.innerHTML =
    '<div><strong>Summary</strong><div style="margin-top:6px;">' + esc(state.analysis.summary || "-") + '</div></div>' +
    '<div class="muted" style="margin-top:8px;">Errors: ' + esc(state.analysis.error_count || 0) + ' ? Warnings: ' + esc(state.analysis.warning_count || 0) + '</div>' +
    '<div style="margin-top:8px;"><strong>Trace IDs</strong>' + renderChips(state.analysis.trace_ids || [], "trace_id") + '</div>' +
    '<div style="margin-top:8px;"><strong>Workgroup IDs</strong>' + renderChips(state.analysis.workgroup_ids || [], "workgroup_id") + '</div>' +
    '<div style="margin-top:8px;"><strong>Task IDs</strong>' + renderChips(state.analysis.task_ids || [], "task_id") + '</div>' +
    '<div style="margin-top:8px;"><strong>Dispatch Run IDs</strong>' + renderChips(state.analysis.dispatch_run_ids || [], "dispatch_run_id") + '</div>' +
    renderRecoveryPanels(recoveryPanels) +
    (signals.length === 0 ? '<div class="empty">No high-confidence diagnostic signal matched.</div>' : signals.map((signal) =>
      '<div class="signal">' +
      '<div><strong>' + esc(signal.title) + '</strong> ? ' + esc(signal.count) + '</div>' +
      '<div class="muted" style="margin:4px 0 8px;">' + esc(signal.recommendation) + '</div>' +
      '<div class="chips">' + renderSignalChip("Filter Signal", signal) + '</div>' +
      '<div style="margin-top:6px;">' + renderExampleBlock(signal.examples || []) + '</div>' +
      '</div>'
    ).join("")) +
    (recentErrors.length === 0 ? '' : '<div><strong>Recent Errors</strong><div style="margin-top:6px;">' + renderExampleBlock(recentErrors) + '</div></div>');
}

function renderOverview() {
  const pane = document.getElementById("overviewPane");
  if (!state.overview) {
    pane.innerHTML = '<div class="empty">No overview loaded.</div>';
    return;
  }
  const sourceCounts = Array.isArray(state.overview.source_counts) ? state.overview.source_counts : [];
  pane.innerHTML =
    '<div><strong>Current Filter Overview</strong><div class="muted" style="margin-top:6px;">' + esc(state.overview.summary || "-") + '</div></div>' +
    '<div class="stat-grid">' +
      '<div class="stat-card"><div class="meta-label">Logs</div><strong>' + esc(state.overview.log_count || 0) + '</strong></div>' +
      '<div class="stat-card"><div class="meta-label">Logs With Signals</div><strong>' + esc(state.overview.logs_with_signals || 0) + '</strong></div>' +
      '<div class="stat-card"><div class="meta-label">Errors</div><strong>' + esc(state.overview.error_count || 0) + '</strong></div>' +
      '<div class="stat-card"><div class="meta-label">Warnings</div><strong>' + esc(state.overview.warning_count || 0) + '</strong></div>' +
    '</div>' +
    renderOverviewPresence(state.overview.presence_summary || {}, state.overview.live_presence || []) +
    renderOverviewConnection(state.overview.connection_summary || {}) +
    renderConnectionHotspots((state.overview.connection_summary && state.overview.connection_summary.hotspots) || []) +
    renderOverviewRecoveryPanels(state.overview.recovery_panels || []) +
    '<div style="margin-top:10px;"><strong>Sources</strong>' +
      (sourceCounts.length === 0 ? '<div class="muted" style="margin-top:6px;">-</div>' : '<div class="chips">' + sourceCounts.map((item) =>
        '<span class="chip">' + esc((item.source || "unknown").toUpperCase()) + ' ? ' + esc(item.log_count || 0) + '</span>'
      ).join("") + '</div>') +
    '</div>' +
    '<div style="margin-top:10px;"><strong>Top Signals</strong>' + renderOverviewSignals(state.overview.top_signals || []) + '</div>' +
    renderOverviewBucketSection("Top Trace IDs", state.overview.top_trace_ids || [], "trace_id") +
    renderOverviewBucketSection("Top Workgroup IDs", state.overview.top_workgroup_ids || [], "workgroup_id") +
    renderOverviewBucketSection("Top Task IDs", state.overview.top_task_ids || [], "task_id") +
    renderOverviewBucketSection("Top Dispatch Run IDs", state.overview.top_dispatch_run_ids || [], "dispatch_run_id");
  bindFilterChipHandlers(pane);
}

function renderContent() {
  document.getElementById("contentPane").textContent = state.detail ? (state.detail.content || "") : "No log selected.";
}

async function selectLog(id) {
  state.selectedId = id;
  syncUrlState();
  renderList();
  state.detail = await api('/admin/api/mobile-logs/' + encodeURIComponent(id));
  state.analysis = await api('/admin/api/mobile-logs/' + encodeURIComponent(id) + '/analysis');
  renderMeta();
  renderAnalysis();
  renderContent();
  bindFilterChipHandlers(document);
}

async function refresh() {
  const [logs, overview] = await Promise.all([api(buildListUrl()), api(buildOverviewUrl())]);
  state.logs = logs;
  state.overview = overview;
  if (state.selectedId && !state.logs.some((item) => item.id === state.selectedId)) {
    state.selectedId = "";
  }
  if (!state.selectedId && state.logs.length > 0) {
    state.selectedId = state.logs[0].id;
  }
  syncUrlState();
  renderActiveFilters();
  renderOverview();
  renderList();
  if (state.selectedId) {
    await selectLog(state.selectedId);
  } else {
    state.detail = null;
    state.analysis = null;
    renderOverview();
    renderMeta();
    renderAnalysis();
    renderContent();
  }
}

document.getElementById('refreshBtn').addEventListener('click', () => { void refresh(); });
document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  state.filters = { q: "", source: "", signal_code: "", trace_id: "", workgroup_id: "", task_id: "", dispatch_run_id: "", agent_state: "", controller_state: "", host: "", platform: "" };
  syncInputsFromState();
  void refresh();
});
document.getElementById('copyLinkBtn').addEventListener('click', async () => {
  const absoluteUrl = window.location.origin + buildPageUrl();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(absoluteUrl);
  } else {
    window.prompt("Copy log view link", absoluteUrl);
  }
});
document.getElementById('queryInput').addEventListener('change', (event) => {
  state.filters.q = event.target.value.trim();
  void refresh();
});
document.getElementById('sourceInput').addEventListener('change', (event) => {
  state.filters.source = event.target.value.trim();
  void refresh();
});
document.getElementById('traceInput').addEventListener('change', (event) => {
  state.filters.trace_id = event.target.value.trim();
  void refresh();
});
document.getElementById('workgroupInput').addEventListener('change', (event) => {
  state.filters.workgroup_id = event.target.value.trim();
  void refresh();
});
document.getElementById('taskInput').addEventListener('change', (event) => {
  state.filters.task_id = event.target.value.trim();
  void refresh();
});
document.getElementById('dispatchRunInput').addEventListener('change', (event) => {
  state.filters.dispatch_run_id = event.target.value.trim();
  void refresh();
});
window.addEventListener('popstate', () => {
  loadStateFromUrl();
  void refresh();
});
loadStateFromUrl();
void refresh();
</script>
</body>
</html>`
