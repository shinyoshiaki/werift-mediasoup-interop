import assert from "node:assert/strict";
import test from "node:test";

import { arrangeBrowserInteropSession } from "./helpers/session.js";

const TEST_TIMEOUT_MS = 90_000;

function isChromeHandler(name: string | undefined) {
  return (
    name === "Chrome111" ||
    name === "Chrome74" ||
    (typeof name === "string" && /^Chrome\d+$/.test(name) && Number(name.slice(6)) >= 74)
  );
}

test(
  "B1: ブラウザと werift の Device.factory が Handler 自動選択で成功する",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { loaded, session } = await arrangeBrowserInteropSession();
    try {
      // 実行: ブラウザページと Node polyfill の双方で detectDevice する。
      const browserHandler = await session.detectBrowserHandler();
      const weriftHandler = session.detectedWeriftHandler();

      // 検証: ブラウザは Chromium 系 Handler、werift は Chrome111。handlerName は渡していない。
      assert.equal(loaded.loaded, true);
      assert.ok(
        isChromeHandler(browserHandler),
        `unexpected browser handler ${browserHandler}`,
      );
      assert.ok(
        isChromeHandler(loaded.handlerName),
        `unexpected browser device handler ${loaded.handlerName}`,
      );
      assert.equal(weriftHandler, "Chrome111");
      assert.equal(session.device?.handlerName, "Chrome111");
      assert.equal(session.device?.loaded, true);
    } finally {
      await session.close();
    }
  },
);
