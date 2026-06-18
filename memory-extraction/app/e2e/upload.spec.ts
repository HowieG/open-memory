import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

/**
 * Autonomous QA of the full flow: upload a Claude export -> "uploaded to your
 * memory store" confirmation with conversation titles -> Next -> the "Your
 * memories" page (dummy facts + a source-tagged sidebar) -> click a conversation
 * -> it renders. Plus the emoji-portrait first-delight flow (consent -> streamed
 * radial portrait via the offline stub provider -> hover excerpt -> open convo).
 * Drives the real Electron UI end to end.
 */

const HERE = __dirname;
const APP_DIR = path.resolve(HERE, "..");
const SAMPLE_DIR = path.join(HERE, "sample");
const SENSITIVE_DIR = path.join(HERE, "sample-sensitive");

let zipPath: string;
let sensitiveZipPath: string;
let storeDir: string;
// Fresh Electron userData per run so a real Anthropic key persisted in localStorage
// (from a prior real-model run) can't leak in and route the portrait off the stub.
let userDataDir: string;

test.beforeAll(() => {
  const tmp = mkdtempSync(path.join(tmpdir(), "om-e2e-"));
  zipPath = path.join(tmp, "CLAUDE_EXPORT_e2e-sample.zip");
  execSync(
    `zip -j -q "${zipPath}" "${path.join(SAMPLE_DIR, "conversations.json")}" "${path.join(SAMPLE_DIR, "users.json")}"`,
  );
  sensitiveZipPath = path.join(tmp, "CLAUDE_EXPORT_sensitive.zip");
  execSync(
    `zip -j -q "${sensitiveZipPath}" "${path.join(SENSITIVE_DIR, "conversations.json")}" "${path.join(SENSITIVE_DIR, "users.json")}"`,
  );
  // Isolated, empty store per run so the sidebar count is deterministic.
  storeDir = mkdtempSync(path.join(tmpdir(), "om-store-"));
  userDataDir = mkdtempSync(path.join(tmpdir(), "om-userdata-"));
});

