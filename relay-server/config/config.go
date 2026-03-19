package config

import (
	"flag"
	"os"
	"strconv"
)

type Config struct {
	Port          string
	JWTSecret     string
	LogLevel      string
	PingInterval  int // seconds
	QueueSize     int // ring buffer size per project
	TLSCert       string
	TLSKey        string
	CORSOrigins   string // comma-separated allowed origins, "*" for all
	AdminUser     string // Deprecated: kept for backward compatibility
	AdminPassword string // Deprecated: kept for backward compatibility
	DataDir       string
	DatabasePath  string // SQLite database file path
}

func Load() *Config {
	c := &Config{}
	flag.StringVar(&c.Port, "port", getEnv("PORT", "8080"), "HTTP listen port")
	flag.StringVar(&c.JWTSecret, "jwt-secret", getEnv("JWT_SECRET", "change-me-in-production"), "JWT signing secret")
	flag.StringVar(&c.LogLevel, "log-level", getEnv("LOG_LEVEL", "info"), "Log level")
	flag.IntVar(&c.PingInterval, "ping-interval", getEnvInt("PING_INTERVAL", 30), "WS ping interval seconds")
	flag.IntVar(&c.QueueSize, "queue-size", getEnvInt("QUEUE_SIZE", 100), "Per-project message queue size")
	flag.StringVar(&c.TLSCert, "tls-cert", getEnv("TLS_CERT", ""), "TLS certificate file path")
	flag.StringVar(&c.TLSKey, "tls-key", getEnv("TLS_KEY", ""), "TLS private key file path")
	flag.StringVar(&c.CORSOrigins, "cors-origins", getEnv("CORS_ORIGINS", ""), "Allowed CORS origins (comma-separated)")
	flag.StringVar(&c.AdminUser, "admin-user", getEnv("ADMIN_USER", ""), "Deprecated: Admin panel username")
	flag.StringVar(&c.AdminPassword, "admin-password", getEnv("ADMIN_PASSWORD", ""), "Deprecated: Admin panel password")
	flag.StringVar(&c.DataDir, "data-dir", getEnv("DATA_DIR", "./data"), "Directory for persistent data files")
	flag.StringVar(&c.DatabasePath, "database-path", getEnv("DATABASE_PATH", ""), "SQLite database file path (default: data-dir/relay.db)")
	flag.Parse()

	// Set default database path if not specified
	if c.DatabasePath == "" {
		c.DatabasePath = c.DataDir
	}

	return c
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}
