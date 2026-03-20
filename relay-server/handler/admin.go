package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
)

type adminSession struct {
	UserID    int
	Username  string
	IsAdmin   bool
	ExpiresAt time.Time
}

type adminSessionContextKey struct{}

// In-memory admin sessions (token -> session)
var (
	adminSessions   = map[string]adminSession{}
	adminSessionsMu sync.Mutex
)

const adminSessionTTL = 8 * time.Hour
const adminCookieName = "admin_session"

// adminAuth middleware: validates session cookie, redirects to login if missing.
func adminAuth(cfg *config.Config, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(adminCookieName)
		if err != nil || cookie == nil || cookie.Value == "" {
			if strings.HasPrefix(r.URL.Path, "/admin/api/") {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			} else {
				http.Redirect(w, r, "/admin", http.StatusFound)
			}
			return
		}
		session, ok := getAdminSession(cookie.Value)
		if !ok {
			if strings.HasPrefix(r.URL.Path, "/admin/api/") {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			} else {
				http.Redirect(w, r, "/admin", http.StatusFound)
			}
			return
		}
		ctx := context.WithValue(r.Context(), adminSessionContextKey{}, session)
		next(w, r.WithContext(ctx))
	}
}

func getAdminSession(token string) (adminSession, bool) {
	adminSessionsMu.Lock()
	defer adminSessionsMu.Unlock()
	session, ok := adminSessions[token]
	if !ok {
		return adminSession{}, false
	}
	if time.Now().After(session.ExpiresAt) {
		delete(adminSessions, token)
		return adminSession{}, false
	}
	return session, true
}

func newAdminSession(user *db.User) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	adminSessionsMu.Lock()
	adminSessions[token] = adminSession{
		UserID:    user.ID,
		Username:  user.Username,
		IsAdmin:   user.IsAdmin,
		ExpiresAt: time.Now().Add(adminSessionTTL),
	}
	adminSessionsMu.Unlock()
	return token
}

func currentAdminSession(r *http.Request) (adminSession, bool) {
	session, ok := r.Context().Value(adminSessionContextKey{}).(adminSession)
	return session, ok
}

func setAdminSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminCookieName,
		Value:    token,
		Path:     "/admin",
		HttpOnly: true,
		MaxAge:   int(adminSessionTTL.Seconds()),
		SameSite: http.SameSiteStrictMode,
		Secure:   isHTTPSRequest(r),
	})
}

func clearAdminSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminCookieName,
		Value:    "",
		Path:     "/admin",
		HttpOnly: true,
		MaxAge:   -1,
		SameSite: http.SameSiteStrictMode,
		Secure:   isHTTPSRequest(r),
	})
}

// AdminUIHandler serves the admin SPA (login page + dashboard).
func AdminUIHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(adminHTML))
	}
}

// AdminLoginHandler handles POST /admin/api/login.
func AdminLoginHandler(database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := decodeJSONBody(w, r, &body); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		// Authenticate against database
		user, err := database.AuthenticateUser(body.Username, body.Password)
		if err != nil {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		token := newAdminSession(user)
		setAdminSessionCookie(w, r, token)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"user": map[string]interface{}{
				"id":       user.ID,
				"username": user.Username,
				"is_admin": user.IsAdmin,
			},
		})
	}
}

// AdminLogoutHandler handles POST /admin/api/logout.
func AdminLogoutHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if cookie, err := r.Cookie(adminCookieName); err == nil {
			adminSessionsMu.Lock()
			delete(adminSessions, cookie.Value)
			adminSessionsMu.Unlock()
		}
		clearAdminSessionCookie(w, r)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

// AdminAgentsHandler handles GET/POST /admin/api/agents and DELETE /admin/api/agents/{id}.
func AdminAgentsHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		session, ok := currentAdminSession(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		// DELETE /admin/api/agents/{id}
		if r.Method == http.MethodDelete {
			id := strings.TrimPrefix(r.URL.Path, "/admin/api/agents/")
			if id == "" {
				http.Error(w, "id required", http.StatusBadRequest)
				return
			}
			if err := database.DeleteAgentForUser(id, session.UserID); err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
			return
		}
		// POST /admin/api/agents
		if r.Method == http.MethodPost {
			var body struct {
				ID   string `json:"id"`
				Note string `json:"note"`
			}
			if err := decodeJSONBody(w, r, &body); err != nil || body.ID == "" {
				http.Error(w, "id is required", http.StatusBadRequest)
				return
			}
			if err := database.RegisterAgent(body.ID, session.UserID, body.Note); err != nil {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "created"})
			return
		}

		// GET /admin/api/agents
		agents, err := database.GetUserAgents(session.UserID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(agents)
	})
}

// AdminDevicesHandler handles GET/POST /admin/api/devices and DELETE /admin/api/devices/{id}.
func AdminDevicesHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		session, ok := currentAdminSession(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		// DELETE /admin/api/devices/{id}
		if r.Method == http.MethodDelete {
			id := strings.TrimPrefix(r.URL.Path, "/admin/api/devices/")
			if id == "" {
				http.Error(w, "id required", http.StatusBadRequest)
				return
			}
			if err := database.DeleteDeviceForUser(id, session.UserID); err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
			return
		}
		// POST /admin/api/devices
		if r.Method == http.MethodPost {
			var body struct {
				ID      string `json:"id"`
				AgentID string `json:"agent_id"`
				Note    string `json:"note"`
			}
			if err := decodeJSONBody(w, r, &body); err != nil || body.ID == "" {
				http.Error(w, "id is required", http.StatusBadRequest)
				return
			}
			if body.AgentID != "" {
				belongs, err := database.AgentBelongsToUser(body.AgentID, session.UserID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if !belongs {
					http.Error(w, "agent_id does not belong to current user", http.StatusForbidden)
					return
				}
			}
			if err := database.RegisterDevice(body.ID, session.UserID, body.AgentID, body.Note); err != nil {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]string{"status": "created"})
			return
		}

		// GET /admin/api/devices
		devices, err := database.GetUserDevices(session.UserID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(devices)
	})
}

