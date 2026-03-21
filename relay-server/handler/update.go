package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
)

type updateCheckResponse struct {
	Available           bool   `json:"available"`
	ReleaseID           int    `json:"releaseId,omitempty"`
	Platform            string `json:"platform,omitempty"`
	Channel             string `json:"channel,omitempty"`
	Arch                string `json:"arch,omitempty"`
	LatestVersion       string `json:"latestVersion,omitempty"`
	Build               int    `json:"build,omitempty"`
	MinSupportedVersion string `json:"minSupportedVersion,omitempty"`
	URL                 string `json:"url,omitempty"`
	DownloadURL         string `json:"downloadUrl,omitempty"`
	SHA256              string `json:"sha256,omitempty"`
	Size                int64  `json:"size,omitempty"`
	Notes               string `json:"notes,omitempty"`
	Mandatory           bool   `json:"mandatory,omitempty"`
	PublishedAt         string `json:"publishedAt,omitempty"`
	Filename            string `json:"filename,omitempty"`
}

func UpdateCheckHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, _ = cfg, r
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		platform := strings.TrimSpace(r.URL.Query().Get("platform"))
		if platform == "" {
			http.Error(w, "platform is required", http.StatusBadRequest)
			return
		}
		channel := strings.TrimSpace(r.URL.Query().Get("channel"))
		if channel == "" {
			channel = "stable"
		}
		arch := strings.TrimSpace(r.URL.Query().Get("arch"))
		currentVersion := strings.TrimSpace(r.URL.Query().Get("version"))
		currentBuild, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("build")))

		releases, err := database.ListPublishedReleases(platform, channel, arch)
		if err != nil {
			http.Error(w, "failed to query releases", http.StatusInternalServerError)
			return
		}

		latest := selectLatestRelease(releases, arch)
		w.Header().Set("Content-Type", "application/json")
		if latest == nil || !isReleaseNewer(*latest, currentVersion, currentBuild) {
			_ = json.NewEncoder(w).Encode(updateCheckResponse{Available: false})
			return
		}

		mandatory := latest.Mandatory
		if latest.MinSupportedVersion != "" && compareVersions(currentVersion, latest.MinSupportedVersion) < 0 {
			mandatory = true
		}

		downloadURL := absoluteURL(r, fmt.Sprintf("/api/update/download/%d", latest.ID))
		_ = json.NewEncoder(w).Encode(updateCheckResponse{
			Available:           true,
			ReleaseID:           latest.ID,
			Platform:            latest.Platform,
			Channel:             latest.Channel,
			Arch:                latest.Arch,
			LatestVersion:       latest.Version,
			Build:               latest.Build,
			MinSupportedVersion: latest.MinSupportedVersion,
			URL:                 downloadURL,
			DownloadURL:         downloadURL,
			SHA256:              latest.SHA256,
			Size:                latest.Size,
			Notes:               latest.Notes,
			Mandatory:           mandatory,
			PublishedAt:         latest.PublishedAt.UTC().Format(time.RFC3339),
			Filename:            latest.OriginalFilename,
		})
	}
}

func UpdateDownloadHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, _ = cfg, r
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		idValue := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/update/download/"), "/")
		releaseID, err := strconv.Atoi(idValue)
		if err != nil {
			http.Error(w, "invalid release id", http.StatusBadRequest)
			return
		}

		release, err := database.GetReleaseByID(releaseID)
		if err != nil || !release.Published {
			http.NotFound(w, r)
			return
		}

		file, err := os.Open(release.FilePath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()

		info, err := file.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, release.OriginalFilename))
		w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
		http.ServeContent(w, r, release.OriginalFilename, info.ModTime(), file)
	}
}

func AdminReleasesHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		session, ok := currentAdminSession(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		switch r.Method {
		case http.MethodGet:
			releases, err := database.ListReleases()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(releases)
			return

		case http.MethodPost:
			if err := r.ParseMultipartForm(1 << 30); err != nil {
				http.Error(w, "invalid multipart form", http.StatusBadRequest)
				return
			}

			platform := strings.TrimSpace(r.FormValue("platform"))
			version := strings.TrimSpace(r.FormValue("version"))
			if platform == "" || version == "" {
				http.Error(w, "platform and version are required", http.StatusBadRequest)
				return
			}

			channel := strings.TrimSpace(r.FormValue("channel"))
			if channel == "" {
				channel = "stable"
			}
			arch := strings.TrimSpace(r.FormValue("arch"))
			build, _ := strconv.Atoi(strings.TrimSpace(r.FormValue("build")))
			notes := strings.TrimSpace(r.FormValue("notes"))
			mandatory := parseBoolField(r.FormValue("mandatory"))
			published := true
			if value := strings.TrimSpace(r.FormValue("published")); value != "" {
				published = parseBoolField(value)
			}
			minSupportedVersion := strings.TrimSpace(r.FormValue("min_supported_version"))

			file, header, err := r.FormFile("package")
			if err != nil {
				http.Error(w, "package file is required", http.StatusBadRequest)
				return
			}
			defer file.Close()

			storageDir := filepath.Join(cfg.DataDir, "releases")
			if err := os.MkdirAll(storageDir, 0o755); err != nil {
				http.Error(w, "failed to create storage directory", http.StatusInternalServerError)
				return
			}

			storageName := fmt.Sprintf(
				"%s-%s-%d%s",
				sanitizeFileComponent(platform),
				sanitizeFileComponent(version),
				time.Now().UnixNano(),
				filepath.Ext(header.Filename),
			)
			targetPath := filepath.Join(storageDir, storageName)
			size, hash, err := saveUploadedFile(file, targetPath)
			if err != nil {
				http.Error(w, "failed to store uploaded file", http.StatusInternalServerError)
				return
			}

			release, err := database.CreateRelease(db.CreateReleaseInput{
				Platform:            platform,
				Channel:             channel,
				Arch:                arch,
				Version:             version,
				Build:               build,
				Filename:            storageName,
				OriginalFilename:    header.Filename,
				FilePath:            targetPath,
				SHA256:              hash,
				Size:                size,
				Notes:               notes,
				Mandatory:           mandatory,
				MinSupportedVersion: minSupportedVersion,
				Published:           published,
				CreatedBy:           session.UserID,
			})
			if err != nil {
				_ = os.Remove(targetPath)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(release)
			return

		case http.MethodDelete:
			idValue := strings.Trim(strings.TrimPrefix(r.URL.Path, "/admin/api/releases/"), "/")
			releaseID, err := strconv.Atoi(idValue)
			if err != nil {
				http.Error(w, "invalid release id", http.StatusBadRequest)
				return
			}

			release, err := database.DeleteRelease(releaseID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			if release.FilePath != "" {
				_ = os.Remove(release.FilePath)
			}

			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "deleted",
				"id":     releaseID,
			})
			return
		}

		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
}

func saveUploadedFile(source io.Reader, targetPath string) (int64, string, error) {
	target, err := os.Create(targetPath)
	if err != nil {
		return 0, "", err
	}
	defer target.Close()

	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(target, hash), source)
	if err != nil {
		return 0, "", err
	}
	return size, hex.EncodeToString(hash.Sum(nil)), nil
}

func parseBoolField(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func sanitizeFileComponent(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return "release"
	}
	var builder strings.Builder
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z':
			builder.WriteRune(char)
		case char >= '0' && char <= '9':
			builder.WriteRune(char)
		default:
			builder.WriteRune('-')
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "release"
	}
	return result
}

func absoluteURL(r *http.Request, relativePath string) string {
	scheme := "http"
	if isHTTPSRequest(r) {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s%s", scheme, r.Host, relativePath)
}

func selectLatestRelease(releases []db.Release, arch string) *db.Release {
	if len(releases) == 0 {
		return nil
	}
	best := releases[0]
	for _, candidate := range releases[1:] {
		if compareRelease(candidate, best, arch) > 0 {
			best = candidate
		}
	}
	return &best
}

func compareRelease(left, right db.Release, arch string) int {
	if diff := compareVersions(left.Version, right.Version); diff != 0 {
		return diff
	}
	if left.Build != right.Build {
		if left.Build > right.Build {
			return 1
		}
		return -1
	}
	leftExact := strings.EqualFold(left.Arch, arch)
	rightExact := strings.EqualFold(right.Arch, arch)
	if leftExact != rightExact {
		if leftExact {
			return 1
		}
		return -1
	}
	if left.PublishedAt.After(right.PublishedAt) {
		return 1
	}
	if left.PublishedAt.Before(right.PublishedAt) {
		return -1
	}
	if left.ID > right.ID {
		return 1
	}
	if left.ID < right.ID {
		return -1
	}
	return 0
}

func isReleaseNewer(release db.Release, currentVersion string, currentBuild int) bool {
	if currentVersion == "" {
		return true
	}
	if diff := compareVersions(release.Version, currentVersion); diff != 0 {
		return diff > 0
	}
	return release.Build > currentBuild
}

func compareVersions(left, right string) int {
	leftParts := splitVersion(left)
	rightParts := splitVersion(right)
	maxLen := len(leftParts)
	if len(rightParts) > maxLen {
		maxLen = len(rightParts)
	}

	for index := 0; index < maxLen; index++ {
		leftPart := "0"
		rightPart := "0"
		if index < len(leftParts) {
			leftPart = leftParts[index]
		}
		if index < len(rightParts) {
			rightPart = rightParts[index]
		}

		leftNumber, leftIsNumber := strconv.Atoi(leftPart)
		rightNumber, rightIsNumber := strconv.Atoi(rightPart)
		if leftIsNumber == nil && rightIsNumber == nil {
			switch {
			case leftNumber > rightNumber:
				return 1
			case leftNumber < rightNumber:
				return -1
			default:
				continue
			}
		}

		switch {
		case leftPart > rightPart:
			return 1
		case leftPart < rightPart:
			return -1
		}
	}

	return 0
}

func splitVersion(value string) []string {
	trimmed := strings.TrimSpace(strings.TrimPrefix(strings.ToLower(value), "v"))
	if trimmed == "" {
		return []string{"0"}
	}
	parts := strings.FieldsFunc(trimmed, func(char rune) bool {
		return char == '.' || char == '-' || char == '_' || char == '+'
	})
	if len(parts) == 0 {
		return []string{"0"}
	}
	return parts
}
