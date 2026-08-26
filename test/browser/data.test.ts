import assert from "node:assert/strict";
import test from "node:test";

import { waitForClose, waitForMessage } from "../helpers/signaling.js";
import { arrangeBrowserInteropSession } from "./helpers/session.js";

const TEST_TIMEOUT_MS = 90_000;

test(
  "B6: DataChannel 双方向の文字列 payload と close が伝播する",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { session } = await arrangeBrowserInteropSession();
    try {
      const browserSend = await session.createBrowserSendTransport();
      const weriftRecv = await session.createWeriftRecvTransport();
      const weriftSend = await session.createWeriftSendTransport();
      const browserRecv = await session.createBrowserRecvTransport();

      // 実行: browser→werift と werift→browser の reliable ordered DataChannel を張る。
      const browserProducer = await session.produceBrowserData(browserSend, {
        label: "browser-data",
        protocol: "werift",
        ordered: true,
      });
      const weriftConsumed = await session.consumeDataOnWerift(
        weriftRecv,
        browserProducer.id,
      );
      const weriftProducer = await session.produceWeriftData(weriftSend, {
        label: "werift-data",
        protocol: "werift",
        ordered: true,
      });
      const browserConsumed = await session.consumeDataOnBrowser(
        browserRecv,
        weriftProducer.id,
      );

      const toWerift = waitForMessage(weriftConsumed.client);
      await session.sendBrowserData(browserProducer.id, "hello-from-browser");
      weriftProducer.send("hello-from-werift");
      const toBrowser = await session.waitBrowserMessages(browserConsumed.client.id);

      // 検証: 双方の payload が届く。
      assert.equal(await toWerift, "hello-from-browser");
      assert.equal(toBrowser, "hello-from-werift");
      assert.equal(browserProducer.label, "browser-data");
      assert.equal(weriftConsumed.client.label, "browser-data");
      assert.equal(browserConsumed.client.label, "werift-data");

      // 実行: 双方を close し、close が伝播することを待つ。
      const weriftConsumerClosed = waitForClose(weriftConsumed.client);
      const weriftProducerClosed = waitForClose(weriftProducer);
      await session.closeBrowserData("producer", browserProducer.id);
      weriftProducer.close();
      await session.closeBrowserData("consumer", browserConsumed.client.id);
      await weriftConsumerClosed;
      await weriftProducerClosed;

      // 検証: close 後は双方 closed。
      assert.equal(weriftConsumed.client.closed, true);
      assert.equal(weriftProducer.closed, true);
      assert.equal(
        await session.browserDataClosed("producer", browserProducer.id),
        true,
      );
      assert.equal(
        await session.browserDataClosed("consumer", browserConsumed.client.id),
        true,
      );
    } finally {
      await session.close();
    }
  },
);