// AdminCheckHandler returns 200 if session is valid (used by UI to detect login state).
func AdminCheckHandler(cfg *config.Config) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		session, ok := currentAdminSession(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"user": map[string]interface{}{
				"id":       session.UserID,
				"username": session.Username,
				"is_admin": session.IsAdmin,
			},
		})
	})
}

// AdminUsersHandler handles GET/POST /admin/api/users, POST /admin/api/users/{id}/password,
// and DELETE /admin/api/users/{id}.
func AdminUsersHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return adminAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
		session, ok := currentAdminSession(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !session.IsAdmin {
			http.Error(w, "admin access required", http.StatusForbidden)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		path := strings.TrimPrefix(r.URL.Path, "/admin/api/users")

		switch {
		case path == "" || path == "/":
			switch r.Method {
			case http.MethodGet:
				users, err := database.ListUsers()
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				json.NewEncoder(w).Encode(users)
				return
			case http.MethodPost:
				var body struct {
					Username string `json:"username"`
					Password string `json:"password"`
					IsAdmin  bool   `json:"is_admin"`
				}
				if err := decodeJSONBody(w, r, &body); err != nil {
					http.Error(w, "invalid request body", http.StatusBadRequest)
					return
				}
				user, err := database.CreateUser(body.Username, body.Password, body.IsAdmin)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"status": "created",
					"user": map[string]interface{}{
						"id":       user.ID,
						"username": user.Username,
						"is_admin": user.IsAdmin,
					},
				})
				return
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}

		case strings.HasSuffix(path, "/password") && r.Method == http.MethodPost:
			idValue := strings.Trim(strings.TrimSuffix(path, "/password"), "/")
			userID, err := strconv.Atoi(idValue)
			if err != nil {
				http.Error(w, "invalid user id", http.StatusBadRequest)
				return
			}
			var body struct {
				Password string `json:"password"`
			}
			if err := decodeJSONBody(w, r, &body); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			if err := database.SetUserPassword(userID, body.Password); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "password_reset"})
			return

		case r.Method == http.MethodDelete:
			idValue := strings.Trim(path, "/")
			userID, err := strconv.Atoi(idValue)
			if err != nil {
				http.Error(w, "invalid user id", http.StatusBadRequest)
				return
			}
			if userID == session.UserID {
				http.Error(w, "cannot delete the current admin user", http.StatusBadRequest)
				return
			}

			targetUser, err := database.GetUserByID(userID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			if targetUser.IsAdmin {
				adminCount, err := database.CountAdminUsers()
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				if adminCount <= 1 {
					http.Error(w, "cannot delete the last admin user", http.StatusBadRequest)
					return
				}
			}
			if err := database.DeleteUser(userID); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
			return
		}

		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
}

const adminHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Relay Admin</title>
<style>
  :root {
    --bg: #1a1a1a; --surface: #222; --surface2: #2a2a2a;
    --border: #333; --text: #e0e0e0; --muted: #666; --label: #aaa;
    --accent: #007acc; --accent-h: #0069b3;
    --success: #4caf50; --error: #f44336; --warn: #ff9800;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background:var(--bg); color:var(--text); font-size:13px; line-height:1.5; }
  .brand-lockup { display:flex; align-items:center; gap:12px; }
  .brand-lockup.compact { gap:10px; }
  .brand-copy { display:flex; flex-direction:column; gap:2px; }
  .brand-mark { width:42px; height:42px; flex:0 0 auto; }
  .brand-lockup.compact .brand-mark { width:28px; height:28px; }
  .brand-tagline { font-size:11px; color:var(--muted); letter-spacing:0.06em; text-transform:uppercase; }

  /* Login */
  #loginPage { display:flex; align-items:center; justify-content:center; height:100vh; }
  .login-box { background:var(--surface); border:1px solid var(--border); border-radius:10px;
               padding:32px 28px; width:320px; }
  .login-box h1 { font-size:16px; color:var(--text); }
  .login-brand { margin-bottom:24px; }
  .login-box label { display:block; font-size:12px; color:var(--label); margin-bottom:4px; font-weight:500; }
  .login-box input { width:100%; padding:7px 10px; background:var(--surface2); border:1px solid var(--border);
                     border-radius:5px; color:var(--text); font-size:13px; outline:none; margin-bottom:14px; }
  .login-box input:focus { border-color:var(--accent); }
  .login-box button { width:100%; padding:8px; background:var(--accent); color:#fff; border:none;
                      border-radius:5px; font-size:13px; cursor:pointer; font-weight:500; }
  .login-box button:hover { background:var(--accent-h); }
  .login-err { color:var(--error); font-size:12px; margin-top:10px; display:none; }

  /* Dashboard */
  #dashboard { display:none; }
  .topbar { display:flex; align-items:center; justify-content:space-between;
            padding:12px 24px; background:var(--surface); border-bottom:1px solid var(--border); }
  .topbar h1 { font-size:14px; font-weight:600; }
  .topbar-right { display:flex; align-items:center; gap:10px; }
  .user-badge { padding:5px 10px; border:1px solid var(--border); border-radius:999px;
                color:var(--label); font-size:12px; background:var(--surface2); }
  .lang-switch { padding:5px 10px; background:transparent; border:1px solid var(--border);
                 border-radius:4px; color:var(--label); font-size:12px; cursor:pointer; }
  .lang-switch:hover { border-color:var(--text); color:var(--text); }
  .topbar button { padding:5px 14px; background:transparent; border:1px solid var(--border);
                   border-radius:4px; color:var(--label); font-size:12px; cursor:pointer; }
  .topbar button:hover { border-color:var(--text); color:var(--text); }

  .content { padding:24px; max-width:900px; margin:0 auto; }
  .tabs { display:flex; gap:4px; margin-bottom:20px; border-bottom:1px solid var(--border); }
  .tab { padding:8px 16px; cursor:pointer; font-size:13px; color:var(--muted);
         border-bottom:2px solid transparent; margin-bottom:-1px; }
  .tab.active { color:var(--accent); border-bottom-color:var(--accent); }

  .panel { display:none; }
  .panel.active { display:block; }

  .toolbar { display:flex; gap:8px; margin-bottom:16px; }
  .toolbar input { flex:1; padding:6px 10px; background:var(--surface2); border:1px solid var(--border);
                   border-radius:5px; color:var(--text); font-size:13px; outline:none; }
  .toolbar input:focus { border-color:var(--accent); }
  .toolbar select { padding:6px 10px; background:var(--surface2); border:1px solid var(--border);
                    border-radius:5px; color:var(--text); font-size:13px; outline:none; min-width:160px; }
  .btn { padding:6px 14px; border:none; border-radius:5px; font-size:13px; cursor:pointer; font-weight:500; }
  .btn-primary { background:var(--accent); color:#fff; }
  .btn-primary:hover { background:var(--accent-h); }
  .btn-danger { background:transparent; border:1px solid #555; color:var(--error); }
  .btn-danger:hover { background:rgba(244,67,54,0.1); border-color:var(--error); }
  .toolbar-check { display:flex; align-items:center; gap:6px; padding:0 4px; color:var(--label); font-size:12px; white-space:nowrap; }
  .toolbar-check input { width:auto; }

  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; font-weight:600; text-transform:uppercase;
       letter-spacing:0.7px; color:var(--muted); padding:8px 12px;
       border-bottom:1px solid var(--border); }
  td { padding:10px 12px; border-bottom:1px solid #2a2a2a; font-size:13px; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:rgba(255,255,255,0.02); }
  .mono { font-family:'SF Mono','Consolas',monospace; font-size:12px; color:var(--label); }
  .note-cell { color:var(--muted); }
  .empty { text-align:center; padding:32px; color:var(--muted); }

  .toast { position:fixed; bottom:20px; right:20px; padding:10px 16px; border-radius:6px;
           font-size:13px; display:none; z-index:999; }
  .toast.ok { background:#1e3a1e; border:1px solid var(--success); color:var(--success); }
  .toast.err { background:#3a1e1e; border:1px solid var(--error); color:var(--error); }

  /* Info box */
  .info-box { background:var(--surface); border:1px solid var(--border); border-radius:8px;
              padding:16px; margin-bottom:20px; }
  .info-box h3 { font-size:13px; font-weight:600; margin-bottom:12px; color:var(--text); }
  .info-item { margin-bottom:10px; }
  .info-item:last-child { margin-bottom:0; }
  .info-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;
                margin-bottom:4px; font-weight:600; }
  .info-value { font-family:'SF Mono','Consolas',monospace; font-size:12px; color:var(--text);
                background:var(--surface2); padding:8px 10px; border-radius:4px; border:1px solid var(--border);
                word-break:break-all; display:flex; align-items:center; justify-content:space-between; }
  .copy-btn { background:transparent; border:1px solid var(--border); color:var(--label);
              padding:3px 8px; border-radius:3px; font-size:11px; cursor:pointer; margin-left:8px;
              flex-shrink:0; }
  .copy-btn:hover { border-color:var(--accent); color:var(--accent); }
  .info-code { background:var(--bg); border:1px solid var(--border); border-radius:4px;
               padding:10px; font-family:'SF Mono','Consolas',monospace; font-size:11px;
               color:var(--label); line-height:1.6; overflow-x:auto; }
  .action-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 12px;
                background:var(--surface2); border:1px solid var(--border); border-radius:4px;
                color:var(--text); font-size:12px; cursor:pointer; text-decoration:none;
                transition:all 0.15s; }
  .action-btn:hover { border-color:var(--accent); color:var(--accent); }
  .token-display { background:var(--bg); border:1px solid var(--border); border-radius:4px;
                   padding:10px; font-family:'SF Mono','Consolas',monospace; font-size:11px;
                   color:var(--success); margin-top:8px; display:none; word-break:break-all; }
</style>
</head>
<body>

<div id="loginPage">
  <div class="login-box">
    <div class="brand-lockup login-brand">
      <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="brandBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0d1824"/>
            <stop offset="100%" stop-color="#163249"/>
          </linearGradient>
          <linearGradient id="brandCore" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#5dd0ff"/>
            <stop offset="100%" stop-color="#3fd88f"/>
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="56" height="56" rx="15" fill="url(#brandBg)"/>
        <rect x="8" y="10" width="48" height="7" rx="3.5" fill="rgba(255,255,255,0.10)"/>
        <circle cx="32" cy="18" r="6" fill="#5dd0ff"/>
        <circle cx="18" cy="45" r="6" fill="#7ee6ff"/>
        <circle cx="46" cy="45" r="6" fill="#3fd88f"/>
        <path d="M 32 24 L 22 37" stroke="#edf4fb" stroke-width="3" stroke-linecap="round"/>
        <path d="M 32 24 L 42 37" stroke="#edf4fb" stroke-width="3" stroke-linecap="round"/>
        <path d="M 24 45 L 40 45" stroke="rgba(237,244,251,0.7)" stroke-width="3" stroke-linecap="round"/>
        <path d="M 32 28 L 41 37 L 32 46 L 23 37 Z" fill="url(#brandCore)"/>
        <path d="M 32 31 L 32 42" stroke="#08111a" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M 26.5 37 L 37.5 37" stroke="#08111a" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <div class="brand-copy">
        <h1>Relay Admin</h1>
        <div class="brand-tagline">Desktop · Relay · Mobile</div>
      </div>
    </div>
    <label>Username</label>
    <input type="text" id="loginUser" autocomplete="username">
    <label>Password</label>
    <input type="password" id="loginPass" autocomplete="current-password">
    <button id="loginBtn">Sign In</button>
    <div class="login-err" id="loginErr">Invalid credentials</div>
  </div>
</div>

<div id="dashboard">
  <div class="topbar">
    <div class="brand-lockup compact">
      <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="brandBgTop" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0d1824"/>
            <stop offset="100%" stop-color="#163249"/>
          </linearGradient>
          <linearGradient id="brandCoreTop" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#5dd0ff"/>
            <stop offset="100%" stop-color="#3fd88f"/>
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="56" height="56" rx="15" fill="url(#brandBgTop)"/>
        <rect x="8" y="10" width="48" height="7" rx="3.5" fill="rgba(255,255,255,0.10)"/>
        <circle cx="32" cy="18" r="6" fill="#5dd0ff"/>
        <circle cx="18" cy="45" r="6" fill="#7ee6ff"/>
        <circle cx="46" cy="45" r="6" fill="#3fd88f"/>
        <path d="M 32 24 L 22 37" stroke="#edf4fb" stroke-width="3" stroke-linecap="round"/>
        <path d="M 32 24 L 42 37" stroke="#edf4fb" stroke-width="3" stroke-linecap="round"/>
        <path d="M 24 45 L 40 45" stroke="rgba(237,244,251,0.7)" stroke-width="3" stroke-linecap="round"/>
        <path d="M 32 28 L 41 37 L 32 46 L 23 37 Z" fill="url(#brandCoreTop)"/>
        <path d="M 32 31 L 32 42" stroke="#08111a" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M 26.5 37 L 37.5 37" stroke="#08111a" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <div class="brand-copy">
        <h1 data-i18n="title">Relay Admin</h1>
      </div>
    </div>
    <div class="topbar-right">
      <span class="user-badge" id="currentUserLabel">Not signed in</span>
      <select class="lang-switch" id="langSwitch">
        <option value="en">English</option>
        <option value="zh">中文</option>
      </select>
      <button id="logoutBtn" data-i18n="logout">Sign Out</button>
    </div>
  </div>
  <div class="content">
    <div class="tabs">
      <div class="tab active" data-tab="overview" data-i18n="tab.overview">Overview</div>
      <div class="tab" data-tab="agents" data-i18n="tab.agents">Agents</div>
      <div class="tab" data-tab="devices" data-i18n="tab.devices">Devices</div>
      <div class="tab" data-tab="users" id="usersTab" style="display:none;">Users</div>
    </div>

    <div class="panel active" id="overviewPanel">
      <div class="info-box">
        <h3 data-i18n="ws.title">🌐 WebSocket Connection</h3>
        <div class="info-item">
          <div class="info-label" data-i18n="ws.url">WebSocket URL</div>
          <div class="info-value">
            <span id="wsUrl">ws://localhost:8080/ws</span>
            <button class="copy-btn" onclick="copyText('wsUrl')" data-i18n="btn.copy">Copy</button>
          </div>
        </div>
      </div>

      <div class="info-box">
        <h3 data-i18n="agent.title">🖥️ Local Agent Setup</h3>
        <div class="info-item">
          <div class="info-label" data-i18n="agent.step1">Step 1: Add Agent</div>
          <p style="font-size:12px; color:var(--label); margin-bottom:8px;" data-i18n="agent.step1.desc">Go to "Agents" tab and create a new agent with a unique ID (e.g., "my-laptop")</p>
        </div>
        <div class="info-item">
          <div class="info-label" data-i18n="agent.step2">Step 2: Get JWT Token</div>
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="text" id="agentTokenId" data-i18n-placeholder="agent.id.placeholder" placeholder="Enter Agent ID" style="flex:1; padding:6px 10px; background:var(--surface2); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:12px;">
            <button class="action-btn" onclick="getAgentToken()" data-i18n="btn.getToken">Get Token</button>
          </div>
          <div class="token-display" id="agentTokenDisplay"></div>
        </div>
        <div class="info-item">
          <div class="info-label" data-i18n="agent.step3">Step 3: Configure Local Agent</div>
          <div class="info-code" data-i18n="agent.step3.desc">Open Local Agent Settings and enter:
- Relay Server URL: <span id="wsUrlCopy">ws://localhost:8080/ws</span>
- Agent ID: [your agent ID]
- Token: [JWT token from step 2]</div>
        </div>
      </div>

      <div class="info-box">
        <h3 data-i18n="device.title">📱 Android App Setup</h3>
        <div class="info-item">
          <div class="info-label" data-i18n="device.step1">Step 1: Add Device</div>
          <p style="font-size:12px; color:var(--label); margin-bottom:8px;" data-i18n="device.step1.desc">Go to "Devices" tab and create a new device with a unique ID (e.g., "my-phone")</p>
        </div>
        <div class="info-item">
          <div class="info-label" data-i18n="device.step2">Step 2: Get JWT Token</div>
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="text" id="deviceTokenId" data-i18n-placeholder="device.id.placeholder" placeholder="Enter Device ID" style="flex:1; padding:6px 10px; background:var(--surface2); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:12px;">
            <button class="action-btn" onclick="getDeviceToken()" data-i18n="btn.getToken">Get Token</button>
          </div>
          <div class="token-display" id="deviceTokenDisplay"></div>
        </div>
        <div class="info-item">
          <div class="info-label" data-i18n="device.step3">Step 3: Configure Android App</div>
          <div class="info-code" data-i18n="device.step3.desc">Open Android App Settings and enter:
- Server URL: <span id="wsUrlCopy2">ws://localhost:8080/ws</span>
- Device ID: [your device ID]
- Token: [JWT token from step 2]
- Agent ID: [bind to specific agent, optional]</div>
        </div>
      </div>
    </div>

    <div class="panel" id="agentsPanel">
      <div class="toolbar">
        <input type="text" id="agentId" data-i18n-placeholder="agents.id.placeholder" placeholder="Agent ID">
        <input type="text" id="agentNote" data-i18n-placeholder="agents.note.placeholder" placeholder="Note (optional)">
        <button class="btn btn-primary" id="addAgentBtn" data-i18n="agents.add">Add Agent</button>
      </div>
      <table id="agentsTable">
        <thead><tr>
          <th data-i18n="agents.table.id">Agent ID</th>
          <th data-i18n="agents.table.note">Note</th>
          <th data-i18n="agents.table.created">Created</th>
          <th></th>
        </tr></thead>
        <tbody id="agentsTbody"></tbody>
      </table>
    </div>

    <div class="panel" id="devicesPanel">
      <div class="toolbar">
        <input type="text" id="deviceId" data-i18n-placeholder="devices.id.placeholder" placeholder="Device ID">
        <select id="deviceAgent"><option value="" data-i18n="devices.agent.placeholder">— Bind to Agent (optional) —</option></select>
        <input type="text" id="deviceNote" data-i18n-placeholder="devices.note.placeholder" placeholder="Note (optional)">
        <button class="btn btn-primary" id="addDeviceBtn" data-i18n="devices.add">Add Device</button>
      </div>
      <table id="devicesTable">
        <thead><tr>
          <th data-i18n="devices.table.id">Device ID</th>
          <th data-i18n="devices.table.agent">Agent</th>
          <th data-i18n="devices.table.note">Note</th>
          <th data-i18n="devices.table.created">Created</th>
          <th></th>
        </tr></thead>
        <tbody id="devicesTbody"></tbody>
      </table>
    </div>
    <div class="panel" id="usersPanel">
      <div class="toolbar">
        <input type="text" id="newUsername" placeholder="Username">
        <input type="password" id="newUserPassword" placeholder="Temporary password">
        <label class="toolbar-check"><input type="checkbox" id="newUserIsAdmin">Admin</label>
        <button class="btn btn-primary" id="addUserBtn">Create User</button>
      </div>
      <table id="usersTable">
        <thead><tr>
          <th>Username</th>
          <th>Role</th>
          <th>Agents</th>
          <th>Devices</th>
          <th>Created</th>
          <th></th>
        </tr></thead>
        <tbody id="usersTbody"></tbody>
      </table>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const $ = id => document.getElementById(id);
let currentAdminUser = null;
let agents = [];
let devices = [];
let users = [];

// i18n translations
const i18n = {
  en: {
    title: 'Relay Admin',
    logout: 'Sign Out',
    'tab.overview': 'Overview',
    'tab.agents': 'Agents',
    'tab.devices': 'Devices',
    'ws.title': '🌐 WebSocket Connection',
    'ws.url': 'WebSocket URL',
    'btn.copy': 'Copy',
    'btn.getToken': 'Get Token',
    'btn.delete': 'Delete',
    'agent.title': '🖥️ Local Agent Setup',
    'agent.step1': 'Step 1: Add Agent',
    'agent.step1.desc': 'Go to "Agents" tab and create a new agent with a unique ID (e.g., "my-laptop")',
    'agent.step2': 'Step 2: Get JWT Token',
    'agent.step3': 'Step 3: Configure Local Agent',
    'agent.step3.desc': 'Open Local Agent Settings and enter:\n- Relay Server URL: {wsUrl}\n- Agent ID: [your agent ID]\n- Token: [JWT token from step 2]',
    'agent.id.placeholder': 'Enter Agent ID',
    'device.title': '📱 Android App Setup',
    'device.step1': 'Step 1: Add Device',
    'device.step1.desc': 'Go to "Devices" tab and create a new device with a unique ID (e.g., "my-phone")',
    'device.step2': 'Step 2: Get JWT Token',
    'device.step3': 'Step 3: Configure Android App',
    'device.step3.desc': 'Open Android App Settings and enter:\n- Server URL: {wsUrl}\n- Device ID: [your device ID]\n- Token: [JWT token from step 2]\n- Agent ID: [bind to specific agent, optional]',
    'device.id.placeholder': 'Enter Device ID',
    'agents.id.placeholder': 'Agent ID',
    'agents.note.placeholder': 'Note (optional)',
    'agents.add': 'Add Agent',
    'agents.table.id': 'Agent ID',
    'agents.table.note': 'Note',
    'agents.table.created': 'Created',
    'agents.empty': 'No agents registered',
    'devices.id.placeholder': 'Device ID',
    'devices.note.placeholder': 'Note (optional)',
    'devices.agent.placeholder': '— Bind to Agent (optional) —',
    'devices.add': 'Add Device',
    'devices.table.id': 'Device ID',
    'devices.table.agent': 'Agent',
    'devices.table.note': 'Note',
    'devices.table.created': 'Created',
    'devices.empty': 'No devices registered',
    'toast.copied': 'Copied to clipboard',
    'toast.copyFailed': 'Failed to copy',
    'toast.tokenGenerated': 'Token generated successfully',
    'toast.agentAdded': 'Agent added',
    'toast.agentDeleted': 'Agent deleted',
    'toast.deviceAdded': 'Device added',
    'toast.deviceDeleted': 'Device deleted',
    'toast.enterAgentId': 'Please enter Agent ID',
    'toast.enterDeviceId': 'Please enter Device ID',
    'confirm.deleteAgent': 'Delete agent {id}?',
    'confirm.deleteDevice': 'Delete device {id}?'
  },
  zh: {
    title: '中继服务器管理',
    logout: '退出登录',
    'tab.overview': '概览',
    'tab.agents': '客户端',
    'tab.devices': '设备',
    'ws.title': '🌐 WebSocket 连接',
    'ws.url': 'WebSocket 地址',
    'btn.copy': '复制',
    'btn.getToken': '获取 Token',
    'btn.delete': '删除',
    'agent.title': '🖥️ 本地客户端配置',
    'agent.step1': '步骤 1：添加客户端',
    'agent.step1.desc': '前往"客户端"标签页，创建一个唯一的客户端 ID（例如："my-laptop"）',
    'agent.step2': '步骤 2：获取 JWT Token',
    'agent.step3': '步骤 3：配置本地客户端',
    'agent.step3.desc': '打开本地客户端设置并输入：\n- 中继服务器地址：{wsUrl}\n- 客户端 ID：[你的客户端 ID]\n- Token：[步骤 2 中的 JWT token]',
    'agent.id.placeholder': '输入客户端 ID',
    'device.title': '📱 Android 应用配置',
    'device.step1': '步骤 1：添加设备',
    'device.step1.desc': '前往"设备"标签页，创建一个唯一的设备 ID（例如："my-phone"）',
    'device.step2': '步骤 2：获取 JWT Token',
    'device.step3': '步骤 3：配置 Android 应用',
    'device.step3.desc': '打开 Android 应用设置并输入：\n- 服务器地址：{wsUrl}\n- 设备 ID：[你的设备 ID]\n- Token：[步骤 2 中的 JWT token]\n- 客户端 ID：[绑定到指定客户端，可选]',
    'device.id.placeholder': '输入设备 ID',
    'agents.id.placeholder': '客户端 ID',
    'agents.note.placeholder': '备注（可选）',
    'agents.add': '添加客户端',
    'agents.table.id': '客户端 ID',
    'agents.table.note': '备注',
    'agents.table.created': '创建时间',
    'agents.empty': '暂无客户端',
    'devices.id.placeholder': '设备 ID',
    'devices.note.placeholder': '备注（可选）',
    'devices.agent.placeholder': '— 绑定到客户端（可选）—',
    'devices.add': '添加设备',
    'devices.table.id': '设备 ID',
    'devices.table.agent': '客户端',
    'devices.table.note': '备注',
    'devices.table.created': '创建时间',
    'devices.empty': '暂无设备',
    'toast.copied': '已复制到剪贴板',
    'toast.copyFailed': '复制失败',
    'toast.tokenGenerated': 'Token 生成成功',
    'toast.agentAdded': '客户端已添加',
    'toast.agentDeleted': '客户端已删除',
    'toast.deviceAdded': '设备已添加',
    'toast.deviceDeleted': '设备已删除',
    'toast.enterAgentId': '请输入客户端 ID',
    'toast.enterDeviceId': '请输入设备 ID',
    'confirm.deleteAgent': '确定删除客户端 {id}？',
    'confirm.deleteDevice': '确定删除设备 {id}？'
  }
};

let currentLang = localStorage.getItem('adminLang') || 'en';

function t(key, params = {}) {
  let text = i18n[currentLang][key] || i18n.en[key] || key;
  Object.keys(params).forEach(k => {
    text = text.replace('{' + k + '}', params[k]);
  });
  return text;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key === 'agent.step3.desc' || key === 'device.step3.desc') {
      const wsUrl = document.getElementById('wsUrl').textContent;
      el.textContent = t(key, {wsUrl});
    } else {
      el.textContent = t(key);
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  $('langSwitch').value = currentLang;
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === name + 'Panel');
  });
}

