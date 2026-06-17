# Source logos

Drop real brand logos here and the app renders them automatically (instead of the
inline approximation marks in `App.tsx`). Missing logos fall back to the inline mark.

## Filenames (by brand, not by source id)

| Source in app | File to add |
|---------------|-------------|
| ChatGPT       | `openai.svg` (or `openai.png`) |
| Claude        | `claude.svg` (or `claude.png`) |
| Gemini        | `gemini.svg` (or `gemini.png`) |

## Format

- **SVG preferred** — scales crisply at any size, tiny file. Full-color brand SVGs
  render as-is; monochrome ones render in their own color.
- **PNG works too** — use a transparent background, roughly square (≥64×64).

The logo is shown in a 16×16 box (`object-fit: contain`), so any aspect ratio is fine.

## Where to find them

- **svgl.app** — modern, searchable library of full-color brand SVGs (has OpenAI,
  Claude/Anthropic, Gemini). Best for accurate, colored marks.
- **simpleicons.org** — large set of monochrome brand glyphs (npm: `simple-icons`).
- Official brand kits (most accurate / correct licensing): OpenAI brand guidelines,
  Anthropic brand resources, Google brand resources (Gemini).

After adding files, no code change is needed — just rebuild (`npm start` / `npm run e2e`).
