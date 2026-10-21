// mediasoup <= 3.19.2 (before versatica/mediasoup PR #1612) never forwards VP8
// with an X=0 descriptor. werift's X/I/M descriptor must reach and decode in
// Chromium through the legacy SFU without upgrading it.
import assert from "node:assert/strict";
import test from "node:test";

import { LEGACY_MEDIASOUP_VERSION } from "../helpers/worker.js";
import { arrangeWeriftVp8WebmToBrowser } from "./helpers/media.js";

const TEST_TIMEOUT_MS = 90_000;

test(
  `B10: werift VP8 WebM → mediasoup ${LEGACY_MEDIASOUP_VERSION} → Chromium consume がデコードする`,
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { consumed, session } = await arrangeWeriftVp8WebmToBrowser({ flavor: "legacy" });
    try {
      // 実行: legacy mediasoup 経由で werift の WebM 再生 VP8 を Chromium に受信・デコードさせる。
      const packetsReceived = await session.waitBrowserPacketsReceived(
        consumed.client.id,
        20,
      );
      const framesDecoded = await session.waitBrowserFramesDecoded(
        consumed.client.id,
        1,
      );

      // 検証: legacy worker でも packetsReceived と framesDecoded > 0 の両方を満たす。
      assert.equal(session.interop.mediasoupVersion, LEGACY_MEDIASOUP_VERSION);
      assert.ok(packetsReceived >= 20, `packetsReceived=${packetsReceived}`);
      assert.ok(framesDecoded > 0, `framesDecoded=${framesDecoded}`);
    } finally {
      await session.close();
    }
  },
);
