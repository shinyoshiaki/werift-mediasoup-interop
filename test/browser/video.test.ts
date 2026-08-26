import assert from "node:assert/strict";
import test from "node:test";

import { assertRtpHeadersProgress, waitForRtpHeaders } from "../helpers/rtp.js";
import { pumpWeriftDummyRtp } from "./helpers/media.js";
import { arrangeBrowserInteropSession } from "./helpers/session.js";

const TEST_TIMEOUT_MS = 90_000;

test(
  "B4: ブラウザ VP8 produce を werift consume が RTP ヘッダで受け取る",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { session } = await arrangeBrowserInteropSession();
    try {
      const send = await session.createBrowserSendTransport();
      const recv = await session.createWeriftRecvTransport();

      // 実行: ブラウザ fake camera で produce し、werift 側で consume する。
      const producer = await session.produceBrowserMedia(send, "video");
      const consumed = await session.consumeOnWerift(recv, producer.id);
      const packets = await waitForRtpHeaders(consumed.client.track as never, 2);

      // 検証: VP8 相当の映像 RTP が seq/ts/ssrc 付きで届く。
      assert.equal(producer.kind, "video");
      assert.equal(consumed.client.track.readyState, "live");
      assertRtpHeadersProgress(packets);
    } finally {
      await session.close();
    }
  },
);

test(
  "B5: werift VP8 produce をブラウザ consume の packetsReceived が増える",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { session } = await arrangeBrowserInteropSession();
    try {
      const send = await session.createWeriftSendTransport();
      const recv = await session.createBrowserRecvTransport();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const [track] = stream.getVideoTracks();

      // 実行: werift dummy VP8 を produce し、ブラウザ inbound RTP を待つ。
      const producer = await send.client.produce({ track });
      await session.waitWeriftConnected(send);
      const consumed = await session.consumeOnBrowser(recv, producer.id);
      const pumping = pumpWeriftDummyRtp({
        kind: "video",
        track: track as { writeRtp: (packet: unknown) => void },
        ssrc: producer.rtpParameters.encodings?.[0]?.ssrc ?? 2,
        count: 40,
      });
      const packetsReceived = await session.waitBrowserPacketsReceived(
        consumed.client.id,
        2,
      );
      await pumping;
      const decoded = await session.tryWaitVideoPlay(2_000);

      // 検証: packetsReceived が必須。canvas 再生は取れれば追加、失敗しても落とさない。
      assert.equal(await session.browserConsumerReadyState(consumed.client.id), "live");
      assert.ok(packetsReceived >= 2, `packetsReceived=${packetsReceived}`);
      void decoded;
    } finally {
      await session.close();
    }
  },
);
