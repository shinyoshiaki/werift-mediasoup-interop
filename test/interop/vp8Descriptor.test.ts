import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeVp8MediaRegister,
  arrangeVp8Pipeline,
  assertVp8PictureIdDescriptors,
  collectRtp,
  hasDepacketizedKeyframe,
  importWeriftRtpCodecs,
  type Vp8ConsumerMode,
  type WeriftVp8Source,
} from "../helpers/vp8.js";

const RECEIVED_PACKETS = 20;
const RECEIVE_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 60_000;

const CASES: Array<{ source: WeriftVp8Source; consumer: Vp8ConsumerMode }> = [
  { source: "dummy", consumer: "simple" },
  { source: "dummy", consumer: "simulcast" },
  { source: "webm", consumer: "simple" },
  { source: "webm", consumer: "simulcast" },
];

for (const { source, consumer } of CASES) {
  test(
    `werift VP8 (${source}) → mediasoup ${consumer} consumer で X/I/M descriptor と PictureID 連番が届く`,
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const codecs = await importWeriftRtpCodecs();
      const mediaRegister = await arrangeVp8MediaRegister(source);
      const { consumed, session } = await arrangeVp8Pipeline({
        consumer,
        mediaRegister,
      });
      try {
        // 実行: werift 自身の VP8 送信経路 (dummy / packetizer) の RTP を consumer 側で収集する。
        const packets = await collectRtp(
          consumed.client.track,
          RECEIVED_PACKETS,
          RECEIVE_TIMEOUT_MS,
        );

        // 検証: 閾値以上届き、全 packet が X=1/I=1/M=1・L/T/K=0 で、PictureID がフレームごとに +1 される。
        assert.ok(packets.length >= RECEIVED_PACKETS);
        const { frames } = assertVp8PictureIdDescriptors(codecs, packets);
        assert.ok(frames >= 2, `frames=${frames}`);

        // 検証: webm (packetizer 経路) は depacketize したフレームに keyframe を含む。
        if (source === "webm") {
          assert.ok(hasDepacketizedKeyframe(codecs, packets), "no keyframe received");
        }
      } finally {
        await session.close();
      }
    },
  );
}
