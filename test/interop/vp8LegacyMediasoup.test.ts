// mediasoup <= 3.19.2 (before versatica/mediasoup PR #1612) drops VP8 with an
// X=0 payload descriptor as unparsable, so it never sees a keyframe and the
// consumer forwards nothing. werift must send X=1 (PictureID) so legacy SFUs
// forward it without being upgraded.
import assert from "node:assert/strict";
import test from "node:test";

import { delay, markedPayload, sendMarkedRtp } from "../helpers/rtp.js";
import {
  arrangeVp8MediaRegister,
  arrangeVp8Pipeline,
  assertVp8PictureIdDescriptors,
  collectRtp,
  countRtpDuring,
  hasDepacketizedKeyframe,
  importWeriftRtpCodecs,
  type Vp8ConsumerMode,
  type WeriftVp8Source,
} from "../helpers/vp8.js";
import { LEGACY_MEDIASOUP_VERSION } from "../helpers/worker.js";

const FLAVOR = "legacy" as const;
const RECEIVED_PACKETS = 20;
// dummy は 1 秒、vp8-opus.webm も 1 秒間隔で keyframe。legacy は keyframe まで転送しない。
const RECEIVE_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 60_000;

test(
  `対照: mediasoup ${LEGACY_MEDIASOUP_VERSION} は X=0 の最小 descriptor VP8 を 1 packet も転送しない`,
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // 既定の空 callback register に synthetic RTP (0x10 0x00 = X=0, S=1, P=0) を直接書き込む。
    const { consumed, serverProducer, session, track } = await arrangeVp8Pipeline({
      flavor: FLAVOR,
    });
    try {
      const marker = Buffer.from("LEGACY-X0");
      const payload = markedPayload("video/VP8", marker);

      // 実行: keyframe 相当の X=0 packet を 3 秒間 (60 packet、全 marker 付き) 流し、consumer 側の受信数を数える。
      const received = await countRtpDuring(consumed.client.track, 4_000, async () => {
        for (let index = 0; index < 60; index++) {
          await sendMarkedRtp({
            track: track as { writeRtp: (packet: unknown) => void },
            sequenceNumber: 5000 + index,
            timestamp: 3000 * index,
            ssrc: 2,
            marker: true,
            payload,
          });
          await delay(50);
        }
      });
      const producerStats = await serverProducer.getStats();

      // 検証: legacy worker を使っており、producer には届いているのに consumer は 0 packet (報告された症状の再現)。
      assert.equal(session.mediasoupVersion, LEGACY_MEDIASOUP_VERSION);
      const producerPackets = producerStats.reduce(
        (sum, stat) => sum + (stat.packetCount ?? 0),
        0,
      );
      assert.ok(producerPackets > 0, `producer packetCount=${producerPackets}`);
      assert.equal(received, 0);

      // 検証: keyframe を待つ consumer が送信側へ PLI を返している。
      const pliCount = producerStats.reduce((sum, stat) => sum + (stat.pliCount ?? 0), 0);
      assert.ok(pliCount > 0, `producer pliCount=${pliCount}`);
    } finally {
      await session.close();
    }
  },
);

const CASES: Array<{ source: WeriftVp8Source; consumer: Vp8ConsumerMode }> = [
  { source: "dummy", consumer: "simple" },
  { source: "dummy", consumer: "simulcast" },
  { source: "webm", consumer: "simple" },
  { source: "webm", consumer: "simulcast" },
];

for (const { source, consumer } of CASES) {
  test(
    `werift VP8 (${source}) → mediasoup ${LEGACY_MEDIASOUP_VERSION} ${consumer} consumer で転送され descriptor が保たれる`,
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const codecs = await importWeriftRtpCodecs();
      const mediaRegister = await arrangeVp8MediaRegister(source);
      const { consumed, session } = await arrangeVp8Pipeline({
        consumer,
        flavor: FLAVOR,
        mediaRegister,
      });
      try {
        // 実行: werift 自身の VP8 送信経路の RTP を legacy mediasoup 経由で受信する。
        const packets = await collectRtp(
          consumed.client.track,
          RECEIVED_PACKETS,
          RECEIVE_TIMEOUT_MS,
        );

        // 検証: legacy worker でも閾値以上が転送され、X/I/M descriptor と PictureID 連番がそのまま届く。
        assert.equal(session.mediasoupVersion, LEGACY_MEDIASOUP_VERSION);
        assert.ok(packets.length >= RECEIVED_PACKETS);
        assertVp8PictureIdDescriptors(codecs, packets);

        // 検証: legacy は keyframe からしか転送しないので、受信は keyframe から始まる。
        assert.ok(hasDepacketizedKeyframe(codecs, packets), "no keyframe received");
      } finally {
        await session.close();
      }
    },
  );
}

for (const source of ["dummy", "webm"] as const) {
  test(
    `werift VP8 (${source}) → mediasoup ${LEGACY_MEDIASOUP_VERSION}: consumer pause → resume 後も転送が再開する`,
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const codecs = await importWeriftRtpCodecs();
      const mediaRegister = await arrangeVp8MediaRegister(source);
      const { consumed, session } = await arrangeVp8Pipeline({
        flavor: FLAVOR,
        mediaRegister,
      });
      try {
        // 実行: まず転送開始を確認してから server 側 consumer を pause する。
        await collectRtp(consumed.client.track, RECEIVED_PACKETS, RECEIVE_TIMEOUT_MS);
        await consumed.server.pause();
        await delay(300);
        const whilePaused = await countRtpDuring(consumed.client.track, 1_000);

        // 実行: resume すると legacy SimpleConsumer は keyframe 待ちに戻る。次の keyframe から再開するのを待つ。
        const resumed = collectRtp(
          consumed.client.track,
          RECEIVED_PACKETS,
          RECEIVE_TIMEOUT_MS,
        );
        await consumed.server.resume();
        const packets = await resumed;

        // 検証: pause 中は止まり、resume 後は keyframe 検出を経て閾値以上が再び届く。
        assert.equal(whilePaused, 0);
        assert.ok(packets.length >= RECEIVED_PACKETS);
        assertVp8PictureIdDescriptors(codecs, packets);
        assert.ok(hasDepacketizedKeyframe(codecs, packets), "no keyframe after resume");
      } finally {
        await session.close();
      }
    },
  );
}
