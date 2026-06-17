import { EMAIL_PROVIDERS, type EmailProvider, type EmailProviderId, type FetchStrategy } from "./providers";

/**
 * Pure parser for "your export is ready" emails. Headless and side-effect-free so
 * it's unit-tested against fixture bodies with no Gmail/Electron mocking — the
 * Electron main process just hands it raw {from, subject, htmlBody}.
 *
 *   {from, subject, htmlBody}
 *        │  matchProvider (sender + subject)
 *        ├─ no match               → null            (not an export email)
 *        ├─ unsupported (google)   → {supported:false, downloadUrl:null}
 *        └─ supported              → extract URL from body
 *              ├─ url found        → {supported:true, downloadUrl}
 *              └─ no url            → null            (looks like it, but unusable — don't act)
 */

export interface RawEmail {
  from: string;
  subject: string;
  htmlBody: string;
}

export interface ParsedExportEmail {
  provider: EmailProviderId;
  fetch: FetchStrategy;
  /** false → recognized provider with no v1 ingest path (show "not supported yet") */
  supported: boolean;
  /** the export download URL; null when unsupported */
  downloadUrl: string | null;
}

/** Decode the handful of HTML entities that appear inside URLs in email bodies
 *  (query params are usually `&amp;`-escaped). Decoding first yields a directly
 *  usable URL and keeps the `sig`/`ts` params intact. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'");
}

/** First provider whose sender AND subject match. Senders are distinct domains,
 *  so at most one matches. */
export function matchProvider(email: RawEmail): EmailProvider | null {
  for (const p of EMAIL_PROVIDERS) {
    if (p.sender.test(email.from) && p.subject.test(email.subject)) return p;
  }
  return null;
}

/** The provider-specific URL pattern only matches that provider's real export
 *  link, so unrelated links in the body are ignored. */
function extractUrl(provider: EmailProvider, htmlBody: string): string | null {
  if (!provider.urlPattern) return null;
  const match = decodeEntities(htmlBody).match(provider.urlPattern);
  return match ? match[0] : null;
}

export function parseExportEmail(email: RawEmail): ParsedExportEmail | null {
  const provider = matchProvider(email);
  if (!provider) return null;

  if (!provider.supported) {
    return { provider: provider.id, fetch: provider.fetch, supported: false, downloadUrl: null };
  }

  const downloadUrl = extractUrl(provider, email.htmlBody);
  if (!downloadUrl) return null;

  return { provider: provider.id, fetch: provider.fetch, supported: true, downloadUrl };
}
