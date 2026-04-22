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

type syncKnownProject struct {
	ProjectID string `json:"project_id"`
	Signature string `json:"signature"`
}

type syncDeltaRequest struct {
	SinceRevision   string             `json:"since_revision"`
	KnownProjects   []syncKnownProject `json:"known_projects"`
	KnownProjectIDs []string           `json:"known_project_ids"`
}

type syncDeltaResponse struct {
	AgentID        string                  `json:"agent_id"`
	Revision       string                  `json:"revision"`
	ProjectCount   int                     `json:"project_count"`
	Changed        bool                    `json:"changed"`
	ProjectUpserts []model.ProjectListItem `json:"project_upserts"`
	ProjectRemoves []string                `json:"project_removes"`
}

func SyncDeltaHandler(h *hub.Hub, cfg *config.Config, st *store.Store) http.HandlerFunc {
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
			http.Error(w, "only devices can sync", http.StatusForbidden)
			return
		}

		var req syncDeltaRequest
		if err := decodeJSONBody(w, r, &req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		agentID, _ := st.GetDeviceAgentID(claims.DeviceID)
		projects := h.GetAccessibleProjectsByDevice(claims.DeviceID)
		revision := buildSyncRevision(agentID, projects)
		hasKnownProjectState := len(req.KnownProjects) > 0 || len(req.KnownProjectIDs) > 0
		if strings.TrimSpace(req.SinceRevision) != "" && strings.TrimSpace(req.SinceRevision) == revision && !hasKnownProjectState {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(syncDeltaResponse{
				AgentID:        agentID,
				Revision:       revision,
				ProjectCount:   len(projects),
				Changed:        false,
				ProjectUpserts: []model.ProjectListItem{},
				ProjectRemoves: []string{},
			})
			return
		}
		upserts, removes := buildSyncProjectDelta(projects, req.KnownProjects, req.KnownProjectIDs)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(syncDeltaResponse{
			AgentID:        agentID,
			Revision:       revision,
			ProjectCount:   len(projects),
			Changed:        len(upserts) > 0 || len(removes) > 0,
			ProjectUpserts: upserts,
			ProjectRemoves: removes,
		})
	}
}

func buildSyncProjectDelta(projects []model.ProjectListItem, knownProjects []syncKnownProject, knownProjectIDs []string) ([]model.ProjectListItem, []string) {
	knownByProjectID := make(map[string]string, len(knownProjects))
	knownIDSet := make(map[string]struct{}, len(knownProjects)+len(knownProjectIDs))
	for _, item := range knownProjects {
		projectID := strings.TrimSpace(item.ProjectID)
		if projectID == "" {
			continue
		}
		knownByProjectID[projectID] = strings.TrimSpace(item.Signature)
		knownIDSet[projectID] = struct{}{}
	}
	for _, projectID := range knownProjectIDs {
		normalizedProjectID := strings.TrimSpace(projectID)
		if normalizedProjectID == "" {
			continue
		}
		knownIDSet[normalizedProjectID] = struct{}{}
	}

	currentByProjectID := make(map[string]model.ProjectListItem, len(projects))
	upserts := make([]model.ProjectListItem, 0)
	for _, project := range projects {
		projectID := strings.TrimSpace(project.ID)
		if projectID == "" {
			continue
		}
		currentByProjectID[projectID] = project
		knownSignature, hasKnownSignature := knownByProjectID[projectID]
		_, knownToClient := knownIDSet[projectID]
		if (hasKnownSignature && knownSignature != buildProjectSyncSignature(project)) || (!hasKnownSignature && !knownToClient) {
			upserts = append(upserts, project)
		}
	}

	removes := make([]string, 0)
	for projectID := range knownIDSet {
		if _, ok := currentByProjectID[projectID]; !ok {
			removes = append(removes, projectID)
		}
	}

	return upserts, removes
}
