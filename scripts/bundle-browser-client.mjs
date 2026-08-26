import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "test/browser/page/dist/client.js");

mkdirSync(path.dirname(outfile), { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: [path.join(root, "test/browser/page/client.ts")],
  format: "iife",
  outfile,
  platform: "browser",
  target: "es2022",
});
