package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	executionRequestPending  = "pending"
	executionRequestApproved = "approved"
	executionRequestRejected = "rejected"
	executionRequestRevoked  = "revoked"
)

type CollaborationExecutionRequestRecord struct {
	ID              string    `json:"id"`
	GroupID         int       `json:"group_id"`
	GroupNumber     string    `json:"group_number"`
	WorkgroupID     string    `json:"workgroup_id"`
	RequesterUserID int       `json:"requester_user_id"`
	RequesterName   string    `json:"requester_name"`
	TargetAgentID   string    `json:"target_agent_id"`
	ProjectIDs      []string  `json:"project_ids"`
	Status          string    `json:"status"`
	DecisionNote    string    `json:"decision_note"`
	DecidedByUserID *int      `json:"decided_by_user_id,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (db *DB) CreateCollaborationExecutionRequest(groupID, requesterUserID int, targetAgentID string, projectIDs []string) (*CollaborationExecutionRequestRecord, error) {
	targetAgentID = strings.TrimSpace(targetAgentID)
	projectIDs = normalizeAccessGrantProjectIDs(projectIDs)
	if groupID <= 0 || requesterUserID <= 0 || targetAgentID == "" || len(projectIDs) == 0 {
		return nil, fmt.Errorf("group, requester, target agent, and at least one project are required")
	}

	var ownerUserID int
	if err := db.QueryRow("SELECT user_id FROM agents WHERE id = ?", targetAgentID).Scan(&ownerUserID); err != nil {
		return nil, fmt.Errorf("failed to verify target agent: %w", err)
	}
	if ownerUserID != requesterUserID {
		return nil, fmt.Errorf("only the target agent owner can request execution access")
	}

	var existingID string
	err := db.QueryRow(`
		SELECT id FROM collaboration_execution_requests
		WHERE group_id = ? AND target_agent_id = ? AND status = 'pending'
		ORDER BY created_at DESC LIMIT 1
	`, groupID, targetAgentID).Scan(&existingID)
	if err == nil {
		return db.GetCollaborationExecutionRequest(existingID)
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to check pending execution request: %w", err)
	}

	encodedProjects, err := json.Marshal(projectIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to encode project scope: %w", err)
	}
	requestID := uuid.NewString()
	if _, err := db.Exec(`
		INSERT INTO collaboration_execution_requests (id, group_id, requester_user_id, target_agent_id, project_ids, status, updated_at)
		VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
	`, requestID, groupID, requesterUserID, targetAgentID, string(encodedProjects)); err != nil {
		return nil, fmt.Errorf("failed to create execution request: %w", err)
	}
	return db.GetCollaborationExecutionRequest(requestID)
}

func (db *DB) GetCollaborationExecutionRequest(requestID string) (*CollaborationExecutionRequestRecord, error) {
	return db.getCollaborationExecutionRequest(`
		SELECT r.id, r.group_id, g.group_number, g.workgroup_id, r.requester_user_id, u.username,
			r.target_agent_id, r.project_ids, r.status, r.decision_note, r.decided_by_user_id, r.created_at, r.updated_at
		FROM collaboration_execution_requests r
		INNER JOIN collaboration_groups g ON g.id = r.group_id
		INNER JOIN users u ON u.id = r.requester_user_id
		WHERE r.id = ?
	`, strings.TrimSpace(requestID))
}

func (db *DB) ListCollaborationExecutionRequests(groupID, requesterUserID int) ([]CollaborationExecutionRequestRecord, error) {
	query := `
		SELECT r.id, r.group_id, g.group_number, g.workgroup_id, r.requester_user_id, u.username,
			r.target_agent_id, r.project_ids, r.status, r.decision_note, r.decided_by_user_id, r.created_at, r.updated_at
		FROM collaboration_execution_requests r
		INNER JOIN collaboration_groups g ON g.id = r.group_id
		INNER JOIN users u ON u.id = r.requester_user_id
		WHERE r.group_id = ?`
	args := []any{groupID}
	if requesterUserID > 0 {
		query += " AND r.requester_user_id = ?"
		args = append(args, requesterUserID)
	}
	query += " ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.updated_at DESC"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list execution requests: %w", err)
	}
	defer rows.Close()
	items := make([]CollaborationExecutionRequestRecord, 0)
	for rows.Next() {
		item, err := scanCollaborationExecutionRequest(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, rows.Err()
}

func (db *DB) DecideCollaborationExecutionRequest(requestID string, ownerUserID int, approve bool, note string) (*CollaborationExecutionRequestRecord, error) {
	request, err := db.GetCollaborationExecutionRequest(requestID)
	if err != nil {
		return nil, err
	}
	if request.Status != executionRequestPending {
		return nil, fmt.Errorf("execution request is no longer pending")
	}
	var groupOwnerID int
	if err := db.QueryRow("SELECT owner_user_id FROM collaboration_groups WHERE id = ?", request.GroupID).Scan(&groupOwnerID); err != nil {
		return nil, fmt.Errorf("failed to verify group owner: %w", err)
	}
	if groupOwnerID != ownerUserID {
		return nil, fmt.Errorf("only the group owner can decide execution requests")
	}

	status := executionRequestRejected
	if approve {
		existingGrant, grantErr := db.GetAgentAccessGrant(ownerUserID, request.TargetAgentID)
		if grantErr == nil && existingGrant.RevokedAt == nil && !strings.HasPrefix(existingGrant.Note, "swarm-execution:") {
			return nil, fmt.Errorf("target agent already has an independent access grant; keep it separate from swarm access")
		}
		if grantErr != nil && !strings.Contains(strings.ToLower(grantErr.Error()), "grant not found") {
			return nil, grantErr
		}
		status = executionRequestApproved
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("failed to start execution request decision: %w", err)
	}
	defer tx.Rollback()
	if approve {
		if err := db.createAgentAccessGrantWithTx(tx, AccessGrantInput{
			ControllerUserID:  ownerUserID,
			TargetAgentID:     request.TargetAgentID,
			CreatedByUserID:   ownerUserID,
			Note:              swarmExecutionGrantNote(request.GroupNumber, request.ID),
			ProjectIDs:        request.ProjectIDs,
			ScopeType:         accessGrantScopeSelectedProjects,
			CapabilityBundle:  "collaborate",
			AllowFileDownload: false,
			AllowDiagnostics:  true,
		}); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(`
		UPDATE collaboration_execution_requests
		SET status = ?, decision_note = ?, decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status = 'pending'
	`, status, strings.TrimSpace(note), ownerUserID, request.ID); err != nil {
		return nil, fmt.Errorf("failed to save execution request decision: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit execution request decision: %w", err)
	}
	return db.GetCollaborationExecutionRequest(request.ID)
}

func (db *DB) RevokeCollaborationExecutionRequest(requestID string, ownerUserID int, note string) (*CollaborationExecutionRequestRecord, error) {
	request, err := db.GetCollaborationExecutionRequest(requestID)
	if err != nil {
		return nil, err
	}
	if request.Status != executionRequestApproved {
		return nil, fmt.Errorf("only approved execution requests can be revoked")
	}
	var groupOwnerID int
	if err := db.QueryRow("SELECT owner_user_id FROM collaboration_groups WHERE id = ?", request.GroupID).Scan(&groupOwnerID); err != nil {
		return nil, fmt.Errorf("failed to verify group owner: %w", err)
	}
	if groupOwnerID != ownerUserID {
		return nil, fmt.Errorf("only the group owner can revoke execution requests")
	}
	if err := db.DeleteAgentAccessGrantByNote(ownerUserID, request.TargetAgentID, swarmExecutionGrantNote(request.GroupNumber, request.ID)); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`
		UPDATE collaboration_execution_requests
		SET status = 'revoked', decision_note = ?, decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, strings.TrimSpace(note), ownerUserID, request.ID); err != nil {
		return nil, fmt.Errorf("failed to revoke execution request: %w", err)
	}
	return db.GetCollaborationExecutionRequest(request.ID)
}

