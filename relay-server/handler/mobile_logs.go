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
	Summary        string            `json:"summary"`
	ErrorCount     int               `json:"error_count"`
	WarningCount   int               `json:"warning_count"`
	Signals        []mobileLogSignal `json:"signals"`
	RecentErrors   []string          `json:"recent_errors"`
	TraceIDs       []string          `json:"trace_ids,omitempty"`
	WorkgroupIDs   []string          `json:"workgroup_ids,omitempty"`
	TaskIDs        []string          `json:"task_ids,omitempty"`
	DispatchRunIDs []string          `json:"dispatch_run_ids,omitempty"`
}

type mobileLogFilter struct {
	Query         string
	Source        string
	TraceID       string
	WorkgroupID   string
	TaskID        string
	DispatchRunID string
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

func AdminMobileLogsHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
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
			Query:         strings.TrimSpace(r.URL.Query().Get("q")),
			Source:        strings.TrimSpace(r.URL.Query().Get("source")),
			TraceID:       strings.TrimSpace(r.URL.Query().Get("trace_id")),
			WorkgroupID:   strings.TrimSpace(r.URL.Query().Get("workgroup_id")),
			TaskID:        strings.TrimSpace(r.URL.Query().Get("task_id")),
			DispatchRunID: strings.TrimSpace(r.URL.Query().Get("dispatch_run_id")),
		}
		if filter.Query != "" || filter.Source != "" || filter.TraceID != "" || filter.WorkgroupID != "" || filter.TaskID != "" || filter.DispatchRunID != "" {
			records = filterStoredMobileLogs(records, filepath.Join(cfg.DataDir, "mobile-logs"), filter)
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
	if filter.Query == "" && filter.Source == "" && filter.TraceID == "" && filter.WorkgroupID == "" && filter.TaskID == "" && filter.DispatchRunID == "" {
		return records
	}

	query := strings.ToLower(strings.TrimSpace(filter.Query))
	source := strings.ToLower(strings.TrimSpace(filter.Source))
	traceID := strings.ToLower(strings.TrimSpace(filter.TraceID))
	workgroupID := strings.ToLower(strings.TrimSpace(filter.WorkgroupID))
	taskID := strings.ToLower(strings.TrimSpace(filter.TaskID))
	dispatchRunID := strings.ToLower(strings.TrimSpace(filter.DispatchRunID))
	filtered := make([]storedMobileLogMetadata, 0, len(records))

	for _, record := range records {
		var content string
		var err error
		needsContent := query != "" || taskID != "" || dispatchRunID != "" || len(record.TraceIDs) == 0 || len(record.WorkgroupIDs) == 0
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
		filtered = append(filtered, record)
	}

	return filtered
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
		Summary:        summary,
		ErrorCount:     errorCount,
		WarningCount:   warningCount,
		Signals:        signals,
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
  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
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
  .empty {
    padding: 28px 16px;
    text-align: center;
    color: var(--muted);
  }
  @media (max-width: 980px) {
    body { padding: 10px; }
    .content { grid-template-columns: 1fr; padding: 16px; }
    .meta-grid { grid-template-columns: 1fr; }
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
        <button class="btn primary" type="button" id="refreshBtn">Refresh</button>
      </div>
    </div>
    <div class="content">
      <section class="card list-panel">
        <h2 style="margin:0 0 6px;">Uploaded Logs</h2>
        <p class="muted" style="margin:0 0 14px;">Newest first. Source, trace, and workgroup chips help pivot quickly.</p>
        <div class="list" id="logList"></div>
      </section>
      <section class="card detail-panel">
        <div>
          <h2 style="margin:0 0 6px;">Details</h2>
          <p class="muted" style="margin:0;">Metadata, extracted identifiers, automated analysis, and raw log content are shown together.</p>
        </div>
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
  filters: {
    q: "",
    source: "",
    trace_id: "",
    workgroup_id: "",
    task_id: "",
    dispatch_run_id: "",
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
  if (state.filters.trace_id) params.set("trace_id", state.filters.trace_id);
  if (state.filters.workgroup_id) params.set("workgroup_id", state.filters.workgroup_id);
  if (state.filters.task_id) params.set("task_id", state.filters.task_id);
  if (state.filters.dispatch_run_id) params.set("dispatch_run_id", state.filters.dispatch_run_id);
  const query = params.toString();
  return "/admin/api/mobile-logs" + (query ? ("?" + query) : "");
}

function renderChips(values, kind) {
  if (!Array.isArray(values) || values.length === 0) {
    return '<div class="muted">-</div>';
  }
  return '<div class="chips">' + values.map((value) =>
    '<button type="button" class="chip actionable" data-filter-kind="' + esc(kind) + '" data-filter-value="' + esc(value) + '">' + esc(value) + '</button>'
  ).join("") + '</div>';
}

function bindFilterChipHandlers(root) {
  root.querySelectorAll("[data-filter-kind]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.getAttribute("data-filter-kind");
      const value = button.getAttribute("data-filter-value") || "";
      if (kind === "trace_id") {
        state.filters.trace_id = value;
        document.getElementById("traceInput").value = value;
      } else if (kind === "workgroup_id") {
        state.filters.workgroup_id = value;
        document.getElementById("workgroupInput").value = value;
      } else if (kind === "task_id") {
        state.filters.task_id = value;
        document.getElementById("taskInput").value = value;
      } else if (kind === "dispatch_run_id") {
        state.filters.dispatch_run_id = value;
        document.getElementById("dispatchRunInput").value = value;
      }
      await refresh();
    });
  });
}

