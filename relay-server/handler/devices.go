package handler

import (
	"encoding/json"
	"net/http"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
)

// ClientDevicesHandler exposes the current user's registered mobile devices to signed-in clients.
func ClientDevicesHandler(cfg *config.Config, database *db.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := currentClientSession(r, cfg, database)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		items, err := database.ListDevicesForScope(session.User.ID, false)
		if err != nil {
			http.Error(w, "failed to list devices", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(items)
	}
}
