package hub

import (
	"errors"
	"testing"

	"github.com/claudecode/relay-server/config"
	"github.com/claudecode/relay-server/model"
	"github.com/gorilla/websocket"
)

func TestWSCloseSignalSnapshotAggregatesByClientSourceAndCode(t *testing.T) {
	h := NewHub(&config.Config{}, nil)

	h.RecordWSCloseSignal(model.ClientTypeDevice, "read", &websocket.CloseError{
		Code: websocket.CloseAbnormalClosure,
		Text: "proxy idle timeout",
	}, true)
	h.RecordWSCloseSignal(model.ClientTypeDevice, "read", &websocket.CloseError{
		Code: websocket.CloseAbnormalClosure,
		Text: "proxy idle timeout",
	}, true)
	h.RecordWSCloseSignal(model.ClientTypeAgent, "ping", errors.New("i/o timeout"), false)

	snapshot := h.WSCloseSignalSnapshot()
	if len(snapshot) != 2 {
		t.Fatalf("expected 2 close-signal buckets, got %d", len(snapshot))
	}

	first := snapshot[0]
	if first.ClientType != string(model.ClientTypeDevice) {
		t.Fatalf("expected first bucket for device, got %+v", first)
	}
	if first.Source != "read" || first.CloseCode != websocket.CloseAbnormalClosure {
		t.Fatalf("unexpected first bucket: %+v", first)
	}
	if first.Count != 2 || first.UnexpectedCount != 2 {
		t.Fatalf("expected aggregated device close counts, got %+v", first)
	}
	if first.LastReason != "proxy idle timeout" {
		t.Fatalf("expected last reason to be preserved, got %+v", first)
	}

	second := snapshot[1]
	if second.ClientType != string(model.ClientTypeAgent) || second.Source != "ping" || second.CloseCode != 0 {
		t.Fatalf("unexpected second bucket: %+v", second)
	}
	if second.CloseCodeText != "transport_error" {
		t.Fatalf("expected transport_error label for non-close errors, got %+v", second)
	}
}
