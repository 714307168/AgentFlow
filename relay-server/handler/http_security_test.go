package handler

import (
	"bytes"
	"compress/gzip"
	"net/http/httptest"
	"testing"
)

func TestDecodeJSONBodyWithLimitSupportsGzip(t *testing.T) {
	var compressed bytes.Buffer
	gzipWriter := gzip.NewWriter(&compressed)
	if _, err := gzipWriter.Write([]byte(`{"name":"agentflow"}`)); err != nil {
		t.Fatalf("failed to write gzip payload: %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("failed to close gzip payload: %v", err)
	}

	req := httptest.NewRequest("POST", "/api/device/logs", bytes.NewReader(compressed.Bytes()))
	req.Header.Set("Content-Encoding", "gzip")
	recorder := httptest.NewRecorder()

	var payload struct {
		Name string `json:"name"`
	}
	if err := decodeJSONBodyWithLimit(recorder, req, &payload, 1024); err != nil {
		t.Fatalf("expected gzip body to decode, got %v", err)
	}
	if payload.Name != "agentflow" {
		t.Fatalf("expected decoded payload, got %#v", payload)
	}
}