function applySessionUI() {
  const label = $('currentUserLabel');
  const usersTab = $('usersTab');

  if (!currentAdminUser) {
    label.textContent = 'Not signed in';
    usersTab.style.display = 'none';
    return;
  }

  label.textContent = currentAdminUser.username + (currentAdminUser.is_admin ? ' (Admin)' : ' (User)');
  usersTab.style.display = currentAdminUser.is_admin ? '' : 'none';

  if (!currentAdminUser.is_admin && $('usersPanel').classList.contains('active')) {
    activateTab('overview');
  }
}

$('langSwitch').addEventListener('change', (e) => {
  currentLang = e.target.value;
  localStorage.setItem('adminLang', currentLang);
  applyI18n();
  renderAgents();
  renderDevices();
  renderUsers();
});

function showToast(msg, ok) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + (ok ? 'ok' : 'err');
  t.style.display = 'block';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.display = 'none', 2500);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? {'Content-Type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.trim() || res.statusText);
  }
  return res.json().catch(() => ({}));
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

// ---- Login ----
$('loginBtn').addEventListener('click', async () => {
  const u = $('loginUser').value.trim();
  const p = $('loginPass').value;
  try {
    const resp = await api('POST', '/admin/api/login', {username: u, password: p});
    currentAdminUser = resp.user || null;
    $('loginErr').style.display = 'none';
    showDashboard();
  } catch {
    $('loginErr').style.display = 'block';
  }
});
$('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });

$('logoutBtn').addEventListener('click', async () => {
  await api('POST', '/admin/api/logout', {}).catch(() => {});
  currentAdminUser = null;
  users = [];
  $('dashboard').style.display = 'none';
  $('loginPage').style.display = 'flex';
});

// ---- Tabs ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activateTab(tab.dataset.tab);
  });
});

