import assert from "node:assert/strict";
import test from "node:test";

import { delay, markedPayload, sendMarkedRtp, waitForMarkedRtp } from "../helpers/rtp.js";
import { waitForOpen } from "../helpers/signaling.js";
import { arrangeInteropSession } from "../helpers/session.js";

test("audio+video+data 同時接続と独立した pause/close", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const media = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    const audioProducer = await send.client.produce({
      track: media.getAudioTracks()[0],
    });
    const videoProducer = await send.client.produce({
      track: media.getVideoTracks()[0],
    });
    const dataProducer = await send.client.produceData({
      label: "mux",
      ordered: true,
    });
    await session.waitConnected(send.client);
    const audioConsumer = await session.consumeProducer(recv, audioProducer.id);
    const videoConsumer = await session.consumeProducer(recv, videoProducer.id);
    const dataConsumer = await session.consumeDataProducer(
      recv,
      dataProducer.id,
    );
    await session.waitConnected(recv.client);
    await waitForOpen(dataProducer);
    await waitForOpen(dataConsumer.client);
    await delay(100);

    const audioMarker = Buffer.from("MUX-AUDIO");
    const videoMarker = Buffer.from("MUX-VIDEO");
    const audioWait = waitForMarkedRtp(
      audioConsumer.client.track as never,
      audioMarker,
      1,
    );
    const videoWait = waitForMarkedRtp(
      videoConsumer.client.track as never,
      videoMarker,
      1,
    );
    for (let index = 0; index < 8; index++) {
      await sendMarkedRtp({
        track: media.getAudioTracks()[0] as { writeRtp: (packet: unknown) => void },
        sequenceNumber: 10 + index,
        timestamp: 960 * index,
        ssrc: audioProducer.rtpParameters.encodings?.[0]?.ssrc ?? 1,
        marker: true,
        payload: audioMarker,
      });
      await sendMarkedRtp({
        track: media.getVideoTracks()[0] as { writeRtp: (packet: unknown) => void },
        sequenceNumber: 20 + index,
        timestamp: 3000 * index,
        ssrc: videoProducer.rtpParameters.encodings?.[0]?.ssrc ?? 2,
        marker: true,
        payload: markedPayload("video/VP8", videoMarker),
      });
      await delay(20);
    }
    await audioWait;
    await videoWait;
    // 検証: audio と video の RTP が同時に届き、video track は live のまま。
    assert.equal(videoConsumer.client.track.readyState, "live");

    const message = new Promise<string>((resolve) => {
      dataConsumer.client.on("message", (data) => resolve(String(data)));
    });
    dataProducer.send("mux");
    assert.equal(await message, "mux");

    // 実行: audio だけ pause/close しても video/data は生きる。
    await audioProducer.pause();
    audioProducer.close();
    assert.equal(videoProducer.closed, false);
    assert.equal(dataProducer.closed, false);
    assert.equal(videoConsumer.client.track.readyState, "live");
  } finally {
    await session.close();
  }
});

test("複数 transport / client の独立した close", async () => {
  const session = await arrangeInteropSession();
  try {
    const peer = await session.createPeerDevice();
    const sendA = await session.createLinkedSendTransport();
    const sendB = await session.createLinkedTransportFor(peer, "send");
    const recvB = await session.createLinkedTransportFor(peer, "recv");
    const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
    const producerA = await sendA.client.produce({
      track: audio.getAudioTracks()[0],
    });
    await session.waitConnected(sendA.client);
    const producerB = await sendB.client.produce({
      track: (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0],
    });
    await session.waitConnected(sendB.client);
    await session.consumeProducer(recvB, producerA.id, peer.rtpCapabilities);
    await session.waitConnected(recvB.client);

    // 実行: A の transport を閉じても B は残る。
    sendA.client.close();
    await delay(20);
    assert.equal(sendA.client.closed, true);
    assert.equal(sendB.client.closed, false);
    assert.equal(producerB.closed, false);
    producerB.close();
  } finally {
    await session.close();
  }
});
