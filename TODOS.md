# TODOS

## memory-extraction

- [ ] **M2 timeline — group Gemini activity into sessions.** Gemini's `MyActivity.json` is one record per turn, so a Gemini export yields thousands of single-turn rows while a ChatGPT/Claude conversation is one row. In a chronological cross-source timeline this makes Gemini dominate and drowns the multi-turn conversations. Fix: in the Gemini adapter, group consecutive records into sessions by time-gap (e.g. gap > 30min = new conversation) so a Gemini "row" is comparable to the other sources.
  - **Why:** the unified timeline's "whole AI history in one stream" premise is only signal (not noise) if a row means the same thing across sources.
  - **Depends on:** M2 timeline build. Deferred from the 2026-06-16 eng review (v1 accepts raw rows).
