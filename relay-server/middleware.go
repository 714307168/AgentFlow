package main

import (
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

type rateLimitEntry struct {
	count   int
	resetAt time.Time
}

type ipRateLimiter struct {
	mu          sync.Mutex
	maxRequests int
	window      time.Duration
	entries     map[string]rateLimitEntry
}

func newIPRateLimiter(maxRequests int, window time.Duration) *ipRateLimiter {
	return &ipRateLimiter{
		maxRequests: maxRequests,
		window:      window,
		entries:     make(map[string]rateLimitEntry),
	}
}

func (l *ipRateLimiter) allow(ip string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.entries) > 4096 {
		for key, entry := range l.entries {
			if now.After(entry.resetAt) {
				delete(l.entries, key)
			}
		}
	}

	entry, ok := l.entries[ip]
	if !ok || now.After(entry.resetAt) {
		l.entries[ip] = rateLimitEntry{
			count:   1,
			resetAt: now.Add(l.window),
		}
		return true, 0
	}

	if entry.count >= l.maxRequests {
		return false, time.Until(entry.resetAt)
	}

	entry.count++
	l.entries[ip] = entry
	return true, 0
}

func rateLimitMiddleware(name string, limiter *ipRateLimiter, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIPFromRequest(r)
		allowed, retryAfter := limiter.allow(ip, time.Now())
		if allowed {
			next(w, r)
			return
		}

		if retryAfter < 0 {
			retryAfter = 0
		}
		w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
		log.Warn().
			Str("path", r.URL.Path).
			Str("limit", name).
			Str("ip", ip).
			Msg("rate limit exceeded")
		http.Error(w, "too many requests", http.StatusTooManyRequests)
	}
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers := w.Header()
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("X-Frame-Options", "DENY")
		headers.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		headers.Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		headers.Set(
			"Content-Security-Policy",
			"default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; "+
				"img-src 'self' data:; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
		)
		if requestUsesHTTPS(r) {
			headers.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Error().
					Interface("panic", rec).
					Str("path", r.URL.Path).
					Bytes("stack", debug.Stack()).
					Msg("unhandled panic")
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func requestUsesHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func clientIPFromRequest(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
		return realIP
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
