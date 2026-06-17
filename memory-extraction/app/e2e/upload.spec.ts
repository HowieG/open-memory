import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

/**
 * Autonomous QA: launch the real Electron app, stub the native file dialog to
 * return a synthetic Claude export, click "Choose file", and assert the
 * conversations actually render. Proves ingest -> render through the live UI.
 */

const HERE = __dirname;
const APP_DIR = path.resolve(HERE, "..");
const SAMPLE_DIR = path.join(HERE, "sample");

let zipPath: string;

test.beforeAll(() => {
  const tmp = mkdtempSync(path.join(tmpdir(), "om-e2e-"));
  // Prefix triggers source detection; -j junks paths so entries sit at the root.
  zipPath = path.join(tmp, "CLAUDE_EXPORT_e2e-sample.zip");
  execSync(
    `zip -j -q "${zipPath}" "${path.join(SAMPLE_DIR, "conversations.json")}" "${path.join(SAMPLE_DIR, "users.json")}"`,
  );
});

test("choose a Claude export, conversations render in the window", async () => {
  const app = await electron.launch({ args: [APP_DIR] });

  // Stub the native open dialog (Playwright can't drive OS chrome).
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, zipPath);

  const win = await app.firstWindow();
  await win.click("#pick");

  await expect(win.locator("#status")).toContainText("claude:", { timeout: 30_000 });
  await expect(win.locator("#status")).toContainText("2 conversations");

  // The rendered conversations live in the result iframe.
  const frame = win.frameLocator("#view");
  await expect(frame.locator("body")).toContainText("Hello from the test");
  await expect(frame.locator("body")).toContainText("E2E Test Conversation");

  await win.screenshot({ path: path.join(HERE, "qa.png") });
  await app.close();
});
