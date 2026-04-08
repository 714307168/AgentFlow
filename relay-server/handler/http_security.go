package handler

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const maxJSONBodyBytes int64 = 64 << 10

func readBearerToken(r *http.Request) (string, error) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if header == "" {
		return "", errors.New("missing authorization")
	}

	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", errors.New("invalid authorization header")
	}
	return parts[1], nil
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst interface{}) error {
	return decodeJSONBodyWithLimit(w, r, dst, maxJSONBodyBytes)
}

func decodeJSONBodyWithLimit(w http.ResponseWriter, r *http.Request, dst interface{}, maxBytes int64) error {
	bodyReader, err := openDecodedRequestBody(w, r, maxBytes)
	if err != nil {
		return err
	}
	defer bodyReader.Close()

	decoder := json.NewDecoder(bodyReader)
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	return nil
}

func openDecodedRequestBody(w http.ResponseWriter, r *http.Request, maxBytes int64) (io.ReadCloser, error) {
	bodyReader := http.MaxBytesReader(w, r.Body, maxBytes)
	encoding := strings.TrimSpace(r.Header.Get("Content-Encoding"))
	if encoding == "" || strings.EqualFold(encoding, "identity") {
		return bodyReader, nil
	}
	if !strings.EqualFold(encoding, "gzip") {
		_ = bodyReader.Close()
		return nil, fmt.Errorf("unsupported content encoding: %s", encoding)
	}

	gzipReader, err := gzip.NewReader(bodyReader)
	if err != nil {
		_ = bodyReader.Close()
		return nil, err
	}
	return &stackedReadCloser{
		Reader: gzipReader,
		closers: []io.Closer{
			gzipReader,
			bodyReader,
		},
	}, nil
}

type stackedReadCloser struct {
	io.Reader
	closers []io.Closer
}

func (r *stackedReadCloser) Close() error {
	var firstErr error
	for _, closer := range r.closers {
		if err := closer.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func isHTTPSRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}
