# @open-memory/ingest

Headless core that turns AI chat exports (ChatGPT, Claude, Gemini) into one
canonical, text-only conversation format. No UI. The Electron shell (M2) and the
LLM memory extractor consume this.

## Status: Milestone 1 — Lane A (scaffold)

Done:
- Canonical schema + zod validator (`src/schema.ts`)
- `SourceAdapter` interface + read-in-place `ArchiveReader` (`src/sources/types.ts`)
- Source detection — prefix-primary, signature guard (`src/sources/detect.ts`)
- yauzl read-in-place zip access (`src/zip.ts`)
- `subset` small-copy fixture tool (`src/subset.ts`, `src/cli.ts`)

Next (Lane B/C): the three adapters, pipeline + per-conversation store,
`MemoryExtractionSource` handoff, throwaway viewer.

## Commands

```bash
npm install
npm test                 # vitest (detect + schema unit; subset integration if exports present)
npm run typecheck        # tsc --noEmit

# build 3-conversation fixtures from the real exports in ../../chat-exports
npm run subset:all -- --n 3

# or a single export
npm run subset -- /path/to/CLAUDE_EXPORT_xxx.zip --n 3
```

Fixtures land in `../fixtures/<source>/` (gitignored — they derive from your
private exports). Eye-test the ChatGPT fixture against the export's own `chat.html`.
