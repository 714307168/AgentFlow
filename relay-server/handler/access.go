package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
)

type accessOverviewResponse struct {
	ControllableAgents []db.AccessibleAgent  `json:"controllable_agents"`
	IncomingGrants     []db.AgentAccessGrant `json:"incoming_grants"`
}

type effectiveScopeResponse struct {
	AccountID   int                      `json:"account_id"`
	Username    string                   `json:"username"`
	ClientType  string                   `json:"client_type"`
	AgentID     string                   `json:"agent_id,omitempty"`
	DeviceID    string                   `json:"device_id,omitempty"`
	AgentScopes []db.EffectiveAgentScope `json:"agent_scopes"`
}

type accessGrantCreateRequest struct {
	ControllerUsername string   `json:"controller_username"`
	TargetAgentID      string   `json:"target_agent_id"`
	ProjectIDs         []string `json:"project_ids"`
	ScopeType          string   `json:"scope_type"`
	CapabilityBundle   string   `json:"capability_bundle"`
	AllowFileDownload  *bool    `json:"allow_file_download"`
	AllowDiagnostics   *bool    `json:"allow_diagnostics"`
	ExpiresAt          string   `json:"expires_at"`
	Note               string   `json:"note"`
}

type accessGrantPatchRequest struct {
	ProjectIDs        *[]string `json:"project_ids"`
	ScopeType         *string   `json:"scope_type"`
	CapabilityBundle  *string   `json:"capability_bundle"`
	AllowFileDownload *bool     `json:"allow_file_download"`
	AllowDiagnostics  *bool     `json:"allow_diagnostics"`
	ExpiresAt         *string   `json:"expires_at"`
	Note              *string   `json:"note"`
}

