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

	h := hub.NewHub(cfg)
	st := store.NewStore(database)

	if cfg.AdminPassword != "" && cfg.AdminPassword == "changeme" {
		log.Warn().Msg("ADMIN_PASSWORD is set to default 'changeme' — change it in production")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", handler.WSHandler(h, cfg))

	// Authentication endpoints
	mux.HandleFunc("/api/auth/login", handler.LoginHandler(database, cfg))
	mux.HandleFunc("/api/auth/register-client", handler.RegisterClientHandler(database, cfg))
	mux.HandleFunc("/api/auth/change-password", handler.ChangePasswordHandler(database))

	// Legacy endpoints (kept for backward compatibility)
	mux.HandleFunc("/api/session", handler.SessionHandler(cfg, st))
	mux.HandleFunc("/api/project/bind", handler.ProjectBindHandler(h, cfg))
	mux.HandleFunc("/api/agent/wakeup", handler.WakeupHandler(h, cfg))
	mux.HandleFunc("/api/device/sync", handler.SyncHandler(h, cfg, st))

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	// Admin panel
	mux.HandleFunc("/admin/api/login", handler.AdminLoginHandler(database))
	mux.HandleFunc("/admin/api/logout", handler.AdminLogoutHandler())
	mux.HandleFunc("/admin/api/check", handler.AdminCheckHandler(cfg))
	mux.HandleFunc("/admin/api/agents/", handler.AdminAgentsHandler(cfg, st))
	mux.HandleFunc("/admin/api/agents", handler.AdminAgentsHandler(cfg, st))
	mux.HandleFunc("/admin/api/devices/", handler.AdminDevicesHandler(cfg, st))
	mux.HandleFunc("/admin/api/devices", handler.AdminDevicesHandler(cfg, st))
	mux.HandleFunc("/admin", handler.AdminUIHandler(cfg))
	mux.HandleFunc("/admin/", handler.AdminUIHandler(cfg))

	// CORS middleware
	corsHandler := corsMiddleware(mux, cfg.CORSOrigins)

	addr := ":" + cfg.Port
	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		log.Info().Str("addr", addr).Msg("relay server starting (TLS)")
		if err := http.ListenAndServeTLS(addr, cfg.TLSCert, cfg.TLSKey, corsHandler); err != nil {
			log.Fatal().Err(err).Msg("server exited")
		}
	} else {
		log.Info().Str("addr", addr).Msg("relay server starting")
		if err := http.ListenAndServe(addr, corsHandler); err != nil {
			log.Fatal().Err(err).Msg("server exited")
		}
	}
}

func corsMiddleware(next http.Handler, origins string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origins == "*" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else if origin != "" {
			for _, allowed := range strings.Split(origins, ",") {
				if strings.TrimSpace(allowed) == origin {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					break
				}
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
