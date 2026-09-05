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
    await session.waitConnected(send);
    await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv);

    // 検証: client / server とも接続済みになる。
    assert.equal(send.client.connectionState, "connected");
    assert.equal(recv.client.connectionState, "connected");
    assert.match(send.server.iceState, /connected|completed/);
    assert.match(recv.server.iceState, /connected|completed/);
  } finally {
    await session.close();
  }
});

test("ICE restart と server/client 起点の close を安全に処理する", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const producer = await send.client.produce({
      track: stream.getAudioTracks()[0],
    });
    await session.waitConnected(send);
    await session.consumeProducer(recv, producer.id);
    await session.waitConnected(recv);
    const before = send.server.iceParameters.usernameFragment;

    // 実行: ICE restart 完了後、server 起点で transport を閉じる。
    await session.restartIce(send);
    assert.equal(send.client.connectionState, "connected");
    recv.server.close();

    // 検証: mediasoup の server close は遠隔 client へ状態通知しないため、server 自体の終了だけを確認する。
    assert.equal(recv.server.closed, true);

    // 実行: server 側の終了後に client 側も明示的に閉じ、別 transport は client 起点で閉じる。
    recv.client.close();
    send.client.close();
    assert.equal(send.client.closed, true);
    send.server.close();

    // 検証: usernameFragment が変わり、両 endpoint を明示的に安全終了できる。
    assert.notEqual(send.server.iceParameters.usernameFragment, before);
    assert.equal(recv.server.closed, true);
    assert.equal(recv.client.closed, true);
    assert.equal(send.client.closed, true);
    assert.equal(send.server.closed, true);
  } finally {
    await session.close();
  }
});
