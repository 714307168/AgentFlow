package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/claudecode/relay-server/auth"
	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/hub"
	"github.com/claudecode/relay-server/model"
	"github.com/google/uuid"
)

type projectBindRequest struct {
	ProjectID   string `json:"project_id"`
	AgentID     string `json:"agent_id"`
	Path        string `json:"path"`
	Name        string `json:"name"`
	CLIProvider string `json:"cli_provider"`
	CLIModel    string `json:"cli_model"`
}

// ProjectBindHandler registers a project->agent mapping via REST.
func ProjectBindHandler(h *hub.Hub, cfg *config.Config) http.HandlerFunc {
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

		var req projectBindRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.ProjectID == "" || req.AgentID == "" {
			http.Error(w, "project_id and agent_id are required", http.StatusBadRequest)
			return
		}
		if claims.Type != model.ClientTypeAgent {
			http.Error(w, "only agents can bind projects", http.StatusForbidden)
			return
		}
		if claims.AgentID == "" || claims.AgentID != req.AgentID {
			http.Error(w, "token is not authorized for this agent", http.StatusForbidden)
			return
		}

		h.BindProject(req.ProjectID, req.AgentID, req.Name, req.Path, req.CLIProvider, req.CLIModel)

		// Forward project.bind to agent via WebSocket
		payloadData := map[string]interface{}{
			"project_id":   req.ProjectID,
			"id":           req.ProjectID, // backward compatibility for older agents
			"name":         req.Name,
			"path":         req.Path,
			"agent_id":     req.AgentID,
			"cli_provider": req.CLIProvider,
			"cli_model":    req.CLIModel,
		}
		payloadBytes, _ := json.Marshal(payloadData)

		envelope := &model.Envelope{
			ID:        uuid.New().String(),
			Event:     model.EventProjectBind,
			ProjectID: req.ProjectID,
			Timestamp: time.Now().UnixMilli(),
			Payload:   payloadBytes,
		}

		sent := h.SendToAgent(req.AgentID, envelope)
		if !sent {
			http.Error(w, "agent not online", http.StatusServiceUnavailable)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}
}
