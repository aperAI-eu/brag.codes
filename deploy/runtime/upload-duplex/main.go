package uploadduplex

import (
    "context"
    "net/http"
    "io"
    "time"
)

type Config struct{}
func CreateConfig() *Config { return &Config{} }
type middleware struct{ next http.Handler }
func New(_ context.Context, next http.Handler, _ *Config, _ string) (http.Handler, error) {
    return &middleware{next: next}, nil
}
func (m *middleware) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if r.ProtoMajor != 1 { m.next.ServeHTTP(w, r); return }
    control := http.NewResponseController(w)
    w.Header().Set("Connection", "close")
    if err := control.EnableFullDuplex(); err != nil {
        http.Error(w, "Upload transport unavailable", http.StatusServiceUnavailable)
        return
    }
    if r.Body != nil {
        body := r.Body
        // ReverseProxy closes the outgoing request body before returning. Closing
        // an incomplete incoming body there can block while its Read is in flight.
        // Own that cleanup here, after the entire response has been copied. Byte
        // counts cannot establish completion for chunked or transformed responses.
        r.Body = &deferredClose{body: body}
        defer func() {
            control.Flush()
            control.SetReadDeadline(time.Now())
            body.Close()
        }()
    }
    m.next.ServeHTTP(w, r)
}

type deferredClose struct { body io.ReadCloser }
func (b *deferredClose) Read(p []byte) (int, error) { return b.body.Read(p) }
func (b *deferredClose) Close() error { return nil }
