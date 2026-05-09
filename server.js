// server.js — Coda Chat Engine Proxy
// Holds a Coda API token server-side so the Chrome extension
// can write to _CommentTarget and _Chats without exposing credentials.
//
// Environment variables (set in Render dashboard):
//   CODA_API_TOKEN  — your Coda API token (required)
//   ALLOWED_ORIGINS — comma-separated chrome-extension:// origins, or "*" for dev

import express from "express";
import cors    from "cors";

const app  = express();
const PORT = process.env.PORT || 3000;
const CODA_BASE = "https://coda.io/apis/v1";

// ── CORS ──────────────────────────────────────────────────────────────────────

const rawOrigins    = process.env.ALLOWED_ORIGINS || "*";
const allowedOrigins = rawOrigins === "*"
  ? "*"
  : rawOrigins.split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (allowedOrigins === "*")              return callback(null, true);
    if (!origin)                             return callback(null, true);
    if (allowedOrigins.includes(origin))     return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed`));
  },
  methods:        ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json({ limit: "1mb" }));

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({
    ok:             true,
    service:        "coda-chat-engine-proxy",
    tokenConfigured: !!process.env.CODA_API_TOKEN,
  });
});

// ── Coda API proxy ────────────────────────────────────────────────────────────
// Any request to /coda/* is forwarded to https://coda.io/apis/v1/*
// with the Coda token injected server-side.
//
// Examples:
//   GET  /coda/docs/:docId/tables/:tableId/rows
//   POST /coda/docs/:docId/tables/:tableId/rows
//   PUT  /coda/docs/:docId/tables/:tableId/rows/:rowId

app.all("/coda/*", async (req, res) => {
  const token = process.env.CODA_API_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, error: "CODA_API_TOKEN not configured on server." });
  }

  // Strip /coda prefix, forward the rest to Coda
  const codaPath = req.path.replace(/^\/coda/, "");
  const qs  = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
  const url = `${CODA_BASE}${codaPath}${qs}`;

  // Log every request for debugging
  console.log(`[proxy] ${req.method} ${url}`);

  try {
    const fetchOptions = {
      method:  req.method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
      },
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, fetchOptions);
    const data     = await response.json();

    if (!response.ok) {
      console.error(`[proxy] Coda ${response.status}:`, JSON.stringify(data));
    }

    res.status(response.status).json(data);

  } catch (err) {
    console.error("[proxy] Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Debug: test token against a known endpoint ────────────────────────────────
app.get("/debug/token", async (req, res) => {
  const token = process.env.CODA_API_TOKEN;
  if (!token) return res.json({ ok: false, error: "No token" });

  // Try to list docs — simplest auth test
  const r = await fetch(`${CODA_BASE}/docs?limit=3`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await r.json();
  res.json({ status: r.status, ok: r.ok, data });
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

app.listen(PORT, () => {
  console.log(`Coda Chat Engine proxy on port ${PORT}`);
  console.log(`Coda token: ${process.env.CODA_API_TOKEN ? "✓ configured" : "✗ MISSING"}`);
});
