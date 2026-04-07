package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/db"
	"github.com/claudecode/relay-server/hub"
)

type clientDeviceItem struct {
	ID            string     `json:"id"`
	UserID        int        `json:"user_id"`
	Username      string     `json:"username"`
	AgentID       string     `json:"agent_id,omitempty"`
	Note          string     `json:"note"`
	CreatedAt     time.Time  `json:"created_at"`
	Online        bool       `json:"online"`
	PresenceState string     `json:"presence_state"`
	LastActiveAt  *time.Time `json:"last_active_at,omitempty"`
	LastSeenAt    *time.Time `json:"last_seen_at,omitempty"`
}

// ClientDevicesHandler exposes the current user's registered mobile devices to signed-in clients.
func ClientDevicesHandler(cfg *config.Config, database *db.DB, liveHub *hub.Hub) http.HandlerFunc {
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

		response := make([]clientDeviceItem, 0, len(items))
		for _, item := range items {
			presence := hub.PresenceInfo{State: hub.PresenceStateOffline}
			if liveHub != nil {
				presence = liveHub.DevicePresence(item.ID)
			}
			response = append(response, clientDeviceItem{
				ID:            item.ID,
				UserID:        item.UserID,
				Username:      item.Username,
				AgentID:       item.AgentID,
				Note:          item.Note,
				CreatedAt:     item.CreatedAt,
				Online:        presence.Online,
				PresenceState: string(presence.State),
				LastActiveAt:  optionalTimePointer(presence.LastActiveAt),
				LastSeenAt:    optionalTimePointer(presence.LastSeenAt),
			})
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}
}

func optionalTimePointer(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	result := value
	return &result
}
