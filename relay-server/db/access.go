package db

import (
	"database/sql"
	"encoding/base64"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type AccessibleAgent struct {
	AgentID           string     `json:"agent_id"`
	OwnerUserID       int        `json:"owner_user_id"`
	OwnerUsername     string     `json:"owner_username"`
	OwnerNote         string     `json:"owner_note"`
	IsOwned           bool       `json:"is_owned"`
	GrantedByUserID   int        `json:"granted_by_user_id"`
	GrantedProjectIDs []string   `json:"granted_project_ids"`
	ScopeType         string     `json:"scope_type"`
	CapabilityBundle  string     `json:"capability_bundle"`
	AllowFileDownload bool       `json:"allow_file_download"`
	AllowDiagnostics  bool       `json:"allow_diagnostics"`
	ExpiresAt         *time.Time `json:"expires_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type AgentAccessGrant struct {
	ID                 string     `json:"id"`
	ControllerUserID   int        `json:"controller_user_id"`
	ControllerUsername string     `json:"controller_username"`
	TargetAgentID      string     `json:"target_agent_id"`
	TargetOwnerUserID  int        `json:"target_owner_user_id"`
	TargetOwnerName    string     `json:"target_owner_name"`
	GrantedProjectIDs  []string   `json:"granted_project_ids"`
	ScopeType          string     `json:"scope_type"`
	CapabilityBundle   string     `json:"capability_bundle"`
	AllowFileDownload  bool       `json:"allow_file_download"`
	AllowDiagnostics   bool       `json:"allow_diagnostics"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	RevokedAt          *time.Time `json:"revoked_at,omitempty"`
	Note               string     `json:"note"`
	CreatedByUserID    int        `json:"created_by_user_id"`
	CreatedAt          time.Time  `json:"created_at"`
}

type EffectiveAgentScope struct {
	AgentID           string   `json:"agent_id"`
	OwnerUserID       int      `json:"owner_user_id"`
	OwnerUsername     string   `json:"owner_username"`
	IsOwned           bool     `json:"is_owned"`
	ScopeType         string   `json:"scope_type"`
	ProjectIDs        []string `json:"project_ids"`
	CapabilityBundle  string   `json:"capability_bundle"`
	AllowFileDownload bool     `json:"allow_file_download"`
	AllowDiagnostics  bool     `json:"allow_diagnostics"`
}

type AccessGrantInput struct {
	ControllerUserID  int
	TargetAgentID     string
	CreatedByUserID   int
	Note              string
	ProjectIDs        []string
	ScopeType         string
	CapabilityBundle  string
	AllowFileDownload bool
	AllowDiagnostics  bool
	ExpiresAt         *time.Time
}

const (
	accessGrantScopeAllProjects      = "all_projects"
	accessGrantScopeSelectedProjects = "selected_projects"
)

func normalizeAccessGrantProjectIDs(projectIDs []string) []string {
	if len(projectIDs) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(projectIDs))
	items := make([]string, 0, len(projectIDs))
	for _, projectID := range projectIDs {
		normalized := strings.TrimSpace(projectID)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		items = append(items, normalized)
	}
	sort.Strings(items)
	return items
}

func grantScopeKey(controllerUserID int, targetAgentID string) string {
	return strconv.Itoa(controllerUserID) + ":" + targetAgentID
}

func buildAccessGrantID(controllerUserID int, targetAgentID string) string {
	encodedAgentID := base64.RawURLEncoding.EncodeToString([]byte(strings.TrimSpace(targetAgentID)))
	return strconv.Itoa(controllerUserID) + ":" + encodedAgentID
}

func parseAccessGrantID(grantID string) (int, string, error) {
	parts := strings.SplitN(strings.TrimSpace(grantID), ":", 2)
	if len(parts) != 2 {
		return 0, "", fmt.Errorf("invalid grant id")
	}
	controllerUserID, err := strconv.Atoi(parts[0])
	if err != nil || controllerUserID <= 0 {
		return 0, "", fmt.Errorf("invalid grant id")
	}
	targetAgentIDBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, "", fmt.Errorf("invalid grant id")
	}
	targetAgentID := strings.TrimSpace(string(targetAgentIDBytes))
	if targetAgentID == "" {
		return 0, "", fmt.Errorf("invalid grant id")
	}
	return controllerUserID, targetAgentID, nil
}

