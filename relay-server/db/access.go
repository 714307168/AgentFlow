package db

import (
	"database/sql"
	"fmt"
	"time"
)

type AccessibleAgent struct {
	AgentID         string    `json:"agent_id"`
	OwnerUserID     int       `json:"owner_user_id"`
	OwnerUsername   string    `json:"owner_username"`
	OwnerNote       string    `json:"owner_note"`
	IsOwned         bool      `json:"is_owned"`
	GrantedByUserID int       `json:"granted_by_user_id"`
	CreatedAt       time.Time `json:"created_at"`
}

type AgentAccessGrant struct {
	ControllerUserID   int       `json:"controller_user_id"`
	ControllerUsername string    `json:"controller_username"`
	TargetAgentID      string    `json:"target_agent_id"`
	TargetOwnerUserID  int       `json:"target_owner_user_id"`
	TargetOwnerName    string    `json:"target_owner_name"`
	Note               string    `json:"note"`
	CreatedByUserID    int       `json:"created_by_user_id"`
	CreatedAt          time.Time `json:"created_at"`
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
			)
		)
	`, agentID, userID, userID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to check agent access: %w", err)
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
			a.created_at,
			g.created_at
		FROM agents a
		INNER JOIN users u ON u.id = a.user_id
		LEFT JOIN agent_access_grants g
			ON g.target_agent_id = a.id AND g.controller_user_id = ?
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
		var agentCreatedAt time.Time
		var grantCreatedAt sql.NullTime
		if err := rows.Scan(
			&item.AgentID,
			&item.OwnerUserID,
			&item.OwnerUsername,
			&item.OwnerNote,
			&isOwned,
			&item.GrantedByUserID,
			&agentCreatedAt,
			&grantCreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan accessible agent: %w", err)
		}
		item.IsOwned = isOwned == 1
		item.CreatedAt = agentCreatedAt
		if grantCreatedAt.Valid {
			item.CreatedAt = grantCreatedAt.Time
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read accessible agents: %w", err)
	}
	return items, nil
}

func (db *DB) CreateAgentAccessGrant(controllerUserID int, targetAgentID string, createdByUserID int, note string) error {
	targetOwnerID, err := db.GetAgentUserID(targetAgentID)
	if err != nil {
		return err
	}
	if targetOwnerID == controllerUserID {
		return fmt.Errorf("controller already owns the target agent")
	}

	_, err = db.Exec(`
		INSERT INTO agent_access_grants (controller_user_id, target_agent_id, note, created_by_user_id)
		VALUES (?, ?, ?, ?)
	`, controllerUserID, targetAgentID, note, createdByUserID)
	if err != nil {
		if isUniqueConstraintError(err, "agent_access_grants.controller_user_id, agent_access_grants.target_agent_id") {
			return fmt.Errorf("grant already exists")
		}
		if isUniqueConstraintError(err, "agent_access_grants.target_agent_id") {
			return fmt.Errorf("grant already exists")
		}
		return fmt.Errorf("failed to create access grant: %w", err)
	}
	return nil
}

func (db *DB) DeleteAgentAccessGrant(controllerUserID int, targetAgentID string) error {
	res, err := db.Exec(`
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
			COALESCE(g.note, ''),
			g.created_by_user_id,
			g.created_at
		FROM agent_access_grants g
		INNER JOIN users controller ON controller.id = g.controller_user_id
		INNER JOIN agents a ON a.id = g.target_agent_id
		INNER JOIN users owner ON owner.id = a.user_id
		WHERE a.user_id = ?
		ORDER BY g.created_at DESC, g.target_agent_id ASC
	`, ownerUserID)
	if err != nil {
		return nil, fmt.Errorf("failed to query incoming access grants: %w", err)
	}
	defer rows.Close()

	var grants []AgentAccessGrant
	for rows.Next() {
		var grant AgentAccessGrant
		if err := rows.Scan(
			&grant.ControllerUserID,
			&grant.ControllerUsername,
			&grant.TargetAgentID,
			&grant.TargetOwnerUserID,
			&grant.TargetOwnerName,
			&grant.Note,
			&grant.CreatedByUserID,
			&grant.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan incoming access grant: %w", err)
		}
		grants = append(grants, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read incoming access grants: %w", err)
	}
	return grants, nil
}
