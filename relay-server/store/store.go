package store

import (
	"database/sql"
	"errors"
	"time"

	"github.com/claudecode/relay-server/db"
)

type AgentRecord struct {
	ID        string    `json:"id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type DeviceRecord struct {
	ID        string    `json:"id"`
	AgentID   string    `json:"agent_id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type Store struct {
	db *db.DB
}

func NewStore(database *db.DB) *Store {
	return &Store{db: database}
}

// Note: These methods are kept for backward compatibility but are deprecated
// New code should use db.RegisterAgent/RegisterDevice directly with userID

func (s *Store) RegisterAgent(id, note string) error {
	if id == "" {
		return errors.New("agent id is required")
	}

	userID, err := s.resolveAdminUserID()
	if err != nil {
		return err
	}

	_, err = s.db.Exec(
		"INSERT INTO agents (id, user_id, note) VALUES (?, ?, ?)",
		id, userID, note,
	)
	if err != nil {
		return err
	}
	return nil
}

func (s *Store) DeleteAgent(id string) error {
	_, err := s.db.Exec("DELETE FROM agents WHERE id = ?", id)
	if err != nil {
		return err
	}
	return nil
}

func (s *Store) RegisterDevice(id, agentID, note string) error {
	if id == "" {
		return errors.New("device id is required")
	}

	userID, err := s.resolveAdminUserID()
	if err != nil {
		return err
	}

	var agentIDNull sql.NullString
	if agentID != "" {
		agentIDNull = sql.NullString{String: agentID, Valid: true}
	}

	_, err = s.db.Exec(
		"INSERT INTO devices (id, user_id, agent_id, note) VALUES (?, ?, ?, ?)",
		id, userID, agentIDNull, note,
	)
	if err != nil {
		return err
	}
	return nil
}

func (s *Store) DeleteDevice(id string) error {
	_, err := s.db.Exec("DELETE FROM devices WHERE id = ?", id)
	if err != nil {
		return err
	}
	return nil
}

func (s *Store) ListAgents() []AgentRecord {
	rows, err := s.db.Query("SELECT id, note, created_at FROM agents ORDER BY created_at DESC")
	if err != nil {
		return []AgentRecord{}
	}
	defer rows.Close()

	var agents []AgentRecord
	for rows.Next() {
		var a AgentRecord
		if err := rows.Scan(&a.ID, &a.Note, &a.CreatedAt); err != nil {
			continue
		}
		agents = append(agents, a)
	}
	return agents
}

func (s *Store) ListDevices() []DeviceRecord {
	rows, err := s.db.Query("SELECT id, COALESCE(agent_id, ''), note, created_at FROM devices ORDER BY created_at DESC")
	if err != nil {
		return []DeviceRecord{}
	}
	defer rows.Close()

	var devices []DeviceRecord
	for rows.Next() {
		var d DeviceRecord
		if err := rows.Scan(&d.ID, &d.AgentID, &d.Note, &d.CreatedAt); err != nil {
			continue
		}
		devices = append(devices, d)
	}
	return devices
}

func (s *Store) AgentExists(id string) bool {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM agents WHERE id = ?", id).Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

func (s *Store) DeviceExists(id string) bool {
	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM devices WHERE id = ?", id).Scan(&count)
	if err != nil {
		return false
	}
	return count > 0
}

// GetDeviceAgentID returns the agent ID bound to the device
func (s *Store) GetDeviceAgentID(deviceID string) (string, bool) {
	var agentID string
	err := s.db.QueryRow("SELECT COALESCE(agent_id, '') FROM devices WHERE id = ?", deviceID).Scan(&agentID)
	if err != nil {
		return "", false
	}
	return agentID, agentID != ""
}

func (s *Store) UpdateDeviceAgent(deviceID, agentID string) error {
	_, err := s.db.Exec("UPDATE devices SET agent_id = ? WHERE id = ?", agentID, deviceID)
	if err != nil {
		return errors.New("device not found")
	}
	return nil
}

func (s *Store) resolveAdminUserID() (int, error) {
	var userID int
	err := s.db.QueryRow("SELECT id FROM users ORDER BY id ASC LIMIT 1").Scan(&userID)
	if err != nil {
		return 0, errors.New("no users available")
	}
	return userID, nil
}
