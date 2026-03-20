package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/claudecode/relay-server/auth"
	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/model"
	"github.com/claudecode/relay-server/store"
)

type sessionRequest struct {
	Type     model.ClientType `json:"type"`
	AgentID  string           `json:"agent_id"`
	DeviceID string           `json:"device_id"`
}

type sessionResponse struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expires_at"`
}

type sessionIssueError struct {
	Status  int
	Message string
}

func (e *sessionIssueError) Error() string {
	return e.Message
}

// SessionHandler is intentionally disabled for public deployments.
func SessionHandler(cfg *config.Config, st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		http.Error(w, "public session issuance is disabled; use /api/auth/login or /admin/api/session", http.StatusForbidden)
	}
}

// AdminSessionHandler issues JWT tokens for the logged-in user's pre-registered agents and devices.
func AdminSessionHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		session, ok := currentAdminSession(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req sessionRequest
		if err := decodeJSONBody(w, r, &req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		resp, issueErr := issueAdminSessionToken(cfg, database, session.UserID, req)
		if issueErr != nil {
			http.Error(w, issueErr.Message, issueErr.Status)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})
}

func issueAdminSessionToken(cfg *config.Config, database *db.DB, userID int, req sessionRequest) (sessionResponse, *sessionIssueError) {
	if req.Type != model.ClientTypeAgent && req.Type != model.ClientTypeDevice {
		return sessionResponse{}, &sessionIssueError{
			Status:  http.StatusBadRequest,
			Message: "type must be 'agent' or 'device'",
		}
	}

	var agentID string
	switch req.Type {
	case model.ClientTypeAgent:
		if req.AgentID == "" {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusBadRequest,
				Message: "agent_id is required",
			}
		}
		belongs, err := database.AgentBelongsToUser(req.AgentID, userID)
		if err != nil {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusInternalServerError,
				Message: "failed to verify agent ownership",
			}
		}
		if !belongs {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusForbidden,
				Message: "agent not registered for current user",
			}
		}
		agentID = req.AgentID

	case model.ClientTypeDevice:
		if req.DeviceID == "" {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusBadRequest,
				Message: "device_id is required",
			}
		}
		belongs, err := database.DeviceBelongsToUser(req.DeviceID, userID)
		if err != nil {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusInternalServerError,
				Message: "failed to verify device ownership",
			}
		}
		if !belongs {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusForbidden,
				Message: "device not registered for current user",
			}
		}
		boundAgentID, err := database.GetDeviceAgentID(req.DeviceID)
		if err != nil {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusInternalServerError,
				Message: "failed to read device binding",
			}
		}
		agentID = boundAgentID
	}

	ttl := 24 * time.Hour
	if req.Type == model.ClientTypeAgent {
		ttl = 30 * 24 * time.Hour
	}

	token, err := auth.SignToken(cfg.JWTSecret, agentID, req.DeviceID, req.Type, ttl)
	if err != nil {
		return sessionResponse{}, &sessionIssueError{
			Status:  http.StatusInternalServerError,
			Message: "failed to sign token",
		}
	}

	return sessionResponse{
		Token:     token,
		ExpiresAt: time.Now().Add(ttl).UTC().Format(time.RFC3339),
	}, nil
}

func issueSessionToken(cfg *config.Config, st *store.Store, req sessionRequest) (sessionResponse, *sessionIssueError) {
	if req.Type != model.ClientTypeAgent && req.Type != model.ClientTypeDevice {
		return sessionResponse{}, &sessionIssueError{
			Status:  http.StatusBadRequest,
			Message: "type must be 'agent' or 'device'",
		}
	}

	switch req.Type {
	case model.ClientTypeAgent:
		if req.AgentID == "" || !st.AgentExists(req.AgentID) {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusForbidden,
				Message: "agent not registered",
			}
		}
	case model.ClientTypeDevice:
		if req.DeviceID == "" || !st.DeviceExists(req.DeviceID) {
			return sessionResponse{}, &sessionIssueError{
				Status:  http.StatusForbidden,
				Message: "device not registered",
			}
		}
	}

	ttl := 24 * time.Hour
	if req.Type == model.ClientTypeAgent {
		ttl = 30 * 24 * time.Hour
	}

	agentID := req.AgentID
	if req.Type == model.ClientTypeDevice {
		if boundAgentID, ok := st.GetDeviceAgentID(req.DeviceID); ok {
			agentID = boundAgentID
		}
	}

	token, err := auth.SignToken(cfg.JWTSecret, agentID, req.DeviceID, req.Type, ttl)
	if err != nil {
		return sessionResponse{}, &sessionIssueError{
			Status:  http.StatusInternalServerError,
			Message: "failed to sign token",
		}
	}

	return sessionResponse{
		Token:     token,
		ExpiresAt: time.Now().Add(ttl).UTC().Format(time.RFC3339),
	}, nil
}
