# Emoji Identity — first-delight + shareable portrait

**Goal:** maximize time-to-first-delight and shareability on the first screen the
user meets in the Electron app, by turning their uploaded chat history into a
live-assembling **emoji portrait of who they are** — which doubles as a
one-click shareable card.

Replaces the current dead end: the hardcoded `FACTS[]` placeholder in
`app/renderer.js:11` and the flat titles list on `screen-uploaded`.

## The concept (locked)

As an export is parsed, we run a light model (Haiku) over the **user-sent**
messages and extract keywords that are **unique to the person**, not things they
merely referenced. Distinction the model is told to make:

- "Zen and the Art of Motorcycle Maintenance" mentioned once → NOT unique (read a book).
- Repeatedly asking about *their* motorcycle → unique to them.

Each keyword maps to an emoji (assets later). We render ~20, **most-unique first**,
**live as the upload happens** — the assembling *is* the loading state.

## Locked design decisions (from review)

- **Trust gate = the pitch.** During parsing, an interstitial asks:
  *"While we do our thing — can we convince you we get you? Can we draw a picture
  of you, in emoji? Your chat messages would be sent to Claude. OpenMemory is
  fully local otherwise."* User must pick **yes/no** to continue. "No" → skip the
  portrait. **"No" → fall back to the titles receipt page** (the existing
  `screen-uploaded`); the portrait is the reward for opting in. This converts the
  privacy disclosure into the delight tease and keeps the "stays on your machine"
  promise honest.
- **Extraction is pluggable — local model preferred.** The keyword→emoji extractor
  is an interface, not hardwired to Claude. Since the product will require a **local
  model** anyway, that becomes the default extractor → fully on-device → the consent
  gate disappears (no messages leave the machine). Claude/Haiku is the *fallback* for
  first-run-before-a-local-model-is-set-up, and only that path shows the consent
  tease. End state: portrait is fully local; the tease only appears when we genuinely
  need to send data out. **v1 reality:** no local-model infra exists yet (`ollama`
  needs a user-run server; `stub` is a no-op), so every shipping v1 user is
  cloud-with-consent. Treat "fully local" as an unbuilt future, not a property v1
  inherits.
- **Layout = radial** (base: mockup variant C). **No uniqueness ordering for
  placement** — a radial has no visual "first," so emojis populate it in *arrival
  order* as each map-reduce chunk returns, and never reshuffle. Uniqueness drives
  *selection* (pick emojis that represent the user, not generic ones), not position.
  This resolves the streaming-vs-batch contradiction: chunks emit good emojis
  incrementally; light dedup skips an emoji already placed.
- **Center anchor = the OpenMemory wordmark, "me" emphasized** —
  Open**me**mory, where *me* is bold and "Open"/"mory" are lighter: *this is me.*
  No invented decorative object (the compass/globe the mockups generated is cut).
  **Future:** swap the center for the user's connected Twitter/X avatar → maximally
  shareable.
- **Hover reveals the source excerpt.** Hovering an emoji shows the chat snippet it
  was derived from — proof these are the user's own words, reinforcing "we get you."
- **The on-screen portrait IS the share card.** One composition serves the live
  reveal and the exported image (OpenMemory wordmark center, captions, calm palette).

## Palette / type (app, not landing)

`--ink #16171A · --paper #EDEBE4 · --line #d9d6cc · --muted #8a8780`; Instrument
Serif for the wordmark + "a portrait of you" subhead; muted monospace for captions.

---

## Pass 1 — Information Architecture (5 → 9)

**Decision (1):** the emoji portrait **replaces** the `screen-uploaded` titles
receipt (`renderer.js:57-61`). New flow:

```
screen-upload ──drop/pick──► [parsing begins]
      │
      ▼  consent tease overlay (yes/no) while messages stream to Haiku
   ┌──────────────────────────────────────────────┐
   │  screen-portrait  (was screen-uploaded)       │
   │   · radial emoji portrait assembles live      │
   │   · center = Open**me**mory wordmark          │
   │   · Share (pill, bottom-right)  ·  Next →      │
   └──────────────────────────────────────────────┘
      │ Next
      ▼
   screen-memories (sidebar convos + real extracted memories)
```

**Consent "no" → the titles receipt is the fallback view** (so `screen-uploaded`
stays in the codebase, just no longer the default for opted-in users). The
source-logo + title row (`convItem`) also survives as the hover-excerpt provenance
and in the memories sidebar. When extraction runs on a local model, there's no
consent gate and the portrait is always shown.

