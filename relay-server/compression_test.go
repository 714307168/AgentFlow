package main

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGzipJSONMiddlewareCompressesJSONResponses(t *testing.T) {
	handler := gzipJSONMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/device/sync", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if got := recorder.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("expected gzip response encoding, got %q", got)
	}

	reader, err := gzip.NewReader(recorder.Result().Body)
	if err != nil {
		t.Fatalf("failed to open gzip body: %v", err)
	}
	defer reader.Close()

	payload, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("failed to read compressed response: %v", err)
	}
	if !strings.Contains(string(payload), `"status":"ok"`) {
		t.Fatalf("expected JSON payload, got %q", string(payload))
	}
}

func TestGzipJSONMiddlewareSkipsDownloadEndpoints(t *testing.T) {
	handler := gzipJSONMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"download":true}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/update/download/desktop.zip", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if got := recorder.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("expected no compression on excluded path, got %q", got)
	}
}
