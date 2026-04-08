package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/claudecode/relay-server/auth"
	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/hub"
	"github.com/claudecode/relay-server/model"
	"github.com/claudecode/relay-server/store"
)

type syncResponse struct {
	AgentID      string                  `json:"agent_id"`
	Revision     string                  `json:"revision"`
	ProjectCount int                     `json:"project_count"`
	Projects     []model.ProjectListItem `json:"projects"`
}

type syncMetaResponse struct {
	AgentID      string `json:"agent_id"`
	Revision     string `json:"revision"`
	ProjectCount int    `json:"project_count"`
	Changed      bool   `json:"changed"`
}

// SyncHandler returns the agent and projects bound to the device
func SyncHandler(h *hub.Hub, cfg *config.Config, st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
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
			http.Error(w, "only devices can sync", http.StatusForbidden)
			return
		}

		agentID, _ := st.GetDeviceAgentID(claims.DeviceID)
		projects := h.GetAccessibleProjectsByDevice(claims.DeviceID)
		revision := buildSyncRevision(agentID, projects)
		if len(projects) == 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(syncResponse{
				AgentID:      agentID,
				Revision:     revision,
				ProjectCount: 0,
				Projects:     []model.ProjectListItem{},
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(syncResponse{
			AgentID:      agentID,
			Revision:     revision,
			ProjectCount: len(projects),
			Projects:     projects,
		})
	}
}

// SyncMetaHandler returns only the revision metadata for the device project list.
func SyncMetaHandler(h *hub.Hub, cfg *config.Config, st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
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
			http.Error(w, "only devices can sync", http.StatusForbidden)
			return
		}

		agentID, _ := st.GetDeviceAgentID(claims.DeviceID)
		projects := h.GetAccessibleProjectsByDevice(claims.DeviceID)
		revision := buildSyncRevision(agentID, projects)
		sinceRevision := strings.TrimSpace(r.URL.Query().Get("since_revision"))

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(syncMetaResponse{
			AgentID:      agentID,
			Revision:     revision,
			ProjectCount: len(projects),
			Changed:      sinceRevision == "" || sinceRevision != revision,
		})
	}
}
