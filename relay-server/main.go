package main

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/handler"
	"github.com/claudecode/relay-server/hub"
	"github.com/claudecode/relay-server/store"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg := config.Load()
	validateStartupConfig(cfg)

	// Configure zerolog JSON output.
	zerolog.TimeFieldFormat = time.RFC3339
	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	log.Logger = zerolog.New(os.Stdout).With().Timestamp().Logger()

	// Initialize database
	database, err := db.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to open database")
	}
	defer database.Close()

	// Initialize default user
	if err := database.InitializeDefaultUser(); err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize default user")
	}

	// Sync user from environment variables (backward compatibility)
	if err := database.SyncUserFromEnv(); err != nil {
		log.Warn().Err(err).Msg("Failed to sync user from environment")
	}

	// Migrate from JSON files if needed
	if err := database.MigrateFromJSON(cfg.DataDir); err != nil {
		log.Warn().Err(err).Msg("Failed to migrate from JSON files")
	}

	st := store.NewStore(database)
	h := hub.NewHub(cfg, st)

	if cfg.AdminPassword != "" && cfg.AdminPassword == "changeme" {
		log.Warn().Msg("ADMIN_PASSWORD is set to default 'changeme' — change it in production")
	}

	mux := http.NewServeMux()
	loginRateLimiter := newIPRateLimiter(10, 5*time.Minute)
	registerRateLimiter := newIPRateLimiter(12, 10*time.Minute)
	changePasswordRateLimiter := newIPRateLimiter(10, 10*time.Minute)
	adminLoginRateLimiter := newIPRateLimiter(8, 10*time.Minute)

	mux.HandleFunc("/ws", handler.WSHandler(h, cfg, st))

	// Authentication endpoints
	mux.HandleFunc("/api/auth/login", rateLimitMiddleware("user-login", loginRateLimiter, handler.LoginHandler(database, cfg)))
	mux.HandleFunc("/api/auth/register-client", rateLimitMiddleware("client-register", registerRateLimiter, handler.RegisterClientHandler(database, cfg)))
	mux.HandleFunc("/api/auth/change-password", rateLimitMiddleware("password-change", changePasswordRateLimiter, handler.ChangePasswordHandler(database)))

	// Legacy endpoints (kept for backward compatibility)
	mux.HandleFunc("/api/session", handler.SessionHandler(cfg, st))
	mux.HandleFunc("/api/project/bind", handler.ProjectBindHandler(h, cfg))
	mux.HandleFunc("/api/agent/wakeup", handler.WakeupHandler(h, cfg))
	mux.HandleFunc("/api/device/sync", handler.SyncHandler(h, cfg, st))
	mux.HandleFunc("/api/update/check", handler.UpdateCheckHandler(cfg, database))
	mux.HandleFunc("/api/update/download/", handler.UpdateDownloadHandler(cfg, database))

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	// Admin panel
	mux.HandleFunc("/admin/api/login", rateLimitMiddleware("admin-login", adminLoginRateLimiter, handler.AdminLoginHandler(database)))
	mux.HandleFunc("/admin/api/logout", handler.AdminLogoutHandler())
	mux.HandleFunc("/admin/api/check", handler.AdminCheckHandler(cfg))
	mux.HandleFunc("/admin/api/overview", handler.AdminOverviewHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/account/password", handler.AdminAccountPasswordHandler(cfg, database))
	mux.HandleFunc("/admin/api/session", handler.AdminSessionHandler(cfg, database))
	mux.HandleFunc("/admin/api/agents/", handler.AdminAgentsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/agents", handler.AdminAgentsHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/devices/", handler.AdminDevicesHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/devices", handler.AdminDevicesHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/users/", handler.AdminUsersHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/users", handler.AdminUsersHandler(cfg, database, h))
	mux.HandleFunc("/admin/api/releases/", handler.AdminReleasesHandler(cfg, database))
	mux.HandleFunc("/admin/api/releases", handler.AdminReleasesHandler(cfg, database))
	mux.HandleFunc("/admin/releases/", handler.AdminReleasesPageHandler(cfg))
	mux.HandleFunc("/admin/releases", handler.AdminReleasesPageHandler(cfg))
	mux.HandleFunc("/admin", handler.AdminUIHandler(cfg))
	mux.HandleFunc("/admin/", handler.AdminUIHandler(cfg))

	// CORS middleware
	corsHandler := corsMiddleware(mux, cfg.CORSOrigins)
	securedHandler := recoveryMiddleware(securityHeadersMiddleware(corsHandler))

	addr := ":" + cfg.Port
	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		log.Info().Str("addr", addr).Msg("relay server starting (TLS)")
		if err := http.ListenAndServeTLS(addr, cfg.TLSCert, cfg.TLSKey, securedHandler); err != nil {
			log.Fatal().Err(err).Msg("server exited")
		}
	} else {
		log.Info().Str("addr", addr).Msg("relay server starting")
		if err := http.ListenAndServe(addr, securedHandler); err != nil {
			log.Fatal().Err(err).Msg("server exited")
		}
	}
}

func validateStartupConfig(cfg *config.Config) {
	jwtSecret := strings.TrimSpace(cfg.JWTSecret)
	if jwtSecret == "" || jwtSecret == "change-me-in-production" {
		log.Fatal().Msg("JWT_SECRET must be set to a unique non-default value before exposing the relay server")
	}
	if (cfg.TLSCert == "") != (cfg.TLSKey == "") {
		log.Fatal().Msg("TLS_CERT and TLS_KEY must be configured together")
	}
	if cfg.CORSOrigins == "*" {
		log.Warn().Msg("CORS_ORIGINS='*' allows any browser origin; use explicit origins for public deployments")
	}
	if cfg.TLSCert == "" && cfg.TLSKey == "" {
		log.Warn().Msg("TLS is not configured on relay-server; terminate HTTPS/WSS at a trusted reverse proxy before public exposure")
	}
}

func corsMiddleware(next http.Handler, origins string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			if origins == "*" || originAllowed(origin, origins) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func originAllowed(origin, origins string) bool {
	for _, allowed := range strings.Split(origins, ",") {
		if strings.EqualFold(strings.TrimSpace(allowed), origin) {
			return true
		}
	}
	return false
}
