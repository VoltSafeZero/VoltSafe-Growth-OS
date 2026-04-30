import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", background: "#0a0a0a", color: "#e5e5e5",
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "2rem", fontFamily: "monospace",
        }}>
          <div style={{ maxWidth: 600, width: "100%" }}>
            <h1 style={{ color: "#f87171", fontSize: "1.25rem", marginBottom: "1rem" }}>
              Something went wrong
            </h1>
            <pre style={{
              background: "#1a1a1a", border: "1px solid #333", borderRadius: 8,
              padding: "1rem", fontSize: "0.75rem", overflowX: "auto",
              whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#fca5a5",
            }}>
              {this.state.error.toString()}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: "1rem", padding: "0.5rem 1.5rem", background: "#14b8a6",
                color: "#0a0a0a", border: "none", borderRadius: 6, cursor: "pointer",
                fontWeight: 600, fontSize: "0.875rem",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