// ---- Overview functions ----
function copyText(elementId) {
  const text = document.getElementById(elementId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast(t('toast.copied'), true);
  }).catch(() => {
    showToast(t('toast.copyFailed'), false);
  });
}

async function getAgentToken() {
  const agentId = $('agentTokenId').value.trim();
  if (!agentId) {
    showToast(t('toast.enterAgentId'), false);
    return;
  }
  try {
    const res = await fetch('/admin/api/session', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({type: 'agent', agent_id: agentId})
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    const data = await res.json();
    const display = $('agentTokenDisplay');
    display.textContent = data.token;
    display.style.display = 'block';
    showToast(t('toast.tokenGenerated'), true);
  } catch(e) {
    showToast(e.message, false);
  }
}

async function getDeviceToken() {
  const deviceId = $('deviceTokenId').value.trim();
  if (!deviceId) {
    showToast(t('toast.enterDeviceId'), false);
    return;
  }
  try {
    const res = await fetch('/admin/api/session', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({type: 'device', device_id: deviceId})
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    const data = await res.json();
    const display = $('deviceTokenDisplay');
    display.textContent = data.token;
    display.style.display = 'block';
    showToast(t('toast.tokenGenerated'), true);
  } catch(e) {
    showToast(e.message, false);
  }
}

// Update WebSocket URL based on current location
window.addEventListener('DOMContentLoaded', () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + window.location.host + '/ws';
  document.querySelectorAll('#wsUrl, #wsUrlCopy, #wsUrlCopy2').forEach(el => {
    el.textContent = wsUrl;
  });
});

// ---- Agents ----

async function loadAgents() {
  agents = await api('GET', '/admin/api/agents');
  if (!Array.isArray(agents)) agents = [];
  renderAgents();
  refreshDeviceAgentSelect();
}

function renderAgents() {
  const tbody = $('agentsTbody');
  if (!agents.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">' + t('agents.empty') + '</td></tr>';
    return;
  }
  tbody.innerHTML = agents.map(function(a) {
    return '<tr>' +
      '<td class="mono">' + esc(a.id) + '</td>' +
      '<td class="note-cell">' + esc(a.note || '') + '</td>' +
      '<td class="mono">' + fmtDate(a.created_at) + '</td>' +
      '<td><button class="btn btn-danger" onclick="deleteAgent(\'' + esc(a.id) + '\')">' + t('btn.delete') + '</button></td>' +
      '</tr>';
  }).join('');
}

$('addAgentBtn').addEventListener('click', async () => {
  const id = $('agentId').value.trim();
  if (!id) { showToast(t('toast.enterAgentId'), false); return; }
  try {
    await api('POST', '/admin/api/agents', {id, note: $('agentNote').value.trim()});
    $('agentId').value = ''; $('agentNote').value = '';
    showToast(t('toast.agentAdded'), true);
    loadAgents();
  } catch(e) { showToast(e.message, false); }
});

async function deleteAgent(id) {
  if (!confirm(t('confirm.deleteAgent', {id}))) return;
  try {
    await api('DELETE', '/admin/api/agents/' + encodeURIComponent(id));
    showToast(t('toast.agentDeleted'), true);
    loadAgents();
  } catch(e) { showToast(e.message, false); }
}

// ---- Devices ----

async function loadDevices() {
  devices = await api('GET', '/admin/api/devices');
  if (!Array.isArray(devices)) devices = [];
  renderDevices();
}

function renderDevices() {
  const tbody = $('devicesTbody');
  if (!devices.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">' + t('devices.empty') + '</td></tr>';
    return;
  }
  tbody.innerHTML = devices.map(function(d) {
    return '<tr>' +
      '<td class="mono">' + esc(d.id) + '</td>' +
      '<td class="mono">' + esc(d.agent_id || '—') + '</td>' +
      '<td class="note-cell">' + esc(d.note || '') + '</td>' +
      '<td class="mono">' + fmtDate(d.created_at) + '</td>' +
      '<td><button class="btn btn-danger" onclick="deleteDevice(\'' + esc(d.id) + '\')">' + t('btn.delete') + '</button></td>' +
      '</tr>';
  }).join('');
}

function refreshDeviceAgentSelect() {
  const sel = $('deviceAgent');
  const cur = sel.value;
  sel.innerHTML = '<option value="">' + t('devices.agent.placeholder') + '</option>' +
    agents.map(function(a) { return '<option value="' + esc(a.id) + '">' + esc(a.id) + '</option>'; }).join('');
  sel.value = cur;
}

$('addDeviceBtn').addEventListener('click', async () => {
  const id = $('deviceId').value.trim();
  if (!id) { showToast(t('toast.enterDeviceId'), false); return; }
  try {
    await api('POST', '/admin/api/devices', {
      id,
      agent_id: $('deviceAgent').value,
      note: $('deviceNote').value.trim(),
    });
    $('deviceId').value = ''; $('deviceNote').value = '';
    showToast(t('toast.deviceAdded'), true);
    loadDevices();
  } catch(e) { showToast(e.message, false); }
});

async function deleteDevice(id) {
  if (!confirm(t('confirm.deleteDevice', {id}))) return;
  try {
    await api('DELETE', '/admin/api/devices/' + encodeURIComponent(id));
    showToast(t('toast.deviceDeleted'), true);
    loadDevices();
  } catch(e) { showToast(e.message, false); }
}

// ---- Users ----
async function loadUsers() {
  if (!currentAdminUser || !currentAdminUser.is_admin) {
    users = [];
    renderUsers();
    return;
  }
  users = await api('GET', '/admin/api/users');
  if (!Array.isArray(users)) users = [];
  renderUsers();
}

function renderUsers() {
  const tbody = $('usersTbody');
  if (!tbody) return;
  if (!currentAdminUser || !currentAdminUser.is_admin) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Admin access required</td></tr>';
    return;
  }
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No users created</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(function(user) {
    const actions = [];
    actions.push('<button class="btn btn-danger" onclick="resetUserPassword(' + user.id + ', ' + encodeJsString(user.username) + ')">Reset Password</button>');
    if (!currentAdminUser || user.id !== currentAdminUser.id) {
      actions.push('<button class="btn btn-danger" onclick="deleteUser(' + user.id + ', ' + encodeJsString(user.username) + ')">Delete</button>');
    }
    return '<tr>' +
      '<td class="mono">' + esc(user.username) + '</td>' +
      '<td>' + (user.is_admin ? 'Admin' : 'User') + '</td>' +
      '<td class="mono">' + esc(user.agent_count) + '</td>' +
      '<td class="mono">' + esc(user.device_count) + '</td>' +
      '<td class="mono">' + fmtDate(user.created_at) + '</td>' +
      '<td style="display:flex; gap:8px; flex-wrap:wrap;">' + actions.join('') + '</td>' +
      '</tr>';
  }).join('');
}

