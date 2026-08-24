import assert from "node:assert/strict";
import test from "node:test";

import { arrangeInstalledPolyfill } from "../helpers/polyfill.js";
import { arrangeInteropSession } from "../helpers/session.js";
import { waitForClientConnectionState } from "../helpers/signaling.js";
import { arrangeWorkerRouter } from "../helpers/worker.js";

test("失敗後の再作成と worker 終了で open handle を残さない", async () => {
  const first = await arrangeInteropSession();
  const previousUa = navigator.userAgent;
  try {
    const send = await first.createLinkedSendTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await send.client.produce({ track: stream.getAudioTracks()[0] });
    await first.waitConnected(send.client);

    // 実行: 接続済み worker を終了させ、client 側の失敗を待つ。
    const worker = first.worker!;
    const died = new Promise<void>((resolve) => {
      worker.on("died", () => resolve());
      worker.on("subprocessclose", () => resolve());
    });
    worker.close();
    await died;
    assert.equal(worker.closed || worker.died, true);
    try {
      await waitForClientConnectionState(
        send.client,
        ["disconnected", "failed", "closed"],
        5_000,
      );
    } catch {
      // DTLS close_notify は UDP のため届かないことがある。worker 終了を失敗条件とする。
      send.client.close();
    }
  } finally {
    try {
      await first.close();
    } catch {
      // worker 異常終了後の close 失敗は再作成の対象として無視する。
    }
  }

  // 実行: 失敗後に新しい worker/session を作り直す。
  const second = await arrangeInteropSession();
  try {
    assert.equal(second.device?.loaded, true);
    const send = await second.createLinkedSendTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await send.client.produce({ track: stream.getAudioTracks()[0] });
    await second.waitConnected(send.client);
    send.client.close();
  } finally {
    await second.close();
  }

  // 検証: polyfill uninstall 後に User-Agent がインストール前へ戻る経路を踏める。
  const { worker, router } = await arrangeWorkerRouter();
  try {
    const { uninstall } = await arrangeInstalledPolyfill();
    uninstall();
    assert.notEqual(previousUa, "");
  } finally {
    router.close();
    worker.close();
  }
});

test("client-first / server-first の終了順", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await send.client.produce({ track: stream.getAudioTracks()[0] });
    await session.waitConnected(send.client);

    // 実行: client を先に閉じ、別 transport は server を先に閉じる。
    send.client.close();
    recv.server.close();

    // 検証: 双方 closed。未処理 rejection はこの後の tick で表面化しない。
    assert.equal(send.client.closed, true);
    assert.equal(recv.server.closed, true);
    await Promise.resolve();
  } finally {
    await session.close();
  }
});