func swarmExecutionGrantNote(groupNumber, requestID string) string {
	return "swarm-execution:" + strings.TrimSpace(groupNumber) + ":" + strings.TrimSpace(requestID)
}

type collaborationExecutionRequestScanner interface{ Scan(dest ...any) error }

func (db *DB) getCollaborationExecutionRequest(query string, args ...any) (*CollaborationExecutionRequestRecord, error) {
	row := db.QueryRow(query, args...)
	return scanCollaborationExecutionRequest(row)
}

func scanCollaborationExecutionRequest(scanner collaborationExecutionRequestScanner) (*CollaborationExecutionRequestRecord, error) {
	var record CollaborationExecutionRequestRecord
	var projectJSON string
	var decidedBy sql.NullInt64
	if err := scanner.Scan(&record.ID, &record.GroupID, &record.GroupNumber, &record.WorkgroupID, &record.RequesterUserID, &record.RequesterName,
		&record.TargetAgentID, &projectJSON, &record.Status, &record.DecisionNote, &decidedBy, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(projectJSON), &record.ProjectIDs); err != nil {
		return nil, fmt.Errorf("failed to decode execution request project scope: %w", err)
	}
	if decidedBy.Valid {
		value := int(decidedBy.Int64)
		record.DecidedByUserID = &value
	}
	return &record, nil
}
