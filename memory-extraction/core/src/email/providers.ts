/**
 * Export-email provider registry — the table that drives detection of "your
 * export is ready" emails and how each provider's download is fetched.
 *
 * Named EMAIL_PROVIDERS (not PROVIDERS) to avoid colliding with the memory/LLM
 * `PROVIDERS` registry in ../memory/providers.ts. Mirrors the source-adapter
 * registry pattern in ../sources/registry.ts: one row per provider, so adding or
 * re-enabling a provider is a data change, not scattered branching.
 *
 *   email {from, subject, htmlBody}
 *        │  match sender + subject
 *        ▼
 *   EmailProvider ── fetch:'server'      → app downloads with no cookies, auto-ingest (ChatGPT)
 *                 ── fetch:'user'        → notify; user opens link in browser, drags zip in (Claude)
 *                 ── fetch:'unsupported' → detect only, show "not supported yet" (Google/Takeout, v1)
 *
 * v1 ingest supports ChatGPT + Claude only (Gemini/Takeout is cut — see TODOS.md).
 * The `google` row exists so the app can say "not supported yet" instead of
 * silently ignoring a recognized export email.
 */

export type EmailProviderId = "chatgpt" | "claude" | "google";

/** How the export archive is obtained once an email is detected. */
export type FetchStrategy = "server" | "user" | "unsupported";

export interface EmailProvider {
  id: EmailProviderId;
  /** matches the email's From header */
  sender: RegExp;
  /** matches the email's Subject */
  subject: RegExp;
  /** extracts the download URL from the HTML body; null when there's nothing to fetch */
  urlPattern: RegExp | null;
  fetch: FetchStrategy;
  /** false = recognized only to tell the user "not supported yet" (no ingest path in v1) */
  supported: boolean;
}

export const EMAIL_PROVIDERS: readonly EmailProvider[] = [
  {
    id: "chatgpt",
    sender: /noreply@tm\.openai\.com/i,
    subject: /your data export is ready/i,
    // signed URL with sig=/ts= query params; stop at quotes/brackets/whitespace
    urlPattern: /https:\/\/chatgpt\.com\/backend-api\/estuary\/content[^\s"'<>]*/i,
    fetch: "server",
    supported: true,
  },
  {
    id: "claude",
    sender: /@mail\.anthropic\.com/i,
    subject: /your data is ready for download/i,
    urlPattern: /https:\/\/claude\.ai\/export\/[^\s"'<>]*/i,
    fetch: "user",
    supported: true,
  },
  {
    id: "google",
    sender: /noreply@google\.com/i,
    subject: /your google data is ready to download/i,
    urlPattern: /https:\/\/takeout\.google\.com\/manage\/archive[^\s"'<>]*/i,
    // v1: ChatGPT + Claude only. Google/Takeout (Gemini) ingestion is cut.
    fetch: "unsupported",
    supported: false,
  },
];
