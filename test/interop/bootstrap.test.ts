import assert from "node:assert/strict";
import test from "node:test";

import { detectDevice } from "mediasoup-client";

import { arrangeInstalledPolyfill } from "../helpers/polyfill.js";
import { arrangeInteropSession } from "../helpers/session.js";

test("polyfill だけで detectDevice と Device.factory が Chrome111 になる", async () => {
  const session = await arrangeInteropSession();
  try {
    // 実行: Handler 引数なしで検出する。
    const handler = session.detectedHandler();

    // 検証: 実 worker/router 上で Chrome111 が選ばれ、Device が load 済み。
    assert.equal(handler, "Chrome111");
    assert.equal(session.device?.handlerName, "Chrome111");
    assert.equal(session.device?.loaded, true);
    assert.equal(session.device?.canProduce("audio"), true);
    assert.equal(session.device?.canProduce("video"), true);
  } finally {
    await session.close();
  }
});

test("明示 userAgent は上書きでき、uninstall で Node UA へ戻る", async () => {
  const previous = globalThis.navigator?.userAgent;
  const explicit =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const { uninstall } = await arrangeInstalledPolyfill({ userAgent: explicit });
  try {
    // 実行: 明示 UA を入れて検出する。
    assert.equal(navigator.userAgent, explicit);
    assert.equal(detectDevice(), "Chrome111");
  } finally {
    uninstall();
  }

  // 検証: uninstall 後はインストール前の値へ戻る。
  assert.equal(globalThis.navigator?.userAgent, previous);
});
