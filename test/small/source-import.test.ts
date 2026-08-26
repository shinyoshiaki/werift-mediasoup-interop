import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { arrangeWeriftSource } from "../helpers/weriftSource.js";
import { resolveWeriftRoot } from "../../src/weriftSource.js";

const POLYFILL_ENTRY = "packages/webrtc/src/polyfill/index.ts";

test("werift の polyfill を TypeScript source から直接 import できる", async () => {
  // Arrange
  const { polyfill, root } = await arrangeWeriftSource();

  // Act: パッケージ build を介さず読み込んだ公開関数を取得する。
  const installPolyfill = polyfill.installPolyfill;
  const createCallbackRegister = polyfill.createCallbackRegister;

  // Assert: resolver が返した checkout に polyfill entry があり、公開関数を解決できる。
  assert.equal(root, await resolveWeriftRoot());
  await access(path.join(root, POLYFILL_ENTRY));
  assert.equal(typeof installPolyfill, "function");
  assert.equal(typeof createCallbackRegister, "function");
});