$('addUserBtn').addEventListener('click', async () => {
  const username = $('newUsername').value.trim();
  const password = $('newUserPassword').value;
  if (!username || !password) {
    showToast('Username and password are required', false);
    return;
  }
  try {
    await api('POST', '/admin/api/users', {
      username,
      password,
      is_admin: $('newUserIsAdmin').checked,
    });
    $('newUsername').value = '';
    $('newUserPassword').value = '';
    $('newUserIsAdmin').checked = false;
    showToast('User created', true);
    loadUsers();
  } catch (e) {
    showToast(e.message, false);
  }
});

async function resetUserPassword(id, username) {
  const password = window.prompt('Enter a new password for ' + username);
  if (password === null) return;
  if (!password.trim()) {
    showToast('Password cannot be empty', false);
    return;
  }
  try {
    await api('POST', '/admin/api/users/' + encodeURIComponent(id) + '/password', {
      password,
    });
    showToast('Password reset', true);
  } catch (e) {
    showToast(e.message, false);
  }
}

async function deleteUser(id, username) {
  if (!confirm('Delete user ' + username + '?')) return;
  try {
    await api('DELETE', '/admin/api/users/' + encodeURIComponent(id));
    showToast('User deleted', true);
    loadUsers();
  } catch (e) {
    showToast(e.message, false);
  }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function encodeJsString(s) {
  return JSON.stringify(String(s));
}

// ---- Init ----
async function showDashboard() {
  const session = await api('GET', '/admin/api/check');
  currentAdminUser = session.user || null;
  $('loginPage').style.display = 'none';
  $('dashboard').style.display = 'block';
  applyI18n();
  applySessionUI();
  await Promise.all([
    loadAgents(),
    loadDevices(),
    currentAdminUser && currentAdminUser.is_admin ? loadUsers() : Promise.resolve(),
  ]);
}

// Check if already logged in
api('GET', '/admin/api/check').then(() => showDashboard()).catch(() => {});
</script>
</body>
</html>`
