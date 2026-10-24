// Load werift's Node.js TypeScript resolve hook (`tools/node-ts/register.mjs`)
// from the same checkout that `src/weriftSource.ts` resolves.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_ENTRY = "tools/node-ts/register.mjs";

const candidates = [
  process.env.WERIFT_REPO_ROOT,
  // integration/werift-mediasoup-interop として submodule checkout された場合。
  path.resolve(PROJECT_ROOT, "../.."),
  // IDE の標準配置で werift-webrtc と並ぶ独立 project の場合。
  path.resolve(PROJECT_ROOT, "../werift-webrtc"),
].filter(Boolean);

const root = candidates.find((candidate) => existsSync(path.join(candidate, HOOK_ENTRY)));
if (!root) {
  throw new Error(
    `werift ${HOOK_ENTRY} was not found; set WERIFT_REPO_ROOT (checked: ${candidates.join(", ")})`,
  );
}

await import(pathToFileURL(path.join(root, HOOK_ENTRY)).href);
