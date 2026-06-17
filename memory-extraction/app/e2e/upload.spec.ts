import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

/**
 * Autonomous QA of the full flow: upload a Claude export -> "uploaded to your
 * memory store" confirmation with conversation titles -> Next -> the "Your
 * memories" page (dummy facts + a source-tagged sidebar) -> click a conversation
 * -> it renders. Drives the real Electron UI end to end.
 */

const HERE = __dirname;
const APP_DIR = path.resolve(HERE, "..");
const SAMPLE_DIR = path.join(HERE, "sample");

let zipPath: string;
let storeDir: string;

test.beforeAll(() => {
  const tmp = mkdtempSync(path.join(tmpdir(), "om-e2e-"));
  zipPath = path.join(tmp, "CLAUDE_EXPORT_e2e-sample.zip");
  execSync(
    `zip -j -q "${zipPath}" "${path.join(SAMPLE_DIR, "conversations.json")}" "${path.join(SAMPLE_DIR, "users.json")}"`,
  );
  // Isolated, empty store per run so the sidebar count is deterministic.
  storeDir = mkdtempSync(path.join(tmpdir(), "om-store-"));
});

test("upload -> memory store confirmation -> memories page -> render a conversation", async () => {
  const app = await electron.launch({ args: [APP_DIR], env: { ...process.env, OM_STORE_DIR: storeDir } });
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
