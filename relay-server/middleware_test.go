package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoginRateLimitIsScopedByUsernameAndIP(t *testing.T) {
	limiter := newIPRateLimiter(1, time.Minute)
	seenUsernames := make([]string, 0, 2)
	handler := loginRateLimitMiddleware("user-login", limiter, func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Username string `json:"username"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("login handler could not read restored body: %v", err)
		}
		seenUsernames = append(seenUsernames, payload.Username)
		w.WriteHeader(http.StatusNoContent)
	})

	assertStatus(t, handler, loginRequest("alice", "203.0.113.10:43110"), http.StatusNoContent)
	assertStatus(t, handler, loginRequest("bob", "203.0.113.10:43111"), http.StatusNoContent)
	assertStatus(t, handler, loginRequest("alice", "203.0.113.10:43112"), http.StatusTooManyRequests)

	if got, want := strings.Join(seenUsernames, ","), "alice,bob"; got != want {
		t.Fatalf("unexpected usernames seen by login handler: got %q want %q", got, want)
	}
}

func TestLoginRateLimitFallsBackToIPWithoutUsername(t *testing.T) {
	limiter := newIPRateLimiter(1, time.Minute)
	handler := loginRateLimitMiddleware("user-login", limiter, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	assertStatus(t, handler, loginRequest("", "203.0.113.20:43110"), http.StatusNoContent)
	response := assertStatus(t, handler, loginRequest("", "203.0.113.20:43111"), http.StatusTooManyRequests)
	if response.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on limited login")
	}
}

func TestRateLimitMiddlewareRemainsIPScoped(t *testing.T) {
	limiter := newIPRateLimiter(1, time.Minute)
	handler := rateLimitMiddleware("generic", limiter, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	assertStatus(t, handler, genericRequest("203.0.113.30:43110"), http.StatusNoContent)
	assertStatus(t, handler, genericRequest("203.0.113.30:43111"), http.StatusTooManyRequests)
	assertStatus(t, handler, genericRequest("203.0.113.31:43112"), http.StatusNoContent)
}

func loginRequest(username string, remoteAddr string) *http.Request {
	body := `{"username":"` + username + `","password":"bad"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	req.RemoteAddr = remoteAddr
	return req
}

func genericRequest(remoteAddr string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/anything", strings.NewReader("{}"))
	req.RemoteAddr = remoteAddr
	return req
}

func assertStatus(t *testing.T, handler http.HandlerFunc, req *http.Request, want int) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler(recorder, req)
	if recorder.Code != want {
		t.Fatalf("unexpected status: got %d want %d body=%q", recorder.Code, want, recorder.Body.String())
	}
	return recorder
}