test("upload -> memory store confirmation -> memories page -> render a conversation", async () => {
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${userDataDir}`], env: { ...process.env, OM_STORE_DIR: storeDir } });
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, zipPath);

  const win = await app.firstWindow();

  // 1. import: upload a Claude export
  await win.getByTestId("pick").click();
  await expect(win.getByText("Conversations uploaded to your memory store")).toBeVisible({ timeout: 30_000 });

  // 2. sidebar lists the conversations, tagged with the Claude source
  const items = win.getByTestId("conv-item");
  await expect(items).toHaveCount(2);
  await expect(win.locator('[data-testid="conv-item"][data-source="claude"]')).toHaveCount(2);

  // 3. memories view: idle estimate -> preview extraction (stub, no key) -> real facts
  await win.getByTestId("to-memories").click();
  await expect(win.getByTestId("estimate")).toContainText("eligible");
  await win.getByTestId("preview").click();
  await expect(win.getByTestId("fact").first()).toContainText("Discussed:", { timeout: 30_000 });
  await expect(win.getByTestId("fact")).toHaveCount(2);
  await expect(win.getByTestId("fact-forget").first()).toBeVisible(); // each memory is controllable

  // 3b. hide a memory -> it blurs + locks (mark as sensitive yourself)
  await expect(win.locator(".fact-card .fact-text.locked")).toHaveCount(0);
  await win.getByTestId("fact-hide").first().click();
  await expect(win.locator(".fact-card .fact-text.locked")).toHaveCount(1);

  // 4. forget a fact -> it's removed (you hold the keys)
  await win.getByTestId("fact-forget").first().click();
  await expect(win.getByTestId("fact")).toHaveCount(1);

  // 5. open a conversation from the sidebar -> assistant-ui renders it
  await items.filter({ hasText: "E2E Test Conversation" }).click();
  await expect(win.locator(".conv-head")).toContainText("E2E Test Conversation");
  await expect(win.getByText("Hello from the test")).toBeVisible();

  await win.screenshot({ path: path.join(HERE, "qa.png") });
  await app.close();
});

test("emoji portrait: import -> consent -> streamed radial portrait -> hover excerpt -> open convo", async () => {
  // Fresh store so the app boots into the import flow (where the portrait is offered).
  const freshStore = mkdtempSync(path.join(tmpdir(), "om-store-portrait-"));
  // OM_NO_EXTERNAL: share copies to clipboard but does NOT open the X composer in CI.
  const app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, OM_STORE_DIR: freshStore, OM_NO_EXTERNAL: "1" },
  });
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, zipPath);
  const win = await app.firstWindow();

  // import, then choose "Draw my portrait"
  await win.getByTestId("pick").click();
  await expect(win.getByTestId("to-portrait")).toBeVisible({ timeout: 30_000 });
  await win.getByTestId("to-portrait").click();

  // consent tease gates the cloud call; say yes (uses the offline stub provider -> no network)
  await expect(win.getByTestId("portrait-consent")).toBeVisible();
  await win.getByTestId("portrait-yes").click();

  // emojis stream onto the radial canvas (stub is deterministic from the fixture)
  const tiles = win.getByTestId("emoji-tile");
  await expect(tiles.first()).toBeVisible({ timeout: 30_000 });
  await expect(win.getByTestId("portrait-count")).toContainText("portrait of you", { timeout: 30_000 });

  // hover an emoji -> the source excerpt appears (proof it's from your own words)
  await tiles.first().hover();
  await expect(win.getByTestId("excerpt")).toBeVisible();

  await win.screenshot({ path: path.join(HERE, "qa-portrait.png") });

  // share: captures the card to the clipboard (X composer suppressed via OM_NO_EXTERNAL)
  await win.getByTestId("portrait-share").click();
  await expect(win.getByTestId("portrait-toast")).toContainText("copied", { timeout: 10_000 });

  // E7: a complete draw is cached to disk (keyed on the conversation set) so a
  // revisit replays instead of re-running/re-paying.
  const cachePath = path.join(freshStore, "emoji-portrait.json");
  expect(existsSync(cachePath)).toBe(true);
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  expect(cache.hash).toBeTruthy();
  expect(cache.signals.length).toBeGreaterThan(0);

  // clicking an emoji opens its source conversation
  await tiles.first().click();
  await expect(win.locator(".conv-head")).toBeVisible({ timeout: 10_000 });

  await app.close();
});

test("sensitive memories + conversations blur and lock, then reveal on click", async () => {
  const freshStore = mkdtempSync(path.join(tmpdir(), "om-store-sensitive-"));
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${userDataDir}`], env: { ...process.env, OM_STORE_DIR: freshStore } });
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, sensitiveZipPath);
  const win = await app.firstWindow();

  // import the sensitive fixture (therapy + 401k are sensitive; React tuning is not)
  await win.getByTestId("pick").click();
  await expect(win.getByText("Conversations uploaded to your memory store")).toBeVisible({ timeout: 30_000 });

  // preview extraction (stub) — this also runs the classify pass that tags conversations
  await win.getByTestId("to-memories").click();
  await win.getByTestId("preview").click();
  await expect(win.getByTestId("fact")).toHaveCount(3, { timeout: 30_000 });

  // two sensitive memory cards render blurred + locked, one stays clear
  await expect(win.locator(".fact-card .fact-text.locked")).toHaveCount(2);
  // clicking the lock on a sensitive card reveals it
  await win.locator(".fact-card .fact-lock").first().click();
  await expect(win.locator(".fact-card .fact-text.locked")).toHaveCount(1);

  // the sidebar shows the two sensitive conversation titles blurred, each with a lock
  await expect(win.locator(".om-conv-item .om-lock")).toHaveCount(2);
  await expect(win.locator(".om-conv-item .om-title.locked")).toHaveCount(2);
  await win.screenshot({ path: path.join(HERE, "qa-sensitive.png") });

  // clicking a sidebar lock reveals that title without opening the conversation
  await win.locator(".om-conv-item .om-lock").first().click();
  await expect(win.locator(".om-conv-item .om-title.locked")).toHaveCount(1);

  await app.close();
});

test("emoji portrait: consent 'no' falls back to the titles/memories view", async () => {
  const freshStore = mkdtempSync(path.join(tmpdir(), "om-store-noconsent-"));
  const app = await electron.launch({ args: [APP_DIR, `--user-data-dir=${userDataDir}`], env: { ...process.env, OM_STORE_DIR: freshStore } });
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, zipPath);
  const win = await app.firstWindow();

  await win.getByTestId("pick").click();
  await expect(win.getByTestId("to-portrait")).toBeVisible({ timeout: 30_000 });
  await win.getByTestId("to-portrait").click();
  await expect(win.getByTestId("portrait-consent")).toBeVisible();

  // decline -> no portrait, land on the memories view
  await win.getByTestId("portrait-no").click();
  await expect(win.getByTestId("estimate")).toBeVisible({ timeout: 10_000 });
  await expect(win.getByTestId("portrait")).toHaveCount(0);

  await app.close();
});
