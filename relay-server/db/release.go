package db

import (
	"database/sql"
	"fmt"
	"time"
)

type Release struct {
	ID                  int       `json:"id"`
	Platform            string    `json:"platform"`
	Channel             string    `json:"channel"`
	Arch                string    `json:"arch"`
	Version             string    `json:"version"`
	Build               int       `json:"build"`
	Filename            string    `json:"filename"`
	OriginalFilename    string    `json:"original_filename"`
	FilePath            string    `json:"file_path"`
	SHA256              string    `json:"sha256"`
	Size                int64     `json:"size"`
	Notes               string    `json:"notes"`
	Mandatory           bool      `json:"mandatory"`
	MinSupportedVersion string    `json:"min_supported_version"`
	Published           bool      `json:"published"`
	CreatedBy           int       `json:"created_by"`
	CreatedAt           time.Time `json:"created_at"`
	PublishedAt         time.Time `json:"published_at"`
}

type CreateReleaseInput struct {
	Platform            string
	Channel             string
	Arch                string
	Version             string
	Build               int
	Filename            string
	OriginalFilename    string
	FilePath            string
	SHA256              string
	Size                int64
	Notes               string
	Mandatory           bool
	MinSupportedVersion string
	Published           bool
	CreatedBy           int
}

func (db *DB) CreateRelease(input CreateReleaseInput) (*Release, error) {
	result, err := db.Exec(`
		INSERT INTO releases (
			platform,
			channel,
			arch,
			version,
			build,
			filename,
			original_filename,
			file_path,
			sha256,
			size,
			notes,
			mandatory,
			min_supported_version,
			published,
			created_by,
			published_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
	`,
		input.Platform,
		input.Channel,
		input.Arch,
		input.Version,
		input.Build,
		input.Filename,
		input.OriginalFilename,
		input.FilePath,
		input.SHA256,
		input.Size,
		input.Notes,
		input.Mandatory,
		input.MinSupportedVersion,
		input.Published,
		input.CreatedBy,
		input.Published,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create release: %w", err)
	}

	id64, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to read release id: %w", err)
	}

	return db.GetReleaseByID(int(id64))
}

func (db *DB) GetReleaseByID(id int) (*Release, error) {
	release := &Release{}
	var publishedAt sql.NullTime
	err := db.QueryRow(`
		SELECT
			id,
			platform,
			channel,
			arch,
			version,
			build,
			filename,
			original_filename,
			file_path,
			sha256,
			size,
			notes,
			mandatory,
			min_supported_version,
			published,
			created_by,
			created_at,
			published_at
		FROM releases
		WHERE id = ?
	`, id).Scan(
		&release.ID,
		&release.Platform,
		&release.Channel,
		&release.Arch,
		&release.Version,
		&release.Build,
		&release.Filename,
		&release.OriginalFilename,
		&release.FilePath,
		&release.SHA256,
		&release.Size,
		&release.Notes,
		&release.Mandatory,
		&release.MinSupportedVersion,
		&release.Published,
		&release.CreatedBy,
		&release.CreatedAt,
		&publishedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("release not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %w", err)
	}
	if publishedAt.Valid {
		release.PublishedAt = publishedAt.Time
	}
	return release, nil
}

func (db *DB) ListReleases() ([]Release, error) {
	rows, err := db.Query(`
		SELECT
			id,
			platform,
			channel,
			arch,
			version,
			build,
			filename,
			original_filename,
			file_path,
			sha256,
			size,
			notes,
			mandatory,
			min_supported_version,
			published,
			created_by,
			created_at,
			published_at
		FROM releases
		ORDER BY created_at DESC, id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list releases: %w", err)
	}
	defer rows.Close()

	releases := make([]Release, 0)
	for rows.Next() {
		var release Release
		var publishedAt sql.NullTime
		if err := rows.Scan(
			&release.ID,
			&release.Platform,
			&release.Channel,
			&release.Arch,
			&release.Version,
			&release.Build,
			&release.Filename,
			&release.OriginalFilename,
			&release.FilePath,
			&release.SHA256,
			&release.Size,
			&release.Notes,
			&release.Mandatory,
			&release.MinSupportedVersion,
			&release.Published,
			&release.CreatedBy,
			&release.CreatedAt,
			&publishedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan release: %w", err)
		}
		if publishedAt.Valid {
			release.PublishedAt = publishedAt.Time
		}
		releases = append(releases, release)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read releases: %w", err)
	}
	return releases, nil
}

func (db *DB) ListPublishedReleases(platform, channel, arch string) ([]Release, error) {
	rows, err := db.Query(`
		SELECT
			id,
			platform,
			channel,
			arch,
			version,
			build,
			filename,
			original_filename,
			file_path,
			sha256,
			size,
			notes,
			mandatory,
			min_supported_version,
			published,
			created_by,
			created_at,
			published_at
		FROM releases
		WHERE published = 1
		  AND platform = ?
		  AND channel = ?
		  AND (arch = ? OR arch = '')
	`, platform, channel, arch)
	if err != nil {
		return nil, fmt.Errorf("failed to query published releases: %w", err)
	}
	defer rows.Close()

	releases := make([]Release, 0)
	for rows.Next() {
		var release Release
		var publishedAt sql.NullTime
		if err := rows.Scan(
			&release.ID,
			&release.Platform,
			&release.Channel,
			&release.Arch,
			&release.Version,
			&release.Build,
			&release.Filename,
			&release.OriginalFilename,
			&release.FilePath,
			&release.SHA256,
			&release.Size,
			&release.Notes,
			&release.Mandatory,
			&release.MinSupportedVersion,
			&release.Published,
			&release.CreatedBy,
			&release.CreatedAt,
			&publishedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan published release: %w", err)
		}
		if publishedAt.Valid {
			release.PublishedAt = publishedAt.Time
		}
		releases = append(releases, release)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read published releases: %w", err)
	}
	return releases, nil
}

func (db *DB) DeleteRelease(id int) (*Release, error) {
	release, err := db.GetReleaseByID(id)
	if err != nil {
		return nil, err
	}

	result, err := db.Exec("DELETE FROM releases WHERE id = ?", id)
	if err != nil {
		return nil, fmt.Errorf("failed to delete release: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("failed to read delete result: %w", err)
	}
	if rowsAffected == 0 {
		return nil, fmt.Errorf("release not found")
	}
	return release, nil
}
