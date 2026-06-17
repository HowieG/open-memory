import { describe, expect, it } from "vitest";
import { requestWithRetry } from "../src/memory/providers";

describe("requestWithRetry (rate-limit handling)", () => {
  it("retries on 429, honors Retry-After, and reports each pause", async () => {
    let calls = 0;
    const doFetch = async () => {
      calls++;
      if (calls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "2" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const pauses: { attempt: number; waitMs: number }[] = [];
    const result = await requestWithRetry(doFetch, (i) => pauses.push(i), { sleep: async () => {} });

    expect(calls).toBe(2);
    expect(pauses).toEqual([{ attempt: 1, waitMs: 2000 }]); // retry-after: 2s
    expect(result).toEqual({ ok: true });
  });

  it("also retries on 529 (overloaded) with exponential backoff", async () => {
    let calls = 0;
    const doFetch = async () => {
      calls++;
      return calls < 3 ? new Response("", { status: 529 }) : new Response("{}", { status: 200 });
    };
    const pauses: number[] = [];
    await requestWithRetry(doFetch, (i) => pauses.push(i.waitMs), { sleep: async () => {} });
    expect(calls).toBe(3);
    expect(pauses).toEqual([1000, 2000]); // exp backoff: 2^0s, 2^1s
  });

  it("gives up after maxRetries and throws", async () => {
    const doFetch = async () => new Response("nope", { status: 429 });
    await expect(requestWithRetry(doFetch, undefined, { maxRetries: 2, sleep: async () => {} })).rejects.toThrow(/429/);
  });

  it("does not retry on non-rate-limit errors", async () => {
    let calls = 0;
    const doFetch = async () => {
      calls++;
      return new Response("bad request", { status: 400 });
    };
    await expect(requestWithRetry(doFetch, undefined, { sleep: async () => {} })).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });
});
