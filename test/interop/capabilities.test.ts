import assert from "node:assert/strict";
import test from "node:test";

import { arrangeInteropSession } from "../helpers/session.js";

const unsupportedVideoCapabilities = {
  codecs: [
    {
      kind: "video" as const,
      mimeType: "video/AV1",
      clockRate: 90000,
      preferredPayloadType: 100,
    },
  ],
  headerExtensions: [],
};

test("Router capabilities と未対応 codec / 不正 parameter の拒否", async () => {
  const session = await arrangeInteropSession();
  try {
    const capabilities = session.device!.rtpCapabilities;
    const mimeTypes = (capabilities.codecs ?? []).map((codec) =>
      codec.mimeType.toLowerCase(),
    );
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    const producer = await send.client.produce({
      track: stream.getAudioTracks()[0],
    });
    await session.waitConnected(send);

    // 実行: 未対応 codec と壊した RTP/SCTP parameter を実 API へ渡す。
    const unsupportedProduce = send.client.produce({
      track: stream.getVideoTracks()[0],
      codec: {
        kind: "video",
        mimeType: "video/AV1",
        clockRate: 90000,
        preferredPayloadType: 100,
      },
    });
    const invalidRtpConsume = recv.server.consume({
      producerId: producer.id,
      rtpCapabilities: {
        codecs: [],
        headerExtensions: [],
      },
    });
    const invalidSctpProduce = send.client.produceData({
      maxPacketLifeTime: 1000,
      maxRetransmits: 0,
    });
    const invalidServerSctp = send.server.produceData({
      sctpStreamParameters: {
        streamId: 99,
        ordered: true,
        maxPacketLifeTime: 4000,
      },
    });

    // 検証: Opus/VP8/H264 は交渉でき、未対応 codec と不正 parameter は reject される。
    assert.ok(mimeTypes.some((type) => type === "audio/opus"));
    assert.ok(mimeTypes.some((type) => type === "video/vp8"));
    assert.ok(mimeTypes.some((type) => type === "video/h264"));
    assert.equal(session.device!.canProduce("audio"), true);
    assert.equal(session.device!.canProduce("video"), true);
    assert.equal(
      session.router!.canConsume({
        producerId: producer.id,
        rtpCapabilities: unsupportedVideoCapabilities,
      }),
      false,
    );
    await assert.rejects(unsupportedProduce, /no matching codec found/i);
    await assert.rejects(invalidRtpConsume);
    await assert.rejects(invalidSctpProduce, TypeError);
    await assert.rejects(invalidServerSctp, TypeError);
  } finally {
    await session.close();
  }
});
