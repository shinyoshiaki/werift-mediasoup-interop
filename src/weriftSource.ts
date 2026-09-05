import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLYFILL_ENTRY = "packages/webrtc/src/polyfill/index.ts";

async function isWeriftRoot(candidate: string): Promise<boolean> {
  try {
    await access(path.join(candidate, POLYFILL_ENTRY));
    return true;
  } catch {
    return false;
  }
}

/** Resolve the werift checkout without installing or building its npm package. */
export async function resolveWeriftRoot(): Promise<string> {
  const candidates = [
    process.env.WERIFT_REPO_ROOT,
    // integration/werift-mediasoup-interop として submodule checkout された場合。
    path.resolve(PROJECT_ROOT, "../.."),
    // IDE の標準配置で werift-webrtc と並ぶ独立 project の場合。
    path.resolve(PROJECT_ROOT, "../werift-webrtc"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await isWeriftRoot(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `werift source checkout was not found; set WERIFT_REPO_ROOT (checked: ${candidates.join(", ")})`,
  );
}

/** Import the polyfill's TypeScript source through tsx's runtime loader. */
export async function importWeriftPolyfill(): Promise<Record<string, unknown>> {
  const weriftRoot = await resolveWeriftRoot();
  const entryUrl = pathToFileURL(path.join(weriftRoot, POLYFILL_ENTRY)).href;

  return import(entryUrl);
}

/** Import codec factories from the parent werift source checkout. */
export async function importWeriftCodecs(): Promise<Record<string, unknown>> {
  const weriftRoot = await resolveWeriftRoot();
  const entryUrl = pathToFileURL(
    path.join(weriftRoot, "packages/webrtc/src/media/codec.ts"),
  ).href;

  return import(entryUrl);
}
