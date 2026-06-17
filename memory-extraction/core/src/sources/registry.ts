import { chatgptAdapter } from "./chatgpt/adapter";
import { claudeAdapter } from "./claude/adapter";
import type { SourceAdapter } from "./types";

/** The built adapters, keyed by SourceId. Gemini is intentionally not here yet. */
export const adapters: Record<string, SourceAdapter> = {
  chatgpt: chatgptAdapter,
  claude: claudeAdapter,
};
