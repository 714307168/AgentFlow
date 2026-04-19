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
		is_admin INTEGER NOT NULL DEFAULT 0,
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

	-- One-way remote control grants.
	CREATE TABLE IF NOT EXISTS agent_access_grants (
		controller_user_id INTEGER NOT NULL,
		target_agent_id TEXT NOT NULL,
		note TEXT,
		created_by_user_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (controller_user_id, target_agent_id),
		FOREIGN KEY (controller_user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (target_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
		FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
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

	-- Published releases for desktop and Android updates
	CREATE TABLE IF NOT EXISTS releases (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		platform TEXT NOT NULL,
		channel TEXT NOT NULL DEFAULT 'stable',
		arch TEXT NOT NULL DEFAULT '',
		version TEXT NOT NULL,
		build INTEGER NOT NULL DEFAULT 0,
		filename TEXT NOT NULL,
		original_filename TEXT NOT NULL,
		file_path TEXT NOT NULL,
		sha256 TEXT NOT NULL,
		size INTEGER NOT NULL DEFAULT 0,
		notes TEXT NOT NULL DEFAULT '',
		mandatory INTEGER NOT NULL DEFAULT 0,
		min_supported_version TEXT NOT NULL DEFAULT '',
		published INTEGER NOT NULL DEFAULT 1,
		created_by INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		published_at DATETIME
	);

	-- Collaboration group registry metadata only. Chat content stays on agents/devices.
	CREATE TABLE IF NOT EXISTS collaboration_groups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		group_number TEXT NOT NULL UNIQUE,
		workgroup_id TEXT NOT NULL,
		host_agent_id TEXT NOT NULL,
		owner_user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		member_snapshot TEXT NOT NULL DEFAULT '[]',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(owner_user_id, host_agent_id, workgroup_id),
		FOREIGN KEY (host_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
		FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS collaboration_group_memberships (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		group_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(group_id, user_id),
		FOREIGN KEY (group_id) REFERENCES collaboration_groups(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	-- Cross-client file transfer metadata.
	CREATE TABLE IF NOT EXISTS transfers (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		sender_type TEXT NOT NULL,
		sender_agent_id TEXT NOT NULL DEFAULT '',
		sender_device_id TEXT NOT NULL DEFAULT '',
		target_type TEXT NOT NULL DEFAULT '',
		target_id TEXT NOT NULL DEFAULT '',
		project_id TEXT NOT NULL DEFAULT '',
		workgroup_id TEXT NOT NULL DEFAULT '',
		file_name TEXT NOT NULL,
		mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
		size_bytes INTEGER NOT NULL DEFAULT 0,
		sha256 TEXT NOT NULL,
		storage_path TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'available',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS transfer_receipts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		transfer_id TEXT NOT NULL,
		client_type TEXT NOT NULL,
		agent_id TEXT NOT NULL DEFAULT '',
		device_id TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		note TEXT NOT NULL DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(transfer_id, client_type, agent_id, device_id, status),
		FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS agent_access_grant_projects (
		controller_user_id INTEGER NOT NULL,
		target_agent_id TEXT NOT NULL,
		project_id TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (controller_user_id, target_agent_id, project_id)
	);

	-- Indexes
	CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
	CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
	CREATE INDEX IF NOT EXISTS idx_devices_agent_id ON devices(agent_id);
	CREATE INDEX IF NOT EXISTS idx_agent_access_grants_controller ON agent_access_grants(controller_user_id);
	CREATE INDEX IF NOT EXISTS idx_agent_access_grants_target_agent ON agent_access_grants(target_agent_id);
	CREATE INDEX IF NOT EXISTS idx_agent_access_grant_projects_controller ON agent_access_grant_projects(controller_user_id, target_agent_id);
	CREATE INDEX IF NOT EXISTS idx_agent_access_grant_projects_target_project ON agent_access_grant_projects(target_agent_id, project_id);
	CREATE INDEX IF NOT EXISTS idx_login_sessions_user_id ON login_sessions(user_id);
	CREATE INDEX IF NOT EXISTS idx_login_sessions_token_hash ON login_sessions(token_hash);
	CREATE INDEX IF NOT EXISTS idx_releases_lookup ON releases(platform, channel, arch, published, created_at);
	CREATE INDEX IF NOT EXISTS idx_collaboration_groups_owner ON collaboration_groups(owner_user_id, updated_at);
	CREATE INDEX IF NOT EXISTS idx_collaboration_groups_host_agent ON collaboration_groups(host_agent_id, updated_at);
	CREATE INDEX IF NOT EXISTS idx_collaboration_group_memberships_user ON collaboration_group_memberships(user_id, created_at);
	CREATE INDEX IF NOT EXISTS idx_transfers_user_created ON transfers(user_id, created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_transfers_target ON transfers(user_id, target_type, target_id, created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_transfers_sender_project_created ON transfers(sender_agent_id, project_id, created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_transfer_receipts_transfer_created ON transfer_receipts(transfer_id, created_at ASC);
	`

	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("failed to create schema: %w", err)
	}

	if err := db.ensureUserAdminColumn(); err != nil {
		return err
	}
	if err := db.ensureAtLeastOneAdmin(); err != nil {
		return err
	}

	log.Info().Msg("Database schema initialized")
	return nil
}

func (db *DB) ensureUserAdminColumn() error {
	rows, err := db.Query("PRAGMA table_info(users)")
	if err != nil {
		return fmt.Errorf("failed to inspect users schema: %w", err)
	}
	defer rows.Close()

	hasIsAdmin := false
	for rows.Next() {
		var (
			cid        int
			name       string
			columnType string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("failed to scan users schema: %w", err)
		}
		if name == "is_admin" {
			hasIsAdmin = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to read users schema: %w", err)
	}
	if hasIsAdmin {
		return nil
	}

	if _, err := db.Exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("failed to add users.is_admin column: %w", err)
	}
	log.Info().Msg("Added users.is_admin column")
	return nil
}

func (db *DB) ensureAtLeastOneAdmin() error {
	var adminCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM users WHERE is_admin = 1").Scan(&adminCount); err != nil {
		return fmt.Errorf("failed to count admin users: %w", err)
	}
	if adminCount > 0 {
		return nil
	}

	var totalCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&totalCount); err != nil {
		return fmt.Errorf("failed to count users: %w", err)
	}
	if totalCount == 0 {
		return nil
	}

	if _, err := db.Exec("UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY id ASC LIMIT 1)"); err != nil {
		return fmt.Errorf("failed to promote initial admin user: %w", err)
	}
	log.Warn().Msg("No admin user found; promoted the earliest user to admin")
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
		"INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
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

	if !exists {
		if _, err := db.CreateUser(username, password, true); err != nil {
			return fmt.Errorf("failed to create user: %w", err)
		}
		log.Info().Str("username", username).Msg("User created from environment variables")
	} else {
		if err := db.SetUserPasswordByUsername(username, password); err != nil {
			return fmt.Errorf("failed to update user password: %w", err)
		}
		if _, err := db.Exec(
			"UPDATE users SET is_admin = 1, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
			username,
		); err != nil {
			return fmt.Errorf("failed to update user admin status: %w", err)
		}
		log.Info().Str("username", username).Msg("User password updated from environment variables")
	}

	return nil
}
