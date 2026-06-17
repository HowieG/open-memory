# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OpenMemory is a marketing/prototype site for a product that imports a user's chat
memories (ChatGPT, Gemini, Claude) and lets apps request access to them under
user-controlled consent — north star: "you hold the keys, app asks nicely."

There is **no build system, package manager, or test suite**. Every page is a
single self-contained `.html` file with inline `<style>` and vanilla `<script>`
(no frameworks, no bundler, no dependencies). Fonts load from Google Fonts CDN;
images are local under `landing/assets/` and `landing/logos/`.

## Layout

- `landing/index.html` — the marketing landing page. Its centerpiece is an
  animated SVG "board" (`#threads`) that draws curved connector paths from a
  memory dashboard to app screenshots, cycling per color group. All animation is
  hand-rolled in the inline IIFE at the bottom of the file (`curve`, `snake`,
  `playGroup`, `cycle`). It also has a copy-prompt widget and an email-signup
  modal.
- `landing/component.html` — standalone interactive consent-modal prototype.
  Accordion of memory categories (`.om-cat`, expansion via `data-open`), per-row
  share toggles, and `[contenteditable]` inline editing. This is the design
  reference for the consent UX.
- `prototype-1/` — intended home for productized consent components (currently empty).
- `memory-extraction/` — the ingest module (has its own toolchain, unlike the
  static landing site). `core/` is a headless TypeScript library (`@open-memory/ingest`,
  vitest) that turns AI chat exports (ChatGPT, Claude; Gemini deferred) into a
  canonical, text-only `messages[]` format. `app/` is a minimal Electron shell to
  drop an export `.zip` and view the conversations. See its self-test contract below.

## Two distinct design systems — do not mix them

- **Landing page** (`index.html`): paper/navy palette (`--ink: #1C2B6B`,
  `--paper: #FAFAF6`), fonts Instrument Serif (display) + Schibsted Grotesk (body)
  + Spline Sans Mono.
- **Consent modal** (`component.html`): near-monochrome with violet accent
  (`--ink: #A587F5`), fonts Fraunces (display) + Geist (UI) + Geist Mono.
  Avoid jade-green and amber/yellow accents here — they were explicitly rejected.

Match the palette and font variables already defined in the `:root` of whichever
file you are editing.

## Running / previewing

Open the HTML files directly in a browser, or serve the `landing/` dir
(`python3 -m http.server` from `landing/`) so relative `assets/` paths resolve.

## Deploy

Linked to Vercel project `open-memory` (`howiegs-projects`) with GitHub autodeploy
on push to `master`. Use `vercel` / `vercel --prod` from the repo root, or just
push to `master`. Config lives in `.vercel/` (gitignored). The Vercel **Root
Directory** is set to `landing` with "Skip deployments when there are no changes
to the root directory" enabled — so pushes that only touch `memory-extraction/`
do not trigger a deploy.

## memory-extraction — self-test contract

The ingest module tests itself. A `Stop` hook (`.claude/hooks/om-selftest.sh`,
wired in `.claude/settings.json`) refuses to end a turn while tests are red,
whenever `memory-extraction/core/` or `app/` has uncommitted changes.

**Definition of done for any change under `memory-extraction/`:**
- `cd memory-extraction/core && npm run typecheck && npm test` is green.
- If `app/` changed: `cd memory-extraction/app && npm run e2e` is green. The e2e
  (Playwright) launches the real Electron app, ingests a fixture export, asserts
  conversations render, and screenshots to `app/e2e/qa.png` (Read it to eyeball).
- Never report done on red. The hook enforces this — do not work around it.

Run the app: `cd memory-extraction/app && npm start`, then drop or pick an export
`.zip`. Set `OM_SELFTEST_E2E=0` to skip the e2e in the hook (it pops an Electron
window); the unit + typecheck gate still runs.
