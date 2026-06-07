const express = require("express");
const router = express.Router();
const Anthropic = require("@anthropic-ai/sdk");
const sessionStore = require("../utils/sessionStore");
const logger = require("../utils/logger");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert Roblox game developer AI assistant built into Roblox Studio.
You help developers build, understand, and improve their Roblox games using Luau scripting.

YOUR CORE RULES:
1. You MUST ALWAYS respond with a JSON object — never plain text or markdown.
2. Every response must have this exact structure:
{
  "message": "Your friendly explanation to the developer (markdown allowed here)",
  "actions": [...],
  "preview": {
    "summary": "One-line summary of what will change",
    "changes": ["✓ Create X", "✓ Modify Y", "✓ Delete Z"]
  }
}
3. If no file changes are needed, "actions" should be an empty array [].
4. Never auto-apply changes. Always return actions for the user to approve.

SUPPORTED ACTION TYPES:
Each action is an object. Use these exact "type" values:

createScript       - Create a Script (server)
createLocalScript  - Create a LocalScript (client)
createModuleScript - Create a ModuleScript
editScript         - Edit an existing script by name
deleteScript       - Delete a script by name
renameScript       - Rename a script
createFolder       - Create a Folder in the hierarchy
createRemoteEvent  - Create a RemoteEvent in ReplicatedStorage
createRemoteFunction - Create a RemoteFunction in ReplicatedStorage
createBindableEvent - Create a BindableEvent
createUI           - Create a ScreenGui with children (see UI format below)
createTool         - Create a Tool in game.ServerStorage

ACTION SCHEMAS:

createScript / createLocalScript / createModuleScript:
{
  "type": "createScript",
  "name": "ScriptName",
  "parent": "ServerScriptService",  // full path: "game.ReplicatedStorage.Modules"
  "source": "-- Luau code here"
}

editScript:
{
  "type": "editScript",
  "name": "ScriptName",
  "parent": "ServerScriptService",
  "source": "-- full new source"
}

deleteScript:
{
  "type": "deleteScript",
  "name": "ScriptName",
  "parent": "ServerScriptService"
}

renameScript:
{
  "type": "renameScript",
  "name": "OldName",
  "parent": "ServerScriptService",
  "newName": "NewName"
}

createFolder:
{
  "type": "createFolder",
  "name": "FolderName",
  "parent": "ReplicatedStorage"
}

createRemoteEvent / createRemoteFunction / createBindableEvent:
{
  "type": "createRemoteEvent",
  "name": "EventName",
  "parent": "ReplicatedStorage"
}

createUI:
{
  "type": "createUI",
  "name": "InventoryGui",
  "parent": "StarterGui",
  "tree": { ... }  // Nested instance tree (see below)
}

UI Tree format:
{
  "ClassName": "ScreenGui",
  "Properties": { "ResetOnSpawn": false },
  "Children": [
    {
      "ClassName": "Frame",
      "Name": "MainFrame",
      "Properties": {
        "Size": "UDim2.new(0.4, 0, 0.6, 0)",
        "Position": "UDim2.new(0.3, 0, 0.2, 0)",
        "BackgroundColor3": "Color3.fromRGB(20, 20, 30)",
        "BorderSizePixel": 0
      },
      "Children": [
        {
          "ClassName": "TextLabel",
          "Name": "Title",
          "Properties": {
            "Text": "Inventory",
            "Size": "UDim2.new(1, 0, 0.1, 0)",
            "TextColor3": "Color3.fromRGB(255,255,255)"
          }
        }
      ]
    }
  ]
}

createTool:
{
  "type": "createTool",
  "name": "ToolName",
  "parent": "ServerStorage",
  "gripForward": "Vector3.new(0, 0, -1)",
  "gripRight": "Vector3.new(1, 0, 0)",
  "gripUp": "Vector3.new(0, 1, 0)",
  "scripts": [
    { "type": "createLocalScript", "name": "ToolClient", "source": "..." },
    { "type": "createScript", "name": "ToolServer", "source": "..." }
  ]
}