func normalizeCapabilityBundle(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "observe", "collaborate", "operate", "admin":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func normalizeScopeType(scopeType string, normalizedProjectIDs []string) string {
	switch strings.ToLower(strings.TrimSpace(scopeType)) {
	case accessGrantScopeSelectedProjects:
		return accessGrantScopeSelectedProjects
	case accessGrantScopeAllProjects:
		return accessGrantScopeAllProjects
	default:
		if len(normalizedProjectIDs) > 0 {
			return accessGrantScopeSelectedProjects
		}
		return accessGrantScopeAllProjects
	}
}

func ptrTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	v := value.Time
	return &v
}

func (db *DB) GetAgentUserID(agentID string) (int, error) {
	var userID int
	err := db.QueryRow("SELECT user_id FROM agents WHERE id = ?", agentID).Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("failed to get agent owner: %w", err)
	}
	return userID, nil
}

func (db *DB) GetDeviceUserID(deviceID string) (int, error) {
	var userID int
	err := db.QueryRow("SELECT user_id FROM devices WHERE id = ?", deviceID).Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("failed to get device owner: %w", err)
	}
	return userID, nil
}

func (db *DB) UserCanAccessAgent(userID int, agentID string) (bool, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM agents a
		WHERE a.id = ? AND (
			a.user_id = ?
			OR EXISTS (
				SELECT 1
				FROM agent_access_grants g
				WHERE g.controller_user_id = ?
					AND g.target_agent_id = a.id
					AND g.revoked_at IS NULL
					AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
			)
		)
	`, agentID, userID, userID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to check agent access: %w", err)
	}
	return count > 0, nil
}

// UserCanAccessAgentDiagnostics checks the explicit diagnostics permission.
// Agent owners retain access; delegated users must have an active grant with
// allow_diagnostics enabled. Keeping this separate from UserCanAccessAgent
// prevents a future broad agent-scope feature from silently exposing machine
// state.
func (db *DB) UserCanAccessAgentDiagnostics(userID int, agentID string) (bool, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM agents a
		WHERE a.id = ? AND (
			a.user_id = ?
			OR EXISTS (
				SELECT 1
				FROM agent_access_grants g
				WHERE g.controller_user_id = ?
					AND g.target_agent_id = a.id
					AND g.allow_diagnostics = 1
					AND g.revoked_at IS NULL
					AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
			)
		)
	`, agentID, userID, userID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to check agent diagnostics access: %w", err)
	}
	return count > 0, nil
}

// UserCanOperateAgent requires an explicit operate/admin grant. It is used by
// field-node actions and intentionally does not inherit observe/collaborate.
func (db *DB) UserCanOperateAgent(userID int, agentID string) (bool, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM agents a
		WHERE a.id = ? AND (
			a.user_id = ? OR EXISTS (
				SELECT 1 FROM agent_access_grants g
				WHERE g.controller_user_id = ? AND g.target_agent_id = a.id
					AND g.capability_bundle IN ('operate', 'admin')
					AND g.revoked_at IS NULL
					AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
			)
		)
	`, agentID, userID, userID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to check agent operation access: %w", err)
	}
	return count > 0, nil
}

func (db *DB) UserCanAccessProject(userID int, agentID string, projectID string) (bool, error) {
	if strings.TrimSpace(projectID) == "" {
		return db.UserCanAccessAgent(userID, agentID)
	}

	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM agents a
		WHERE a.id = ? AND (
			a.user_id = ?
			OR EXISTS (
				SELECT 1
				FROM agent_access_grants g
				WHERE g.controller_user_id = ?
					AND g.target_agent_id = a.id
					AND g.revoked_at IS NULL
					AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
					AND (
						g.scope_type = 'all_projects'
						OR NOT EXISTS (
							SELECT 1
							FROM agent_access_grant_projects gp
							WHERE gp.controller_user_id = g.controller_user_id
								AND gp.target_agent_id = g.target_agent_id
						)
						OR EXISTS (
							SELECT 1
							FROM agent_access_grant_projects gp
							WHERE gp.controller_user_id = g.controller_user_id
								AND gp.target_agent_id = g.target_agent_id
								AND gp.project_id = ?
						)
					)
			)
		)
	`, agentID, userID, userID, strings.TrimSpace(projectID)).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to check project access: %w", err)
	}
	return count > 0, nil
}

