#!/usr/bin/env node
// ChatGPT MCP server for Windows.
// Port of syedazharmbnr1/claude-chatgpt-mcp (macOS AppleScript) to Windows.
// Instead of driving the desktop app with keystrokes, it runs the Codex CLI
// that ships with the ChatGPT desktop app, signed in with your ChatGPT plan:
// no window focus, no clipboard, no API key, no API billing.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.CHATGPT_MCP_DATA || path.join(HERE, "data");
const WORK_DIR = path.join(DATA_DIR, "workspace"); // empty folder: Codex gets no project files
const INDEX_FILE = path.join(DATA_DIR, "conversations.json");
const DEFAULT_MODEL = process.env.CHATGPT_MODEL || "gpt-6.2-sol";
const DEFAULT_EFFORT = process.env.CHATGPT_REASONING_EFFORT || "medium";
const DEFAULT_TIMEOUT_S = Number(process.env.CHATGPT_TIMEOUT_SECONDS || 600);

// Everything that can act outside the chat is switched off: ChatGPT connected apps
// (Outlook/Teams/GitHub/Drive...), plugins, computer use, browser, shell, sub-agents, hooks.
const FEATURES_OFF = [
  "apps", "plugins", "remote_plugin", "computer_use", "browser_use", "browser_use_external",
  "in_app_browser", "multi_agent", "shell_tool", "unified_exec", "hooks", "goals",
  "image_generation", "skill_mcp_dependency_install", "tool_suggest", "workspace_dependencies",
];

fs.mkdirSync(WORK_DIR, { recursive: true });

let codexPathCache = null;
function findCodex() {
  if (codexPathCache) return codexPathCache;
  const candidates = [];
  if (process.env.CODEX_PATH) candidates.push(process.env.CODEX_PATH);
  try {
    // The exe lives in a versioned WindowsApps folder that changes with each app update.
    const loc = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "(Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation"],
      { encoding: "utf8", timeout: 20000 }).trim();
    if (loc) candidates.push(path.join(loc, "app", "resources", "codex.exe"));
  } catch { /* fall through */ }
  for (const c of candidates) if (c && fs.existsSync(c)) return (codexPathCache = c);
  return (codexPathCache = "codex"); // on PATH (npm i -g @openai/codex)
}

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); } catch { return []; }
}
function saveIndex(list) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(list, null, 2));
}
function recordConversation(id, prompt, isNew) {
  const list = loadIndex();
  const now = new Date().toISOString();
  let row = list.find((r) => r.id === id);
  if (!row) {
    row = { id, title: prompt.replace(/\s+/g, " ").trim().slice(0, 80), created: now, turns: 0 };
    list.push(row);
  }
  row.updated = now;
  row.turns = (row.turns || 0) + 1;
  saveIndex(list);
  return row;
}

function runCodex({ prompt, conversationId, model, effort, webSearch, timeoutS, images }) {
  const args = ["exec", "--ignore-user-config", "--skip-git-repo-check", "-s", "read-only",
    "--json", "-c", `model="${model}"`, "-c", `model_reasoning_effort="${effort}"`,
    "-c", `web_search="${webSearch ? "live" : "disabled"}"`];
  const off = webSearch ? FEATURES_OFF : [...FEATURES_OFF, "code_mode_host"];
  for (const f of off) args.push("-c", `features.${f}=false`);
  for (const img of images || []) args.push("-i", img);
  if (conversationId) args.push("resume", conversationId);
  args.push("-"); // prompt on stdin: no quoting problems with any text

  return new Promise((resolve, reject) => {
    const child = spawn(findCodex(), args, { cwd: WORK_DIR, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, timeoutS * 1000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Could not start Codex CLI (${findCodex()}): ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let threadId = conversationId || null, usage = null, failure = null;
      const messages = [], sources = [];
      for (const line of out.split(/\r?\n/)) {
        if (!line.startsWith("{")) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "thread.started") threadId = ev.thread_id;
        else if (ev.type === "turn.completed") usage = ev.usage;
        else if (ev.type === "turn.failed" || ev.type === "error") failure = ev.error?.message || ev.message || JSON.stringify(ev);
        else if (ev.type === "item.completed" && ev.item?.type === "agent_message") messages.push(ev.item.text);
        else if (ev.type === "item.completed" && ev.item?.type === "web_search" && ev.item.action?.query) sources.push(ev.item.action.query);
      }
      if (killed) return reject(new Error(`ChatGPT did not finish within ${timeoutS}s` + (messages.length ? `. Partial: ${messages.at(-1)}` : "")));
      if (!messages.length) {
        const tail = err.split(/\r?\n/).filter((l) => /error|login|auth|expired/i.test(l)).slice(-5).join("\n");
        return reject(new Error(failure || `Codex exited with code ${code} and no reply.${tail ? "\n" + tail : ""}`));
      }
      resolve({ threadId, reply: messages.at(-1), usage, searches: sources });
    });
    child.stdin.end(prompt, "utf8");
  });
}