## Pass 2 — Interaction States (3 → 9)

**Decision (2):** sparse portraits **show only the genuine emojis** and the radial
layout scales/recenters so few still reads as a finished portrait (subhead reads
the real count — see Pass 7 carry-over from Decision 2-adaptive: subhead = "a
portrait of you, in N pieces"). No padding to a fake 20 (that's the slop risk).

**Decision (2b):** the **"137 conversations uploaded" count line stays** on the
portrait screen (top, muted). Only the scrollable title *list* is removed — the
receipt reassurance remains.

```
STATE     | WHAT THE USER SEES
----------|--------------------------------------------------------------
loading   | the assembly IS the loading: "137 conversations uploaded" line
          | shows immediately; emojis pop in most-unique-first, ring by ring,
          | with a soft scale/fade. A quiet "reading your words…" ticker.
empty     | consent = "no", OR 0 user-authored messages: skip portrait, go to
          | screen-memories. Never show an empty portrait canvas.
sparse    | <~12 emojis: center wordmark + the real emojis, layout recenters;
          | subhead "a portrait of you, in 9 pieces". Feels deliberate.
error     | Haiku fails / offline mid-stream: keep emojis already placed, stop
          | gracefully, caption "we drew what we could." Share still works.
          | Never wipe the canvas on a late failure.
partial   | some convos failed to parse: portrait uses what parsed; the count
          | line shows "· 3 skipped" (mirrors today's `res.failed`).
success   | target reached: gentle settle animation, Share pill becomes primary.
```

## Pass 4 — AI-Slop Risk (6 → 9)

Emoji-as-element is slop-blacklist #7, but **defensible here**: the emojis are the
*data* (the user's own signals), not decoration. Guardrails to keep it on the right
side of the line:

- **No invented chrome** — the compass/globe the mockups auto-added is cut. The only
  non-data element at center is the OpenMemory wordmark.
- **One rendering** — captions in muted mono, emojis from one source. **Decision (3):
  native OS emoji** (no Twemoji/Noto bundle). Native color emoji are inherently one
  style, which also fixes the mixed line-icon/emoji look the mockups had.
- **Meaning over grid** — every emoji carries a lowercase keyword caption; radial
  size encodes uniqueness. Not a uniform decorative grid.
- **Share = true screenshot, not html2canvas.** Use Electron
  `webContents.capturePage()` → `NativeImage` → `clipboard.writeImage()`. This is the
  reason native emoji is fine: the export captures the user's own native render
  pixel-for-pixel. html2canvas can't reliably rasterize native color emoji — avoid it.
  Tweet flow: copy image to clipboard **and** open the X compose intent with
  pre-filled text; toast tells the user "image copied — paste it into your post"
  (intent URLs can't attach an image). "Figure out frictionless screenshot" is
  tracked as T-share below.

## Pass 6 — Responsive & Accessibility (3 → 9)

**Decision (4):** emoji excerpt shows on **hover AND keyboard focus** (not hover-only).
Presentation: an **assistant-ui-style chat snippet** — the matched user message with
~1 line of context above and ~2 lines below, bottom-faded with a transparent gradient
to signal "there's more of this conversation, stored." Clicking the emoji (or pressing
Enter on focus) opens that full conversation in the memories view — the natural payoff
of the "there's more" cue.

- Each emoji is a real focusable control: `role="button"`, `tabindex="0"`,
  `aria-label="<keyword> — from your conversations"`. Arrow/Tab walks the portrait.
- Excerpt popover is keyboard-dismissible (Esc) and not hover-trapped.
- Touch: tap = show snippet (hover doesn't exist on touch / future web).
- Window: Electron desktop; define a **min-width (~720px)**; below it the radial
  recenters and rings tighten rather than overflowing. Share/Next stay reachable.
- Contrast: captions are muted `#8a8780` on `#EDEBE4` — verify ≥4.5:1; darken caption
  ink if it fails (it's borderline). Emoji need no contrast but captions do.
- Share/Next are ≥44px touch targets, visible focus ring.

## Pass 3 — User Journey & Emotional Arc (7 → 9)

```
BEAT | USER DOES        | USER FEELS               | PLAN SUPPORTS IT
-----|------------------|--------------------------|----------------------------
5sec | drops export     | "did it work?"           | count line appears instantly
     | sees tease       | curious, slightly flattered| "can we convince you we get you?"
30s  | watches assemble | "oh… that IS me"          | most-unique-first, captions, hover snippet
     | hovers an emoji  | "they kept my actual words"| assistant-ui snippet + stored-gradient
2min | hits Share       | proud / wants to post     | one-tap screenshot to clipboard + X intent
5yr  | returns later    | "this is my memory home"  | portrait re-generates as history grows
```

Time-horizon: visceral (the assembly), behavioral (hover = proof), reflective (the
portrait is a returning artifact, not a one-time gag — see Pass 7).

## Pass 5 — Design-System Alignment (6 → 8)

No DESIGN.md; a locked master design doc exists (`~/.gstack/projects/HowieG-open-memory/
howardgil-master-design-20260616-174942.md`) — reconcile tokens there before build.
This screen uses the **app** palette, not the landing palette:

```
--ink #16171A · --paper #EDEBE4 · --line #d9d6cc · --muted #8a8780
wordmark + "a portrait of you, in N pieces" → Instrument Serif
captions, count line → ui-monospace (matches existing .status / .side-head)
Share → existing ink pill button (reuse current `button` style)
```

New components introduced (must enter the vocabulary): `emoji-tile` (emoji + caption +
focus state), `excerpt-popover` (assistant-ui snippet w/ gradient), `consent-tease`
(interstitial), `portrait-canvas` (radial layout). Reuse `convItem`, `show()`,
source `LOGOS`.

## Pass 7 — Unresolved / Deferred Decisions

```
DECISION NEEDED                          | IF DEFERRED, WHAT HAPPENS
-----------------------------------------|------------------------------------------
Uniqueness scoring method (what baseline | Engineer invents an ad-hoc heuristic;
defines "unique to you" vs referenced)?  | "unique" emojis feel arbitrary. SPEC IT.
First-emoji latency target (the actual   | No perf budget; first delight could be 8s.
"time to first delight" number)?         | Recommend: first emoji ≤2s via sampled batch.
Streaming order vs final settle — do     | Jittery reshuffle on every Haiku return.
rings re-rank live or settle once?       | Recommend: append live, ONE settle at done.
Portrait permanence — regenerate on new  | Built as one-time; "5-year" arc breaks.
imports? cached? re-rollable?            | Recommend: cache + "redraw" affordance.
Twitter/X avatar center + OAuth          | Center stays wordmark (fine for v1).
Local-model extractor timing             | Ship Claude-with-consent first; local later.
```

## NOT in scope (deferred, with rationale)

- **Twitter/X OAuth + avatar-as-center** — biggest shareability unlock, but needs auth
  plumbing; v1 ships the wordmark center. (TODO)
- **Local-model extractor** — the privacy end-state, but depends on the product's
  local-model setup landing first. Ship pluggable interface now, Claude/Haiku as the
  first concrete impl. (TODO)
- **Bespoke asset emojis** ("eventually there will be assets") — native emoji for v1.
- **Animated/video share export** — static PNG only for v1.

## What already exists (reuse, don't rebuild)

- `screen-uploaded` + `convItem` + `.titlelist` → becomes the consent-"no" fallback.
- `show()` screen-switcher and the `screen-*` pattern in `index.html` → add `screen-portrait`.
- Source `LOGOS` (inline SVG) in `renderer.js` → used in excerpt provenance.
- App palette tokens + `button`/`.status`/`.side-head` styles → portrait styling.
- `IngestResult` (`pipeline.ts`) already carries `conversations[]` + `failed[]` →
  feeds the extractor and the "· N skipped" count.
- `CanonicalConversation.messages[]` with `role` → filter `role==="user"` for extraction.

## Implementation Tasks

> Superseded by the eng-revised task list (**E1-E7**) in the Engineering Review
> section below. The original design-pass T1-T8 list targeted the pre-React
> renderer and most-unique-first ordering, both reversed in eng review. Build from
> E1-E7.

## Engineering Review (architecture, code, tests, perf)

**CRITICAL — renderer was migrated to React.** The vanilla `app/renderer.js` /
`app/index.html` this plan originally targeted are GONE. The renderer is now
**React + Vite + assistant-ui** in `app/renderer-src/` (`App.tsx` holds the
screen state machine `upload | uploaded | memories`; placeholder `FACTS[]` is
`App.tsx:5`; `@assistant-ui/react` is a real dep, so the excerpt snippet uses
real assistant-ui primitives, not a fake). All app tasks below target
`renderer-src/`, `main.js`, `preload.js`.

**Scope split (Step 0):** PR1 = delight core (extractor + consent + streaming
portrait + hover-excerpt + e2e). PR2 = share (capturePage card + X intent + cache).

### Architecture decisions
- **A1 — BYO Anthropic key (real plumbing).** Needs a key-input UI + persistence
  via Electron **`safeStorage`** (`process.env.ANTHROPIC_API_KEY` does NOT exist in
  a packaged app — only works in dev). Consent copy must state the user supplies and
  **pays for** their own key (~$0.37/run) and that messages go to Anthropic (note
  Anthropic's default API retention). Portrait lights up when the user has (a) a
  stored key or (b) the local model; otherwise → titles fallback (= consent "no").
- **A2 — Reuse the existing `core/src/memory/` layer (REVERSED from "new
  extract/").** `core/src/memory/providers.ts` already ships `MemoryProvider`,
  `ProviderConfig` (BYO `apiKey`), claude/openai/gemini/ollama providers, a
  deterministic **`stub`**, and `rankProviders`; `extractor.ts` has
  `extractMemories`. Add emoji/keyword extraction as a NEW function in
  `core/src/memory/` that reuses these — do NOT build a parallel `extract/`
  interface. e2e gets `stub` for free. The emoji prompt + output shape differ from
  `KnowledgeFact`, but the provider/key/stub plumbing is shared.
- **Map-reduce extraction (REVERSED from "single full-transcript batch ranking").**
  Full transcript still processed, but as **map** (per-chunk: extract candidate
  emojis that represent the user) → emit incrementally → **reduce** (light dedup:
  skip an emoji already on the radial). No global ranking pass, no reshuffle. The
  extractor returns `{keyword, emoji, sourceConvId, excerpt}` per item so the
  hover-excerpt (Decision 4) has a real data source.
- **Emoji mapping is constrained.** The LLM emits emoji via **structured output
  against a curated emoji set** (enum), not free-form — otherwise abstract keywords
  ("AI strategy consulting") degrade to a generic 🔵. The curated set + a single
  explicit fallback live in `core/src/memory/emoji-set.ts`.
- **Streaming IPC.** `preload.js` adds an event bridge: `main.js`
  `webContents.send("emoji:partial"|"emoji:done"|"emoji:error", …)` + a
  `contextBridge`-exposed `onEmoji(cb)` returning an unsubscribe (clean up across
  re-uploads to avoid listener leaks). `invoke` alone can't stream.
- **Consent ordering.** `ingestAndStore` (`main.js:33`) returns the count first;
  the extractor fires only after consent=yes AND a key/local-model exists.

### Perf / LLM-input decision
- **Full transcript** sent to Haiku (user accepted ~$0.37/run on their own key for
  a once-per-user action). Measured corpus: **1,869 conversations, 7,300 user
  messages, ~374K input tokens** (ChatGPT 242K + Claude 133K).
- **Map-reduce, not one ranking call.** ~374K tokens > 200K context → **2+ chunks**;
  each chunk is a **map** call that emits its representative emojis, which stream
  onto the radial as they return (first emojis ~10-20s after the first chunk; total
  20-40s). The consent tease + "reading your 1,869 conversations…" progress state
  carries the wait (Pass 2). No global ranking/reshuffle pass — radial arrival-order
  placement (see locked layout decision). Reduce = dedup-on-arrival.

### Test plan (vitest in core/, Playwright e2e in app/)
- **CRITICAL regression:** `e2e/upload.spec.ts` asserts the OLD flow ("uploaded to
  your memory store" + titles + Next). PR1 changes it → mandatory rewrite covering
  both consent branches + no-key fallback.
- Core unit (mock client): `filterUserMessages` (role==user; system/tool excluded;
  empty), `scoreUniqueness` GOLDEN on `core/fixtures/` (owned-thing > referenced-
  thing), `dedupeToEmoji` (collisions collapse, N<20 sparse, fallback emoji),
  `extractEmojiPortrait()` map-reduce (arrival-order yield, dedup-on-arrival, mid-chunk error).
- **[→EVAL]** the uniqueness prompt — does it pick owned-things over referenced?
  Add an eval suite with fixture conversations + expected top-emoji asserts.
- Chunk-failure path: one chunk 200s/429s while the other succeeds → portrait shows
  partial + "drew what we could", never wipes placed emojis.

### Failure modes (new codepaths)
| Codepath | Realistic failure | Test? | Error handling? | User sees |
|---|---|---|---|---|
| Haiku call | 429 rate-limit on user key | needed | needed | "drew what we could" + retry |
| 2-chunk run | 1 chunk fails | needed | needed | partial portrait, no wipe |
| BYO key | missing/invalid key | needed | needed | titles fallback + settings hint |
| stream IPC | listener leak across re-uploads | needed | unsubscribe | (silent leak if unhandled) — **flag** |

### What already exists (reuse)
- `App.tsx` screen state machine + `ConvRow`/`Logo` (logos) + `ConversationView`
  (assistant-ui) → portrait screen + excerpt popover reuse these.
- `core/fixtures/{chatgpt,claude}` + vitest `core/test/` → extractor golden tests.
- **`core/src/memory/{providers.ts,extractor.ts}`** — `MemoryProvider`, claude
  BYO-key provider, `stub`, `rankProviders`, `extractMemories` → emoji extraction
  REUSES this (A2); `stub` powers the e2e.
- `IngestResult.{conversations,failed}` (`pipeline.ts`) → extractor input + skipped count.

### Implementation tasks (eng-revised, supersede the design-pass list above)
PR1:
- [ ] **E1 (P1)** core — emoji extraction in `core/src/memory/` REUSING
  `MemoryProvider`/`ProviderConfig`/`stub`: `extractEmojiPortrait(provider, convs)`
  as a map-reduce async generator yielding `{keyword, emoji, sourceConvId, excerpt}`;
  `emoji-set.ts` curated enum + fallback. Files: `core/src/memory/*`,
  `core/src/index.ts`. Verify: `cd core && npm run typecheck && npm test`.
- [ ] **E2 (P1)** core/tests — golden (represents-you selection) + `stub`-provider
  unit tests (dedup-on-arrival, N<20 sparse, structured-emoji fallback) + eval suite.
- [ ] **E3 (P1)** app — streaming IPC: `main.js` map-reduce handler + per-chunk
  `webContents.send`; `preload.js` `onEmoji` event bridge w/ unsubscribe; BYO-key
  UI + `safeStorage` persistence + read.
- [ ] **E4 (P1)** app — `PortraitScreen.tsx` (radial arrival-order, count line,
  sparse/error), `ConsentTease.tsx` (consent + pays-own-key + retention copy),
  excerpt popover reusing assistant-ui `MessagePrimitive`. Delete `FACTS[]`
  (`App.tsx:5`). Files: `renderer-src/*`.
- [ ] **E5 (P1)** e2e — rewrite `upload.spec.ts` using the **`stub` provider** (no
  network in CI): consent yes→portrait, no→titles, no-key→titles. Verify:
  `cd app && npm run e2e`.
PR2:
- [ ] **E6 (P1)** app — Share via `webContents.capturePage()` of a fixed-size card
  node → clipboard + X intent + toast.
- [ ] **E7 (P2)** app/core — extraction cache keyed on conversation-set hash; redraw.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Emoji portrait / share card | `~/.gstack/projects/HowieG-open-memory/designs/emoji-identity-20260617/variant-C.png` | Radial layout, base direction | Replace the invented compass center with the Open**me**mory wordmark; native emoji; mono captions; calm app palette. Doubles as live reveal + share card. |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | outside voice (Claude; Codex unavailable) — 13 found, 3 cross-model tensions resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 14 issues, SCOPE_REDUCED, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score 4/10 → 9/10, 8 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** outside voice caught what the eng pass missed — the renderer is React (not vanilla), `core/src/memory/` already has the provider+stub layer (don't reinvent), and full-transcript batch can't truly stream a global ranking. All 3 resolved into the plan (reuse `memory/`; map-reduce arrival-order radial; no most-unique-first).
- **VERDICT:** DESIGN + ENG reviewed. 1 critical gap (stream-IPC listener leak) has a fix assigned (preload unsubscribe). Not auto-CLEARED: implement E1-E7, then `/ship` runs the diff-scoped gate. Scope split: PR1 delight-core, PR2 share.

**UNRESOLVED DECISIONS:**
- Curated emoji set contents — which emoji the structured-output enum allows (define before E1; affects coverage of abstract keywords).
- Map-reduce chunk boundary — by conversation count vs token budget per chunk (affects how evenly emojis stream; tune in E1).
- Portrait permanence / cache invalidation key — conversation-set hash shape (PR2/E7).
- Twitter/X avatar center + OAuth — deferred to post-v1.
- Share-card privacy audit — what inferred keywords + raw excerpts the public image exposes (must review before PR2/E6).
- Local-model extractor — unbuilt; every v1 user is cloud-with-consent.

