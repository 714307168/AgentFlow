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

type publishWorkgroupRegistryRequest struct {
	WorkgroupID string          `json:"workgroup_id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	GroupNumber string          `json:"group_number"`
	Members     json.RawMessage `json:"members"`
}

type workgroupRegistryResponse struct {
	Record workgroupRegistryRecord `json:"record"`
}

type workgroupRegistryRecord struct {
	GroupNumber   string `json:"groupNumber"`
	WorkgroupID   string `json:"workgroupId"`
	HostAgentID   string `json:"hostAgentId"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	OwnerUsername string `json:"ownerUsername"`
	MemberCount   int    `json:"memberCount"`
	CanManage     bool   `json:"canManage"`
	Joined        bool   `json:"joined"`
	UpdatedAt     int64  `json:"updatedAt"`
}

type workgroupRegistryMember struct {
	UserID   int    `json:"userId"`
	Username string `json:"username"`
	IsOwner  bool   `json:"isOwner"`
	JoinedAt int64  `json:"joinedAt"`
}

func WorkgroupRegistryHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := currentClientSession(r, cfg, database)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		switch r.Method {
		case http.MethodGet:
			if strings.HasSuffix(r.URL.Path, "/mine") {
				records, err := database.ListCollaborationGroupsForUser(session.User.ID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"records": mapCollaborationGroupRecords(records),
				})
				return
			}

			if strings.HasSuffix(r.URL.Path, "/members") {
				record, err := resolveCollaborationGroupFromRequest(database, r)
				if err != nil {
					if err == sql.ErrNoRows {
						http.Error(w, "workgroup not found", http.StatusNotFound)
						return
					}
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}

				exists, allowed, err := database.CheckCollaborationGroupAccess(session.User.ID, record.HostAgentID, record.WorkgroupID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if !exists || !allowed {
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}

				members, err := database.ListCollaborationGroupMembers(record.ID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}

				_ = json.NewEncoder(w).Encode(map[string]any{
					"record":  mapCollaborationGroupRecord(*record),
					"members": mapCollaborationGroupMembers(members),
				})
				return
			}

			query := strings.TrimSpace(r.URL.Query().Get("q"))
			records, err := database.SearchCollaborationGroups(query, 20)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"records": mapCollaborationGroupRecords(records),
			})

		case http.MethodPost:
			if strings.HasSuffix(r.URL.Path, "/publish") {
				if session.Claims.Type != model.ClientTypeAgent {
					http.Error(w, "only agents can publish workgroups", http.StatusForbidden)
					return
				}
				var body publishWorkgroupRegistryRequest
				if err := decodeJSONBody(w, r, &body); err != nil {
					http.Error(w, "invalid request body", http.StatusBadRequest)
					return
				}
				record, err := database.UpsertCollaborationGroup(
					session.User.ID,
					session.Claims.AgentID,
					body.WorkgroupID,
					body.Name,
					body.Description,
					string(body.Members),
					body.GroupNumber,
				)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				_ = json.NewEncoder(w).Encode(workgroupRegistryResponse{
					Record: mapCollaborationGroupRecord(*record),
				})
				return
			}

			if strings.HasSuffix(r.URL.Path, "/join") {
				var body struct {
					GroupNumber string `json:"group_number"`
				}
				if err := decodeJSONBody(w, r, &body); err != nil {
					http.Error(w, "invalid request body", http.StatusBadRequest)
					return
				}
				record, err := database.GetCollaborationGroupByNumber(body.GroupNumber)
				if err != nil {
					if err == sql.ErrNoRows {
						http.Error(w, "workgroup not found", http.StatusNotFound)
						return
					}
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if session.User.ID == record.OwnerUserID {
					_ = json.NewEncoder(w).Encode(map[string]any{
						"success":        true,
						"joined":         false,
						"granted_access": false,
						"record":         mapCollaborationGroupRecord(*record),
					})
					return
				}
				joined, err := database.JoinCollaborationGroup(session.User.ID, record.ID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}

				grantedAccess := false
				if session.User.ID != record.OwnerUserID {
					err = database.CreateAgentAccessGrant(session.User.ID, record.HostAgentID, record.OwnerUserID, "joined via collaboration group "+record.GroupNumber)
					if err == nil {
						grantedAccess = true
					} else if strings.Contains(strings.ToLower(err.Error()), "grant already exists") {
						grantedAccess = false
					} else {
						http.Error(w, err.Error(), http.StatusInternalServerError)
						return
					}
				}

				_ = json.NewEncoder(w).Encode(map[string]any{
					"success":        true,
					"joined":         joined,
					"granted_access": grantedAccess,
					"record":         mapCollaborationGroupRecord(*record),
				})
				return
			}

			if strings.HasSuffix(r.URL.Path, "/leave") {
				var body struct {
					GroupNumber string `json:"group_number"`
					WorkgroupID string `json:"workgroup_id"`
					HostAgentID string `json:"host_agent_id"`
				}
				if err := decodeJSONBody(w, r, &body); err != nil {
					http.Error(w, "invalid request body", http.StatusBadRequest)
					return
				}
				record, err := resolveCollaborationGroup(database, body.GroupNumber, body.HostAgentID, body.WorkgroupID)
				if err != nil {
					if err == sql.ErrNoRows {
						http.Error(w, "workgroup not found", http.StatusNotFound)
						return
					}
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				if record.OwnerUserID == session.User.ID {
					http.Error(w, "owner cannot leave the workgroup", http.StatusBadRequest)
					return
				}
				if err := database.RemoveCollaborationGroupMembership(session.User.ID, record.ID); err != nil {
					if err == sql.ErrNoRows {
						http.Error(w, "membership not found", http.StatusNotFound)
						return
					}
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if err := database.DeleteAgentAccessGrantByNote(
					session.User.ID,
					record.HostAgentID,
					"joined via collaboration group "+record.GroupNumber,
				); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
				return
			}

			if strings.HasSuffix(r.URL.Path, "/kick") {
				var body struct {
					GroupNumber string `json:"group_number"`
					WorkgroupID string `json:"workgroup_id"`
					HostAgentID string `json:"host_agent_id"`
					UserID      int    `json:"user_id"`
				}
				if err := decodeJSONBody(w, r, &body); err != nil {
					http.Error(w, "invalid request body", http.StatusBadRequest)
					return
				}
				record, err := resolveCollaborationGroup(database, body.GroupNumber, body.HostAgentID, body.WorkgroupID)
				if err != nil {
					if err == sql.ErrNoRows {
						http.Error(w, "workgroup not found", http.StatusNotFound)
						return
					}
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				if record.OwnerUserID != session.User.ID {
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
				if body.UserID <= 0 {
					http.Error(w, "user_id is required", http.StatusBadRequest)
					return
				}
				if body.UserID == record.OwnerUserID {
					http.Error(w, "owner cannot be removed", http.StatusBadRequest)
					return
				}
				if err := database.RemoveCollaborationGroupMembership(body.UserID, record.ID); err != nil {
					if err == sql.ErrNoRows {
						http.Error(w, "membership not found", http.StatusNotFound)
						return
					}
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if err := database.DeleteAgentAccessGrantByNote(
					body.UserID,
					record.HostAgentID,
					"joined via collaboration group "+record.GroupNumber,
				); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
				return
			}

			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		case http.MethodDelete:
			workgroupID := strings.TrimSpace(r.URL.Query().Get("workgroup_id"))
			if session.Claims.Type != model.ClientTypeAgent {
				http.Error(w, "only agents can delete published workgroups", http.StatusForbidden)
				return
			}
			if workgroupID == "" {
				http.Error(w, "workgroup_id is required", http.StatusBadRequest)
				return
			}
			if err := database.DeleteCollaborationGroupByOwnerWorkgroup(session.User.ID, session.Claims.AgentID, workgroupID); err != nil {
				if err == sql.ErrNoRows {
					http.Error(w, "workgroup not found", http.StatusNotFound)
					return
				}
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true})

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func mapCollaborationGroupRecords(items []db.CollaborationGroupRecord) []workgroupRegistryRecord {
	result := make([]workgroupRegistryRecord, 0, len(items))
	for _, item := range items {
		result = append(result, mapCollaborationGroupRecord(item))
	}
	return result
}

func mapCollaborationGroupRecord(item db.CollaborationGroupRecord) workgroupRegistryRecord {
	record := workgroupRegistryRecord{
		GroupNumber:   item.GroupNumber,
		WorkgroupID:   item.WorkgroupID,
		HostAgentID:   item.HostAgentID,
		Name:          item.Name,
		OwnerUsername: item.OwnerUsername,
		MemberCount:   item.MemberCount,
		CanManage:     item.IsOwner,
		Joined:        item.IsJoined,
		UpdatedAt:     item.UpdatedAt.UnixMilli(),
	}
	if strings.TrimSpace(item.Description) != "" {
		record.Description = item.Description
	}
	return record
}

func mapCollaborationGroupMembers(items []db.CollaborationGroupMemberRecord) []workgroupRegistryMember {
	result := make([]workgroupRegistryMember, 0, len(items))
	for _, item := range items {
		result = append(result, workgroupRegistryMember{
			UserID:   item.UserID,
			Username: item.Username,
			IsOwner:  item.IsOwner,
			JoinedAt: item.JoinedAt.UnixMilli(),
		})
	}
	return result
}

func resolveCollaborationGroupFromRequest(database *db.DB, r *http.Request) (*db.CollaborationGroupRecord, error) {
	return resolveCollaborationGroup(
		database,
		r.URL.Query().Get("group_number"),
		r.URL.Query().Get("host_agent_id"),
		r.URL.Query().Get("workgroup_id"),
	)
}

func resolveCollaborationGroup(database *db.DB, groupNumber string, hostAgentID string, workgroupID string) (*db.CollaborationGroupRecord, error) {
	groupNumber = strings.TrimSpace(groupNumber)
	hostAgentID = strings.TrimSpace(hostAgentID)
	workgroupID = strings.TrimSpace(workgroupID)
	if groupNumber != "" {
		return database.GetCollaborationGroupByNumber(groupNumber)
	}
	if hostAgentID != "" && workgroupID != "" {
		return database.GetCollaborationGroupByHostWorkgroup(hostAgentID, workgroupID)
	}
	return nil, sql.ErrNoRows
}
