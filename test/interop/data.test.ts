import assert from "node:assert/strict";
import test from "node:test";

import { arrangeInteropSession } from "../helpers/session.js";
import { waitForClose, waitForMessage } from "../helpers/signaling.js";

test("reliable ordered DataProducer/DataConsumer の双方向 message", async () => {
  const session = await arrangeInteropSession();
  try {
    const forward = await session.createLinkedDataPair({
      label: "control",
      protocol: "werift",
      ordered: true,
    });
    const fromServer = await session.createServerToClientData(forward.recv, {
      label: "from-server",
      protocol: "werift",
    });

    // 実行: client→client と server→client の双方へ送り、到着後に close する。
    const forwardReceived = waitForMessage(forward.consumed.client);
    const serverReceived = waitForMessage(fromServer.consumed.client);
    forward.producer.send("hello-data");
    fromServer.producer.send("from-server");
    assert.equal(await forwardReceived, "hello-data");
    assert.equal(await serverReceived, "from-server");

    const closedForwardProducer = waitForClose(forward.producer);
    const closedForwardConsumer = waitForClose(forward.consumed.client);
    const closedServerProducer = waitForClose(fromServer.producer);
    const closedServerConsumer = waitForClose(fromServer.consumed.client);
    forward.producer.close();
    fromServer.producer.close();
    forward.consumed.client.close();
    fromServer.consumed.client.close();
    await closedForwardProducer;
    await closedForwardConsumer;
    await closedServerProducer;
    await closedServerConsumer;

    // 検証: label/protocol・client/server 双方向 payload・close まで完了する。
    assert.equal(forward.producer.label, "control");
    assert.equal(forward.producer.protocol, "werift");
    assert.equal(fromServer.producer.label, "from-server");
    assert.equal(fromServer.consumed.client.label, "from-server");
    assert.equal(forward.producer.closed, true);
    assert.equal(fromServer.producer.closed, true);
    assert.equal(forward.consumed.client.closed, true);
    assert.equal(fromServer.consumed.client.closed, true);
  } finally {
    await session.close();
  }
});

test("unreliable unordered DataChannel も open・送受信・close できる", async () => {
  const session = await arrangeInteropSession();
  try {
    const unreliable = await session.createLinkedDataPair({
      label: "lossy",
      ordered: false,
      maxRetransmits: 0,
    });
    const ttl = await session.createLinkedDataPair({
      label: "ttl",
      protocol: "ttl-proto",
      ordered: false,
      maxPacketLifeTime: 1000,
    });

    // 実行: unreliable と TTL の双方で open 済みチャネルへ送り、到着後に close する。
    const unreliableReceived = waitForMessage(unreliable.consumed.client);
    const ttlReceived = waitForMessage(ttl.consumed.client);
    unreliable.producer.send("u");
    ttl.producer.send("t");
    assert.equal(await unreliableReceived, "u");
    assert.equal(await ttlReceived, "t");

    const closedUnreliableProducer = waitForClose(unreliable.producer);
    const closedUnreliableConsumer = waitForClose(unreliable.consumed.client);
    const closedTtlProducer = waitForClose(ttl.producer);
    const closedTtlConsumer = waitForClose(ttl.consumed.client);
    unreliable.producer.close();
    ttl.producer.close();
    unreliable.consumed.client.close();
    ttl.consumed.client.close();
    await closedUnreliableProducer;
    await closedUnreliableConsumer;
    await closedTtlProducer;
    await closedTtlConsumer;

    // 検証: payload が届き、label/protocol と closed が期待どおり。
    assert.equal(unreliable.consumed.client.label, "lossy");
    assert.equal(ttl.consumed.client.label, "ttl");
    assert.equal(ttl.consumed.client.protocol, "ttl-proto");
    assert.equal(unreliable.producer.closed, true);
    assert.equal(ttl.producer.closed, true);
    assert.equal(unreliable.consumed.client.closed, true);
    assert.equal(ttl.consumed.client.closed, true);
  } finally {
    await session.close();
  }
});