func parseOptionalRFC3339(value string) (*time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func verifyGrantOwnership(database *db.DB, session *clientSession, targetAgentID string) error {
	if session.User.IsAdmin {
		return nil
	}
	belongs, err := database.AgentBelongsToUser(strings.TrimSpace(targetAgentID), session.User.ID)
	if err != nil {
		return err
	}
	if !belongs {
		return errForbidden("target agent does not belong to current user")
	}
	return nil
}

type forbiddenError struct {
	message string
}

func (e forbiddenError) Error() string {
	return e.message
}

func errForbidden(message string) error {
	return forbiddenError{message: message}
}

func writeAccessGrantError(w http.ResponseWriter, err error, fallback string) {
	if err == nil {
		return
	}
	if _, ok := err.(forbiddenError); ok {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	http.Error(w, fallback, http.StatusInternalServerError)
}

// AccessGrantsHandler manages one-way desktop control grants for signed-in app clients.
func AccessGrantsHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := currentClientSession(r, cfg, database)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		pathSuffix := strings.TrimPrefix(r.URL.Path, "/api/access/grants")
		if pathSuffix != "" && pathSuffix != "/" {
			segments := strings.Split(strings.Trim(pathSuffix, "/"), "/")
			if len(segments) == 1 && r.Method == http.MethodPatch {
				grant, err := database.GetAgentAccessGrantByID(segments[0])
				if err != nil {
					http.Error(w, err.Error(), http.StatusNotFound)
					return
				}
				if err := verifyGrantOwnership(database, session, grant.TargetAgentID); err != nil {
					writeAccessGrantError(w, err, "failed to verify target agent ownership")
					return
				}

				var body accessGrantPatchRequest
				if err := decodeJSONBody(w, r, &body); err != nil {
					http.Error(w, "invalid request body", http.StatusBadRequest)
					return
				}

				input := db.AccessGrantInput{
					ControllerUserID:  grant.ControllerUserID,
					TargetAgentID:     grant.TargetAgentID,
					CreatedByUserID:   session.User.ID,
					Note:              grant.Note,
					ProjectIDs:        grant.GrantedProjectIDs,
					ScopeType:         grant.ScopeType,
					CapabilityBundle:  grant.CapabilityBundle,
					AllowFileDownload: grant.AllowFileDownload,
					AllowDiagnostics:  grant.AllowDiagnostics,
					ExpiresAt:         grant.ExpiresAt,
				}
				if body.ProjectIDs != nil {
					input.ProjectIDs = *body.ProjectIDs
				}
				if body.ScopeType != nil {
					input.ScopeType = strings.TrimSpace(*body.ScopeType)
				}
				if body.CapabilityBundle != nil {
					input.CapabilityBundle = strings.TrimSpace(*body.CapabilityBundle)
				}
				if body.AllowFileDownload != nil {
					input.AllowFileDownload = *body.AllowFileDownload
				}
				if body.AllowDiagnostics != nil {
					input.AllowDiagnostics = *body.AllowDiagnostics
				}
				if body.Note != nil {
					input.Note = strings.TrimSpace(*body.Note)
				}
				if body.ExpiresAt != nil {
					expiresAt, err := parseOptionalRFC3339(*body.ExpiresAt)
					if err != nil {
						http.Error(w, "invalid expires_at", http.StatusBadRequest)
						return
					}
					input.ExpiresAt = expiresAt
				}

				if err := database.CreateAgentAccessGrantWithInput(input); err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
				return
			}
			if len(segments) == 2 && segments[1] == "revoke" && r.Method == http.MethodPost {
				grant, err := database.GetAgentAccessGrantByID(segments[0])
				if err != nil {
					http.Error(w, err.Error(), http.StatusNotFound)
					return
				}
				if err := verifyGrantOwnership(database, session, grant.TargetAgentID); err != nil {
					writeAccessGrantError(w, err, "failed to verify target agent ownership")
					return
				}
				if err := database.RevokeAgentAccessGrantByID(segments[0]); err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
				return
			}
			http.Error(w, "not found", http.StatusNotFound)
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
			var body accessGrantCreateRequest
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

			if err := verifyGrantOwnership(database, session, body.TargetAgentID); err != nil {
				writeAccessGrantError(w, err, "failed to verify target agent ownership")
				return
			}

			expiresAt, err := parseOptionalRFC3339(body.ExpiresAt)
			if err != nil {
				http.Error(w, "invalid expires_at", http.StatusBadRequest)
				return
			}

			controllerUser, err := database.GetUserByUsername(body.ControllerUsername)
			if err != nil {
				http.Error(w, "controller user not found", http.StatusNotFound)
				return
			}

			allowFileDownload := true
			if body.AllowFileDownload != nil {
				allowFileDownload = *body.AllowFileDownload
			}
			allowDiagnostics := true
			if body.AllowDiagnostics != nil {
				allowDiagnostics = *body.AllowDiagnostics
			}
			if err := database.CreateAgentAccessGrantWithInput(db.AccessGrantInput{
				ControllerUserID:  controllerUser.ID,
				TargetAgentID:     body.TargetAgentID,
				CreatedByUserID:   session.User.ID,
				Note:              strings.TrimSpace(body.Note),
				ProjectIDs:        body.ProjectIDs,
				ScopeType:         body.ScopeType,
				CapabilityBundle:  body.CapabilityBundle,
				AllowFileDownload: allowFileDownload,
				AllowDiagnostics:  allowDiagnostics,
				ExpiresAt:         expiresAt,
			}); err != nil {
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

			if err := verifyGrantOwnership(database, session, targetAgentID); err != nil {
				writeAccessGrantError(w, err, "failed to verify target agent ownership")
				return
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

// EffectiveScopeHandler returns the current signed-in client's accessible desktop-agent scope.
func EffectiveScopeHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		session, err := currentClientSession(r, cfg, database)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		scopes, err := database.ListEffectiveAgentScopesForUser(session.User.ID)
		if err != nil {
			http.Error(w, "failed to load effective scope", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(effectiveScopeResponse{
			AccountID:   session.User.ID,
			Username:    session.User.Username,
			ClientType:  string(session.Claims.Type),
			AgentID:     strings.TrimSpace(session.Claims.AgentID),
			DeviceID:    strings.TrimSpace(session.Claims.DeviceID),
			AgentScopes: scopes,
		})
	}
}
