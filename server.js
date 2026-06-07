require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Basic middleware ─────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

// Rate limit
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30,
}));

// Simple logger (no external file)
app.use((req, _res, next) => {
  console.log(`[${req.method}] ${req.path}`);
  next();
});

// ── Simple health test ───────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ── Session create ────────────────────────────────
app.post("/session/new", (_req, res) => {
  const sessionId = uuidv4();
  res.json({ sessionId });
});

// ── TEMP chat endpoint ───────────────────────────
// (we will connect AI later)
app.post("/chat", (req, res) => {
  const message = req.body.message;

  res.json({
    reply: "Backend is working. You said: " + message,
    actions: []
  });
});

// ── Start server ──────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});