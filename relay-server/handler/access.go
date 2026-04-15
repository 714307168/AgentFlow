package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
)

type accessOverviewResponse struct {
	ControllableAgents []db.AccessibleAgent  `json:"controllable_agents"`
	IncomingGrants     []db.AgentAccessGrant `json:"incoming_grants"`
}

// AccessGrantsHandler manages one-way desktop control grants for signed-in app clients.
func AccessGrantsHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := currentClientSession(r, cfg, database)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		switch r.Method {
		case http.MethodGet:
			agents, err := database.ListAccessibleAgentsForUser(session.User.ID)
			if err != nil {
				http.Error(w, "failed to load accessible agents", http.StatusInternalServerError)
				return
			}
			grants, err := database.ListIncomingAgentAccessGrants(session.User.ID)
			if err != nil {
				http.Error(w, "failed to load incoming grants", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(accessOverviewResponse{
				ControllableAgents: agents,
				IncomingGrants:     grants,
			})

		case http.MethodPost:
			var body struct {
				ControllerUsername string   `json:"controller_username"`
				TargetAgentID      string   `json:"target_agent_id"`
				ProjectIDs         []string `json:"project_ids"`
				Note               string   `json:"note"`
			}
			if err := decodeJSONBody(w, r, &body); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}

			body.ControllerUsername = strings.TrimSpace(body.ControllerUsername)
			body.TargetAgentID = strings.TrimSpace(body.TargetAgentID)
			if body.ControllerUsername == "" || body.TargetAgentID == "" {
				http.Error(w, "controller_username and target_agent_id are required", http.StatusBadRequest)
				return
			}

			if !session.User.IsAdmin {
				belongs, err := database.AgentBelongsToUser(body.TargetAgentID, session.User.ID)
				if err != nil {
					http.Error(w, "failed to verify target agent ownership", http.StatusInternalServerError)
					return
				}
				if !belongs {
					http.Error(w, "target agent does not belong to current user", http.StatusForbidden)
					return
				}
			}

			controllerUser, err := database.GetUserByUsername(body.ControllerUsername)
			if err != nil {
				http.Error(w, "controller user not found", http.StatusNotFound)
				return
			}

			if err := database.CreateAgentAccessGrant(controllerUser.ID, body.TargetAgentID, session.User.ID, strings.TrimSpace(body.Note), body.ProjectIDs); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"success": true})

		case http.MethodDelete:
			targetAgentID := strings.TrimSpace(r.URL.Query().Get("target_agent_id"))
			controllerUserIDValue := strings.TrimSpace(r.URL.Query().Get("controller_user_id"))
			if targetAgentID == "" || controllerUserIDValue == "" {
				http.Error(w, "target_agent_id and controller_user_id are required", http.StatusBadRequest)
				return
			}

			controllerUserID, err := strconv.Atoi(controllerUserIDValue)
			if err != nil || controllerUserID <= 0 {
				http.Error(w, "invalid controller_user_id", http.StatusBadRequest)
				return
			}

			if !session.User.IsAdmin {
				belongs, err := database.AgentBelongsToUser(targetAgentID, session.User.ID)
				if err != nil {
					http.Error(w, "failed to verify target agent ownership", http.StatusInternalServerError)
					return
				}
				if !belongs {
					http.Error(w, "target agent does not belong to current user", http.StatusForbidden)
					return
				}
			}

			if err := database.DeleteAgentAccessGrant(controllerUserID, targetAgentID); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"success": true})

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}
