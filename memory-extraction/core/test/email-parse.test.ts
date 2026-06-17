import { describe, expect, it } from "vitest";
import { matchProvider, parseExportEmail } from "../src/email/parse";
import { EMAIL_PROVIDERS } from "../src/email/providers";

const chatgpt = {
  from: "ChatGPT <noreply@tm.openai.com>",
  subject: "ChatGPT - Your data export is ready",
  htmlBody: `<p>Download here:</p>
    <a href="https://chatgpt.com/backend-api/estuary/content?id=abc&amp;sig=deadbeef&amp;ts=1750000000">Download data export</a>
    <p>Need help? Visit <a href="https://help.openai.com/articles/123">our help center</a>.</p>`,
};

const claude = {
  from: "Anthropic <data-exports@mail.anthropic.com>",
  subject: "Your data is ready for download",
  htmlBody: `<a href="https://claude.ai/export/abc-123-def?token=xyz">Download your data</a>`,
};

const google = {
  from: "Google <noreply@google.com>",
  subject: "Your Google data is ready to download",
  htmlBody: `<a href="https://takeout.google.com/manage/archive?id=zzz">Download</a>`,
};

describe("matchProvider", () => {
  it("matches each provider by sender + subject", () => {
    expect(matchProvider(chatgpt)?.id).toBe("chatgpt");
    expect(matchProvider(claude)?.id).toBe("claude");
    expect(matchProvider(google)?.id).toBe("google");
  });

  it("returns null when the sender matches but the subject does not", () => {
    expect(matchProvider({ ...chatgpt, subject: "Your weekly ChatGPT digest" })).toBeNull();
  });

  it("returns null for an unrelated email", () => {
    expect(matchProvider({ from: "friend@example.com", subject: "lunch?", htmlBody: "hi" })).toBeNull();
  });
});

describe("parseExportEmail", () => {
  it("extracts the ChatGPT signed URL and decodes &amp; entities", () => {
    const r = parseExportEmail(chatgpt);
    expect(r).toEqual({
      provider: "chatgpt",
      fetch: "server",
      supported: true,
      downloadUrl: "https://chatgpt.com/backend-api/estuary/content?id=abc&sig=deadbeef&ts=1750000000",
    });
  });

  it("extracts the Claude one-time download URL with fetch=user", () => {
    const r = parseExportEmail(claude);
    expect(r?.provider).toBe("claude");
    expect(r?.fetch).toBe("user");
    expect(r?.downloadUrl).toBe("https://claude.ai/export/abc-123-def?token=xyz");
  });

  it("marks Google as recognized-but-unsupported (no download URL, no ingest in v1)", () => {
    const r = parseExportEmail(google);
    expect(r).toEqual({ provider: "google", fetch: "unsupported", supported: false, downloadUrl: null });
  });

  it("returns null when a supported provider's body has no usable URL", () => {
    const r = parseExportEmail({ ...chatgpt, htmlBody: "<p>Your export is ready but the link is missing.</p>" });
    expect(r).toBeNull();
  });

  it("picks the export URL even when other links are present", () => {
    const r = parseExportEmail(chatgpt);
    expect(r?.downloadUrl).toContain("backend-api/estuary/content");
    expect(r?.downloadUrl).not.toContain("help.openai.com");
  });

  it("returns null for a non-export email", () => {
    expect(parseExportEmail({ from: "x@y.com", subject: "hi", htmlBody: "<p>hello</p>" })).toBeNull();
  });
});

describe("EMAIL_PROVIDERS registry", () => {
  it("has distinct senders so at most one provider matches a given email", () => {
    const ids = EMAIL_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps ChatGPT + Claude supported and Google unsupported in v1", () => {
    const supported = (id: string) => EMAIL_PROVIDERS.find((p) => p.id === id)?.supported;
    expect(supported("chatgpt")).toBe(true);
    expect(supported("claude")).toBe(true);
    expect(supported("google")).toBe(false);
  });
});