func (db *DB) ListAccessibleAgentsForUser(userID int) ([]AccessibleAgent, error) {
	rows, err := db.Query(`
		SELECT
			a.id,
			a.user_id,
			u.username,
			COALESCE(a.note, ''),
			CASE WHEN a.user_id = ? THEN 1 ELSE 0 END AS is_owned,
			COALESCE(g.created_by_user_id, 0),
			COALESCE(g.scope_type, ''),
			COALESCE(g.capability_bundle, ''),
			COALESCE(g.allow_file_download, 1),
			COALESCE(g.allow_diagnostics, 1),
			g.expires_at,
			a.created_at,
			g.created_at
		FROM agents a
		INNER JOIN users u ON u.id = a.user_id
		LEFT JOIN agent_access_grants g
			ON g.target_agent_id = a.id AND g.controller_user_id = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
		WHERE a.user_id = ? OR g.controller_user_id = ?
		ORDER BY is_owned DESC, COALESCE(g.created_at, a.created_at) DESC, a.id ASC
	`, userID, userID, userID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query accessible agents: %w", err)
	}
	defer rows.Close()

	var items []AccessibleAgent
	for rows.Next() {
		var item AccessibleAgent
		var isOwned int
		var allowFileDownload int
		var allowDiagnostics int
		var scopeType string
		var capabilityBundle string
		var expiresAt sql.NullTime
		var agentCreatedAt time.Time
		var grantCreatedAt sql.NullTime
		if err := rows.Scan(
			&item.AgentID,
			&item.OwnerUserID,
			&item.OwnerUsername,
			&item.OwnerNote,
			&isOwned,
			&item.GrantedByUserID,
			&scopeType,
			&capabilityBundle,
			&allowFileDownload,
			&allowDiagnostics,
			&expiresAt,
			&agentCreatedAt,
			&grantCreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan accessible agent: %w", err)
		}
		item.IsOwned = isOwned == 1
		item.GrantedProjectIDs = []string{}
		item.ScopeType = normalizeScopeType(scopeType, nil)
		item.CapabilityBundle = capabilityBundle
		item.AllowFileDownload = allowFileDownload != 0
		item.AllowDiagnostics = allowDiagnostics != 0
		item.ExpiresAt = ptrTime(expiresAt)
		item.CreatedAt = agentCreatedAt
		if grantCreatedAt.Valid {
			item.CreatedAt = grantCreatedAt.Time
		}
		if item.IsOwned {
			item.ScopeType = accessGrantScopeAllProjects
			item.CapabilityBundle = "admin"
			item.AllowFileDownload = true
			item.AllowDiagnostics = true
			item.ExpiresAt = nil
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read accessible agents: %w", err)
	}

	scopes, err := db.listGrantProjectIDsForController(userID)
	if err != nil {
		return nil, err
	}
	for index := range items {
		if items[index].IsOwned {
			continue
		}
		items[index].GrantedProjectIDs = scopes[items[index].AgentID]
		if items[index].GrantedProjectIDs == nil {
			items[index].GrantedProjectIDs = []string{}
		}
		if !items[index].IsOwned && len(items[index].GrantedProjectIDs) > 0 {
			items[index].ScopeType = accessGrantScopeSelectedProjects
		}
	}
	return items, nil
}

func (db *DB) CreateAgentAccessGrant(controllerUserID int, targetAgentID string, createdByUserID int, note string, projectIDs []string) error {
	return db.CreateAgentAccessGrantWithInput(AccessGrantInput{
		ControllerUserID:  controllerUserID,
		TargetAgentID:     targetAgentID,
		CreatedByUserID:   createdByUserID,
		Note:              note,
		ProjectIDs:        projectIDs,
		ScopeType:         normalizeScopeType("", normalizeAccessGrantProjectIDs(projectIDs)),
		CapabilityBundle:  "collaborate",
		AllowFileDownload: true,
		AllowDiagnostics:  true,
	})
}

func (db *DB) CreateAgentAccessGrantWithInput(input AccessGrantInput) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to start access grant transaction: %w", err)
	}
	defer tx.Rollback()

	if err := db.createAgentAccessGrantWithTx(tx, input); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit access grant: %w", err)
	}
	return nil
}

