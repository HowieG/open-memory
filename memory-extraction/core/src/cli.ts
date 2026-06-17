import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirReader } from "./dir";
import { renderConversationsHtml } from "./render";
import { chatgptAdapter } from "./sources/chatgpt/adapter";
import type { SourceAdapter } from "./sources/types";
import { subset } from "./subset";

const ADAPTERS: Record<string, SourceAdapter> = {
  chatgpt: chatgptAdapter,
};

/**
 * Dev CLI. The only command shipped in Milestone 1 is `subset` (fixture creation);
 * the user-facing app is the Electron shell in M2.
 *
 *   tsx src/cli.ts subset <export.zip> [--n 3] [--out <dir>]
 *   tsx src/cli.ts subset-all [--exports <dir>] [--n 3] [--out <dir>]
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIR = path.resolve(HERE, "..");
const DEFAULT_OUT = path.resolve(CORE_DIR, "..", "fixtures");
const DEFAULT_EXPORTS = path.resolve(CORE_DIR, "..", "..", "chat-exports");

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** positional args = anything that isn't a `--flag` or the value right after one */
function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      i++; // skip this flag's value
      continue;
    }
    out.push(a);
  }
  return out;
}

async function runSubset(args: string[]): Promise<void> {
  const zipPath = positionals(args)[0];
  if (!zipPath) throw new Error("usage: subset <export.zip> [--n 3] [--out <dir>]");
  const n = Number(flag(args, "n") ?? 3);
  const out = flag(args, "out") ?? DEFAULT_OUT;
  const r = await subset({ zipPath: path.resolve(zipPath), n, outDir: path.resolve(out) });
  console.log(`[${r.source}] wrote ${r.picked}/${r.available} conversations -> ${r.outPath}`);
}

async function runSubsetAll(args: string[]): Promise<void> {
  const exportsDir = path.resolve(flag(args, "exports") ?? DEFAULT_EXPORTS);
  const n = Number(flag(args, "n") ?? 3);
  const out = path.resolve(flag(args, "out") ?? DEFAULT_OUT);

  const files = await readdir(exportsDir);
  const matchers: Array<[RegExp, string]> = [
    [/^OPENAI_EXPORT_.*\.zip$/i, "ChatGPT"],
    [/^CLAUDE_EXPORT_.*\.zip$/i, "Claude"],
    [/^GEMINI_EXPORT_.*\.zip$/i, "Gemini"],
  ];

  let ran = 0;
  for (const [re, label] of matchers) {
    const file = files.find((f) => re.test(f));
    if (!file) {
      console.warn(`[skip] no ${label} export (${re.source}) in ${exportsDir}`);
      continue;
    }
    const r = await subset({ zipPath: path.join(exportsDir, file), n, outDir: out });
    console.log(`[${r.source}] wrote ${r.picked}/${r.available} conversations -> ${r.outPath}`);
    ran++;
  }
  console.log(`\nsubset-all: ${ran}/3 sources written to ${out}`);
}

async function runRender(args: string[]): Promise<void> {
  const source = flag(args, "source") ?? "chatgpt";
  const inDir = path.resolve(flag(args, "in") ?? DEFAULT_OUT);
  const adapter = ADAPTERS[source];
  if (!adapter) {
    throw new Error(`no adapter built yet for "${source}" (have: ${Object.keys(ADAPTERS).join(", ")})`);
  }
  const srcDir = path.join(inDir, source);
  const out = path.resolve(flag(args, "out") ?? path.join(srcDir, "preview.html"));

  const outcome = await adapter.parse(dirReader(srcDir, source));
  const html = renderConversationsHtml(outcome.ok, { source, failed: outcome.failed.length });
  await writeFile(out, html, "utf8");
  console.log(
    `[${source}] rendered ${outcome.ok.length} conversations (${outcome.failed.length} failed) -> ${out}`,
  );
  if (outcome.failed.length) console.log(outcome.failed.map((f) => `  - ${f.id ?? "?"}: ${f.reason}`).join("\n"));
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "subset":
      await runSubset(rest);
      break;
    case "subset-all":
      await runSubsetAll(rest);
      break;
    case "render":
      await runRender(rest);
      break;
    default:
      console.error("commands: subset <zip> | subset-all | render [--source chatgpt]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
