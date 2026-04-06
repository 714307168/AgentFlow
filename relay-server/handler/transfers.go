package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/model"
)

const (
	maxTransferUploadBytes   int64 = 32 << 20
	defaultTransferListLimit       = 50
	maxTransferListLimit           = 200
)

type transferResponse struct {
	ID             string                    `json:"id"`
	SenderType     string                    `json:"sender_type"`
	SenderAgentID  string                    `json:"sender_agent_id,omitempty"`
	SenderDeviceID string                    `json:"sender_device_id,omitempty"`
	TargetType     string                    `json:"target_type,omitempty"`
	TargetID       string                    `json:"target_id,omitempty"`
	ProjectID      string                    `json:"project_id,omitempty"`
	WorkgroupID    string                    `json:"workgroup_id,omitempty"`
	FileName       string                    `json:"file_name"`
	MimeType       string                    `json:"mime_type"`
	SizeBytes      int64                     `json:"size_bytes"`
	SHA256         string                    `json:"sha256"`
	Status         string                    `json:"status"`
	CreatedAt      string                    `json:"created_at"`
	ExpiresAt      string                    `json:"expires_at,omitempty"`
	DownloadURL    string                    `json:"download_url"`
	Receipts       []transferReceiptResponse `json:"receipts,omitempty"`
}

type transferReceiptResponse struct {
	ID         int64  `json:"id"`
	ClientType string `json:"client_type"`
	AgentID    string `json:"agent_id,omitempty"`
	DeviceID   string `json:"device_id,omitempty"`
	Status     string `json:"status"`
	Note       string `json:"note,omitempty"`
	CreatedAt  string `json:"created_at"`
}

type transferReceiptRequest struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

func TransfersHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := currentClientSession(r, cfg, database)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		trimmedPath := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/transfers"), "/")
		if trimmedPath == "" {
			switch r.Method {
			case http.MethodGet:
				handleTransferList(w, r, session, cfg, database)
				return
			case http.MethodPost:
				handleTransferCreate(w, r, session, cfg, database)
				return
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
		}

		parts := strings.Split(trimmedPath, "/")
		transferID := strings.TrimSpace(parts[0])
		if transferID == "" {
			http.NotFound(w, r)
			return
		}

		if len(parts) == 1 {
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			handleTransferDetail(w, r, session, cfg, database, transferID)
			return
		}

		switch parts[1] {
		case "download":
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			handleTransferDownload(w, r, session, database, transferID)
			return
		case "receipts":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			handleTransferReceiptCreate(w, r, session, database, transferID)
			return
		default:
			http.NotFound(w, r)
			return
		}
	}
}

