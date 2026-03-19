package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/claudecode/relay-server/auth"
	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/hub"
	"github.com/claudecode/relay-server/model"
	"github.com/claudecode/relay-server/store"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

// WSHandler upgrades HTTP connections to WebSocket and handles the auth handshake.
func WSHandler(h *hub.Hub, cfg *config.Config, st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin: func(r *http.Request) bool {
				return isAllowedWSOrigin(r, cfg.CORSOrigins)
			},
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Warn().Err(err).Msg("ws upgrade failed")
			return
		}

		// Read the first message — must be auth.login or auth.resume.
		_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			log.Warn().Err(err).Msg("failed to read auth message")
			conn.Close()
			return
		}
		_ = conn.SetReadDeadline(time.Time{})

		var env model.Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			writeError(conn, "", "bad_request", "invalid envelope")
			conn.Close()
			return
		}

		if env.Event != model.EventAuthLogin && env.Event != model.EventAuthResume {
			writeError(conn, env.ID, "auth_required", "first message must be auth.login or auth.resume")
			conn.Close()
			return
		}

		// Parse auth payload.
		var loginPayload model.AuthLoginPayload
		var lastSeq int64

		if env.Event == model.EventAuthResume {
			var rp model.AuthResumePayload
			if err := json.Unmarshal(env.Payload, &rp); err != nil {
				writeError(conn, env.ID, "bad_request", "invalid auth.resume payload")
				conn.Close()
				return
			}
			loginPayload = model.AuthLoginPayload{
				Token:    rp.Token,
				Type:     rp.Type,
				AgentID:  rp.AgentID,
				DeviceID: rp.DeviceID,
			}
			lastSeq = rp.LastSeq
		} else {
			if err := json.Unmarshal(env.Payload, &loginPayload); err != nil {
				writeError(conn, env.ID, "bad_request", "invalid auth.login payload")
				conn.Close()
				return
			}
		}

		// Verify JWT.
		claims, err := auth.VerifyToken(cfg.JWTSecret, loginPayload.Token)
		if err != nil {
			writeError(conn, env.ID, "auth_failed", "invalid token")
			conn.Close()
			return
		}
		if loginPayload.Type != "" && loginPayload.Type != claims.Type {
			writeError(conn, env.ID, "auth_failed", "client type mismatch")
			conn.Close()
			return
		}

		// Build client.
		client := hub.NewClient(h, conn)
		client.ID = uuid.New().String()
		client.Type = claims.Type

		// Register with hub.
		switch claims.Type {
		case model.ClientTypeAgent:
			if claims.AgentID == "" || !st.AgentExists(claims.AgentID) {
				writeError(conn, env.ID, "auth_failed", "agent not registered")
				conn.Close()
				return
			}
			client.AgentID = claims.AgentID
			h.RegisterAgent(client)
			client.ProjectIDs = h.GetProjectIDsByAgent(client.AgentID)
		case model.ClientTypeDevice:
			if claims.DeviceID == "" || !st.DeviceExists(claims.DeviceID) {
				writeError(conn, env.ID, "auth_failed", "device not registered")
				conn.Close()
				return
			}
			client.DeviceID = claims.DeviceID
			if boundAgentID, ok := st.GetDeviceAgentID(claims.DeviceID); ok {
				client.AgentID = boundAgentID
			}
			h.RegisterDevice(client)
		default:
			writeError(conn, env.ID, "auth_failed", "unknown client type")
			conn.Close()
			return
		}

		// Send auth.ok.
		okPayload, _ := json.Marshal(model.AuthOKPayload{
			AgentID:  client.AgentID,
			DeviceID: client.DeviceID,
		})
		ack := model.Envelope{
			ID:        uuid.New().String(),
			Event:     model.EventAuthOK,
			Seq:       h.NextSeq(),
			Timestamp: time.Now().UnixMilli(),
			Payload:   okPayload,
		}
		if data, err := json.Marshal(ack); err == nil {
			_ = conn.WriteMessage(websocket.TextMessage, data)
		}

		// For auth.resume on an agent, drain queued messages for its projects.
		if env.Event == model.EventAuthResume && client.Type == model.ClientTypeAgent {
			if len(client.ProjectIDs) == 0 {
				client.ProjectIDs = h.GetProjectIDsByAgent(client.AgentID)
			}
			for _, projectID := range client.ProjectIDs {
				q := h.GetOrCreateQueue(projectID)
				for _, queued := range q.DrainFrom(lastSeq) {
					_ = client.Send(queued)
				}
			}
		}

		log.Info().
			Str("client_id", client.ID).
			Str("type", string(client.Type)).
			Str("agent_id", client.AgentID).
			Str("device_id", client.DeviceID).
			Msg("client authenticated")

		go client.WritePump()
		go client.ReadPump()
	}
}

func isAllowedWSOrigin(r *http.Request, allowedOrigins string) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	if allowedOrigins == "*" {
		return true
	}

	parsedOrigin, err := url.Parse(origin)
	if err != nil || parsedOrigin.Scheme == "" || parsedOrigin.Host == "" {
		return false
	}

	requestScheme := "http"
	if isHTTPSRequest(r) {
		requestScheme = "https"
	}
	if strings.EqualFold(parsedOrigin.Scheme, requestScheme) && strings.EqualFold(parsedOrigin.Host, r.Host) {
		return true
	}

	for _, allowed := range strings.Split(allowedOrigins, ",") {
		if strings.EqualFold(strings.TrimSpace(allowed), origin) {
			return true
		}
	}
	return false
}

func writeError(conn *websocket.Conn, refID, code, message string) {
	payload, _ := json.Marshal(model.ErrorPayload{Code: code, Message: message})
	env := model.Envelope{
		ID:        uuid.New().String(),
		Event:     model.EventAuthError,
		Timestamp: time.Now().UnixMilli(),
		Payload:   payload,
	}
	data, _ := json.Marshal(env)
	_ = conn.WriteMessage(websocket.TextMessage, data)
}
