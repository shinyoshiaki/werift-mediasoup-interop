import assert from "node:assert/strict";
import test from "node:test";

import { assertRtpHeadersProgress, waitForRtpHeaders } from "../helpers/rtp.js";
import { pumpWeriftDummyRtp } from "./helpers/media.js";
import { arrangeBrowserInteropSession } from "./helpers/session.js";

const TEST_TIMEOUT_MS = 90_000;

test(
  "B2: ブラウザ audio produce を werift consume が RTP ヘッダで受け取る",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { session } = await arrangeBrowserInteropSession();
    try {
      const send = await session.createBrowserSendTransport();
      const recv = await session.createWeriftRecvTransport();

      // 実行: ブラウザ fake microphone で produce し、werift 側で consume する。
      const producer = await session.produceBrowserMedia(send, "audio");
      const consumed = await session.consumeOnWerift(recv, producer.id);
      const packets = await waitForRtpHeaders(consumed.client.track as never, 2);

      // 検証: track は live で、seq/ts が変化し SSRC は安定する。
      assert.equal(producer.kind, "audio");
      assert.equal(consumed.client.track.readyState, "live");
      assertRtpHeadersProgress(packets);
    } finally {
      await session.close();
    }
  },
);

test(
  "B3: werift audio produce をブラウザ consume の packetsReceived が増える",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { session } = await arrangeBrowserInteropSession();
    try {
      const send = await session.createWeriftSendTransport();
      const recv = await session.createBrowserRecvTransport();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const [track] = stream.getAudioTracks();

      // 実行: werift dummy Opus を produce し、ブラウザ Consumer で inbound を待つ。
      const producer = await send.client.produce({ track });
      await session.waitWeriftConnected(send);
      const consumed = await session.consumeOnBrowser(recv, producer.id);
      await pumpWeriftDummyRtp({
        kind: "audio",
        track: track as { writeRtp: (packet: unknown) => void },
        ssrc: producer.rtpParameters.encodings?.[0]?.ssrc ?? 1,
      });
      const packetsReceived = await session.waitBrowserPacketsReceived(
        consumed.client.id,
        2,
      );

      // 検証: ブラウザ track は live で packetsReceived が増える。デコード再生は必須にしない。
      assert.equal(await session.browserConsumerReadyState(consumed.client.id), "live");
      assert.ok(packetsReceived >= 2, `packetsReceived=${packetsReceived}`);
    } finally {
      await session.close();
    }
  },
);
