import assert from "node:assert/strict";
import test from "node:test";

import { Device, detectDevice } from "mediasoup-client";

import {
  type AutodetectedDevice,
  arrangeFakeConsumerOptions,
  arrangeLoadedDevice,
  arrangeMediasoupPolyfill,
  cloneTransportRemoteParameters,
  importWeriftRtcDataChannel,
  wireFakeSendTransport,
} from "./helpers/client.js";

test("detectDevice と Device.factory が handlerName なしで Chrome111 になる", async () => {
  const { uninstall } = await arrangeMediasoupPolyfill();
  try {
    // 実行: Handler 引数なしで検出と factory を呼ぶ。
    const handler = detectDevice();
    const device = await Device.factory();

    // 検証: Chrome111 が選ばれ、User-Agent が Chromium 111 互換になる。
    assert.equal(handler, "Chrome111");
    assert.equal(device.handlerName, "Chrome111");
    assert.match(navigator.userAgent, /Chrome\/111\.0\.0\.0/);
  } finally {
    uninstall();
  }
});

test("Device.load が RTP capabilities と canProduce を返す", async () => {
  const { device, uninstall } = await arrangeLoadedDevice();
  try {
    // 実行: fake Router capabilities で load 済み Device を読む。
    const recv = device.rtpCapabilities;
    const typedDevice: AutodetectedDevice = device;

    // 検証: audio/video を送れ、recv capabilities が得られる。
    assert.equal(typedDevice.loaded, true);
    assert.ok((recv.codecs?.length ?? 0) > 0);
    assert.equal(device.canProduce("audio"), true);
    assert.equal(device.canProduce("video"), true);
  } finally {
    uninstall();
  }
});

test("produce が werift track で connect/produce callback を完了する", async () => {
  const { device, MediaStreamTrack, uninstall } = await arrangeLoadedDevice();
  const sendTransport = device.createSendTransport(
    cloneTransportRemoteParameters(),
  );
  wireFakeSendTransport(sendTransport);
  try {
    // 実行: getUserMedia の audio track を produce する。
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const [track] = stream.getAudioTracks();
    const producer = await sendTransport.produce({ track });

    // 検証: SDP 交渉と produce callback が完了し、werift track を保持する。
    assert.equal(producer.closed, false);
    assert.equal(producer.kind, "audio");
    assert.ok(track instanceof MediaStreamTrack);
    assert.equal(typeof producer.rtpParameters.mid, "string");
    producer.close();
  } finally {
    sendTransport.close();
    uninstall();
  }
});

test("consume が live な werift MediaStreamTrack を返す", async () => {
  const { device, MediaStreamTrack, uninstall } = await arrangeLoadedDevice();
  const recvTransport = device.createRecvTransport(
    cloneTransportRemoteParameters(),
  );
  recvTransport.on("connect", (_params, callback) => {
    callback();
  });
  try {
    // 実行: fake Consumer パラメーターで consume する。
    const consumer = await recvTransport.consume(
      arrangeFakeConsumerOptions("audio/opus"),
    );
    const track = consumer.track;

    // 検証: 返却 track は werift 実装で readyState / writeRtp / onReceiveRtp を持つ。
    assert.ok(track instanceof MediaStreamTrack);
    assert.equal(track.readyState, "live");
    assert.equal(typeof track.writeRtp, "function");
    assert.ok(track.onReceiveRtp);
    consumer.close();
  } finally {
    recvTransport.close();
    uninstall();
  }
});

test("produceData が werift RTCDataChannel を保持する", async () => {
  const { device, uninstall } = await arrangeLoadedDevice();
  const RTCDataChannel = await importWeriftRtcDataChannel();
  const sendTransport = device.createSendTransport(
    cloneTransportRemoteParameters(),
  );
  wireFakeSendTransport(sendTransport);
  try {
    // 実行: SCTP 付き send Transport で produceData する。
    const dataProducer = await sendTransport.produceData({
      label: "werift",
      protocol: "control",
      ordered: true,
    });

    // 検証: DataProducer が werift DataChannel を保持する。
    assert.equal(dataProducer.closed, false);
    assert.equal(dataProducer.label, "werift");
    assert.equal(dataProducer.protocol, "control");
    assert.ok(
      (dataProducer as unknown as { _dataChannel?: unknown })._dataChannel instanceof
        RTCDataChannel,
    );
    dataProducer.close();
  } finally {
    sendTransport.close();
    uninstall();
  }
});

test("close と uninstall が未処理 rejection を残さない", async () => {
  const { device, uninstall } = await arrangeLoadedDevice();
  const sendTransport = device.createSendTransport(
    cloneTransportRemoteParameters(),
  );
  wireFakeSendTransport(sendTransport);
  const recvTransport = device.createRecvTransport(
    cloneTransportRemoteParameters(),
  );
  recvTransport.on("connect", (_params, callback) => {
    callback();
  });

  // 実行: Transport を閉じ、polyfill を外す。
  sendTransport.close();
  recvTransport.close();
  uninstall();

  // 検証: 未処理 rejection を残さない（この後の tick で落ちない）。
  await Promise.resolve();
  assert.equal(sendTransport.closed, true);
  assert.equal(recvTransport.closed, true);
});
