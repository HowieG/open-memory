import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { subset } from "../src/subset";

/**
 * Integration test: runs against the real exports in ../../chat-exports if they
 * exist (they are gitignored), and skips cleanly when they don't — so CI on a
 * fresh checkout stays green while local runs validate the real read path.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.resolve(HERE, "..", "..", "..", "chat-exports");

const SPECS: Array<{ re: RegExp; source: string }> = [
  { re: /^OPENAI_EXPORT_.*\.zip$/i, source: "chatgpt" },
  { re: /^CLAUDE_EXPORT_.*\.zip$/i, source: "claude" },
  { re: /^GEMINI_EXPORT_.*\.zip$/i, source: "gemini" },
];

const haveExports = existsSync(EXPORTS_DIR);
const files = haveExports ? readdirSync(EXPORTS_DIR) : [];

describe.skipIf(!haveExports)("subset (real exports)", () => {
  for (const { re, source } of SPECS) {
    const file = files.find((f) => re.test(f));

    it.skipIf(!file)(`extracts a ${source} fixture`, async () => {
      const out = mkdtempSync(path.join(tmpdir(), "om-subset-"));
      const r = await subset({ zipPath: path.join(EXPORTS_DIR, file!), n: 3, outDir: out });

      expect(r.source).toBe(source);
      expect(r.available).toBeGreaterThan(0);
      expect(r.picked).toBe(Math.min(3, r.available));

      const written = JSON.parse(readFileSync(r.outPath, "utf8"));
      expect(Array.isArray(written)).toBe(true);
      expect(written.length).toBe(r.picked);
    });
  }
});
