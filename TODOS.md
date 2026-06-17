# TODOS

## memory-extraction

_No open TODOs._

## Cut from v1 (do not build)

- **Gemini adapter** — Gemini (Google Takeout `MyActivity.json`) is out of v1
  entirely (decided 2026-06-17). v1 supports **ChatGPT + Claude only**. The
  canonical schema and the `SourceAdapter` interface stay source-agnostic, so
  Gemini can be revived later as a pure additive adapter with no rework. Detection
  still recognizes a Gemini export so the app can show a clear "not supported yet"
  message rather than "unrecognized export."
