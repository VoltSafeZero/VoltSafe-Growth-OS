import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay({
      // Suppress browser-extension noise from the dev runtime-error overlay.
      // The plugin's client script wraps any non-Error caught by window.onerror
      // /unhandledrejection (e.g. SES `lockdown-install.js` throwing bare
      // `null` from sandboxed email-body srcdoc iframes injected by MetaMask /
      // Phantom / Coinbase Wallet extensions) as `new Error("(unknown runtime
      // error)")` — producing a full-screen overlay we can't action. Our app
      // never throws non-Error values (verified: zero Promise.reject(<value>)
      // and zero `throw <literal>` in client/src), so dropping this exact
      // wrapper message is safe. Trade-off: a future `new Error("(unknown
      // runtime error)")` in app code would be silently suppressed too — pick
      // a different message string if that ever needs an overlay. We also
      // drop overlays whose stack originates
      // from extension URLs or SES so a wallet extension that throws a real
      // Error still doesn't hijack our overlay. Returning `false` skips the
      // overlay; the error remains visible in the browser DevTools console.
      filter: (error) => {
        const msg = error?.message || "";
        const stack = error?.stack || "";
        if (msg === "(unknown runtime error)") return false;
        if (
          stack.includes("chrome-extension://") ||
          stack.includes("moz-extension://") ||
          stack.includes("safari-web-extension://") ||
          stack.includes("safari-extension://") ||
          stack.includes("lockdown-install") ||
          msg.includes("SES_UNCAUGHT_EXCEPTION")
        ) {
          return false;
        }
        return true;
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
