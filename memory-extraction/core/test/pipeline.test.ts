import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ingestZip } from "../src/pipeline";

/** End-to-end: real export .zip -> detect -> adapter -> canonical conversations.
 *  Runs only when the gitignored exports are present. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.resolve(HERE, "..", "..", "..", "chat-exports");

const SPECS: Array<{ re: RegExp; source: string }> = [
  { re: /^OPENAI_EXPORT_.*\.zip$/i, source: "chatgpt" },
  { re: /^CLAUDE_EXPORT_.*\.zip$/i, source: "claude" },
];

const haveExports = existsSync(EXPORTS_DIR);
const files = haveExports ? readdirSync(EXPORTS_DIR) : [];

describe.skipIf(!haveExports)("ingestZip (real exports)", () => {
  for (const { re, source } of SPECS) {
    const file = files.find((f) => re.test(f));
    it.skipIf(!file)(`ingests a ${source} export zip end-to-end`, async () => {
      const result = await ingestZip(path.join(EXPORTS_DIR, file!));
      expect(result.source).toBe(source);
      expect(result.conversations.length).toBeGreaterThan(0);
      expect(result.conversations[0]!.messages.length).toBeGreaterThan(0);
      expect(result.conversations.every((c) => c.source === source)).toBe(true);
    });
  }
});
