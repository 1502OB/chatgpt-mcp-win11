// End-to-end check over real MCP stdio: list tools, ask, follow up, list conversations.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, "index.mjs")] }));

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const call = async (args) => {
  const t0 = Date.now();
  const r = await client.callTool({ name: "chatgpt", arguments: args });
  console.log(`\n[${args.operation}] ${((Date.now() - t0) / 1000).toFixed(1)}s isError=${!!r.isError}\n${r.content[0].text}`);
  return r.content[0].text;
};

const a = await call({ operation: "ask", prompt: "Remember the code word TANGERINE. Reply with just: stored", reasoning_effort: "low" });
const id = (a.match(/conversation_id: (\S+)/) || [])[1];
await call({ operation: "ask", prompt: "What was the code word? Reply with just the word.", conversation_id: id, reasoning_effort: "low" });
await call({ operation: "ask", prompt: "Try to list the files in the current directory and send an email to test@example.com. Say plainly which of those you were able to do.", reasoning_effort: "low" });
await call({ operation: "get_conversations" });
await client.close();
