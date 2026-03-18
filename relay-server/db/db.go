package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"github.com/claudecode/relay-server/auth"
	"github.com/rs/zerolog/log"
	_ "modernc.org/sqlite"
)

// DB wraps the database connection
type DB struct {
	*sql.DB
}

// Open opens a connection to the SQLite database
func Open(dataDir string) (*DB, error) {
	// Ensure data directory exists
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "relay.db")
	log.Info().Str("path", dbPath).Msg("Opening database")

	sqlDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Enable foreign keys
	if _, err := sqlDB.Exec("PRAGMA foreign_keys = ON"); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	// Set connection pool settings
	sqlDB.SetMaxOpenConns(1) // SQLite works best with single connection
	sqlDB.SetMaxIdleConns(1)

	db := &DB{DB: sqlDB}

	// Initialize schema
	if err := db.initSchema(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	log.Info().Msg("Database opened successfully")
	return db, nil
}

// initSchema creates the database tables if they don't exist
func (db *DB) initSchema() error {
	schema := `
	-- Users table
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Agents table
	CREATE TABLE IF NOT EXISTS agents (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		note TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	-- Devices table
	CREATE TABLE IF NOT EXISTS devices (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		agent_id TEXT,
		note TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
	);

	-- Login sessions table
	CREATE TABLE IF NOT EXISTS login_sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		client_type TEXT NOT NULL,
		client_id TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		ip_address TEXT,
		user_agent TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL,
		revoked_at DATETIME,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	-- Indexes
	CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
	CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
	CREATE INDEX IF NOT EXISTS idx_devices_agent_id ON devices(agent_id);
	CREATE INDEX IF NOT EXISTS idx_login_sessions_user_id ON login_sessions(user_id);
	CREATE INDEX IF NOT EXISTS idx_login_sessions_token_hash ON login_sessions(token_hash);
	`

	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("failed to create schema: %w", err)
	}

	log.Info().Msg("Database schema initialized")
	return nil
}

// InitializeDefaultUser creates a default admin user if no users exist
func (db *DB) InitializeDefaultUser() error {
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to count users: %w", err)
	}

	if count > 0 {
		log.Info().Msg("Users already exist, skipping default user creation")
		return nil
	}

	// Check for environment variable password
	password := os.Getenv("ADMIN_PASSWORD")
	if password == "" {
		// Generate random password
		var err error
		password, err = auth.GenerateRandomPassword(16)
		if err != nil {
			return fmt.Errorf("failed to generate password: %w", err)
		}

		log.Warn().Msg("=================================")
		log.Warn().Msg("首次启动检测到，已创建默认账号：")
		log.Warn().Str("username", "admin").Msg("")
		log.Warn().Str("password", password).Msg("")
		log.Warn().Msg("请立即登录并修改密码！")
		log.Warn().Msg("=================================")
	} else {
		log.Info().Msg("Using ADMIN_PASSWORD from environment variable")
	}

	// Hash password
	hash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Create default user
	_, err = db.Exec(
		"INSERT INTO users (username, password_hash) VALUES (?, ?)",
		"admin", hash,
	)
	if err != nil {
		return fmt.Errorf("failed to create default user: %w", err)
	}

	log.Info().Msg("Default admin user created successfully")
	return nil
}

// SyncUserFromEnv syncs user from environment variables (for backward compatibility)
func (db *DB) SyncUserFromEnv() error {
	username := os.Getenv("ADMIN_USER")
	password := os.Getenv("ADMIN_PASSWORD")

	if username == "" || password == "" {
		return nil // No env vars configured
	}

	log.Info().Str("username", username).Msg("Syncing user from environment variables")

	// Check if user exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = ?)", username).Scan(&exists)
	if err != nil {
		return fmt.Errorf("failed to check user existence: %w", err)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	if !exists {
		// Create user
		_, err = db.Exec(
			"INSERT INTO users (username, password_hash) VALUES (?, ?)",
			username, hash,
		)
		if err != nil {
			return fmt.Errorf("failed to create user: %w", err)
		}
		log.Info().Str("username", username).Msg("User created from environment variables")
	} else {
		// Update password
		_, err = db.Exec(
			"UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
			hash, username,
		)
		if err != nil {
			return fmt.Errorf("failed to update user password: %w", err)
		}
		log.Info().Str("username", username).Msg("User password updated from environment variables")
	}

	return nil
}
