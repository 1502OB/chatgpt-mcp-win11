# ChatGPT MCP (Windows)

Windows port of [syedazharmbnr1/claude-chatgpt-mcp](https://github.com/syedazharmbnr1/claude-chatgpt-mcp).
The original drives the macOS ChatGPT app with AppleScript (keystrokes + clipboard). This version
instead runs the Codex CLI that ships inside the ChatGPT desktop app, signed in with your ChatGPT
plan, so it:

- costs nothing beyond your ChatGPT plan (no API key, no API billing; uses plan usage limits)
- runs in the background: no window focus, no keystrokes, no clipboard
- keeps follow-ups in one conversation via `conversation_id`

## Tool

`chatgpt` with `operation`:
- `ask`: `prompt` (required), optional `conversation_id`, `web_search` (bool), `model`,
  `reasoning_effort` (low|medium|high|xhigh), `images` (file paths), `timeout_seconds`
- `get_conversations`: conversations started through this tool (`data/conversations.json`)

## Safety

Codex runs with `--ignore-user-config`, a read-only sandbox, in the empty folder `data/workspace`,
and with these features off: ChatGPT connected apps (Outlook, Teams, GitHub, Drive...), plugins,
computer use, browser, shell, sub-agents, hooks, image generation. Code-mode is only on when
`web_search` is true (it is what runs web search). ChatGPT therefore cannot read your files or act
in other apps; paste any text it needs into the prompt.

## Install

Requires Windows 11, Node.js 18+, and the ChatGPT desktop app signed in with your ChatGPT plan.

```powershell
git clone https://github.com/1502OB/chatgpt-mcp-win11.git
cd chatgpt-mcp-win11
npm install
claude mcp add --scope user chatgpt -- node "$PWD\index.mjs"
```

## Setup / maintenance

- Needs the ChatGPT desktop app (package `OpenAI.Codex`) signed in; check with
  `codex.exe login status` (the exe path is found automatically after app updates).
- Override with env vars: `CODEX_PATH`, `CHATGPT_MODEL` (default `gpt-6.2-sol`),
  `CHATGPT_REASONING_EFFORT` (default `medium`), `CHATGPT_TIMEOUT_SECONDS` (default 600).
- Test: `npm test`
- Conversation index and the empty Codex workspace live in `data/` (override with `CHATGPT_MCP_DATA`).
- Remove: `claude mcp remove chatgpt -s user`
