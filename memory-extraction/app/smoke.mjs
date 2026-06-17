import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Proves the exact bundled core (core.cjs) that Electron's main process calls.
const require = createRequire(import.meta.url);
const { ingestZip, renderConversationsHtml } = require("./core.cjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(HERE, "..", "..", "chat-exports");
const files = readdirSync(dir);

for (const [re, label] of [
  [/^OPENAI_EXPORT_.*\.zip$/i, "chatgpt"],
  [/^CLAUDE_EXPORT_.*\.zip$/i, "claude"],
]) {
  const f = files.find((x) => re.test(x));
  if (!f) {
    console.log(`skip ${label}: no export found`);
    continue;
  }
  const r = await ingestZip(path.join(dir, f));
  const html = renderConversationsHtml(r.conversations, { source: r.source, failed: r.failed.length });
  console.log(`${r.source}: ${r.conversations.length} conversations, ${r.failed.length} failed, html ${html.length} bytes`);
}
