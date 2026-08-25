import assert from "node:assert/strict";
import test from "node:test";

import {
  delay,
  markedPayload,
  pumpMarkedRtp,
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
    await session.waitConnected(send);
    const consumed = await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv);
    await delay(200);
    const marker = Buffer.from("VID");
    const payload = markedPayload(mimeType, marker);
    const sendTrack = track as { writeRtp: (packet: unknown) => void };
    // 実行: Consumer 待ちを先に張り、キーフレーム相当の synthetic RTP を流す。
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
    // 検証: VP8 Consumer の track に marker 付き RTP が届き、seq/ts/ssrc/marker が変化する。
    assert.match(producer.rtpParameters.codecs[0].mimeType, /VP8/i);
    assert.equal(consumed.client.track.readyState, "live");
    assert.ok(packets.length >= 2);
    assert.ok(packets[1].sequenceNumber !== packets[0].sequenceNumber);
    assert.ok(packets[1].timestamp !== packets[0].timestamp);
    assert.equal(packets[0].ssrc, packets[1].ssrc);
    assert.equal(typeof packets[0].marker, "boolean");
    assert.ok(packets.some((packet) => packet.marker === true));
    assert.ok(packets[0].payload.indexOf(Buffer.from("VID")) !== -1);
  } finally {
    await session.close();
  }
});

test("H264 produce/consume で synthetic RTP が届く", async () => {
  const { consumed, packets, producer, session } = await produceVideo("video/H264");
  try {
    // 検証: H264 でも payload marker 付き RTP が Router を往復し、seq/ts/ssrc/marker を保持する。
    assert.match(producer.rtpParameters.codecs[0].mimeType, /H264/i);
    assert.equal(consumed.client.track.readyState, "live");
    assert.ok(packets.length >= 2);
    assert.ok(packets[1].sequenceNumber !== packets[0].sequenceNumber);
    assert.ok(packets[1].timestamp !== packets[0].timestamp);
    assert.equal(packets[0].ssrc, packets[1].ssrc);
    assert.equal(typeof packets[0].marker, "boolean");
    assert.ok(packets.some((packet) => packet.marker === true));
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
    await session.waitConnected(send);
    const consumed = await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv);
    const encodings = producer.rtpParameters.encodings ?? [];
    assert.equal(encodings.length, 3);
    assert.deepEqual(
      encodings.map((encoding) => encoding.rid),
      ["r0", "r1", "r2"],
    );
    // Chrome111 は encodings>1 を SDP SSRC とマージせず rid だけ付ける。
    // werift sender は writeRtp 時に自身の SSRC へ上書きするので、既知 SSRC で十分。
    const ssrc =
      encodings
        .map((encoding) => encoding.ssrc)
        .find((value): value is number => typeof value === "number") ?? 2;
    const consumeTrack = consumed.client.track as {
      readyState: string;
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
    };
    await delay(200);

    const layerMarker = Buffer.from("LAYER");
    const sendTrack = stream.getVideoTracks()[0] as {
      writeRtp: (packet: unknown) => void;
    };
    // 実行: 先に RID 付き RTP を流して layer を登録し、その後 layer 選択とキーフレーム要求する。
    const layerWait = waitForMarkedRtp(consumeTrack, layerMarker, 2);
    await pumpMarkedRtp({
      track: sendTrack,
      sequenceNumber: 3000,
      ssrc,
      count: 12,
      payload: markedPayload("video/VP8", layerMarker),
    });
    await consumed.server.setPreferredLayers({
      spatialLayer: 0,
      temporalLayer: 0,
    });
    await consumed.server.requestKeyFrame();
    await pumpMarkedRtp({
      track: sendTrack,
      sequenceNumber: 3200,
      ssrc,
      count: 12,
      payload: markedPayload("video/VP8", layerMarker),
    });
    const layerPackets = await layerWait;

    const replacement = await navigator.mediaDevices.getUserMedia({ video: true });
    await producer.replaceTrack({ track: replacement.getVideoTracks()[0] });
    const replaceMarker = Buffer.from("REPL");
    const replaceWait = waitForMarkedRtp(consumeTrack, replaceMarker, 2);
    await pumpMarkedRtp({
      track: replacement.getVideoTracks()[0] as {
        writeRtp: (packet: unknown) => void;
      },
      sequenceNumber: 4000,
      ssrc,
      count: 12,
      payload: markedPayload("video/VP8", replaceMarker),
    });
    const replacePackets = await replaceWait;

    // 検証: 3 encoding があり、layer 選択と replaceTrack 後も RTP が届く。
    assert.ok(layerPackets.length >= 2);
    assert.ok(layerPackets[1].sequenceNumber !== layerPackets[0].sequenceNumber);
    assert.equal(layerPackets[0].ssrc, layerPackets[1].ssrc);
    assert.ok(replacePackets.length >= 2);
    assert.ok(replacePackets[1].sequenceNumber !== replacePackets[0].sequenceNumber);
    assert.equal(replacePackets[0].ssrc, replacePackets[1].ssrc);
    assert.ok(replacePackets[0].payload.indexOf(replaceMarker) !== -1);
    assert.equal(consumed.client.track.readyState, "live");
  } finally {
    await session.close();
  }
});
