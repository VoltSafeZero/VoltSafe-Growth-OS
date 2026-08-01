import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed /assets/* — safe for a 1-year immutable cache (filenames change on content change)
  const assetsPath = path.join(distPath, "assets");
  if (fs.existsSync(assetsPath)) {
    app.use(
      "/assets",
      express.static(assetsPath, {
        immutable: true,
        maxAge: "1y",
        etag: false,
      }),
    );
  }

  // All other static files (favicon, manifest, etc.) — short cache, revalidate
  app.use(
    express.static(distPath, {
      maxAge: 0,
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
      },
    }),
  );

  // SPA fallback — always serve index.html with no-cache so browsers pick up new chunk filenames after a deploy.
  // IMPORTANT: /api/* requests must NEVER reach this handler. If they do it means an API route handler
  // is missing or was not registered — return a clean 404 JSON instead of silently serving the SPA shell,
  // which would mask the missing route and make debugging extremely difficult.
  app.use("/{*path}", (req, res, next) => {
    // Use req.originalUrl, not req.path: Express 5 strips the matched path prefix from
    // req.path inside app.use("/{*path}", ...) handlers, leaving just "/".
    // req.originalUrl is always the full, unmodified request URL.
    const urlPath = req.originalUrl.split("?")[0];
    if (urlPath.startsWith("/api/")) {
      // An API route that reached the SPA catch-all was never registered.
      // Log a visible warning so the gap is immediately detectable in production logs.
      console.error(`[static] SPA catch-all reached for API path: ${req.method} ${urlPath} — route not registered`);
      return res.status(404).json({ message: "API route not found" });
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
