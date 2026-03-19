package db

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/claudecode/relay-server/auth"
)

// User represents a user in the system
type User struct {
	ID           int
	Username     string
	PasswordHash string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// GetUserByUsername retrieves a user by username
func (db *DB) GetUserByUsername(username string) (*User, error) {
	user := &User{}
	err := db.QueryRow(`
		SELECT id, username, password_hash, created_at, updated_at
		FROM users
		WHERE username = ?
	`, username).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return user, nil
}

// GetUserByID retrieves a user by ID
func (db *DB) GetUserByID(id int) (*User, error) {
	user := &User{}
	err := db.QueryRow(`
		SELECT id, username, password_hash, created_at, updated_at
		FROM users
		WHERE id = ?
	`, id).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return user, nil
}

// AuthenticateUser verifies username and password
func (db *DB) AuthenticateUser(username, password string) (*User, error) {
	user, err := db.GetUserByUsername(username)
	if err != nil {
		return nil, err
	}

	if !auth.VerifyPassword(password, user.PasswordHash) {
		return nil, fmt.Errorf("invalid credentials")
	}

	return user, nil
}

// ChangePassword changes a user's password
func (db *DB) ChangePassword(username, oldPassword, newPassword string) error {
	// Verify old password
	user, err := db.AuthenticateUser(username, oldPassword)
	if err != nil {
		return err
	}

	// Validate new password
	if err := auth.ValidatePassword(newPassword); err != nil {
		return err
	}

	// Hash new password
	hash, err := auth.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Update password
	_, err = db.Exec(`
		UPDATE users
		SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, hash, user.ID)

	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	return nil
}

// AgentBelongsToUser checks if an agent belongs to a user
func (db *DB) AgentBelongsToUser(agentID string, userID int) (bool, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM agents
		WHERE id = ? AND user_id = ?
	`, agentID, userID).Scan(&count)

	if err != nil {
		return false, fmt.Errorf("failed to check agent ownership: %w", err)
	}

	return count > 0, nil
}

// DeviceBelongsToUser checks if a device belongs to a user
func (db *DB) DeviceBelongsToUser(deviceID string, userID int) (bool, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM devices
		WHERE id = ? AND user_id = ?
	`, deviceID, userID).Scan(&count)

	if err != nil {
		return false, fmt.Errorf("failed to check device ownership: %w", err)
	}

	return count > 0, nil
}

// RegisterAgent registers a new agent for a user
func (db *DB) RegisterAgent(agentID string, userID int, note string) error {
	_, err := db.Exec(`
		INSERT INTO agents (id, user_id, note)
		VALUES (?, ?, ?)
	`, agentID, userID, note)

	if err != nil {
		return fmt.Errorf("failed to register agent: %w", err)
	}

	return nil
}

// RegisterDevice registers a new device for a user
func (db *DB) RegisterDevice(deviceID string, userID int, agentID, note string) error {
	var agentIDNull sql.NullString
	if agentID != "" {
		agentIDNull = sql.NullString{String: agentID, Valid: true}
	}

	_, err := db.Exec(`
		INSERT INTO devices (id, user_id, agent_id, note)
		VALUES (?, ?, ?, ?)
	`, deviceID, userID, agentIDNull, note)

	if err != nil {
		return fmt.Errorf("failed to register device: %w", err)
	}

	return nil
}

// GetUserAgents returns all agents for a user
func (db *DB) GetUserAgents(userID int) ([]map[string]string, error) {
	rows, err := db.Query(`
		SELECT id, note, created_at
		FROM agents
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query agents: %w", err)
	}
	defer rows.Close()

	var agents []map[string]string
	for rows.Next() {
		var id, note string
		var createdAt time.Time
		if err := rows.Scan(&id, &note, &createdAt); err != nil {
			return nil, fmt.Errorf("failed to scan agent: %w", err)
		}

		agents = append(agents, map[string]string{
			"id":         id,
			"note":       note,
			"created_at": createdAt.Format(time.RFC3339),
		})
	}

	return agents, nil
}

// GetUserDevices returns all devices for a user
func (db *DB) GetUserDevices(userID int) ([]map[string]string, error) {
	rows, err := db.Query(`
		SELECT id, agent_id, note, created_at
		FROM devices
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query devices: %w", err)
	}
	defer rows.Close()

	var devices []map[string]string
	for rows.Next() {
		var id, note string
		var agentID sql.NullString
		var createdAt time.Time
		if err := rows.Scan(&id, &agentID, &note, &createdAt); err != nil {
			return nil, fmt.Errorf("failed to scan device: %w", err)
		}

		device := map[string]string{
			"id":         id,
			"note":       note,
			"created_at": createdAt.Format(time.RFC3339),
		}
		if agentID.Valid {
			device["agent_id"] = agentID.String
		}

		devices = append(devices, device)
	}

	return devices, nil
}

// GetDeviceAgentID returns the bound agent ID for a device.
func (db *DB) GetDeviceAgentID(deviceID string) (string, error) {
	var agentID sql.NullString
	err := db.QueryRow("SELECT agent_id FROM devices WHERE id = ?", deviceID).Scan(&agentID)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("device not found")
	}
	if err != nil {
		return "", fmt.Errorf("failed to get device agent id: %w", err)
	}
	if !agentID.Valid {
		return "", nil
	}
	return agentID.String, nil
}

// GetSingleAgentIDForUser returns the agent id only when user has exactly one agent.
func (db *DB) GetSingleAgentIDForUser(userID int) (string, error) {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM agents WHERE user_id = ?", userID).Scan(&count); err != nil {
		return "", fmt.Errorf("failed to count user agents: %w", err)
	}
	if count != 1 {
		return "", nil
	}

	var agentID string
	if err := db.QueryRow("SELECT id FROM agents WHERE user_id = ? LIMIT 1", userID).Scan(&agentID); err != nil {
		return "", fmt.Errorf("failed to get single agent id: %w", err)
	}
	return agentID, nil
}

// UpdateDeviceAgent updates the bound agent for a device.
func (db *DB) UpdateDeviceAgent(deviceID, agentID string) error {
	res, err := db.Exec("UPDATE devices SET agent_id = ? WHERE id = ?", agentID, deviceID)
	if err != nil {
		return fmt.Errorf("failed to update device agent: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read update result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("device not found")
	}
	return nil
}
