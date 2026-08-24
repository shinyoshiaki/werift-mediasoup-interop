import assert from "node:assert/strict";
import test from "node:test";

import { waitForOpen } from "../helpers/signaling.js";
import { arrangeInteropSession } from "../helpers/session.js";

test("reliable ordered DataProducer/DataConsumer の双方向 message", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const producer = await send.client.produceData({
      label: "control",
      protocol: "werift",
      ordered: true,
    });
    await session.waitConnected(send.client);
    const consumed = await session.consumeDataProducer(recv, producer.id);
    await session.waitConnected(recv.client);
    await waitForOpen(producer);
    await waitForOpen(consumed.client);

    // 実行: Producer から Consumer へメッセージを送る。
    const received = new Promise<string>((resolve) => {
      consumed.client.on("message", (data) => {
        resolve(String(data));
      });
    });
    producer.send("hello-data");

    // 検証: label/protocol と payload が届く。
    assert.equal(producer.label, "control");
    assert.equal(producer.protocol, "werift");
    assert.equal(await received, "hello-data");
    producer.close();
    consumed.client.close();
    assert.equal(producer.closed, true);
  } finally {
    await session.close();
  }
});

test("unreliable unordered DataChannel も接続できる", async () => {
  const session = await arrangeInteropSession();
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();

    const unreliable = await send.client.produceData({
      label: "lossy",
      ordered: false,
      maxRetransmits: 0,
    });
    const unordered = await send.client.produceData({
      label: "ttl",
      ordered: false,
      maxPacketLifeTime: 1000,
    });
    await session.waitConnected(send.client);
    const consumedUnreliable = await session.consumeDataProducer(
      recv,
      unreliable.id,
    );
    const consumedTtl = await session.consumeDataProducer(recv, unordered.id);
    await session.waitConnected(recv.client);
    await waitForOpen(unreliable);
    await waitForOpen(consumedUnreliable.client);

    const got = new Promise<string>((resolve) => {
      consumedUnreliable.client.on("message", (data) => resolve(String(data)));
    });
    unreliable.send("u");
    assert.equal(await got, "u");
    assert.equal(consumedTtl.client.label, "ttl");
  } finally {
    await session.close();
  }
});
