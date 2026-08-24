import assert from "node:assert/strict";
import test from "node:test";

import {
  delay,
  markedPayload,
  sendMarkedRtp,
  waitForMarkedRtp,
} from "../helpers/rtp.js";
import { arrangeInteropSession } from "../helpers/session.js";

async function produceVideo(mimeType: string) {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const [track] = stream.getVideoTracks();
    const codec =
      mimeType.toLowerCase() === "video/vp8"
        ? undefined
        : session.device!.rtpCapabilities.codecs?.find(
            (entry) => entry.mimeType.toLowerCase() === mimeType.toLowerCase(),
          );
    const producer = await send.client.produce({
      track,
      codec,
    });
    await session.waitConnected(send.client);
    const consumed = await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv.client);
    await delay(200);
    const marker = Buffer.from("VID");
    const payload = markedPayload(mimeType, marker);
    const sendTrack = track as { writeRtp: (packet: unknown) => void };
    const waiter = waitForMarkedRtp(
      consumed.client.track as {
        onReceiveRtp: {
          subscribe: (listener: (rtp: {
            header: {
              sequenceNumber: number;
              timestamp: number;
              ssrc: number;
              marker: boolean;
            };
            payload: Buffer;
          }) => void) => { unSubscribe: () => void };
        };
      },
      marker,
      2,
    );
    for (let index = 0; index < 20; index++) {
      await sendMarkedRtp({
        track: sendTrack,
        sequenceNumber: 2000 + index,
        timestamp: 3000 * index,
        ssrc: producer.rtpParameters.encodings?.[0]?.ssrc ?? 2,
        marker: index % 2 === 1,
        payload,
      });
      await delay(30);
    }
    const packets = await waiter;
    return { consumed, packets, producer, session };
  } catch (error) {
    await session.close();
    throw error;
  }
}

test("VP8 produce/consume で synthetic RTP が届く", async () => {
  const { consumed, packets, producer, session } = await produceVideo("video/VP8");
  try {
    // 検証: VP8 Consumer の track に marker 付き RTP が届く。
    assert.match(producer.rtpParameters.codecs[0].mimeType, /VP8/i);
    assert.equal(consumed.client.track.readyState, "live");
    assert.ok(packets.length >= 2);
    assert.ok(packets[1].sequenceNumber !== packets[0].sequenceNumber);
    assert.ok(packets[1].timestamp !== packets[0].timestamp);
    assert.equal(packets[0].ssrc, packets[1].ssrc);
    assert.ok(packets[0].payload.indexOf(Buffer.from("WERIFT-video/VP8")) !== -1);
  } finally {
    await session.close();
  }
});

test("H264 produce/consume で synthetic RTP が届く", async () => {
  const { packets, producer, session } = await produceVideo("video/H264");
  try {
    assert.match(producer.rtpParameters.codecs[0].mimeType, /H264/i);
    assert.ok(packets.length >= 2);
    assert.ok(packets[0].payload.indexOf(Buffer.from("VID")) !== -1);
  } finally {
    await session.close();
  }
});

test("simulcast・preferred layer・key-frame request・replaceTrack", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const producer = await send.client.produce({
      track: stream.getVideoTracks()[0],
      encodings: [
        { maxBitrate: 100_000 },
        { maxBitrate: 300_000 },
        { maxBitrate: 900_000 },
      ],
    });
    await session.waitConnected(send.client);
    const consumed = await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv.client);

    // 実行: layer 選択、キーフレーム要求、track 差し替え。
    await consumed.server.setPreferredLayers({ spatialLayer: 0, temporalLayer: 0 });
    await consumed.server.requestKeyFrame();
    const replacement = await navigator.mediaDevices.getUserMedia({ video: true });
    await producer.replaceTrack({ track: replacement.getVideoTracks()[0] });

    // 検証: simulcast encodings があり、Consumer は live のまま。
    assert.ok((producer.rtpParameters.encodings?.length ?? 0) >= 1);
    assert.equal(consumed.client.track.readyState, "live");
  } finally {
    await session.close();
  }
});
