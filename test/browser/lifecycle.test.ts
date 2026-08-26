import assert from "node:assert/strict";
import test from "node:test";

import { delay } from "../helpers/rtp.js";
import { arrangeBrowserInteropSession } from "./helpers/session.js";

const TEST_TIMEOUT_MS = 90_000;

test(
  "B8: client-first / server-first close と context close でリソースを残さない",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { session } = await arrangeBrowserInteropSession();
    try {
      const browserSend = await session.createBrowserSendTransport();
      const weriftRecv = await session.createWeriftRecvTransport();
      const send = await session.createWeriftSendTransport();
      const browserRecv = await session.createBrowserRecvTransport();
      await session.produceBrowserMedia(browserSend, "audio");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await send.client.produce({ track: stream.getAudioTracks()[0] });
      await session.waitWeriftConnected(send);

      // 実行: browser client を先に閉じ、werift は server を先に閉じる。
      await session.closeBrowserTransport(browserSend.id);
      weriftRecv.server.close();
      send.client.close();
      browserRecv.server.close();

      // 検証: 双方 closed。未処理 rejection はこの後の tick で表面化しない。
      assert.equal(weriftRecv.server.closed, true);
      assert.equal(send.client.closed, true);
      assert.equal(browserRecv.server.closed, true);
      await delay(50);
      await Promise.resolve();
    } finally {
      const worker = session.interop.worker;
      const browser = session.runtime?.browser;
      await session.close();
      // 検証: uninstall / worker / browser を閉じたあと、接続は残らない。
      assert.equal(worker?.closed || worker?.died, true);
      assert.equal(browser?.isConnected() ?? false, false);
    }
  },
);
