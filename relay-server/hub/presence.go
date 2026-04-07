package hub

import (
	"sync"
	"time"

	"github.com/claudecode/relay-server/model"
)

const presenceActiveWindow = 90 * time.Second

type PresenceState string

const (
	PresenceStateOnline     PresenceState = "online"
	PresenceStateIdle       PresenceState = "idle"
	PresenceStateBackground PresenceState = "background"
	PresenceStateOffline    PresenceState = "offline"
)

type PresenceInfo struct {
	Online       bool          `json:"online"`
	State        PresenceState `json:"presence_state"`
	LastActiveAt time.Time     `json:"last_active_at,omitempty"`
	LastSeenAt   time.Time     `json:"last_seen_at,omitempty"`
}

type presenceRecord struct {
	mu               sync.RWMutex
	clientType       model.ClientType
	online           bool
	connectedAt      time.Time
	lastInboundAt    time.Time
	lastTransportAt  time.Time
	lastDisconnected time.Time
}

func newPresenceRecord(clientType model.ClientType) *presenceRecord {
	return &presenceRecord{clientType: clientType}
}

func (r *presenceRecord) markConnected(at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.online = true
	if r.connectedAt.IsZero() || at.After(r.connectedAt) {
		r.connectedAt = at
	}
	if r.lastInboundAt.IsZero() {
		r.lastInboundAt = at
	}
	if r.lastTransportAt.IsZero() || at.After(r.lastTransportAt) {
		r.lastTransportAt = at
	}
}

func (r *presenceRecord) markInbound(at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.connectedAt.IsZero() {
		r.connectedAt = at
	}
	if r.lastInboundAt.IsZero() || at.After(r.lastInboundAt) {
		r.lastInboundAt = at
	}
	if r.lastTransportAt.IsZero() || at.After(r.lastTransportAt) {
		r.lastTransportAt = at
	}
}

func (r *presenceRecord) markTransport(at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.connectedAt.IsZero() {
		r.connectedAt = at
	}
	if r.lastTransportAt.IsZero() || at.After(r.lastTransportAt) {
		r.lastTransportAt = at
	}
}

func (r *presenceRecord) markDisconnected(at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.online = false
	if r.lastDisconnected.IsZero() || at.After(r.lastDisconnected) {
		r.lastDisconnected = at
	}
	if r.lastTransportAt.IsZero() || at.After(r.lastTransportAt) {
		r.lastTransportAt = at
	}
}

func (r *presenceRecord) snapshot(now time.Time) PresenceInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	lastActiveAt := maxTime(r.lastInboundAt, r.connectedAt)
	lastSeenAt := maxTime(r.lastTransportAt, lastActiveAt, r.lastDisconnected)
	state := PresenceStateOffline
	if r.online {
		if lastActiveAt.IsZero() || now.Sub(lastActiveAt) <= presenceActiveWindow {
			state = PresenceStateOnline
		} else if r.clientType == model.ClientTypeDevice {
			state = PresenceStateBackground
		} else {
			state = PresenceStateIdle
		}
	}

	return PresenceInfo{
		Online:       r.online,
		State:        state,
		LastActiveAt: lastActiveAt,
		LastSeenAt:   lastSeenAt,
	}
}

func maxTime(values ...time.Time) time.Time {
	var latest time.Time
	for _, value := range values {
		if value.IsZero() {
			continue
		}
		if latest.IsZero() || value.After(latest) {
			latest = value
		}
	}
	return latest
}