func handleTransferList(w http.ResponseWriter, r *http.Request, session *clientSession, cfg *config.Config, database *db.DB) {
	limit := defaultTransferListLimit
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if limit > maxTransferListLimit {
		limit = maxTransferListLimit
	}

	items, err := database.ListTransfersForUser(session.User.ID, limit)
	if err != nil {
		http.Error(w, "failed to list transfers", http.StatusInternalServerError)
		return
	}

	response := make([]transferResponse, 0, len(items))
	for _, item := range items {
		response = append(response, buildTransferResponse(r, item, nil))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func handleTransferCreate(w http.ResponseWriter, r *http.Request, session *clientSession, cfg *config.Config, database *db.DB) {
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, maxTransferUploadBytes+(2<<20))
	}
	if err := r.ParseMultipartForm(maxTransferUploadBytes + (1 << 20)); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "too large") {
			http.Error(w, "upload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid multipart form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	targetType, ok := normalizeTransferTargetType(r.FormValue("target_type"))
	if !ok {
		http.Error(w, "unsupported target_type", http.StatusBadRequest)
		return
	}
	targetID := strings.TrimSpace(r.FormValue("target_id"))
	if targetType != "" && targetID == "" {
		http.Error(w, "target_id is required when target_type is set", http.StatusBadRequest)
		return
	}

	projectID := strings.TrimSpace(r.FormValue("project_id"))
	workgroupID := strings.TrimSpace(r.FormValue("workgroup_id"))
	fileName := sanitizeTransferFileName(header.Filename)
	if fileName == "" {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	mimeType := strings.TrimSpace(r.FormValue("mime_type"))
	if mimeType == "" {
		mimeType = strings.TrimSpace(header.Header.Get("Content-Type"))
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	var expiresAt *time.Time
	if raw := strings.TrimSpace(r.FormValue("expires_in_hours")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			http.Error(w, "expires_in_hours must be a positive integer", http.StatusBadRequest)
			return
		}
		expires := time.Now().UTC().Add(time.Duration(value) * time.Hour)
		expiresAt = &expires
	}

	transferID, err := randomTransferID()
	if err != nil {
		http.Error(w, "failed to allocate transfer id", http.StatusInternalServerError)
		return
	}

	storageDir := filepath.Join(cfg.DataDir, "transfers")
	if err := os.MkdirAll(storageDir, 0o755); err != nil {
		http.Error(w, "failed to create transfer storage", http.StatusInternalServerError)
		return
	}

	storageName := transferID + sanitizeTransferExtension(filepath.Ext(fileName))
	storagePath := filepath.Join(storageDir, storageName)
	size, hash, err := saveUploadedFile(file, storagePath)
	if err != nil {
		http.Error(w, "failed to store transfer file", http.StatusInternalServerError)
		return
	}
	if size <= 0 {
		_ = os.Remove(storagePath)
		http.Error(w, "empty file is not allowed", http.StatusBadRequest)
		return
	}

	input := db.CreateTransferInput{
		ID:          transferID,
		UserID:      session.User.ID,
		TargetType:  targetType,
		TargetID:    targetID,
		ProjectID:   projectID,
		WorkgroupID: workgroupID,
		FileName:    fileName,
		MimeType:    mimeType,
		SizeBytes:   size,
		SHA256:      hash,
		StoragePath: storagePath,
		ExpiresAt:   expiresAt,
	}

	switch session.Claims.Type {
	case model.ClientTypeAgent:
		input.SenderType = string(model.ClientTypeAgent)
		input.SenderAgentID = strings.TrimSpace(session.Claims.AgentID)
	case model.ClientTypeDevice:
		input.SenderType = string(model.ClientTypeDevice)
		input.SenderAgentID = strings.TrimSpace(session.Claims.AgentID)
		input.SenderDeviceID = strings.TrimSpace(session.Claims.DeviceID)
	default:
		_ = os.Remove(storagePath)
		http.Error(w, "unsupported client type", http.StatusForbidden)
		return
	}

	item, err := database.CreateTransfer(input)
	if err != nil {
		_ = os.Remove(storagePath)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(buildTransferResponse(r, *item, nil))
}

func handleTransferDetail(w http.ResponseWriter, r *http.Request, session *clientSession, _ *config.Config, database *db.DB, transferID string) {
	item, err := database.GetTransferByIDForUser(transferID, session.User.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	receipts, err := database.ListTransferReceiptsForTransfer(transferID, session.User.ID)
	if err != nil {
		http.Error(w, "failed to load transfer receipts", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(buildTransferResponse(r, *item, receipts))
}

func handleTransferDownload(w http.ResponseWriter, r *http.Request, session *clientSession, database *db.DB, transferID string) {
	item, err := database.GetTransferByIDForUser(transferID, session.User.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if transferStatus(*item) == "expired" {
		http.Error(w, "transfer expired", http.StatusGone)
		return
	}

	file, err := os.Open(item.StoragePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", item.MimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, item.FileName))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	http.ServeContent(w, r, item.FileName, info.ModTime(), file)
}

func handleTransferReceiptCreate(w http.ResponseWriter, r *http.Request, session *clientSession, database *db.DB, transferID string) {
	var req transferReceiptRequest
	if err := decodeJSONBody(w, r, &req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	status := normalizeTransferReceiptStatus(req.Status)
	if status == "" {
		http.Error(w, "status must be delivered, opened, or failed", http.StatusBadRequest)
		return
	}

	input := db.CreateTransferReceiptInput{
		TransferID: transferID,
		ClientType: string(session.Claims.Type),
		Status:     status,
		Note:       strings.TrimSpace(req.Note),
	}
	if session.Claims.Type == model.ClientTypeAgent {
		input.AgentID = strings.TrimSpace(session.Claims.AgentID)
	}
	if session.Claims.Type == model.ClientTypeDevice {
		input.AgentID = strings.TrimSpace(session.Claims.AgentID)
		input.DeviceID = strings.TrimSpace(session.Claims.DeviceID)
	}

	receipt, err := database.CreateTransferReceipt(session.User.ID, input)
	if err != nil {
		if strings.Contains(err.Error(), "transfer not found") {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "failed to create transfer receipt", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(buildTransferReceiptResponse(*receipt))
}

func buildTransferResponse(r *http.Request, item db.Transfer, receipts []db.TransferReceipt) transferResponse {
	response := transferResponse{
		ID:             item.ID,
		SenderType:     item.SenderType,
		SenderAgentID:  item.SenderAgentID,
		SenderDeviceID: item.SenderDeviceID,
		TargetType:     item.TargetType,
		TargetID:       item.TargetID,
		ProjectID:      item.ProjectID,
		WorkgroupID:    item.WorkgroupID,
		FileName:       item.FileName,
		MimeType:       item.MimeType,
		SizeBytes:      item.SizeBytes,
		SHA256:         item.SHA256,
		Status:         transferStatus(item),
		CreatedAt:      item.CreatedAt.UTC().Format(time.RFC3339),
		DownloadURL:    absoluteURL(r, "/api/transfers/"+item.ID+"/download"),
	}
	if item.ExpiresAt.Valid {
		response.ExpiresAt = item.ExpiresAt.Time.UTC().Format(time.RFC3339)
	}
	if len(receipts) > 0 {
		response.Receipts = make([]transferReceiptResponse, 0, len(receipts))
		for _, receipt := range receipts {
			response.Receipts = append(response.Receipts, buildTransferReceiptResponse(receipt))
		}
	}
	return response
}

func buildTransferReceiptResponse(item db.TransferReceipt) transferReceiptResponse {
	return transferReceiptResponse{
		ID:         item.ID,
		ClientType: item.ClientType,
		AgentID:    item.AgentID,
		DeviceID:   item.DeviceID,
		Status:     item.Status,
		Note:       item.Note,
		CreatedAt:  item.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func transferStatus(item db.Transfer) string {
	if item.ExpiresAt.Valid && time.Now().UTC().After(item.ExpiresAt.Time.UTC()) {
		return "expired"
	}
	status := strings.TrimSpace(strings.ToLower(item.Status))
	if status == "" {
		return "available"
	}
	return status
}

func normalizeTransferTargetType(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return "", true
	case "agent", "device", "project", "workgroup":
		return strings.ToLower(strings.TrimSpace(value)), true
	default:
		return "", false
	}
}

func normalizeTransferReceiptStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "delivered", "opened", "failed":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func sanitizeTransferFileName(value string) string {
	value = strings.TrimSpace(filepath.Base(value))
	if value == "." || value == "" {
		return "transfer.bin"
	}

	var builder strings.Builder
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
		case char >= 'A' && char <= 'Z':
			builder.WriteRune(char)
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
		case char == '.', char == '-', char == '_', char == ' ':
			builder.WriteRune(char)
		default:
			builder.WriteRune('_')
		}
	}

	result := strings.Trim(strings.Join(strings.Fields(builder.String()), " "), " .")
	if result == "" {
		return "transfer.bin"
	}
	return result
}

func sanitizeTransferExtension(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ".bin"
	}

	var builder strings.Builder
	for _, char := range value {
		switch {
		case char == '.':
			builder.WriteRune(char)
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
		}
	}
	result := builder.String()
	if !strings.HasPrefix(result, ".") || len(result) == 1 {
		return ".bin"
	}
	return result
}

func randomTransferID() (string, error) {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return "tr_" + hex.EncodeToString(buffer), nil
}