func (db *DB) createAgentAccessGrantWithTx(tx *sql.Tx, input AccessGrantInput) error {
	targetAgentID := strings.TrimSpace(input.TargetAgentID)
	var targetOwnerID int
	err := tx.QueryRow("SELECT user_id FROM agents WHERE id = ?", targetAgentID).Scan(&targetOwnerID)
	if err != nil {
		return fmt.Errorf("failed to get agent owner: %w", err)
	}
	if targetOwnerID == input.ControllerUserID {
		return fmt.Errorf("controller already owns the target agent")
	}

	normalizedProjectIDs := normalizeAccessGrantProjectIDs(input.ProjectIDs)
	if len(input.ProjectIDs) > 0 && len(normalizedProjectIDs) == 0 {
		return fmt.Errorf("at least one valid project id is required")
	}
	scopeType := normalizeScopeType(input.ScopeType, normalizedProjectIDs)
	if scopeType == accessGrantScopeSelectedProjects && len(normalizedProjectIDs) == 0 {
		return fmt.Errorf("at least one valid project id is required")
	}
	capabilityBundle := normalizeCapabilityBundle(input.CapabilityBundle)
	if strings.TrimSpace(input.CapabilityBundle) != "" && capabilityBundle == "" {
		return fmt.Errorf("invalid capability bundle")
	}
	if capabilityBundle == "" {
		capabilityBundle = "collaborate"
	}

	_, err = tx.Exec(`
		INSERT INTO agent_access_grants (
			controller_user_id,
			target_agent_id,
			scope_type,
			capability_bundle,
			allow_file_download,
			allow_diagnostics,
			note,
			created_by_user_id,
			expires_at,
			revoked_at,
			created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
		ON CONFLICT(controller_user_id, target_agent_id) DO UPDATE SET
			scope_type = excluded.scope_type,
			capability_bundle = excluded.capability_bundle,
			allow_file_download = excluded.allow_file_download,
			allow_diagnostics = excluded.allow_diagnostics,
			note = excluded.note,
			created_by_user_id = excluded.created_by_user_id,
			expires_at = excluded.expires_at,
			revoked_at = NULL,
			created_at = CURRENT_TIMESTAMP
	`, input.ControllerUserID, targetAgentID, scopeType, capabilityBundle, boolToInt(input.AllowFileDownload), boolToInt(input.AllowDiagnostics), strings.TrimSpace(input.Note), input.CreatedByUserID, input.ExpiresAt)
	if err != nil {
		return fmt.Errorf("failed to create access grant: %w", err)
	}

	if _, err := tx.Exec(`
		DELETE FROM agent_access_grant_projects
		WHERE controller_user_id = ? AND target_agent_id = ?
	`, input.ControllerUserID, targetAgentID); err != nil {
		return fmt.Errorf("failed to clear access grant project scope: %w", err)
	}

	for _, projectID := range normalizedProjectIDs {
		if _, err := tx.Exec(`
			INSERT INTO agent_access_grant_projects (controller_user_id, target_agent_id, project_id)
			VALUES (?, ?, ?)
		`, input.ControllerUserID, targetAgentID, projectID); err != nil {
			return fmt.Errorf("failed to save access grant project scope: %w", err)
		}
	}
	return nil
}