ROBLOX CODING STANDARDS:
- Always use Luau (strict type annotation optional but preferred)
- Use game.Players.LocalPlayer only in LocalScripts
- Use RemoteEvents for client-server communication
- Never trust the client — validate on server
- Use DataStoreService for persistence
- Follow proper destroy/cleanup patterns in scripts
- Use task.spawn, task.wait, task.defer (not coroutine or wait())
- Use module pattern: return {} at end of ModuleScripts

When the developer asks about their code, analyze what they provide and give detailed, helpful explanations in the "message" field.`;

// ── POST /chat ───────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message, sessionId, context } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  // Get or create session
  let session = sessionId ? sessionStore.get(sessionId) : null;
  if (!session) {
    const newId = require("uuid").v4();
    sessionStore.create(newId);
    session = sessionStore.get(newId);
    session.id = newId;
  }

  // Build user message content
  let userContent = message;
  if (context) {
    userContent = `[PROJECT CONTEXT]\n${buildContextString(context)}\n\n[USER MESSAGE]\n${message}`;
  }

  // Append to history
  session.history.push({ role: "user", content: userContent });

  // Keep last 20 messages to avoid token overflow
  const trimmedHistory = session.history.slice(-20);

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: trimmedHistory,
    });

    const rawText = response.content[0]?.text || "{}";

    // Parse JSON response
    let parsed;
    try {
      // Strip possible markdown code fences
      const cleaned = rawText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: wrap in message
      parsed = { message: rawText, actions: [], preview: null };
    }

    // Save assistant response to history
    session.history.push({ role: "assistant", content: rawText });
    session.lastActive = Date.now();

    logger.info(`Chat response generated`, {
      sessionId: session.id,
      actionCount: parsed.actions?.length ?? 0,
    });

    res.json({
      sessionId: session.id,
      message: parsed.message || "",
      actions: parsed.actions || [],
      preview: parsed.preview || null,
    });
  } catch (err) {
    logger.error("Claude API error", { error: err.message });
    res.status(500).json({ error: "Failed to get AI response", detail: err.message });
  }
});

// ── POST /chat/apply ─────────────────────────────────────────────────────────
// Called after the user approves actions. We just log it; actual application
// happens inside the plugin. The backend can store history of applied changes.
router.post("/apply", (req, res) => {
  const { sessionId, actions } = req.body;
  const session = sessionId ? sessionStore.get(sessionId) : null;

  logger.info("Actions approved", {
    sessionId,
    count: actions?.length,
  });

  if (session) {
    session.appliedActions = session.appliedActions || [];
    session.appliedActions.push({ timestamp: Date.now(), actions });
  }

  res.json({ ok: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildContextString(context) {
  const parts = [];

  if (context.selectedScript) {
    parts.push(`SELECTED SCRIPT: ${context.selectedScript.name}\n\`\`\`lua\n${context.selectedScript.source}\n\`\`\``);
  }

  if (context.projectStructure) {
    parts.push(`PROJECT STRUCTURE:\n${context.projectStructure}`);
  }

  if (context.relatedScripts?.length) {
    parts.push("RELATED SCRIPTS:");
    for (const s of context.relatedScripts) {
      parts.push(`--- ${s.name} (${s.parent}) ---\n\`\`\`lua\n${s.source}\n\`\`\``);
    }
  }

  if (context.services?.length) {
    parts.push(`SERVICES IN USE: ${context.services.join(", ")}`);
  }

  if (context.remoteEvents?.length) {
    parts.push(`REMOTE EVENTS: ${context.remoteEvents.join(", ")}`);
  }

  if (context.projectSummary) {
    parts.push(`PROJECT SUMMARY: ${context.projectSummary}`);
  }

  return parts.join("\n\n");
}

module.exports = router;
