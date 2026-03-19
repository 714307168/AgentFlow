package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/claudecode/relay-server/auth"
	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/hub"
	"github.com/claudecode/relay-server/store"
)

type syncResponse struct {
	AgentID  string              `json:"agent_id"`
	Projects []map[string]string `json:"projects"`
}

// SyncHandler returns the agent and projects bound to the device
func SyncHandler(h *hub.Hub, cfg *config.Config, st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" {
			http.Error(w, "missing authorization", http.StatusUnauthorized)
			return
		}

		claims, err := auth.VerifyToken(cfg.JWTSecret, token)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		if claims.Type != "device" {
			http.Error(w, "only devices can sync", http.StatusForbidden)
			return
		}

		agentID, ok := st.GetDeviceAgentID(claims.DeviceID)
		if (!ok || agentID == "") && claims.AgentID != "" {
			agentID = claims.AgentID
			_ = st.UpdateDeviceAgent(claims.DeviceID, agentID)
			ok = true
		}
		if !ok || agentID == "" {
			http.Error(w, "device not bound to agent", http.StatusNotFound)
			return
		}

		// Get projects from hub (in-memory)
		projects := h.GetAgentProjects(agentID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(syncResponse{
			AgentID:  agentID,
			Projects: projects,
		})
	}
}
