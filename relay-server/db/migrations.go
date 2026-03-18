package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/rs/zerolog/log"
)

// MigrateFromJSON migrates data from JSON files to SQLite database
func (db *DB) MigrateFromJSON(dataDir string) error {
	log.Info().Msg("Starting JSON to SQLite migration")

	// Check if migration is needed
	var agentCount int
	err := db.QueryRow("SELECT COUNT(*) FROM agents").Scan(&agentCount)
	if err != nil {
		return fmt.Errorf("failed to count agents: %w", err)
	}

	if agentCount > 0 {
		log.Info().Msg("Database already has data, skipping JSON migration")
		return nil
	}

	// Get default user ID
	var userID int
	err = db.QueryRow("SELECT id FROM users LIMIT 1").Scan(&userID)
	if err != nil {
		return fmt.Errorf("no user found, cannot migrate: %w", err)
	}

	log.Info().Int("user_id", userID).Msg("Migrating data to user")

	// Migrate agents.json
	if err := db.migrateAgents(dataDir, userID); err != nil {
		log.Error().Err(err).Msg("Failed to migrate agents")
		// Continue with devices migration even if agents fail
	}

	// Migrate devices.json
	if err := db.migrateDevices(dataDir, userID); err != nil {
		log.Error().Err(err).Msg("Failed to migrate devices")
	}

	log.Info().Msg("JSON to SQLite migration completed")
	return nil
}

type agentRecord struct {
	ID        string    `json:"id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

func (db *DB) migrateAgents(dataDir string, userID int) error {
	agentsFile := filepath.Join(dataDir, "agents.json")

	// Check if file exists
	if _, err := os.Stat(agentsFile); os.IsNotExist(err) {
		log.Info().Msg("agents.json not found, skipping agents migration")
		return nil
	}

	// Read file
	data, err := os.ReadFile(agentsFile)
	if err != nil {
		return fmt.Errorf("failed to read agents.json: %w", err)
	}

	// Parse JSON
	var agents []agentRecord
	if err := json.Unmarshal(data, &agents); err != nil {
		return fmt.Errorf("failed to parse agents.json: %w", err)
	}

	// Insert agents
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT INTO agents (id, user_id, note, created_at) VALUES (?, ?, ?, ?)")
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, agent := range agents {
		_, err := stmt.Exec(agent.ID, userID, agent.Note, agent.CreatedAt)
		if err != nil {
			log.Error().Err(err).Str("agent_id", agent.ID).Msg("Failed to insert agent")
			continue
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Info().Int("count", len(agents)).Msg("Migrated agents from JSON")

	// Backup original file
	backupFile := agentsFile + ".backup"
	if err := os.Rename(agentsFile, backupFile); err != nil {
		log.Warn().Err(err).Msg("Failed to backup agents.json")
	} else {
		log.Info().Str("backup", backupFile).Msg("Backed up agents.json")
	}

	return nil
}

type deviceRecord struct {
	ID        string    `json:"id"`
	AgentID   string    `json:"agent_id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

func (db *DB) migrateDevices(dataDir string, userID int) error {
	devicesFile := filepath.Join(dataDir, "devices.json")

	// Check if file exists
	if _, err := os.Stat(devicesFile); os.IsNotExist(err) {
		log.Info().Msg("devices.json not found, skipping devices migration")
		return nil
	}

	// Read file
	data, err := os.ReadFile(devicesFile)
	if err != nil {
		return fmt.Errorf("failed to read devices.json: %w", err)
	}

	// Parse JSON
	var devices []deviceRecord
	if err := json.Unmarshal(data, &devices); err != nil {
		return fmt.Errorf("failed to parse devices.json: %w", err)
	}

	// Insert devices
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT INTO devices (id, user_id, agent_id, note, created_at) VALUES (?, ?, ?, ?, ?)")
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, device := range devices {
		var agentID sql.NullString
		if device.AgentID != "" {
			agentID = sql.NullString{String: device.AgentID, Valid: true}
		}

		_, err := stmt.Exec(device.ID, userID, agentID, device.Note, device.CreatedAt)
		if err != nil {
			log.Error().Err(err).Str("device_id", device.ID).Msg("Failed to insert device")
			continue
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Info().Int("count", len(devices)).Msg("Migrated devices from JSON")

	// Backup original file
	backupFile := devicesFile + ".backup"
	if err := os.Rename(devicesFile, backupFile); err != nil {
		log.Warn().Err(err).Msg("Failed to backup devices.json")
	} else {
		log.Info().Str("backup", backupFile).Msg("Backed up devices.json")
	}

	return nil
}
