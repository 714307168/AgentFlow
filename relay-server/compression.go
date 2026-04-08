package main

import (
	"bufio"
	"compress/gzip"
	"net"
	"net/http"
	"strings"
)

func gzipJSONMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !requestAcceptsGzip(r) || shouldSkipGzipForPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		w.Header().Add("Vary", "Accept-Encoding")
		writer := newGzipJSONResponseWriter(w)
		defer writer.Close()
		next.ServeHTTP(writer, r)
	})
}

func requestAcceptsGzip(r *http.Request) bool {
	for _, value := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		token := strings.TrimSpace(strings.SplitN(value, ";", 2)[0])
		if strings.EqualFold(token, "gzip") {
			return true
		}
	}
	return false
}

func shouldSkipGzipForPath(path string) bool {
	switch {
	case path == "/ws":
		return true
	case strings.HasPrefix(path, "/api/transfers/") && strings.HasSuffix(path, "/download"):
		return true
	case strings.HasPrefix(path, "/api/update/download/"):
		return true
	default:
		return false
	}
}

type gzipJSONResponseWriter struct {
	http.ResponseWriter
	compressor  *gzip.Writer
	compressing bool
	wroteHeader bool
}

func newGzipJSONResponseWriter(w http.ResponseWriter) *gzipJSONResponseWriter {
	return &gzipJSONResponseWriter{ResponseWriter: w}
}

func (w *gzipJSONResponseWriter) WriteHeader(statusCode int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true

	if w.shouldCompress(statusCode) {
		headers := w.Header()
		headers.Del("Content-Length")
		headers.Set("Content-Encoding", "gzip")
		w.compressor = gzip.NewWriter(w.ResponseWriter)
		w.compressing = true
	}

	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *gzipJSONResponseWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.compressing {
		return w.compressor.Write(data)
	}
	return w.ResponseWriter.Write(data)
}

func (w *gzipJSONResponseWriter) Flush() {
	if w.compressing && w.compressor != nil {
		_ = w.compressor.Flush()
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *gzipJSONResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (w *gzipJSONResponseWriter) shouldCompress(statusCode int) bool {
	if statusCode == http.StatusSwitchingProtocols || statusCode == http.StatusNoContent || statusCode == http.StatusNotModified {
		return false
	}
	contentType := strings.ToLower(strings.TrimSpace(w.Header().Get("Content-Type")))
	if contentType == "" {
		return false
	}
	if !strings.HasPrefix(contentType, "application/json") {
		return false
	}
	if strings.TrimSpace(w.Header().Get("Content-Encoding")) != "" {
		return false
	}
	if strings.TrimSpace(w.Header().Get("Content-Range")) != "" {
		return false
	}
	return true
}

func (w *gzipJSONResponseWriter) Close() error {
	if w.compressor == nil {
		return nil
	}
	return w.compressor.Close()
}
