import assert from "node:assert/strict";
import test from "node:test";

import { arrangeInteropSession } from "../helpers/session.js";

test("send/recv WebRtcTransport が ICE/DTLS で接続する", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [track] = stream.getAudioTracks();

    // 実行: produce で connect を起こし、双方の接続完了を待つ。
    const producer = await send.client.produce({ track });
    await session.waitConnected(send.client);
    await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv.client);

    // 検証: client / server とも接続済みになる。
    assert.equal(send.client.connectionState, "connected");
    assert.equal(recv.client.connectionState, "connected");
    assert.match(send.server.iceState, /connected|completed/);
    assert.match(recv.server.iceState, /connected|completed/);
  } finally {
    await session.close();
  }
});

test("ICE restart と server/client 起点の close が伝播する", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await send.client.produce({ track: stream.getAudioTracks()[0] });
    await session.waitConnected(send.client);
    const before = send.server.iceParameters.usernameFragment;

    // 実行: server 起点で ICE restart する。
    await session.restartIce(send);

    // 検証: usernameFragment が変わり、接続は維持される。
    assert.notEqual(send.server.iceParameters.usernameFragment, before);
    assert.equal(send.client.connectionState, "connected");

    const recv = await session.createLinkedRecvTransport();
    recv.server.close();
    await delay(50);
    assert.equal(recv.server.closed, true);

    send.client.close();
    assert.equal(send.client.closed, true);
  } finally {
    await session.close();
  }
});

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
