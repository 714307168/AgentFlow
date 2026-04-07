package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

const (
	relayAPIHeaderVersion       = "X-AgentFlow-API-Version"
	relayAPIHeaderFamilies      = "X-AgentFlow-API-Families"
	relayAPIHeaderClient        = "X-AgentFlow-Client"
	relayAPIHeaderClientVersion = "X-AgentFlow-Client-Version"
	relayAPIVersion             = "1"
)

var relayAPIFamilies = map[string]string{
	"mobile":    "1",
	"relay":     "1",
	"transfer":  "1",
	"update":    "1",
	"workgroup": "1",
}

type relayAPIMetaResponse struct {
	ProtocolVersion string            `json:"protocol_version"`
	Families        map[string]string `json:"families"`
	HeaderVersion   string            `json:"header_version"`
	HeaderClient    string            `json:"header_client"`
	HeaderClientVer string            `json:"header_client_version"`
}

func apiMetaVersionHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(relayAPIMetaResponse{
			ProtocolVersion: relayAPIVersion,
			Families:        cloneRelayAPIFamilies(),
			HeaderVersion:   relayAPIHeaderVersion,
			HeaderClient:    relayAPIHeaderClient,
			HeaderClientVer: relayAPIHeaderClientVersion,
		})
	}
}

func apiVersionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isRelayAPIRequest(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		headers := w.Header()
		headers.Set(relayAPIHeaderVersion, relayAPIVersion)
		headers.Set(relayAPIHeaderFamilies, relayAPIFamiliesHeaderValue())

		requestedVersion := strings.TrimSpace(r.Header.Get(relayAPIHeaderVersion))
		if requestedVersion != "" && requestedVersion != relayAPIVersion {
			headers.Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUpgradeRequired)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error":               "unsupported_api_version",
				"requested_version":   requestedVersion,
				"supported_version":   relayAPIVersion,
				"supported_families":  cloneRelayAPIFamilies(),
				"client":              strings.TrimSpace(r.Header.Get(relayAPIHeaderClient)),
				"client_version":      strings.TrimSpace(r.Header.Get(relayAPIHeaderClientVersion)),
				"upgrade_instruction": "Upgrade the client to a relay API compatible build.",
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func relayAPIFamiliesHeaderValue() string {
	keys := make([]string, 0, len(relayAPIFamilies))
	for key := range relayAPIFamilies {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+relayAPIFamilies[key])
	}
	return strings.Join(parts, ",")
}

func cloneRelayAPIFamilies() map[string]string {
	cloned := make(map[string]string, len(relayAPIFamilies))
	for key, value := range relayAPIFamilies {
		cloned[key] = value
	}
	return cloned
}

func isRelayAPIRequest(path string) bool {
	normalized := strings.TrimSpace(path)
	return normalized == "/ws" ||
		normalized == "/api" ||
		strings.HasPrefix(normalized, "/api/")
}
