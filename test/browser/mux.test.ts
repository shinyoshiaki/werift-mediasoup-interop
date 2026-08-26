import assert from "node:assert/strict";
import test from "node:test";

import { waitForMessage } from "../helpers/signaling.js";
import { arrangeBrowserInteropSession } from "./helpers/session.js";

const TEST_TIMEOUT_MS = 90_000;

test(
  "B7: audio と data の同時接続で片方の pause/close が他を壊さない",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { session } = await arrangeBrowserInteropSession();
    try {
      const browserSend = await session.createBrowserSendTransport();
      const weriftRecv = await session.createWeriftRecvTransport();

      // 実行: 同じ Router 上で audio produce と data produce を同時に張る。
      const audioProducer = await session.produceBrowserMedia(browserSend, "audio");
      const dataProducer = await session.produceBrowserData(browserSend, {
        label: "mux",
        ordered: true,
      });
      const audioConsumed = await session.consumeOnWerift(
        weriftRecv,
        audioProducer.id,
      );
      const dataConsumed = await session.consumeDataOnWerift(
        weriftRecv,
        dataProducer.id,
      );

      const message = waitForMessage(dataConsumed.client);
      await session.sendBrowserData(dataProducer.id, "still-alive");

      // 検証: data が届き、audio consumer は live。
      assert.equal(await message, "still-alive");
      assert.equal(audioConsumed.client.track.readyState, "live");

      // 実行: audio だけ pause/close する。
      await session.pauseBrowserProducer(audioProducer.id);
      await session.closeBrowserProducer(audioProducer.id);

      const again = waitForMessage(dataConsumed.client);
      await session.sendBrowserData(dataProducer.id, "after-audio-close");

      // 検証: data は残り、audio producer だけ閉じている。
      assert.equal(await again, "after-audio-close");
      assert.equal(dataConsumed.client.closed, false);
    } finally {
      await session.close();
    }
  },
);
