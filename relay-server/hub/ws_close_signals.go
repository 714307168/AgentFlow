package hub

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/claudecode/relay-server/model"
	"github.com/gorilla/websocket"
)

const maxWSCloseSignalTextLength = 160

type WSCloseSignal struct {
	ClientType      string    `json:"client_type,omitempty"`
	Source          string    `json:"source"`
	CloseCode       int       `json:"close_code"`
	CloseCodeText   string    `json:"close_code_text,omitempty"`
	Count           int64     `json:"count"`
	UnexpectedCount int64     `json:"unexpected_count"`
	LastReason      string    `json:"last_reason,omitempty"`
	LastError       string    `json:"last_error,omitempty"`
	LastAt          time.Time `json:"last_at,omitempty"`
}

type wsCloseSignalCounter struct {
	clientType      string
	source          string
	closeCode       int
	closeCodeText   string
	count           int64
	unexpectedCount int64
	lastReason      string
	lastError       string
	lastAt          time.Time
}

func (h *Hub) RecordWSCloseSignal(clientType model.ClientType, source string, err error, unexpected bool) {
	if h == nil || err == nil {
		return
	}

	normalizedSource := strings.TrimSpace(source)
	if normalizedSource == "" {
		normalizedSource = "unknown"
	}

	closeCode, closeReason, closeErrorText := parseWSCloseSignalError(err)
	clientTypeLabel := strings.TrimSpace(string(clientType))
	if clientTypeLabel == "" {
		clientTypeLabel = "unknown"
	}
	key := clientTypeLabel + "|" + normalizedSource + "|" + strconv.Itoa(closeCode)

	h.closeSignalMu.Lock()
	defer h.closeSignalMu.Unlock()

	counter, ok := h.closeSignals[key]
	if !ok {
		counter = &wsCloseSignalCounter{
			clientType:    clientTypeLabel,
			source:        normalizedSource,
			closeCode:     closeCode,
			closeCodeText: closeCodeLabel(closeCode),
		}
		h.closeSignals[key] = counter
	}

	counter.count++
	if unexpected {
		counter.unexpectedCount++
	}
	counter.lastAt = time.Now()
	if closeReason != "" {
		counter.lastReason = closeReason
	}
	if closeErrorText != "" {
		counter.lastError = closeErrorText
	}
}

func (h *Hub) recordWSCloseSignalForClient(client *Client, source string, err error, unexpected bool) {
	if client == nil {
		return
	}
	h.RecordWSCloseSignal(client.Type, source, err, unexpected)
}

func IsUnexpectedWSCloseSignalError(err error) bool {
	return websocket.IsUnexpectedCloseError(
		err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseNoStatusReceived,
		websocket.CloseAbnormalClosure,
	)
}

func (h *Hub) WSCloseSignalSnapshot() []WSCloseSignal {
	h.closeSignalMu.RLock()
	items := make([]WSCloseSignal, 0, len(h.closeSignals))
	for _, counter := range h.closeSignals {
		items = append(items, WSCloseSignal{
			ClientType:      counter.clientType,
			Source:          counter.source,
			CloseCode:       counter.closeCode,
			CloseCodeText:   counter.closeCodeText,
			Count:           counter.count,
			UnexpectedCount: counter.unexpectedCount,
			LastReason:      counter.lastReason,
			LastError:       counter.lastError,
			LastAt:          counter.lastAt,
		})
	}
	h.closeSignalMu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		if items[i].Count != items[j].Count {
			return items[i].Count > items[j].Count
		}
		if !items[i].LastAt.Equal(items[j].LastAt) {
			return items[i].LastAt.After(items[j].LastAt)
		}
		if items[i].ClientType != items[j].ClientType {
			return items[i].ClientType < items[j].ClientType
		}
		if items[i].Source != items[j].Source {
			return items[i].Source < items[j].Source
		}
		return items[i].CloseCode < items[j].CloseCode
	})

	return items
}

func parseWSCloseSignalError(err error) (int, string, string) {
	if err == nil {
		return 0, "", ""
	}

	if closeErr, ok := err.(*websocket.CloseError); ok {
		return closeErr.Code, trimWSCloseSignalText(closeErr.Text), trimWSCloseSignalText(err.Error())
	}

	return 0, "", trimWSCloseSignalText(err.Error())
}

func closeCodeLabel(code int) string {
	if code <= 0 {
		return "transport_error"
	}
	switch code {
	case websocket.CloseNormalClosure:
		return "normal_closure"
	case websocket.CloseGoingAway:
		return "going_away"
	case websocket.CloseProtocolError:
		return "protocol_error"
	case websocket.CloseUnsupportedData:
		return "unsupported_data"
	case websocket.CloseNoStatusReceived:
		return "no_status_received"
	case websocket.CloseAbnormalClosure:
		return "abnormal_closure"
	case websocket.CloseInvalidFramePayloadData:
		return "invalid_frame_payload_data"
	case websocket.ClosePolicyViolation:
		return "policy_violation"
	case websocket.CloseMessageTooBig:
		return "message_too_big"
	case websocket.CloseMandatoryExtension:
		return "mandatory_extension"
	case websocket.CloseInternalServerErr:
		return "internal_server_error"
	case websocket.CloseServiceRestart:
		return "service_restart"
	case websocket.CloseTryAgainLater:
		return "try_again_later"
	case websocket.CloseTLSHandshake:
		return "tls_handshake"
	default:
		return "application_defined"
	}
}

func trimWSCloseSignalText(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) <= maxWSCloseSignalTextLength {
		return trimmed
	}
	return trimmed[:maxWSCloseSignalTextLength]
}
