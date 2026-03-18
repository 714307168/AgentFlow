package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/claudecode/relay-server/auth"
	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/model"
	"github.com/rs/zerolog/log"
)

type loginRequest struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	ClientType string `json:"client_type"` // "agent" or "device"
	ClientID   string `json:"client_id"`
}

type loginResponse struct {
	Token     string   `json:"token"`
	ExpiresAt string   `json:"expires_at"`
	User      userInfo `json:"user"`
}

type userInfo struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

// LoginHandler handles user login with username and password
func LoginHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// Validate required fields
		if req.Username == "" || req.Password == "" || req.ClientType == "" || req.ClientID == "" {
			http.Error(w, "username, password, client_type, and client_id are required", http.StatusBadRequest)
			return
		}

		// Validate client type
		if req.ClientType != "agent" && req.ClientType != "device" {
			http.Error(w, "client_type must be 'agent' or 'device'", http.StatusBadRequest)
			return
		}

		// Authenticate user
		user, err := database.AuthenticateUser(req.Username, req.Password)
		if err != nil {
			log.Warn().Str("username", req.Username).Msg("Authentication failed")
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}

		// Check if client belongs to user, auto-register if not exists
		var belongs bool
		if req.ClientType == "agent" {
			belongs, err = database.AgentBelongsToUser(req.ClientID, user.ID)
			if err != nil {
				log.Error().Err(err).Msg("Failed to check agent ownership")
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			if !belongs {
				// Auto-register agent on first login
				if err := database.RegisterAgent(req.ClientID, user.ID, "Auto-registered on login"); err != nil {
					log.Error().Err(err).Str("agent_id", req.ClientID).Msg("Failed to auto-register agent")
					http.Error(w, "failed to register agent", http.StatusInternalServerError)
					return
				}
				log.Info().Str("agent_id", req.ClientID).Int("user_id", user.ID).Msg("Auto-registered agent")
			}
		} else {
			belongs, err = database.DeviceBelongsToUser(req.ClientID, user.ID)
			if err != nil {
				log.Error().Err(err).Msg("Failed to check device ownership")
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			if !belongs {
				// Auto-register device on first login (use empty agent_id for now)
				if err := database.RegisterDevice(req.ClientID, user.ID, "", "Auto-registered on login"); err != nil {
					log.Error().Err(err).Str("device_id", req.ClientID).Msg("Failed to auto-register device")
					http.Error(w, "failed to register device", http.StatusInternalServerError)
					return
				}
				log.Info().Str("device_id", req.ClientID).Int("user_id", user.ID).Msg("Auto-registered device")
			}
		}

		// Generate JWT token
		var clientType model.ClientType
		if req.ClientType == "agent" {
			clientType = model.ClientTypeAgent
		} else {
			clientType = model.ClientTypeDevice
		}

		var ttl time.Duration
		if clientType == model.ClientTypeAgent {
			ttl = 30 * 24 * time.Hour // 30 days for agents
		} else {
			ttl = 24 * time.Hour // 24 hours for devices
		}

		token, err := auth.GenerateToken(cfg.JWTSecret, clientType, req.ClientID, req.ClientID, ttl)
		if err != nil {
			log.Error().Err(err).Msg("Failed to generate token")
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		// Record login session
		tokenHash := hashToken(token)
		ipAddress := getClientIP(r)
		userAgent := r.UserAgent()

		_, err = database.Exec(`
			INSERT INTO login_sessions (user_id, client_type, client_id, token_hash, ip_address, user_agent, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, user.ID, req.ClientType, req.ClientID, tokenHash, ipAddress, userAgent, time.Now().Add(ttl))

		if err != nil {
			log.Error().Err(err).Msg("Failed to record login session")
			// Continue anyway, session recording is not critical
		}

		log.Info().
			Str("username", user.Username).
			Str("client_type", req.ClientType).
			Str("client_id", req.ClientID).
			Msg("User logged in successfully")

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(loginResponse{
			Token:     token,
			ExpiresAt: time.Now().Add(ttl).UTC().Format(time.RFC3339),
			User: userInfo{
				ID:       user.ID,
				Username: user.Username,
			},
		})
	}
}

type registerClientRequest struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	ClientType string `json:"client_type"` // "agent" or "device"
	ClientID   string `json:"client_id"`
	Note       string `json:"note"`
	AgentID    string `json:"agent_id"` // Required for devices
}

// RegisterClientHandler registers a new agent or device
func RegisterClientHandler(database *db.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req registerClientRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// Validate required fields
		if req.Username == "" || req.Password == "" || req.ClientType == "" || req.ClientID == "" {
			http.Error(w, "username, password, client_type, and client_id are required", http.StatusBadRequest)
			return
		}

		// Validate client type
		if req.ClientType != "agent" && req.ClientType != "device" {
			http.Error(w, "client_type must be 'agent' or 'device'", http.StatusBadRequest)
			return
		}

		// For devices, agent_id is required
		if req.ClientType == "device" && req.AgentID == "" {
			http.Error(w, "agent_id is required for devices", http.StatusBadRequest)
			return
		}

		// Authenticate user
		user, err := database.AuthenticateUser(req.Username, req.Password)
		if err != nil {
			log.Warn().Str("username", req.Username).Msg("Authentication failed")
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}

		// Register client
		if req.ClientType == "agent" {
			err = database.RegisterAgent(req.ClientID, user.ID, req.Note)
		} else {
			err = database.RegisterDevice(req.ClientID, user.ID, req.AgentID, req.Note)
		}

		if err != nil {
			log.Error().Err(err).Msg("Failed to register client")
			http.Error(w, "failed to register client: "+err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info().
			Str("username", user.Username).
			Str("client_type", req.ClientType).
			Str("client_id", req.ClientID).
			Msg("Client registered successfully")

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"client_id": req.ClientID,
		})
	}
}

type changePasswordRequest struct {
	Username    string `json:"username"`
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// ChangePasswordHandler changes a user's password
func ChangePasswordHandler(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req changePasswordRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if req.Username == "" || req.OldPassword == "" || req.NewPassword == "" {
			http.Error(w, "username, old_password, and new_password are required", http.StatusBadRequest)
			return
		}

		err := database.ChangePassword(req.Username, req.OldPassword, req.NewPassword)
		if err != nil {
			log.Warn().Str("username", req.Username).Err(err).Msg("Password change failed")
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		log.Info().Str("username", req.Username).Msg("Password changed successfully")

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})
	}
}

// hashToken creates a SHA256 hash of the token for storage
func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

// getClientIP extracts the client IP address from the request
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header first
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		// Take the first IP if multiple are present
		ips := strings.Split(forwarded, ",")
		return strings.TrimSpace(ips[0])
	}

	// Check X-Real-IP header
	realIP := r.Header.Get("X-Real-IP")
	if realIP != "" {
		return realIP
	}

	// Fall back to RemoteAddr
	return r.RemoteAddr
}
