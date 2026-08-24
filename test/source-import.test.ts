import assert from "node:assert/strict";
import test from "node:test";

import { arrangeWeriftSource } from "./helpers/weriftSource.js";

test("werift の polyfill を TypeScript source から直接 import できる", async () => {
  // Arrange
  const { polyfill, root } = await arrangeWeriftSource();

  // Act: パッケージ build を介さず読み込んだ公開関数を取得する。
  const installPolyfill = polyfill.installPolyfill;
  const createCallbackRegister = polyfill.createCallbackRegister;

  // Assert: 相互接続 fixture が必要とする入口を source checkout から解決できる。
  assert.match(root, /werift-webrtc(?:\.worktree\/[^/]+)?$/);
  assert.equal(typeof installPolyfill, "function");
  assert.equal(typeof createCallbackRegister, "function");
});