func (db *DB) GetAgentAccessGrant(controllerUserID int, targetAgentID string) (*AgentAccessGrant, error) {
	row := db.QueryRow(`
		SELECT
			g.controller_user_id,
			controller.username,
			g.target_agent_id,
			a.user_id,
			owner.username,
			COALESCE(g.scope_type, ''),
			COALESCE(g.capability_bundle, ''),
			COALESCE(g.allow_file_download, 1),
			COALESCE(g.allow_diagnostics, 1),
			g.expires_at,
			g.revoked_at,
			COALESCE(g.note, ''),
			g.created_by_user_id,
			g.created_at
		FROM agent_access_grants g
		INNER JOIN users controller ON controller.id = g.controller_user_id
		INNER JOIN agents a ON a.id = g.target_agent_id
		INNER JOIN users owner ON owner.id = a.user_id
		WHERE g.controller_user_id = ? AND g.target_agent_id = ?
	`, controllerUserID, strings.TrimSpace(targetAgentID))

	var grant AgentAccessGrant
	var allowFileDownload int
	var allowDiagnostics int
	var expiresAt sql.NullTime
	var revokedAt sql.NullTime
	if err := row.Scan(
		&grant.ControllerUserID,
		&grant.ControllerUsername,
		&grant.TargetAgentID,
		&grant.TargetOwnerUserID,
		&grant.TargetOwnerName,
		&grant.ScopeType,
		&grant.CapabilityBundle,
		&allowFileDownload,
		&allowDiagnostics,
		&expiresAt,
		&revokedAt,
		&grant.Note,
		&grant.CreatedByUserID,
		&grant.CreatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("grant not found")
		}
		return nil, fmt.Errorf("failed to load access grant: %w", err)
	}
	grant.ID = buildAccessGrantID(grant.ControllerUserID, grant.TargetAgentID)
	grant.GrantedProjectIDs = []string{}
	grant.AllowFileDownload = allowFileDownload != 0
	grant.AllowDiagnostics = allowDiagnostics != 0
	grant.ExpiresAt = ptrTime(expiresAt)
	grant.RevokedAt = ptrTime(revokedAt)

	projectIDs, err := db.listGrantProjectIDs(controllerUserID, targetAgentID)
	if err != nil {
		return nil, err
	}
	grant.GrantedProjectIDs = projectIDs
	if grant.ScopeType == "" {
		grant.ScopeType = normalizeScopeType("", projectIDs)
	}
	return &grant, nil
}

func (db *DB) GetAgentAccessGrantByID(grantID string) (*AgentAccessGrant, error) {
	controllerUserID, targetAgentID, err := parseAccessGrantID(grantID)
	if err != nil {
		return nil, err
	}
	return db.GetAgentAccessGrant(controllerUserID, targetAgentID)
}

func (db *DB) DeleteAgentAccessGrant(controllerUserID int, targetAgentID string) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to start delete access grant transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		DELETE FROM agent_access_grant_projects
		WHERE controller_user_id = ? AND target_agent_id = ?
	`, controllerUserID, targetAgentID); err != nil {
		return fmt.Errorf("failed to delete access grant projects: %w", err)
	}

	res, err := tx.Exec(`
		DELETE FROM agent_access_grants
		WHERE controller_user_id = ? AND target_agent_id = ?
	`, controllerUserID, targetAgentID)
	if err != nil {
		return fmt.Errorf("failed to delete access grant: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read delete result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("grant not found")
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit delete access grant: %w", err)
	}
	return nil
}

func (db *DB) RevokeAgentAccessGrantByID(grantID string) error {
	controllerUserID, targetAgentID, err := parseAccessGrantID(grantID)
	if err != nil {
		return err
	}
	return db.RevokeAgentAccessGrant(controllerUserID, targetAgentID)
}

func (db *DB) RevokeAgentAccessGrant(controllerUserID int, targetAgentID string) error {
	res, err := db.Exec(`
		UPDATE agent_access_grants
		SET revoked_at = CURRENT_TIMESTAMP
		WHERE controller_user_id = ? AND target_agent_id = ? AND revoked_at IS NULL
	`, controllerUserID, strings.TrimSpace(targetAgentID))
	if err != nil {
		return fmt.Errorf("failed to revoke access grant: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read revoke result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("grant not found")
	}
	return nil
}

func (db *DB) DeleteAgentAccessGrantByNote(controllerUserID int, targetAgentID string, note string) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to start delete access grant by note transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		DELETE FROM agent_access_grant_projects
		WHERE controller_user_id = ? AND target_agent_id = ?
			AND EXISTS (
				SELECT 1
				FROM agent_access_grants g
				WHERE g.controller_user_id = ?
					AND g.target_agent_id = ?
					AND g.note = ?
			)
	`, controllerUserID, targetAgentID, controllerUserID, targetAgentID, note); err != nil {
		return fmt.Errorf("failed to delete access grant projects by note: %w", err)
	}

	res, err := tx.Exec(`
		DELETE FROM agent_access_grants
		WHERE controller_user_id = ? AND target_agent_id = ? AND note = ?
	`, controllerUserID, targetAgentID, note)
	if err != nil {
		return fmt.Errorf("failed to delete access grant by note: %w", err)
	}
	if _, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("failed to read delete result: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit delete access grant by note: %w", err)
	}
	return nil
}

