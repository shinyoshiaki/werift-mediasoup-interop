import assert from "node:assert/strict";
import test from "node:test";

import { arrangeInteropSession } from "../helpers/session.js";
import {
  waitForClientConnectionState,
  waitUntil,
} from "../helpers/signaling.js";

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

test("ICE restart と server/client 起点の close が伝播する", async () => {
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

    // 実行: ICE restart 完了後、server 起点と client 起点で close する。
    await session.restartIce(send);
    assert.equal(send.client.connectionState, "connected");
    recv.server.close();
    const recvClientState = await waitForClientConnectionState(
      recv.client,
      ["disconnected", "failed", "closed"],
      15_000,
      recv.server,
    );
    send.client.close();
    await waitUntil(
      () =>
        send.server.closed ||
        send.server.iceState === "disconnected" ||
        send.server.iceState === "closed" ||
        send.server.dtlsState === "closed" ||
        send.server.dtlsState === "failed",
      15_000,
      `timed out waiting for server close propagation (ice=${send.server.iceState} dtls=${send.server.dtlsState} sctp=${send.server.sctpState ?? "-"} client=${send.client.connectionState})`,
    );

    // 検証: usernameFragment が変わり、close は相手側へ伝わる。
    assert.notEqual(send.server.iceParameters.usernameFragment, before);
    assert.equal(recv.server.closed, true);
    assert.ok(
      recvClientState === "disconnected" ||
        recvClientState === "failed" ||
        recvClientState === "closed" ||
        recv.client.closed,
    );
    assert.equal(send.client.closed, true);
    assert.ok(
      send.server.closed ||
        send.server.iceState === "disconnected" ||
        send.server.iceState === "closed" ||
        send.server.dtlsState === "closed" ||
        send.server.dtlsState === "failed",
    );
  } finally {
    await session.close();
  }
});
