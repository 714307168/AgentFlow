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
	ID         string
	AgentID    string
	DeviceID   string
	Type       model.ClientType
	ProjectIDs []string

	conn *websocket.Conn
	send chan []byte
	hub  *Hub

	closed    chan struct{}
	closeOnce sync.Once
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
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Warn().Str("client_id", c.ID).Err(err).Msg("unexpected ws close")
			}
			return
		}

		var env model.Envelope
		if err := json.Unmarshal(msg, &env); err != nil {
			log.Warn().Str("client_id", c.ID).Err(err).Msg("failed to unmarshal envelope")
			continue
		}

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
				log.Warn().Str("client_id", c.ID).Err(err).Msg("ws write error")
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
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