func (db *DB) ListIncomingAgentAccessGrants(ownerUserID int) ([]AgentAccessGrant, error) {
	rows, err := db.Query(`
		SELECT
			g.controller_user_id,
			controller.username,
			g.target_agent_id,
			a.user_id,
			owner.username,
			COALESCE(g.scope_type, ''),
			COALESCE(g.capability_bundle, ''),
			COALESCE(g.allow_file_download, 1),
			COALESCE(g.allow_diagnostics, 1),
			g.expires_at,
			g.revoked_at,
			COALESCE(g.note, ''),
			g.created_by_user_id,
			g.created_at
		FROM agent_access_grants g
		INNER JOIN users controller ON controller.id = g.controller_user_id
		INNER JOIN agents a ON a.id = g.target_agent_id
		INNER JOIN users owner ON owner.id = a.user_id
		WHERE a.user_id = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
		ORDER BY g.created_at DESC, g.target_agent_id ASC
	`, ownerUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to query incoming access grants: %w", err)
	}
	defer rows.Close()

	var grants []AgentAccessGrant
	for rows.Next() {
		var grant AgentAccessGrant
		var allowFileDownload int
		var allowDiagnostics int
		var expiresAt sql.NullTime
		var revokedAt sql.NullTime
		if err := rows.Scan(
			&grant.ControllerUserID,
			&grant.ControllerUsername,
			&grant.TargetAgentID,
			&grant.TargetOwnerUserID,
			&grant.TargetOwnerName,
			&grant.ScopeType,
			&grant.CapabilityBundle,
			&allowFileDownload,
			&allowDiagnostics,
			&expiresAt,
			&revokedAt,
			&grant.Note,
			&grant.CreatedByUserID,
			&grant.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan incoming access grant: %w", err)
		}
		grant.GrantedProjectIDs = []string{}
		grant.ID = buildAccessGrantID(grant.ControllerUserID, grant.TargetAgentID)
		grant.AllowFileDownload = allowFileDownload != 0
		grant.AllowDiagnostics = allowDiagnostics != 0
		grant.ExpiresAt = ptrTime(expiresAt)
		grant.RevokedAt = ptrTime(revokedAt)
		grants = append(grants, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read incoming access grants: %w", err)
	}

	scopes, err := db.listGrantProjectIDsForOwner(ownerUserID)
	if err != nil {
		return nil, err
	}
	for index := range grants {
		key := grantScopeKey(grants[index].ControllerUserID, grants[index].TargetAgentID)
		grants[index].GrantedProjectIDs = scopes[key]
		if grants[index].GrantedProjectIDs == nil {
			grants[index].GrantedProjectIDs = []string{}
		}
	}
	return grants, nil
}

func (db *DB) listGrantProjectIDsForController(controllerUserID int) (map[string][]string, error) {
	rows, err := db.Query(`
		SELECT target_agent_id, project_id
		FROM agent_access_grant_projects
		WHERE controller_user_id = ?
			AND EXISTS (
				SELECT 1
				FROM agent_access_grants g
				WHERE g.controller_user_id = agent_access_grant_projects.controller_user_id
					AND g.target_agent_id = agent_access_grant_projects.target_agent_id
					AND g.revoked_at IS NULL
					AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
			)
		ORDER BY target_agent_id ASC, project_id ASC
	`, controllerUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to query access grant project scopes: %w", err)
	}
	defer rows.Close()

	scopes := make(map[string][]string)
	for rows.Next() {
		var targetAgentID string
		var projectID string
		if err := rows.Scan(&targetAgentID, &projectID); err != nil {
			return nil, fmt.Errorf("failed to scan access grant project scope: %w", err)
		}
		scopes[targetAgentID] = append(scopes[targetAgentID], projectID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read access grant project scopes: %w", err)
	}
	return scopes, nil
}

func (db *DB) listGrantProjectIDs(controllerUserID int, targetAgentID string) ([]string, error) {
	rows, err := db.Query(`
		SELECT project_id
		FROM agent_access_grant_projects
		WHERE controller_user_id = ? AND target_agent_id = ?
		ORDER BY project_id ASC
	`, controllerUserID, strings.TrimSpace(targetAgentID))
	if err != nil {
		return nil, fmt.Errorf("failed to query access grant project scope: %w", err)
	}
	defer rows.Close()

	items := make([]string, 0)
	for rows.Next() {
		var projectID string
		if err := rows.Scan(&projectID); err != nil {
			return nil, fmt.Errorf("failed to scan access grant project scope: %w", err)
		}
		items = append(items, projectID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read access grant project scope: %w", err)
	}
	return items, nil
}

func (db *DB) listGrantProjectIDsForOwner(ownerUserID int) (map[string][]string, error) {
	rows, err := db.Query(`
		SELECT gp.controller_user_id, gp.target_agent_id, gp.project_id
		FROM agent_access_grant_projects gp
		INNER JOIN agents a ON a.id = gp.target_agent_id
		WHERE a.user_id = ?
			AND EXISTS (
				SELECT 1
				FROM agent_access_grants g
				WHERE g.controller_user_id = gp.controller_user_id
					AND g.target_agent_id = gp.target_agent_id
					AND g.revoked_at IS NULL
					AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
			)
		ORDER BY gp.controller_user_id ASC, gp.target_agent_id ASC, gp.project_id ASC
	`, ownerUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to query incoming access grant project scopes: %w", err)
	}
	defer rows.Close()

	scopes := make(map[string][]string)
	for rows.Next() {
		var controllerUserID int
		var targetAgentID string
		var projectID string
		if err := rows.Scan(&controllerUserID, &targetAgentID, &projectID); err != nil {
			return nil, fmt.Errorf("failed to scan incoming access grant project scope: %w", err)
		}
		key := grantScopeKey(controllerUserID, targetAgentID)
		scopes[key] = append(scopes[key], projectID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read incoming access grant project scopes: %w", err)
	}
	return scopes, nil
}

func (db *DB) ListEffectiveAgentScopesForUser(userID int) ([]EffectiveAgentScope, error) {
	agents, err := db.ListAccessibleAgentsForUser(userID)
	if err != nil {
		return nil, err
	}

	scopes := make([]EffectiveAgentScope, 0, len(agents))
	for _, agent := range agents {
		projectIDs := append([]string{}, agent.GrantedProjectIDs...)
		scopeType := agent.ScopeType
		if agent.IsOwned || scopeType == "" || (len(projectIDs) == 0 && scopeType != accessGrantScopeSelectedProjects) {
			scopeType = accessGrantScopeAllProjects
			projectIDs = []string{}
		}
		scopes = append(scopes, EffectiveAgentScope{
			AgentID:           agent.AgentID,
			OwnerUserID:       agent.OwnerUserID,
			OwnerUsername:     agent.OwnerUsername,
			IsOwned:           agent.IsOwned,
			ScopeType:         scopeType,
			ProjectIDs:        projectIDs,
			CapabilityBundle:  agent.CapabilityBundle,
			AllowFileDownload: agent.AllowFileDownload,
			AllowDiagnostics:  agent.AllowDiagnostics,
		})
	}
	return scopes, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
