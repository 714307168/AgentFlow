package db

import (
	"crypto/rand"
	"database/sql"
	"fmt"
	"math/big"
	"strings"
	"time"
)

type CollaborationGroupRecord struct {
	ID             int       `json:"id"`
	GroupNumber    string    `json:"group_number"`
	WorkgroupID    string    `json:"workgroup_id"`
	HostAgentID    string    `json:"host_agent_id"`
	OwnerUserID    int       `json:"owner_user_id"`
	OwnerUsername  string    `json:"owner_username"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	MemberSnapshot string    `json:"member_snapshot"`
	MemberCount    int       `json:"member_count"`
	IsOwner        bool      `json:"is_owner"`
	IsJoined       bool      `json:"is_joined"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type CollaborationGroupMemberRecord struct {
	UserID   int       `json:"user_id"`
	Username string    `json:"username"`
	IsOwner  bool      `json:"is_owner"`
	JoinedAt time.Time `json:"joined_at"`
}

func (db *DB) UpsertCollaborationGroup(
	ownerUserID int,
	hostAgentID string,
	workgroupID string,
	name string,
	description string,
	memberSnapshot string,
	requestedGroupNumber string,
) (*CollaborationGroupRecord, error) {
	hostAgentID = strings.TrimSpace(hostAgentID)
	workgroupID = strings.TrimSpace(workgroupID)
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	memberSnapshot = strings.TrimSpace(memberSnapshot)
	requestedGroupNumber = strings.TrimSpace(requestedGroupNumber)

	if ownerUserID <= 0 || hostAgentID == "" || workgroupID == "" || name == "" {
		return nil, fmt.Errorf("owner_user_id, host_agent_id, workgroup_id, and name are required")
	}
	if memberSnapshot == "" {
		memberSnapshot = "[]"
	}

	existing, err := db.GetCollaborationGroupByOwnerWorkgroup(ownerUserID, hostAgentID, workgroupID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}

	groupNumber := requestedGroupNumber
	if existing != nil && existing.GroupNumber != "" && groupNumber == "" {
		groupNumber = existing.GroupNumber
	}
	if groupNumber == "" {
		groupNumber, err = db.generateUniqueGroupNumber()
		if err != nil {
			return nil, err
		}
	} else if err := db.ensureCollaborationGroupNumberAvailable(groupNumber, existing); err != nil {
		return nil, err
	}

	if existing == nil {
		_, err = db.Exec(`
			INSERT INTO collaboration_groups (
				group_number, workgroup_id, host_agent_id, owner_user_id, name, description, member_snapshot, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		`, groupNumber, workgroupID, hostAgentID, ownerUserID, name, description, memberSnapshot)
		if err != nil {
			return nil, fmt.Errorf("failed to create collaboration group: %w", err)
		}
	} else {
		_, err = db.Exec(`
			UPDATE collaboration_groups
			SET group_number = ?, name = ?, description = ?, member_snapshot = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, groupNumber, name, description, memberSnapshot, existing.ID)
		if err != nil {
			return nil, fmt.Errorf("failed to update collaboration group: %w", err)
		}
	}

	record, err := db.GetCollaborationGroupByOwnerWorkgroup(ownerUserID, hostAgentID, workgroupID)
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (db *DB) GetCollaborationGroupByOwnerWorkgroup(ownerUserID int, hostAgentID string, workgroupID string) (*CollaborationGroupRecord, error) {
	return db.getCollaborationGroup(`
		SELECT
			g.id,
			g.group_number,
			g.workgroup_id,
			g.host_agent_id,
			g.owner_user_id,
			u.username,
			g.name,
			g.description,
			g.member_snapshot,
			(
				SELECT COUNT(*)
				FROM collaboration_group_memberships membership_count
				WHERE membership_count.group_id = g.id
			) + 1 AS member_count,
			1 AS is_owner,
			1 AS is_joined,
			g.created_at,
			g.updated_at
		FROM collaboration_groups g
		INNER JOIN users u ON u.id = g.owner_user_id
		WHERE g.owner_user_id = ? AND g.host_agent_id = ? AND g.workgroup_id = ?
	`, ownerUserID, strings.TrimSpace(hostAgentID), strings.TrimSpace(workgroupID))
}

func (db *DB) GetCollaborationGroupByHostWorkgroup(hostAgentID string, workgroupID string) (*CollaborationGroupRecord, error) {
	return db.getCollaborationGroup(`
		SELECT
			g.id,
			g.group_number,
			g.workgroup_id,
			g.host_agent_id,
			g.owner_user_id,
			u.username,
			g.name,
			g.description,
			g.member_snapshot,
			(
				SELECT COUNT(*)
				FROM collaboration_group_memberships membership_count
				WHERE membership_count.group_id = g.id
			) + 1 AS member_count,
			0 AS is_owner,
			0 AS is_joined,
			g.created_at,
			g.updated_at
		FROM collaboration_groups g
		INNER JOIN users u ON u.id = g.owner_user_id
		WHERE g.host_agent_id = ? AND g.workgroup_id = ?
	`, strings.TrimSpace(hostAgentID), strings.TrimSpace(workgroupID))
}

func (db *DB) GetCollaborationGroupByNumber(groupNumber string) (*CollaborationGroupRecord, error) {
	return db.getCollaborationGroup(`
		SELECT
			g.id,
			g.group_number,
			g.workgroup_id,
			g.host_agent_id,
			g.owner_user_id,
			u.username,
			g.name,
			g.description,
			g.member_snapshot,
			(
				SELECT COUNT(*)
				FROM collaboration_group_memberships membership_count
				WHERE membership_count.group_id = g.id
			) + 1 AS member_count,
			0 AS is_owner,
			0 AS is_joined,
			g.created_at,
			g.updated_at
		FROM collaboration_groups g
		INNER JOIN users u ON u.id = g.owner_user_id
		WHERE g.group_number = ?
	`, strings.TrimSpace(groupNumber))
}

func (db *DB) SearchCollaborationGroups(query string, limit int) ([]CollaborationGroupRecord, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []CollaborationGroupRecord{}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	rows, err := db.Query(`
		SELECT
			g.id,
			g.group_number,
			g.workgroup_id,
			g.host_agent_id,
			g.owner_user_id,
			u.username,
			g.name,
			g.description,
			g.member_snapshot,
			(
				SELECT COUNT(*)
				FROM collaboration_group_memberships membership_count
				WHERE membership_count.group_id = g.id
			) + 1 AS member_count,
			0 AS is_owner,
			0 AS is_joined,
			g.created_at,
			g.updated_at
		FROM collaboration_groups g
		INNER JOIN users u ON u.id = g.owner_user_id
		WHERE g.group_number = ?
		ORDER BY g.updated_at DESC
		LIMIT ?
	`, query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to search collaboration groups: %w", err)
	}
	defer rows.Close()

	var items []CollaborationGroupRecord
	for rows.Next() {
		record, err := scanCollaborationGroup(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *record)
	}
	return items, rows.Err()
}

func (db *DB) ListCollaborationGroupsForUser(userID int) ([]CollaborationGroupRecord, error) {
	rows, err := db.Query(`
		SELECT
			g.id,
			g.group_number,
			g.workgroup_id,
			g.host_agent_id,
			g.owner_user_id,
			u.username,
			g.name,
			g.description,
			g.member_snapshot,
			(
				SELECT COUNT(*)
				FROM collaboration_group_memberships membership_count
				WHERE membership_count.group_id = g.id
			) + 1 AS member_count,
			CASE WHEN g.owner_user_id = ? THEN 1 ELSE 0 END AS is_owner,
			CASE
				WHEN g.owner_user_id = ? THEN 1
				WHEN EXISTS (
					SELECT 1
					FROM collaboration_group_memberships memberships
					WHERE memberships.group_id = g.id AND memberships.user_id = ?
				) THEN 1
				ELSE 0
			END AS is_joined,
			g.created_at,
			g.updated_at
		FROM collaboration_groups g
		INNER JOIN users u ON u.id = g.owner_user_id
		WHERE
			g.owner_user_id = ?
			OR EXISTS (
				SELECT 1
				FROM collaboration_group_memberships memberships
				WHERE memberships.group_id = g.id AND memberships.user_id = ?
			)
		ORDER BY g.updated_at DESC, g.id DESC
	`, userID, userID, userID, userID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list collaboration groups: %w", err)
	}
	defer rows.Close()

	var items []CollaborationGroupRecord
	for rows.Next() {
		record, err := scanCollaborationGroup(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *record)
	}
	return items, rows.Err()
}

func (db *DB) DeleteCollaborationGroupByOwnerWorkgroup(ownerUserID int, hostAgentID string, workgroupID string) error {
	res, err := db.Exec(`
		DELETE FROM collaboration_groups
		WHERE owner_user_id = ? AND host_agent_id = ? AND workgroup_id = ?
	`, ownerUserID, strings.TrimSpace(hostAgentID), strings.TrimSpace(workgroupID))
	if err != nil {
		return fmt.Errorf("failed to delete collaboration group: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read delete result: %w", err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (db *DB) JoinCollaborationGroup(userID int, groupID int) (bool, error) {
	if userID <= 0 || groupID <= 0 {
		return false, fmt.Errorf("user_id and group_id are required")
	}
	_, err := db.Exec(`
		INSERT INTO collaboration_group_memberships (group_id, user_id)
		VALUES (?, ?)
	`, groupID, userID)
	if err != nil {
		if isUniqueConstraintError(err, "collaboration_group_memberships.group_id, collaboration_group_memberships.user_id") {
			return false, nil
		}
		return false, fmt.Errorf("failed to join collaboration group: %w", err)
	}
	return true, nil
}

func (db *DB) RemoveCollaborationGroupMembership(userID int, groupID int) error {
	if userID <= 0 || groupID <= 0 {
		return fmt.Errorf("user_id and group_id are required")
	}
	res, err := db.Exec(`
		DELETE FROM collaboration_group_memberships
		WHERE user_id = ? AND group_id = ?
	`, userID, groupID)
	if err != nil {
		return fmt.Errorf("failed to remove collaboration group membership: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read membership delete result: %w", err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (db *DB) ListCollaborationGroupMembers(groupID int) ([]CollaborationGroupMemberRecord, error) {
	rows, err := db.Query(`
		SELECT
			u.id,
			u.username,
			1 AS is_owner,
			g.created_at AS joined_at
		FROM collaboration_groups g
		INNER JOIN users u ON u.id = g.owner_user_id
		WHERE g.id = ?
		UNION ALL
		SELECT
			u.id,
			u.username,
			0 AS is_owner,
			m.created_at AS joined_at
		FROM collaboration_group_memberships m
		INNER JOIN users u ON u.id = m.user_id
		WHERE m.group_id = ?
		ORDER BY is_owner DESC, joined_at ASC, username COLLATE NOCASE ASC
	`, groupID, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to list collaboration group members: %w", err)
	}
	defer rows.Close()

	items := make([]CollaborationGroupMemberRecord, 0)
	for rows.Next() {
		var record CollaborationGroupMemberRecord
		var isOwner int
		if err := rows.Scan(
			&record.UserID,
			&record.Username,
			&isOwner,
			&record.JoinedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan collaboration group member: %w", err)
		}
		record.IsOwner = isOwner == 1
		items = append(items, record)
	}
	return items, rows.Err()
}

func (db *DB) CheckCollaborationGroupAccess(userID int, hostAgentID string, workgroupID string) (bool, bool, error) {
	if userID <= 0 || strings.TrimSpace(hostAgentID) == "" || strings.TrimSpace(workgroupID) == "" {
		return false, false, fmt.Errorf("user_id, host_agent_id, and workgroup_id are required")
	}

	record, err := db.GetCollaborationGroupByHostWorkgroup(hostAgentID, workgroupID)
	if err == sql.ErrNoRows {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	if record.OwnerUserID == userID {
		return true, true, nil
	}

	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM collaboration_group_memberships
		WHERE group_id = ? AND user_id = ?
	`, record.ID, userID).Scan(&count); err != nil {
		return true, false, fmt.Errorf("failed to check collaboration group membership: %w", err)
	}
	return true, count > 0, nil
}

func (db *DB) HasAnyCollaborationGroupAccess(userID int, hostAgentID string) (bool, error) {
	if userID <= 0 || strings.TrimSpace(hostAgentID) == "" {
		return false, fmt.Errorf("user_id and host_agent_id are required")
	}

	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM collaboration_groups g
		WHERE g.host_agent_id = ?
			AND (
				g.owner_user_id = ?
				OR EXISTS (
					SELECT 1
					FROM collaboration_group_memberships m
					WHERE m.group_id = g.id AND m.user_id = ?
				)
			)
	`, strings.TrimSpace(hostAgentID), userID, userID).Scan(&count); err != nil {
		return false, fmt.Errorf("failed to check collaboration agent membership: %w", err)
	}
	return count > 0, nil
}

func (db *DB) ensureCollaborationGroupNumberAvailable(groupNumber string, existing *CollaborationGroupRecord) error {
	current, err := db.GetCollaborationGroupByNumber(groupNumber)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if existing != nil && current.ID == existing.ID {
		return nil
	}
	return fmt.Errorf("group number already exists")
}

func (db *DB) generateUniqueGroupNumber() (string, error) {
	for attempt := 0; attempt < 20; attempt += 1 {
		value, err := randomDigits(8)
		if err != nil {
			return "", err
		}
		_, err = db.GetCollaborationGroupByNumber(value)
		if err == sql.ErrNoRows {
			return value, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("failed to generate unique group number")
}

func randomDigits(length int) (string, error) {
	if length <= 0 {
		return "", fmt.Errorf("invalid digit length")
	}
	var builder strings.Builder
	for builder.Len() < length {
		value, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", fmt.Errorf("failed to read random digits: %w", err)
		}
		builder.WriteString(value.String())
	}
	return builder.String(), nil
}

func (db *DB) getCollaborationGroup(query string, args ...interface{}) (*CollaborationGroupRecord, error) {
	row := db.QueryRow(query, args...)
	record, err := scanCollaborationGroup(row)
	if err != nil {
		return nil, err
	}
	return record, nil
}

type collaborationGroupScanner interface {
	Scan(dest ...interface{}) error
}

func scanCollaborationGroup(scanner collaborationGroupScanner) (*CollaborationGroupRecord, error) {
	var record CollaborationGroupRecord
	var isOwner int
	var isJoined int
	if err := scanner.Scan(
		&record.ID,
		&record.GroupNumber,
		&record.WorkgroupID,
		&record.HostAgentID,
		&record.OwnerUserID,
		&record.OwnerUsername,
		&record.Name,
		&record.Description,
		&record.MemberSnapshot,
		&record.MemberCount,
		&isOwner,
		&isJoined,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return nil, err
	}
	record.IsOwner = isOwner == 1
	record.IsJoined = isJoined == 1
	return &record, nil
}
