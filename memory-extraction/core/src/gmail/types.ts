import type { RawEmail } from "../email/parse";

/**
 * The Gmail seam. The progressive-poll engine (T3) and the test fake (T12) build
 * on this interface; the real implementation lives in app/main against googleapis.
 * Keeping it an interface in core/ means the poll logic and its error branches
 * (history-gone, auth-revoked) are unit-tested without a live account or Electron.
 *
 *   poll tick ──► historyList(cursor) ──► messageIds[] ──► messagesGet(id) ──► RawEmail
 *                      │ 404 (cursor too old)
 *                      └─► GmailHistoryGoneError ──► messagesList(query) full re-scan
 */

export interface GmailMessageRef {
  id: string;
  threadId?: string;
}

export interface GmailHistoryPage {
  /** message ids that appeared since the requested historyId */
  messageIds: string[];
  /** the new cursor to persist (gmail-state.json lastHistoryId) */
  historyId: string;
}

export interface GmailClient {
  /** Incremental change list since `startHistoryId`.
   *  @throws GmailHistoryGoneError when the cursor is too old (HTTP 404). */
  historyList(startHistoryId: string): Promise<GmailHistoryPage>;
  /** Full scan fallback when history is gone. `query` is a Gmail search expression. */
  messagesList(query: string): Promise<GmailMessageRef[]>;
  /** Fetch one message, decoded to {from, subject, htmlBody}. */
  messagesGet(id: string): Promise<RawEmail>;
}

/** Thrown when Gmail's history cursor has expired (~1 week) → trigger a full re-scan. */
export class GmailHistoryGoneError extends Error {
  constructor(message = "Gmail historyId too old; full re-scan required") {
    super(message);
    this.name = "GmailHistoryGoneError";
  }
}

/** Thrown when the stored refresh token is rejected (invalid_grant) → prompt reconnect. */
export class GmailAuthRevokedError extends Error {
  constructor(message = "Gmail refresh token revoked (invalid_grant); reconnect required") {
    super(message);
    this.name = "GmailAuthRevokedError";
  }
}