function renderList() {
  const root = document.getElementById("logList");
  if (!Array.isArray(state.logs) || state.logs.length === 0) {
    root.innerHTML = '<div class="empty">No uploaded device logs matched the current filter.</div>';
    return;
  }
  root.innerHTML = state.logs.map((item) => {
    const active = item.id === state.selectedId ? "active" : "";
    return '<button type="button" class="item ' + active + '" data-id="' + esc(item.id) + '">' +
      '<div><strong>' + esc(item.original_name || item.id) + '</strong></div>' +
      '<div class="muted">User ' + esc(item.username) + ' ? Device ' + esc(item.device_id) + '</div>' +
      '<div class="muted">' + esc((item.source || "-").toUpperCase()) + ' ? ' + esc(item.app_version || "-") + ' ? ' + esc(item.uploaded_at || "-") + '</div>' +
      (Array.isArray(item.trace_ids) && item.trace_ids.length > 0 ? '<div class="muted">trace_id · ' + esc(item.trace_ids[0]) + '</div>' : '') +
      (Array.isArray(item.workgroup_ids) && item.workgroup_ids.length > 0 ? '<div class="muted">workgroup_id · ' + esc(item.workgroup_ids[0]) + '</div>' : '') +
      (Array.isArray(item.task_ids) && item.task_ids.length > 0 ? '<div class="muted">task_id · ' + esc(item.task_ids[0]) + '</div>' : '') +
      (Array.isArray(item.dispatch_run_ids) && item.dispatch_run_ids.length > 0 ? '<div class="muted">dispatch_run_id · ' + esc(item.dispatch_run_ids[0]) + '</div>' : '') +
      '<div class="muted">' + esc(fmtBytes(item.size_bytes)) + '</div>' +
      '</button>';
  }).join("");
  root.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectLog(button.getAttribute("data-id")));
  });
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
    '</div>';
}

function renderAnalysis() {
  const pane = document.getElementById("analysisPane");
  if (!state.analysis) {
    pane.innerHTML = '<div class="empty">No analysis loaded.</div>';
    return;
  }
  const signals = Array.isArray(state.analysis.signals) ? state.analysis.signals : [];
  const recentErrors = Array.isArray(state.analysis.recent_errors) ? state.analysis.recent_errors : [];
  pane.innerHTML =
    '<div><strong>Summary</strong><div style="margin-top:6px;">' + esc(state.analysis.summary || "-") + '</div></div>' +
    '<div class="muted" style="margin-top:8px;">Errors: ' + esc(state.analysis.error_count || 0) + ' ? Warnings: ' + esc(state.analysis.warning_count || 0) + '</div>' +
    '<div style="margin-top:8px;"><strong>Trace IDs</strong>' + renderChips(state.analysis.trace_ids || [], "trace_id") + '</div>' +
    '<div style="margin-top:8px;"><strong>Workgroup IDs</strong>' + renderChips(state.analysis.workgroup_ids || [], "workgroup_id") + '</div>' +
    '<div style="margin-top:8px;"><strong>Task IDs</strong>' + renderChips(state.analysis.task_ids || [], "task_id") + '</div>' +
    '<div style="margin-top:8px;"><strong>Dispatch Run IDs</strong>' + renderChips(state.analysis.dispatch_run_ids || [], "dispatch_run_id") + '</div>' +
    (signals.length === 0 ? '<div class="empty">No high-confidence diagnostic signal matched.</div>' : signals.map((signal) =>
      '<div class="signal">' +
      '<div><strong>' + esc(signal.title) + '</strong> ? ' + esc(signal.count) + '</div>' +
      '<div class="muted" style="margin:4px 0 8px;">' + esc(signal.recommendation) + '</div>' +
      '<div class="mono">' + esc((signal.examples || []).join("
")) + '</div>' +
      '</div>'
    ).join("")) +
    (recentErrors.length === 0 ? '' : '<div><strong>Recent Errors</strong><div class="mono" style="margin-top:6px;">' + esc(recentErrors.join("
")) + '</div></div>');
}

function renderContent() {
  document.getElementById("contentPane").textContent = state.detail ? (state.detail.content || "") : "No log selected.";
}

async function selectLog(id) {
  state.selectedId = id;
  renderList();
  state.detail = await api('/admin/api/mobile-logs/' + encodeURIComponent(id));
  state.analysis = await api('/admin/api/mobile-logs/' + encodeURIComponent(id) + '/analysis');
  renderMeta();
  renderAnalysis();
  renderContent();
  bindFilterChipHandlers(document);
}

async function refresh() {
  state.logs = await api(buildListUrl());
  if (state.selectedId && !state.logs.some((item) => item.id === state.selectedId)) {
    state.selectedId = "";
  }
  if (!state.selectedId && state.logs.length > 0) {
    state.selectedId = state.logs[0].id;
  }
  renderList();
  if (state.selectedId) {
    await selectLog(state.selectedId);
  } else {
    state.detail = null;
    state.analysis = null;
    renderMeta();
    renderAnalysis();
    renderContent();
  }
}

document.getElementById('refreshBtn').addEventListener('click', () => { void refresh(); });
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
void refresh();
</script>
</body>
</html>`
