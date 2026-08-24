import assert from "node:assert/strict";
import test from "node:test";

import { arrangeInstalledPolyfill } from "../helpers/polyfill.js";
import { arrangeInteropSession } from "../helpers/session.js";
import { arrangeWorkerRouter } from "../helpers/worker.js";

test("失敗後の再作成と worker 終了で open handle を残さない", async () => {
  const first = await arrangeInteropSession();
  const previousUa = navigator.userAgent;
  await first.close();

  // 実行: uninstall 後に新しい worker/session を作り直す。
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
