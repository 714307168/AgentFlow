package model

import "encoding/json"

// Event name constants
const (
	// Auth events
	EventAuthLogin   = "auth.login"
	EventAuthResume  = "auth.resume"
	EventAuthRefresh = "auth.refresh"
	EventAuthOK      = "auth.ok"
	EventAuthError   = "auth.error"

	// Project events
	EventProjectBind        = "project.bind"
	EventProjectBound       = "project.bound"
	EventProjectListRequest = "project.list.request"
	EventProjectList        = "project.list"
	EventProjectListed      = "project.listed"
	EventSessionSyncRequest = "session.sync.request"
	EventSessionSync        = "session.sync"

	// Message events
	EventMessageSend  = "message.send"
	EventMessageChunk = "message.chunk"
	EventMessageDone  = "message.done"
	EventMessageError = "message.error"

	// Agent events
	EventAgentStatus = "agent.status"
	EventAgentWakeup = "agent.wakeup"

	// File events
	EventFileSync   = "file.sync"
	EventFileUpload = "file.upload"
	EventFileChunk  = "file.chunk"
	EventFileDone   = "file.done"
	EventFileError  = "file.error"

	// E2E encryption events
	EventE2EOffer  = "e2e.offer"
	EventE2EAnswer = "e2e.answer"

	// System events
	EventPing  = "ping"
	EventPong  = "pong"
	EventError = "error"
)

// ClientType identifies the type of connected client
type ClientType string

const (
	ClientTypeAgent  ClientType = "agent"
	ClientTypeDevice ClientType = "device"
)

// Envelope is the universal message wrapper for all WS communication
type Envelope struct {
	ID        string          `json:"id"`
	Event     string          `json:"event"`
	ProjectID string          `json:"project_id,omitempty"`
	StreamID  string          `json:"stream_id,omitempty"`
	Seq       int64           `json:"seq,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	Timestamp int64           `json:"ts"`
}

// AuthLoginPayload is the payload for auth.login
type AuthLoginPayload struct {
	Token    string     `json:"token"`
	Type     ClientType `json:"type"`
	AgentID  string     `json:"agent_id,omitempty"`
	DeviceID string     `json:"device_id,omitempty"`
}

// AuthResumePayload is the payload for auth.resume
type AuthResumePayload struct {
	Token    string     `json:"token"`
	Type     ClientType `json:"type"`
	AgentID  string     `json:"agent_id,omitempty"`
	DeviceID string     `json:"device_id,omitempty"`
	LastSeq  int64      `json:"last_seq"`
}

// AuthOKPayload is the payload for auth.ok
type AuthOKPayload struct {
	AgentID  string `json:"agent_id,omitempty"`
	DeviceID string `json:"device_id,omitempty"`
}

// ProjectBindPayload is the payload for project.bind
type ProjectBindPayload struct {
	ProjectID   string `json:"project_id"`
	Path        string `json:"path"`
	Name        string `json:"name"`
	CLIProvider string `json:"cli_provider,omitempty"`
	CLIModel    string `json:"cli_model,omitempty"`
}

type ProjectListItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	CLIProvider string `json:"cli_provider,omitempty"`
	CLIModel    string `json:"cli_model,omitempty"`
	Online      bool   `json:"online"`
}

type ProjectListPayload struct {
	AgentID  string            `json:"agent_id,omitempty"`
	Projects []ProjectListItem `json:"projects"`
}

// MessageSendPayload is the payload for message.send
type MessageSendPayload struct {
	Content   string `json:"content"`
	ProjectID string `json:"project_id"`
}

// MessageChunkPayload is the payload for message.chunk
type MessageChunkPayload struct {
	Content   string `json:"content"`
	ProjectID string `json:"project_id"`
	StreamID  string `json:"stream_id"`
	Seq       int64  `json:"seq"`
	Done      bool   `json:"done"`
}

// AgentStatusPayload is the payload for agent.status
type AgentStatusPayload struct {
	AgentID   string `json:"agent_id"`
	Online    bool   `json:"online"`
	ProjectID string `json:"project_id,omitempty"`
}

// ErrorPayload is the payload for error events
type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// FileSyncPayload is the payload for file.sync
type FileSyncPayload struct {
	ProjectID string `json:"project_id"`
	Path      string `json:"path"`
	Content   string `json:"content"` // base64 encoded
	Version   int64  `json:"version"`
	Checksum  string `json:"checksum"`
}

// E2EOfferPayload is the payload for e2e.offer (public key exchange)
type E2EOfferPayload struct {
	PublicKey string `json:"public_key"` // base64-encoded X25519 public key
}

// E2EAnswerPayload is the payload for e2e.answer
type E2EAnswerPayload struct {
	PublicKey string `json:"public_key"` // base64-encoded X25519 public key
}

// EncryptedPayload wraps an encrypted message payload
type EncryptedPayload struct {
	Ciphertext string `json:"ciphertext"` // base64-encoded AES-256-GCM ciphertext
	Nonce      string `json:"nonce"`      // base64-encoded 12-byte nonce
	Encrypted  bool   `json:"encrypted"`  // always true
}

// FileUploadPayload is the payload for file.upload
type FileUploadPayload struct {
	FileName  string `json:"file_name"`
	FileSize  int64  `json:"file_size"`
	MimeType  string `json:"mime_type"`
	ProjectID string `json:"project_id"`
}

// FileChunkPayload is the payload for file.chunk
type FileChunkPayload struct {
	FileID string `json:"file_id"`
	Chunk  string `json:"chunk"` // base64 encoded
	Seq    int64  `json:"seq"`
	Total  int64  `json:"total"`
}

// FileDonePayload is the payload for file.done
type FileDonePayload struct {
	FileID   string `json:"file_id"`
	FileName string `json:"file_name"`
	FilePath string `json:"file_path,omitempty"`
}
