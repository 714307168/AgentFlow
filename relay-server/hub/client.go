package hub

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/claudecode/relay-server/model"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	maxMsgSize = 512 * 1024 // 512 KB
)

// Client represents a single WebSocket connection (agent or device).
type Client struct {
	ID                 string
	AgentID            string
	DeviceID           string
	UserID             int
	Type               model.ClientType
	ProjectIDs         []string
	AccessibleAgentIDs map[string]struct{}

	conn *websocket.Conn
	send chan []byte
	hub  *Hub

	closed    chan struct{}
	closeOnce sync.Once
}

func (c *Client) CanAccessAgent(agentID string) bool {
	if agentID == "" {
		return false
	}
	if c.Type == model.ClientTypeAgent {
		return c.AgentID != "" && c.AgentID == agentID
	}
	if len(c.AccessibleAgentIDs) == 0 {
		return c.AgentID != "" && c.AgentID == agentID
	}
	_, ok := c.AccessibleAgentIDs[agentID]
	return ok
}

// NewClient creates a Client bound to the given hub and connection.
func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		conn:   conn,
		send:   make(chan []byte, 256),
		hub:    hub,
		closed: make(chan struct{}),
	}
}

// ReadPump reads messages from the WebSocket and dispatches them to the hub.
// It must be run in its own goroutine.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMsgSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.hub.recordClientTransport(c)
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			unexpected := websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure)
			c.hub.recordWSCloseSignalForClient(c, "read", err, unexpected)
			if unexpected {
				log.Warn().Str("client_id", c.ID).Err(err).Msg("unexpected ws close")
			}
			return
		}
		c.hub.recordClientInbound(c)

		var env model.Envelope
		if err := json.Unmarshal(msg, &env); err != nil {
			log.Warn().Str("client_id", c.ID).Err(err).Msg("failed to unmarshal envelope")
			continue
		}

		c.hub.RecordInbound(env.Event, len(msg))
		c.hub.HandleMessage(c, &env)
	}
}

// WritePump drains the send channel to the WebSocket and sends periodic pings.
// It must be run in its own goroutine.
func (c *Client) WritePump() {
	pingInterval := time.Duration(c.hub.cfg.PingInterval) * time.Second
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				c.hub.recordWSCloseSignalForClient(c, "write", err, websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure))
				log.Warn().Str("client_id", c.ID).Err(err).Msg("ws write error")
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.hub.recordWSCloseSignalForClient(c, "ping", err, websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure))
				return
			}
		}
	}
}

// Send marshals env and queues it for delivery to this client.
func (c *Client) Send(env *model.Envelope) error {
	data, err := json.Marshal(env)
	if err != nil {
		return err
	}

	select {
	case <-c.closed:
		return errors.New("client closed")
	default:
	}

	select {
	case c.send <- data:
		c.hub.RecordOutbound(env.Event, len(data))
	case <-c.closed:
		return errors.New("client closed")
	default:
		log.Warn().Str("client_id", c.ID).Msg("send buffer full, dropping message")
	}
	return nil
}

// Close safely closes outbound channels once.
func (c *Client) Close() {
	c.closeOnce.Do(func() {
		close(c.closed)
		close(c.send)
	})
}
