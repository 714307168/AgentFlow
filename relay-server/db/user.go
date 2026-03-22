package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/claudecode/relay-server/auth"
)

// User represents a user in the system
type User struct {
	ID           int
	Username     string
	PasswordHash string
	IsAdmin      bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type UserSummary struct {
	ID          int       `json:"id"`
	Username    string    `json:"username"`
	IsAdmin     bool      `json:"is_admin"`
	AgentCount  int       `json:"agent_count"`
	DeviceCount int       `json:"device_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type AgentScopeSummary struct {
	ID        string    `json:"id"`
	UserID    int       `json:"user_id"`
	Username  string    `json:"username"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type DeviceScopeSummary struct {
	ID        string    `json:"id"`
	UserID    int       `json:"user_id"`
	Username  string    `json:"username"`
	AgentID   string    `json:"agent_id,omitempty"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

// GetUserByUsername retrieves a user by username
func (db *DB) GetUserByUsername(username string) (*User, error) {
	user := &User{}
	err := db.QueryRow(`
		SELECT id, username, password_hash, is_admin, created_at, updated_at
		FROM users
		WHERE username = ?
	`, username).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.IsAdmin, &user.CreatedAt, &user.UpdatedAt)

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
		SELECT id, username, password_hash, is_admin, created_at, updated_at
		FROM users
		WHERE id = ?
	`, id).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.IsAdmin, &user.CreatedAt, &user.UpdatedAt)

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

func (db *DB) CreateUser(username, password string, isAdmin bool) (*User, error) {
	username = normalizeUsername(username)
	if err := validateUsername(username); err != nil {
		return nil, err
	}
	if err := auth.ValidatePassword(password); err != nil {
		return nil, err
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	res, err := db.Exec(`
		INSERT INTO users (username, password_hash, is_admin)
		VALUES (?, ?, ?)
	`, username, hash, isAdmin)
	if err != nil {
		if isUniqueConstraintError(err, "users.username") {
			return nil, fmt.Errorf("username already exists")
		}
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	id64, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to read created user id: %w", err)
	}

	return db.GetUserByID(int(id64))
}

func (db *DB) SetUserPassword(userID int, newPassword string) error {
	if err := auth.ValidatePassword(newPassword); err != nil {
		return err
	}

	hash, err := auth.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	res, err := db.Exec(`
		UPDATE users
		SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, hash, userID)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read update result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

func (db *DB) SetUserPasswordByUsername(username, newPassword string) error {
	user, err := db.GetUserByUsername(username)
	if err != nil {
		return err
	}
	return db.SetUserPassword(user.ID, newPassword)
}

func (db *DB) DeleteUser(userID int) error {
	res, err := db.Exec("DELETE FROM users WHERE id = ?", userID)
	if err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read delete result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}

func (db *DB) ListUsers() ([]UserSummary, error) {
	rows, err := db.Query(`
		SELECT
			u.id,
			u.username,
			u.is_admin,
			u.created_at,
			u.updated_at,
			COALESCE(a.agent_count, 0) AS agent_count,
			COALESCE(d.device_count, 0) AS device_count
		FROM users u
		LEFT JOIN (
			SELECT user_id, COUNT(*) AS agent_count
			FROM agents
			GROUP BY user_id
		) a ON a.user_id = u.id
		LEFT JOIN (
			SELECT user_id, COUNT(*) AS device_count
			FROM devices
			GROUP BY user_id
		) d ON d.user_id = u.id
		ORDER BY u.is_admin DESC, u.username ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query users: %w", err)
	}
	defer rows.Close()

	var users []UserSummary
	for rows.Next() {
		var user UserSummary
		if err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.IsAdmin,
			&user.CreatedAt,
			&user.UpdatedAt,
			&user.AgentCount,
			&user.DeviceCount,
		); err != nil {
			return nil, fmt.Errorf("failed to scan user: %w", err)
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read users: %w", err)
	}
	return users, nil
}

func (db *DB) CountAdminUsers() (int, error) {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM users WHERE is_admin = 1").Scan(&count); err != nil {
		return 0, fmt.Errorf("failed to count admin users: %w", err)
	}
	return count, nil
}

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

func (db *DB) ListAgentsForScope(userID int, isAdmin bool) ([]AgentScopeSummary, error) {
	query := `
		SELECT
			a.id,
			a.user_id,
			u.username,
			COALESCE(a.note, ''),
			a.created_at
		FROM agents a
		INNER JOIN users u ON u.id = a.user_id
	`
	args := []interface{}{}
	if !isAdmin {
		query += " WHERE a.user_id = ?"
		args = append(args, userID)
	}
	query += " ORDER BY a.created_at DESC, a.id ASC"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query scoped agents: %w", err)
	}
	defer rows.Close()

	var agents []AgentScopeSummary
	for rows.Next() {
		var item AgentScopeSummary
		if err := rows.Scan(&item.ID, &item.UserID, &item.Username, &item.Note, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan scoped agent: %w", err)
		}
		agents = append(agents, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read scoped agents: %w", err)
	}
	return agents, nil
}

func (db *DB) ListDevicesForScope(userID int, isAdmin bool) ([]DeviceScopeSummary, error) {
	query := `
		SELECT
			d.id,
			d.user_id,
			u.username,
			COALESCE(d.agent_id, ''),
			COALESCE(d.note, ''),
			d.created_at
		FROM devices d
		INNER JOIN users u ON u.id = d.user_id
	`
	args := []interface{}{}
	if !isAdmin {
		query += " WHERE d.user_id = ?"
		args = append(args, userID)
	}
	query += " ORDER BY d.created_at DESC, d.id ASC"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query scoped devices: %w", err)
	}
	defer rows.Close()

	var devices []DeviceScopeSummary
	for rows.Next() {
		var item DeviceScopeSummary
		if err := rows.Scan(&item.ID, &item.UserID, &item.Username, &item.AgentID, &item.Note, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan scoped device: %w", err)
		}
		devices = append(devices, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read scoped devices: %w", err)
	}
	return devices, nil
}

func (db *DB) DeleteAgentForUser(agentID string, userID int) error {
	res, err := db.Exec("DELETE FROM agents WHERE id = ? AND user_id = ?", agentID, userID)
	if err != nil {
		return fmt.Errorf("failed to delete agent: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read delete result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("agent not found")
	}
	return nil
}

func (db *DB) DeleteAgent(agentID string) error {
	res, err := db.Exec("DELETE FROM agents WHERE id = ?", agentID)
	if err != nil {
		return fmt.Errorf("failed to delete agent: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read delete result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("agent not found")
	}
	return nil
}

func (db *DB) DeleteDeviceForUser(deviceID string, userID int) error {
	res, err := db.Exec("DELETE FROM devices WHERE id = ? AND user_id = ?", deviceID, userID)
	if err != nil {
		return fmt.Errorf("failed to delete device: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read delete result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("device not found")
	}
	return nil
}

func (db *DB) DeleteDevice(deviceID string) error {
	res, err := db.Exec("DELETE FROM devices WHERE id = ?", deviceID)
	if err != nil {
		return fmt.Errorf("failed to delete device: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to read delete result: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("device not found")
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
		if isUniqueConstraintError(err, "agents.id") {
			return fmt.Errorf("agent id already exists")
		}
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
		if isUniqueConstraintError(err, "devices.id") {
			return fmt.Errorf("device id already exists")
		}
		return fmt.Errorf("failed to register device: %w", err)
	}

	return nil
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

func normalizeUsername(username string) string {
	return strings.TrimSpace(username)
}

func validateUsername(username string) error {
	if username == "" {
		return fmt.Errorf("username is required")
	}
	if len(username) < 3 {
		return fmt.Errorf("username must be at least 3 characters long")
	}
	if len(username) > 64 {
		return fmt.Errorf("username must be 64 characters or fewer")
	}
	if strings.ContainsAny(username, " \t\r\n") {
		return fmt.Errorf("username cannot contain whitespace")
	}
	return nil
}

func isUniqueConstraintError(err error, key string) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "UNIQUE constraint failed: "+key)
}
