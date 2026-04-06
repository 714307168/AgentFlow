package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type Transfer struct {
	ID             string
	UserID         int
	SenderType     string
	SenderAgentID  string
	SenderDeviceID string
	TargetType     string
	TargetID       string
	ProjectID      string
	WorkgroupID    string
	FileName       string
	MimeType       string
	SizeBytes      int64
	SHA256         string
	StoragePath    string
	Status         string
	CreatedAt      time.Time
	ExpiresAt      sql.NullTime
}

type CreateTransferInput struct {
	ID             string
	UserID         int
	SenderType     string
	SenderAgentID  string
	SenderDeviceID string
	TargetType     string
	TargetID       string
	ProjectID      string
	WorkgroupID    string
	FileName       string
	MimeType       string
	SizeBytes      int64
	SHA256         string
	StoragePath    string
	Status         string
	ExpiresAt      *time.Time
}

type TransferReceipt struct {
	ID         int64
	TransferID string
	ClientType string
	AgentID    string
	DeviceID   string
	Status     string
	Note       string
	CreatedAt  time.Time
}

type CreateTransferReceiptInput struct {
	TransferID string
	ClientType string
	AgentID    string
	DeviceID   string
	Status     string
	Note       string
}

func (db *DB) CreateTransfer(input CreateTransferInput) (*Transfer, error) {
	status := strings.TrimSpace(strings.ToLower(input.Status))
	if status == "" {
		status = "available"
	}

	var expiresAt any
	if input.ExpiresAt != nil {
		expiresAt = input.ExpiresAt.UTC()
	}

	_, err := db.Exec(`
		INSERT INTO transfers (
			id,
			user_id,
			sender_type,
			sender_agent_id,
			sender_device_id,
			target_type,
			target_id,
			project_id,
			workgroup_id,
			file_name,
			mime_type,
			size_bytes,
			sha256,
			storage_path,
			status,
			expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		strings.TrimSpace(input.ID),
		input.UserID,
		strings.TrimSpace(input.SenderType),
		strings.TrimSpace(input.SenderAgentID),
		strings.TrimSpace(input.SenderDeviceID),
		strings.TrimSpace(input.TargetType),
		strings.TrimSpace(input.TargetID),
		strings.TrimSpace(input.ProjectID),
		strings.TrimSpace(input.WorkgroupID),
		strings.TrimSpace(input.FileName),
		strings.TrimSpace(input.MimeType),
		input.SizeBytes,
		strings.TrimSpace(strings.ToLower(input.SHA256)),
		strings.TrimSpace(input.StoragePath),
		status,
		expiresAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create transfer: %w", err)
	}

	return db.GetTransferByIDForUser(strings.TrimSpace(input.ID), input.UserID)
}

func (db *DB) GetTransferByIDForUser(transferID string, userID int) (*Transfer, error) {
	row := db.QueryRow(`
		SELECT
			id,
			user_id,
			sender_type,
			sender_agent_id,
			sender_device_id,
			target_type,
			target_id,
			project_id,
			workgroup_id,
			file_name,
			mime_type,
			size_bytes,
			sha256,
			storage_path,
			status,
			created_at,
			expires_at
		FROM transfers
		WHERE id = ? AND user_id = ?
	`, strings.TrimSpace(transferID), userID)
	return scanTransfer(row)
}

func (db *DB) ListTransfersForUser(userID, limit int) ([]Transfer, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := db.Query(`
		SELECT
			id,
			user_id,
			sender_type,
			sender_agent_id,
			sender_device_id,
			target_type,
			target_id,
			project_id,
			workgroup_id,
			file_name,
			mime_type,
			size_bytes,
			sha256,
			storage_path,
			status,
			created_at,
			expires_at
		FROM transfers
		WHERE user_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list transfers: %w", err)
	}
	defer rows.Close()

	items := make([]Transfer, 0)
	for rows.Next() {
		item, err := scanTransfer(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read transfers: %w", err)
	}
	return items, nil
}

func (db *DB) CreateTransferReceipt(userID int, input CreateTransferReceiptInput) (*TransferReceipt, error) {
	if _, err := db.GetTransferByIDForUser(input.TransferID, userID); err != nil {
		return nil, err
	}

	_, err := db.Exec(`
		INSERT INTO transfer_receipts (
			transfer_id,
			client_type,
			agent_id,
			device_id,
			status,
			note
		) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(transfer_id, client_type, agent_id, device_id, status)
		DO UPDATE SET
			note = excluded.note,
			created_at = CURRENT_TIMESTAMP
	`,
		strings.TrimSpace(input.TransferID),
		strings.TrimSpace(input.ClientType),
		strings.TrimSpace(input.AgentID),
		strings.TrimSpace(input.DeviceID),
		strings.TrimSpace(input.Status),
		strings.TrimSpace(input.Note),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create transfer receipt: %w", err)
	}

	row := db.QueryRow(`
		SELECT
			id,
			transfer_id,
			client_type,
			agent_id,
			device_id,
			status,
			note,
			created_at
		FROM transfer_receipts
		WHERE transfer_id = ? AND client_type = ? AND agent_id = ? AND device_id = ? AND status = ?
		ORDER BY id DESC
		LIMIT 1
	`,
		strings.TrimSpace(input.TransferID),
		strings.TrimSpace(input.ClientType),
		strings.TrimSpace(input.AgentID),
		strings.TrimSpace(input.DeviceID),
		strings.TrimSpace(input.Status),
	)

	receipt, err := scanTransferReceipt(row)
	if err != nil {
		return nil, err
	}
	return receipt, nil
}

func (db *DB) ListTransferReceiptsForTransfer(transferID string, userID int) ([]TransferReceipt, error) {
	if _, err := db.GetTransferByIDForUser(transferID, userID); err != nil {
		return nil, err
	}

	rows, err := db.Query(`
		SELECT
			id,
			transfer_id,
			client_type,
			agent_id,
			device_id,
			status,
			note,
			created_at
		FROM transfer_receipts
		WHERE transfer_id = ?
		ORDER BY created_at ASC, id ASC
	`, strings.TrimSpace(transferID))
	if err != nil {
		return nil, fmt.Errorf("failed to list transfer receipts: %w", err)
	}
	defer rows.Close()

	items := make([]TransferReceipt, 0)
	for rows.Next() {
		item, err := scanTransferReceipt(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read transfer receipts: %w", err)
	}
	return items, nil
}

type transferScanner interface {
	Scan(dest ...interface{}) error
}

func scanTransfer(scanner transferScanner) (*Transfer, error) {
	var item Transfer
	err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&item.SenderType,
		&item.SenderAgentID,
		&item.SenderDeviceID,
		&item.TargetType,
		&item.TargetID,
		&item.ProjectID,
		&item.WorkgroupID,
		&item.FileName,
		&item.MimeType,
		&item.SizeBytes,
		&item.SHA256,
		&item.StoragePath,
		&item.Status,
		&item.CreatedAt,
		&item.ExpiresAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("transfer not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to scan transfer: %w", err)
	}
	return &item, nil
}

func scanTransferReceipt(scanner transferScanner) (*TransferReceipt, error) {
	var item TransferReceipt
	err := scanner.Scan(
		&item.ID,
		&item.TransferID,
		&item.ClientType,
		&item.AgentID,
		&item.DeviceID,
		&item.Status,
		&item.Note,
		&item.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("transfer receipt not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to scan transfer receipt: %w", err)
	}
	return &item, nil
}