const CHATGPT_TOOL = {
  name: "chatgpt",
  description:
    "Ask ChatGPT a question (runs in the background through the Codex CLI signed in with the user's ChatGPT plan; " +
    "no API cost, does not touch the screen). Operations: 'ask' sends a prompt and returns ChatGPT's reply plus a " +
    "conversation_id you can pass back to continue the same conversation; 'get_conversations' lists conversations " +
    "started through this tool. ChatGPT here has no access to files, email, or other apps; include any text it needs in the prompt.",
  inputSchema: {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["ask", "get_conversations"], description: "'ask' or 'get_conversations'" },
      prompt: { type: "string", description: "The prompt to send to ChatGPT (required for ask)" },
      conversation_id: { type: "string", description: "Optional conversation_id from an earlier ask, to continue that conversation" },
      web_search: { type: "boolean", description: "Let ChatGPT search the web for this answer (default false)" },
      model: { type: "string", description: `Model (default ${DEFAULT_MODEL})` },
      reasoning_effort: { type: "string", enum: ["low", "medium", "high", "xhigh"], description: `Reasoning effort (default ${DEFAULT_EFFORT})` },
      images: { type: "array", items: { type: "string" }, description: "Optional local image file paths to attach" },
      timeout_seconds: { type: "number", description: `Max seconds to wait (default ${DEFAULT_TIMEOUT_S})` },
    },
    required: ["operation"],
  },
};

const server = new Server({ name: "ChatGPT MCP Tool (Windows)", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [CHATGPT_TOOL] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], isError });
  try {
    if (name !== "chatgpt") return text(`Unknown tool: ${name}`, true);
    if (args.operation === "get_conversations") {
      const list = loadIndex().sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
      if (!list.length) return text("No conversations found yet. Start one with operation 'ask'.");
      return text(`Found ${list.length} conversation(s):\n\n` +
        list.map((r) => `${r.id}  |  ${r.title}  |  ${r.turns} turn(s), last ${r.updated}`).join("\n"));
    }
    if (args.operation !== "ask") return text("Invalid arguments: operation must be 'ask' or 'get_conversations'", true);
    if (!args.prompt || typeof args.prompt !== "string") return text("Prompt is required for ask operation", true);
    for (const img of args.images || []) if (!fs.existsSync(img)) return text(`Image not found: ${img}`, true);

    const r = await runCodex({
      prompt: args.prompt,
      conversationId: args.conversation_id,
      model: args.model || DEFAULT_MODEL,
      effort: args.reasoning_effort || DEFAULT_EFFORT,
      webSearch: !!args.web_search,
      timeoutS: Number(args.timeout_seconds) || DEFAULT_TIMEOUT_S,
      images: args.images,
    });
    if (r.threadId) recordConversation(r.threadId, args.prompt);
    const meta = [`conversation_id: ${r.threadId}`];
    if (r.searches.length) meta.push(`web searches: ${r.searches.join(" | ")}`);
    return text(`${r.reply}\n\n---\n${meta.join("\n")}`);
  } catch (e) {
    return text(`Error: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});

await server.connect(new StdioServerTransport());
console.error("ChatGPT MCP Server (Windows, Codex CLI backend) running on stdio");
