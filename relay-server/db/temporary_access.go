package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type TemporaryAccessLink struct {
	ID                int        `json:"id"`
	TokenHash         string     `json:"-"`
	CreatedByUserID   int        `json:"created_by_user_id"`
	TargetAgentID     string     `json:"target_agent_id"`
	GrantedProjectIDs []string   `json:"granted_project_ids"`
	ScopeType         string     `json:"scope_type"`
	CapabilityBundle  string     `json:"capability_bundle"`
	AllowFileDownload bool       `json:"allow_file_download"`
	AllowDiagnostics  bool       `json:"allow_diagnostics"`
	Note              string     `json:"note"`
	MaxUses           int        `json:"max_uses"`
	UsedCount         int        `json:"used_count"`
	RemainingUses     int        `json:"remaining_uses"`
	ExpiresAt         time.Time  `json:"expires_at"`
	RevokedAt         *time.Time `json:"revoked_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type TemporaryAccessLinkInput struct {
	TokenHash         string
	CreatedByUserID   int
	TargetAgentID     string
	ProjectIDs        []string
	ScopeType         string
	CapabilityBundle  string
	AllowFileDownload bool
	AllowDiagnostics  bool
	Note              string
	MaxUses           int
	ExpiresAt         time.Time
}

func normalizeTemporaryAccessLinkInput(input TemporaryAccessLinkInput) (TemporaryAccessLinkInput, error) {
	input.TokenHash = strings.TrimSpace(input.TokenHash)
	input.TargetAgentID = strings.TrimSpace(input.TargetAgentID)
	input.Note = strings.TrimSpace(input.Note)
	input.ProjectIDs = normalizeAccessGrantProjectIDs(input.ProjectIDs)
	input.ScopeType = normalizeScopeType(input.ScopeType, input.ProjectIDs)
	input.CapabilityBundle = normalizeCapabilityBundle(input.CapabilityBundle)
	if input.TokenHash == "" {
		return input, fmt.Errorf("token hash is required")
	}
	if input.CreatedByUserID <= 0 {
		return input, fmt.Errorf("created_by_user_id is required")
	}
	if input.TargetAgentID == "" {
		return input, fmt.Errorf("target_agent_id is required")
	}
	if input.ScopeType == accessGrantScopeSelectedProjects && len(input.ProjectIDs) == 0 {
		return input, fmt.Errorf("at least one valid project id is required")
	}
	if input.CapabilityBundle == "" {
		input.CapabilityBundle = "collaborate"
	}
	if input.MaxUses <= 0 {
		return input, fmt.Errorf("max_uses must be greater than zero")
	}
	if input.MaxUses > 1000 {
		return input, fmt.Errorf("max_uses cannot exceed 1000")
	}
	if input.ExpiresAt.IsZero() || !input.ExpiresAt.After(time.Now()) {
		return input, fmt.Errorf("expires_at must be in the future")
	}
	return input, nil
}

func (db *DB) CreateTemporaryAccessLink(input TemporaryAccessLinkInput) (*TemporaryAccessLink, error) {
	input, err := normalizeTemporaryAccessLinkInput(input)
	if err != nil {
		return nil, err
	}
	if _, err := db.GetAgentUserID(input.TargetAgentID); err != nil {
		return nil, err
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("failed to start temporary access link transaction: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
		INSERT INTO temporary_access_links (
			token_hash,
			created_by_user_id,
			target_agent_id,
			scope_type,
			capability_bundle,
			allow_file_download,
			allow_diagnostics,
			note,
			max_uses,
			expires_at,
			created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, input.TokenHash, input.CreatedByUserID, input.TargetAgentID, input.ScopeType, input.CapabilityBundle, boolToInt(input.AllowFileDownload), boolToInt(input.AllowDiagnostics), input.Note, input.MaxUses, input.ExpiresAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create temporary access link: %w", err)
	}
	linkID, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to read temporary access link id: %w", err)
	}
	for _, projectID := range input.ProjectIDs {
		if _, err := tx.Exec(`
			INSERT INTO temporary_access_link_projects (link_id, project_id)
			VALUES (?, ?)
		`, linkID, projectID); err != nil {
			return nil, fmt.Errorf("failed to save temporary access project scope: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit temporary access link: %w", err)
	}
	return db.GetTemporaryAccessLinkByHash(input.TokenHash)
}

func (db *DB) GetTemporaryAccessLinkByHash(tokenHash string) (*TemporaryAccessLink, error) {
	link, err := scanTemporaryAccessLink(db.QueryRow(`
		SELECT
			id,
			token_hash,
			created_by_user_id,
			target_agent_id,
			COALESCE(scope_type, ''),
			COALESCE(capability_bundle, ''),
			COALESCE(allow_file_download, 1),
			COALESCE(allow_diagnostics, 1),
			COALESCE(note, ''),
			max_uses,
			used_count,
			expires_at,
			revoked_at,
			created_at
		FROM temporary_access_links
		WHERE token_hash = ?
	`, strings.TrimSpace(tokenHash)))
	if err != nil {
		return nil, err
	}
	projects, err := db.listTemporaryAccessLinkProjectIDs(link.ID)
	if err != nil {
		return nil, err
	}
	link.GrantedProjectIDs = projects
	return link, nil
}

func (db *DB) RedeemTemporaryAccessLink(tokenHash string, controllerUserID int) (*TemporaryAccessLink, error) {
	if controllerUserID <= 0 {
		return nil, fmt.Errorf("controller user is required")
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("failed to start temporary access redemption transaction: %w", err)
	}
	defer tx.Rollback()

	link, err := scanTemporaryAccessLink(tx.QueryRow(`
		SELECT
			id,
			token_hash,
			created_by_user_id,
			target_agent_id,
			COALESCE(scope_type, ''),
			COALESCE(capability_bundle, ''),
			COALESCE(allow_file_download, 1),
			COALESCE(allow_diagnostics, 1),
			COALESCE(note, ''),
			max_uses,
			used_count,
			expires_at,
			revoked_at,
			created_at
		FROM temporary_access_links
		WHERE token_hash = ?
	`, strings.TrimSpace(tokenHash)))
	if err != nil {
		return nil, err
	}
	if link.RevokedAt != nil {
		return nil, fmt.Errorf("temporary access link has been disabled")
	}
	if !link.ExpiresAt.After(time.Now()) {
		return nil, fmt.Errorf("temporary access link has expired")
	}
	if link.UsedCount >= link.MaxUses {
		return nil, fmt.Errorf("temporary access link has no remaining uses")
	}

	projects, err := listTemporaryAccessLinkProjectIDsTx(tx, link.ID)
	if err != nil {
		return nil, err
	}
	link.GrantedProjectIDs = projects

	if err := db.createAgentAccessGrantWithTx(tx, AccessGrantInput{
		ControllerUserID:  controllerUserID,
		TargetAgentID:     link.TargetAgentID,
		CreatedByUserID:   link.CreatedByUserID,
		Note:              "temporary share: " + link.Note,
		ProjectIDs:        link.GrantedProjectIDs,
		ScopeType:         link.ScopeType,
		CapabilityBundle:  link.CapabilityBundle,
		AllowFileDownload: link.AllowFileDownload,
		AllowDiagnostics:  link.AllowDiagnostics,
		ExpiresAt:         &link.ExpiresAt,
	}); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(`
		UPDATE temporary_access_links
		SET
			used_count = used_count + 1,
			revoked_at = CASE WHEN used_count + 1 >= max_uses THEN CURRENT_TIMESTAMP ELSE revoked_at END
		WHERE id = ? AND revoked_at IS NULL AND used_count < max_uses
	`, link.ID); err != nil {
		return nil, fmt.Errorf("failed to update temporary access usage: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit temporary access redemption: %w", err)
	}
	return db.GetTemporaryAccessLinkByHash(tokenHash)
}

func scanTemporaryAccessLink(row *sql.Row) (*TemporaryAccessLink, error) {
	var link TemporaryAccessLink
	var allowFileDownload int
	var allowDiagnostics int
	var revokedAt sql.NullTime
	if err := row.Scan(
		&link.ID,
		&link.TokenHash,
		&link.CreatedByUserID,
		&link.TargetAgentID,
		&link.ScopeType,
		&link.CapabilityBundle,
		&allowFileDownload,
		&allowDiagnostics,
		&link.Note,
		&link.MaxUses,
		&link.UsedCount,
		&link.ExpiresAt,
		&revokedAt,
		&link.CreatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("temporary access link not found")
		}
		return nil, fmt.Errorf("failed to load temporary access link: %w", err)
	}
	link.AllowFileDownload = allowFileDownload != 0
	link.AllowDiagnostics = allowDiagnostics != 0
	link.RevokedAt = ptrTime(revokedAt)
	link.RemainingUses = link.MaxUses - link.UsedCount
	if link.RemainingUses < 0 {
		link.RemainingUses = 0
	}
	return &link, nil
}

func (db *DB) listTemporaryAccessLinkProjectIDs(linkID int) ([]string, error) {
	return listTemporaryAccessLinkProjectIDsTx(db.DB, linkID)
}

type temporaryProjectQueryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

func listTemporaryAccessLinkProjectIDsTx(queryer temporaryProjectQueryer, linkID int) ([]string, error) {
	rows, err := queryer.Query(`
		SELECT project_id
		FROM temporary_access_link_projects
		WHERE link_id = ?
		ORDER BY project_id ASC
	`, linkID)
	if err != nil {
		return nil, fmt.Errorf("failed to query temporary access project scope: %w", err)
	}
	defer rows.Close()

	projectIDs := []string{}
	for rows.Next() {
		var projectID string
		if err := rows.Scan(&projectID); err != nil {
			return nil, fmt.Errorf("failed to scan temporary access project scope: %w", err)
		}
		projectIDs = append(projectIDs, projectID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read temporary access project scope: %w", err)
	}
	return projectIDs, nil
}
