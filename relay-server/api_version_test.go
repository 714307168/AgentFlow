package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAPIVersionMiddlewareAddsHeadersAndAcceptsMatchingVersion(t *testing.T) {
	handler := apiVersionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/meta/version", nil)
	req.Header.Set(relayAPIHeaderVersion, relayAPIVersion)
	req.Header.Set(relayAPIHeaderClient, "android")
	req.Header.Set(relayAPIHeaderClientVersion, "1.2.12")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d", http.StatusNoContent, recorder.Code)
	}
	if got := recorder.Header().Get(relayAPIHeaderVersion); got != relayAPIVersion {
		t.Fatalf("expected %s header %q, got %q", relayAPIHeaderVersion, relayAPIVersion, got)
	}
	if got := recorder.Header().Get(relayAPIHeaderFamilies); got == "" {
		t.Fatalf("expected %s header to be present", relayAPIHeaderFamilies)
	}
}

func TestAPIVersionMiddlewareRejectsUnsupportedVersion(t *testing.T) {
	handler := apiVersionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/transfers", nil)
	req.Header.Set(relayAPIHeaderVersion, "999")
	req.Header.Set(relayAPIHeaderClient, "desktop-local-agent")
	req.Header.Set(relayAPIHeaderClientVersion, "1.1.117")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUpgradeRequired {
		t.Fatalf("expected status %d, got %d", http.StatusUpgradeRequired, recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode error payload: %v", err)
	}
	if payload["error"] != "unsupported_api_version" {
		t.Fatalf("unexpected error payload: %+v", payload)
	}
	if payload["supported_version"] != relayAPIVersion {
		t.Fatalf("expected supported_version %q, got %#v", relayAPIVersion, payload["supported_version"])
	}
}

func TestAPIMetaVersionHandlerReturnsProtocolAndFamilies(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/meta/version", nil)
	recorder := httptest.NewRecorder()

	apiVersionMiddleware(apiMetaVersionHandler()).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload relayAPIMetaResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode payload: %v", err)
	}
	if payload.ProtocolVersion != relayAPIVersion {
		t.Fatalf("expected protocol version %q, got %q", relayAPIVersion, payload.ProtocolVersion)
	}
	if payload.Families["transfer"] != "1" || payload.Families["workgroup"] != "1" || payload.Families["mobile"] != "1" {
		t.Fatalf("unexpected families payload: %+v", payload.Families)
	}
}
