const express = require("express");
const router = express.Router();
const Anthropic = require("@anthropic-ai/sdk");
const sessionStore = require("../utils/sessionStore");
const logger = require("../utils/logger");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /context/summarize
// Takes raw project data and returns a compressed summary to store in the plugin
router.post("/summarize", async (req, res) => {
  const { scripts, hierarchy, sessionId } = req.body;

  if (!scripts || !Array.isArray(scripts)) {
    return res.status(400).json({ error: "scripts array is required" });
  }

  const scriptList = scripts
    .map((s) => `${s.name} (${s.type} in ${s.parent}): ${s.source?.slice(0, 300)}...`)
    .join("\n\n");

  const prompt = `Analyze this Roblox project and return a concise JSON summary.

Scripts found:
${scriptList}

Hierarchy:
${hierarchy || "Not provided"}

Return this exact JSON:
{
  "projectType": "RPG|FPS|Simulator|Obby|Other",
  "mainSystems": ["system names"],
  "architecture": "brief description",
  "services": ["Roblox services used"],
  "scriptRelationships": [{"from": "Script1", "to": "Script2", "relationship": "calls/requires/fires"}],
  "summary": "2-3 sentence project overview"
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0]?.text || "{}";
    const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();

    let summary;
    try {
      summary = JSON.parse(cleaned);
    } catch {
      summary = { summary: raw };
    }

    // Store in session
    if (sessionId) {
      const session = sessionStore.get(sessionId);
      if (session) {
        session.projectSummary = summary;
      }
    }

    logger.info("Project summarized", { sessionId });
    res.json(summary);
  } catch (err) {
    logger.error("Summarize error", { error: err.message });
    res.status(500).json({ error: "Failed to summarize project" });
  }
});

// POST /context/store
// Store project context for a session (called when plugin scans the game)
router.post("/store", (req, res) => {
  const { sessionId, context } = req.body;
  const session = sessionStore.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  session.storedContext = context;
  session.contextUpdatedAt = Date.now();

  res.json({ ok: true, storedAt: session.contextUpdatedAt });
});

module.exports = router;
