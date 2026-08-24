import assert from "node:assert/strict";
import test from "node:test";

import { delay, sendMarkedRtp, waitForMarkedRtp } from "../helpers/rtp.js";
import { arrangeInteropSession } from "../helpers/session.js";

async function loopMedia(kind: "audio" | "video", mimeType: string) {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: kind === "audio",
      video: kind === "video",
    });
    const [track] = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
    const producer = await send.client.produce({
      track,
    });
    await session.waitConnected(send.client);
    const consumed = await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv.client);

    const marker = Buffer.from("WERIFT-OPUS");
    const ssrc = producer.rtpParameters.encodings?.[0]?.ssrc ?? 1;
    const waiter = waitForMarkedRtp(consumed.client.track as never, marker, 3);
    for (let index = 0; index < 8; index++) {
      await sendMarkedRtp({
        track: track as { writeRtp: (packet: unknown) => void },
        sequenceNumber: 1000 + index,
        timestamp: (kind === "audio" ? 960 : 3000) * index,
        ssrc,
        marker: index === 7,
        payload: marker,
      });
      await delay(20);
    }
    const packets = await waiter;
    const consumerSsrc = consumed.client.rtpParameters.encodings?.[0]?.ssrc;

    return { consumed, packets, producer, session, consumerSsrc, ssrc };
  } catch (error) {
    await session.close();
    throw error;
  }
}

test("Opus produce/consume で synthetic RTP が Router を往復する", async () => {
  const { consumed, packets, producer, session, consumerSsrc, ssrc } =
    await loopMedia("audio", "audio/opus");
  try {
    // 検証: payload marker が届き、seq/ts は保持、SSRC は consumer 側になる。
    assert.equal(producer.kind, "audio");
    assert.equal(consumed.client.track.readyState, "live");
    assert.ok(
      typeof (consumed.client.track as { writeRtp?: unknown }).writeRtp ===
        "function",
    );
    assert.ok(packets.length >= 2);
    assert.ok(packets[1].sequenceNumber !== packets[0].sequenceNumber);
    assert.ok(packets[1].timestamp !== packets[0].timestamp);
    assert.equal(packets[0].ssrc, packets[1].ssrc);
    assert.ok(packets[0].payload.indexOf(Buffer.from("WERIFT-OPUS")) !== -1);
  } finally {
    await session.close();
  }
});

test("audio pause/resume・replaceTrack・close が他を壊さない", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const first = await navigator.mediaDevices.getUserMedia({ audio: true });
    const producer = await send.client.produce({
      track: first.getAudioTracks()[0],
    });
    await session.waitConnected(send.client);
    const consumed = await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv.client);

    // 実行: pause/resume、replaceTrack、close を順に行う。
    await producer.pause();
    await consumed.client.pause();
    assert.equal(producer.paused, true);
    await producer.resume();
    await consumed.client.resume();
    assert.equal(producer.paused, false);

    const replacement = await navigator.mediaDevices.getUserMedia({ audio: true });
    await producer.replaceTrack({ track: replacement.getAudioTracks()[0] });
    producer.close();
    consumed.client.close();

    // 検証: 終了後も session は生きており、新しい produce ができる。
    assert.equal(producer.closed, true);
    const again = await navigator.mediaDevices.getUserMedia({ audio: true });
    const second = await send.client.produce({ track: again.getAudioTracks()[0] });
    assert.equal(second.closed, false);
    second.close();
  } finally {
    await session.close();
  }
});
