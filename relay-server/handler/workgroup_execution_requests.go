package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/model"
)

// WorkgroupExecutionRequestsHandler manages opt-in execution access. Group
// membership is deliberately insufficient: the target Agent must request a
// scoped grant and the group owner must approve it.
func WorkgroupExecutionRequestsHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := currentClientSession(r, cfg, database)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		switch {
		case r.Method == http.MethodGet:
			groupNumber := strings.TrimSpace(r.URL.Query().Get("group_number"))
			record, err := database.GetCollaborationGroupByNumber(groupNumber)
			if err != nil {
				writeExecutionRequestError(w, err)
				return
			}
			_, allowed, err := database.CheckCollaborationGroupAccess(session.User.ID, record.HostAgentID, record.WorkgroupID)
			if err != nil || !allowed {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			requesterID := 0
			if session.User.ID != record.OwnerUserID {
				requesterID = session.User.ID
			}
			requests, err := database.ListCollaborationExecutionRequests(record.ID, requesterID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"requests": requests})

		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/request"):
			if session.Claims.Type != model.ClientTypeAgent || strings.TrimSpace(session.Claims.AgentID) == "" {
				http.Error(w, "only the target agent can request execution access", http.StatusForbidden)
				return
			}
			var body struct {
				GroupNumber string   `json:"group_number"`
				ProjectIDs  []string `json:"project_ids"`
			}
			if err := decodeJSONBody(w, r, &body); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			record, err := database.GetCollaborationGroupByNumber(body.GroupNumber)
			if err != nil {
				writeExecutionRequestError(w, err)
				return
			}
			_, allowed, err := database.CheckCollaborationGroupAccess(session.User.ID, record.HostAgentID, record.WorkgroupID)
			if err != nil || !allowed || session.User.ID == record.OwnerUserID {
				http.Error(w, "only a joined non-owner member can request execution access", http.StatusForbidden)
				return
			}
			request, err := database.CreateCollaborationExecutionRequest(record.ID, session.User.ID, session.Claims.AgentID, body.ProjectIDs)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "request": request})

		case r.Method == http.MethodPost && (strings.HasSuffix(r.URL.Path, "/approve") || strings.HasSuffix(r.URL.Path, "/reject")):
			var body struct {
				RequestID string `json:"request_id"`
				Note      string `json:"note"`
			}
			if err := decodeJSONBody(w, r, &body); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			request, err := database.GetCollaborationExecutionRequest(body.RequestID)
			if err != nil {
				writeExecutionRequestError(w, err)
				return
			}
			group, err := database.GetCollaborationGroupByNumber(request.GroupNumber)
			if err != nil || group.OwnerUserID != session.User.ID {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			approved := strings.HasSuffix(r.URL.Path, "/approve")
			updated, err := database.DecideCollaborationExecutionRequest(request.ID, session.User.ID, approved, body.Note)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "request": updated})

		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/revoke"):
			var body struct {
				RequestID string `json:"request_id"`
				Note      string `json:"note"`
			}
			if err := decodeJSONBody(w, r, &body); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			request, err := database.GetCollaborationExecutionRequest(body.RequestID)
			if err != nil {
				writeExecutionRequestError(w, err)
				return
			}
			group, err := database.GetCollaborationGroupByNumber(request.GroupNumber)
			if err != nil || group.OwnerUserID != session.User.ID {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			updated, err := database.RevokeCollaborationExecutionRequest(request.ID, session.User.ID, body.Note)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "request": updated})

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func writeExecutionRequestError(w http.ResponseWriter, err error) {
	if err == sql.ErrNoRows || strings.Contains(strings.ToLower(err.Error()), "not found") {
		http.Error(w, "execution request or workgroup not found", http.StatusNotFound)
		return
	}
	http.Error(w, err.Error(), http.StatusBadRequest)
}
