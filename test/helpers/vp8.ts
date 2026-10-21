import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Producer, WebRtcTransport } from "mediasoup/types";

import { resolveWeriftRoot } from "../../src/weriftSource.js";
import type { MediaRegisterFactory } from "./polyfill.js";
import { arrangeInteropSession } from "./session.js";
import type { MediasoupFlavor } from "./worker.js";

/** werift VP8 send paths exercised against mediasoup. */
export type WeriftVp8Source = "dummy" | "webm";

/** VP8 + Opus WebM fixture in the werift checkout (160x120, keyframes every 1 s, 1.2 s loop). */
export async function resolveVp8WebmFixturePath() {
  const root = await resolveWeriftRoot();
  return path.join(
    root,
    "packages/webrtc/tests/data/nonstandard/userMedia-e2e/vp8-opus.webm",
  );
}

/**
 * Polyfill `mediaRegister` that sends werift's own VP8 RTP:
 * - `dummy`: `createDummyRegister()` (dummy media, keyframe every 30 frames)
 * - `webm`: `createMp4WebmRegister()` (file playback via `Vp8Packetizer`)
 */
export async function arrangeVp8MediaRegister(
  source: WeriftVp8Source,
): Promise<MediaRegisterFactory> {
  if (source === "dummy") {
    return (module) => [module.createDummyRegister()];
  }
  const fixturePath = await resolveVp8WebmFixturePath();
  return (module) => [module.createMp4WebmRegister({ path: fixturePath, loop: true })];
}

type Vp8RtpPayload = {
  xBit: number;
  sBit: number;
  pid: number;
  iBit?: number;
  lBit?: number;
  tBit?: number;
  kBit?: number;
  mBit?: number;
  pictureId?: number;
};

type WeriftRtpCodecs = {
  Vp8RtpPayload: { deSerialize(buf: Buffer): Vp8RtpPayload };
  dePacketizeRtpPackets(
    codec: string,
    packets: Array<{ header: ReceivedRtp["header"]; payload: Buffer }>,
  ): { isKeyframe: boolean; data: Buffer };
};

/** Import werift's VP8 depacketizer from the parent source checkout. */
export async function importWeriftRtpCodecs() {
  const root = await resolveWeriftRoot();
  return (await import(
    pathToFileURL(path.join(root, "packages/rtp/src/codec/index.ts")).href
  )) as WeriftRtpCodecs;
}

export type ReceivedRtp = {
  header: {
    sequenceNumber: number;
    timestamp: number;
    ssrc: number;
    marker: boolean;
    payloadType: number;
  };
  payload: Buffer;
};

type RtpTrack = {
  onReceiveRtp: {
    subscribe: (listener: (rtp: ReceivedRtp) => void) => { unSubscribe: () => void };
  };
};

/** Collect RTP from a werift consumer track until `count` packets arrive. */
export function collectRtp(track: unknown, count: number, timeoutMs = 15_000) {
  const rtpTrack = track as RtpTrack;
  return new Promise<ReceivedRtp[]>((resolve, reject) => {
    const received: ReceivedRtp[] = [];
    const timer = setTimeout(() => {
      unSubscribe();
      reject(
        new Error(`timed out waiting for ${count} RTP packets (got ${received.length})`),
      );
    }, timeoutMs);
    const { unSubscribe } = rtpTrack.onReceiveRtp.subscribe((rtp) => {
      received.push({
        header: { ...rtp.header },
        payload: Buffer.from(rtp.payload),
      });
      if (received.length >= count) {
        clearTimeout(timer);
        unSubscribe();
        resolve(received);
      }
    });
  });
}

/** Count RTP received on a werift consumer track during `durationMs`. */
export async function countRtpDuring(
  track: unknown,
  durationMs: number,
  act: () => Promise<void> = async () => {},
) {
  const rtpTrack = track as RtpTrack;
  let count = 0;
  const { unSubscribe } = rtpTrack.onReceiveRtp.subscribe(() => {
    count++;
  });
  try {
    await Promise.all([act(), new Promise((resolve) => setTimeout(resolve, durationMs))]);
    return count;
  } finally {
    unSubscribe();
  }
}

/** Resolve the server Producer created by the next client `produce()`. */
export function waitServerProducer(server: WebRtcTransport) {
  return new Promise<Producer>((resolve) => {
    server.observer.once("newproducer", resolve);
  });
}

/**
 * Assert every packet carries the browser-equivalent descriptor
 * (X=1, I=1, M=1, L=T=K=0) and PictureID is shared within a frame and
 * advances by 1 (15-bit wrap) between consecutive frames.
 */
export function assertVp8PictureIdDescriptors(
  codecs: WeriftRtpCodecs,
  packets: ReceivedRtp[],
) {
  assert.ok(packets.length > 0, "no RTP packets to verify");
  const parsed = packets.map((packet) => ({
    packet,
    vp8: codecs.Vp8RtpPayload.deSerialize(packet.payload),
  }));
  for (const [index, { packet, vp8 }] of parsed.entries()) {
    const at = `packet#${index} seq=${packet.header.sequenceNumber} head=${packet.payload.subarray(0, 4).toString("hex")}`;
    assert.equal(vp8.xBit, 1, `X bit (${at})`);
    assert.equal(vp8.iBit, 1, `I bit (${at})`);
    assert.equal(vp8.mBit, 1, `M bit (${at})`);
    assert.equal(vp8.lBit, 0, `L bit (${at})`);
    assert.equal(vp8.tBit, 0, `T bit (${at})`);
    assert.equal(vp8.kBit, 0, `K bit (${at})`);
    assert.equal(typeof vp8.pictureId, "number", `PictureID (${at})`);
  }

  const frames = splitFrames(parsed);
  for (const [index, frame] of frames.entries()) {
    const ids = new Set(frame.map(({ vp8 }) => vp8.pictureId));
    assert.equal(ids.size, 1, `frame#${index} has mixed PictureIDs: ${[...ids].join(",")}`);
    if (index === 0) {
      continue;
    }
    const previous = frames[index - 1][0].vp8.pictureId!;
    assert.equal(
      frame[0].vp8.pictureId,
      (previous + 1) & 0x7fff,
      `PictureID must advance by 1 between frame#${index - 1} and frame#${index}`,
    );
  }
  return { frames: frames.length };
}

/** Depacketize complete frames (S=1 ... marker) and report whether a keyframe arrived. */
export function hasDepacketizedKeyframe(codecs: WeriftRtpCodecs, packets: ReceivedRtp[]) {
  const parsed = packets.map((packet) => ({
    packet,
    vp8: codecs.Vp8RtpPayload.deSerialize(packet.payload),
  }));
  return splitFrames(parsed).some((frame) => {
    const last = frame.at(-1)!;
    if (frame[0].vp8.sBit !== 1 || !last.packet.header.marker) {
      return false;
    }
    return codecs.dePacketizeRtpPackets(
      "VP8",
      frame.map(({ packet }) => packet),
    ).isKeyframe;
  });
}

function splitFrames<T extends { packet: ReceivedRtp }>(packets: T[]) {
  const frames: T[][] = [];
  for (const entry of packets) {
    const current = frames.at(-1);
    if (current && current[0].packet.header.timestamp === entry.packet.header.timestamp) {
      current.push(entry);
    } else {
      frames.push([entry]);
    }
  }
  return frames;
}

export type Vp8ConsumerMode = "simple" | "simulcast";

/** Same 3x L1T1 encodings as the existing simulcast interop case. */
const SIMULCAST_ENCODINGS = [
  { maxBitrate: 100_000, scalabilityMode: "L1T1" },
  { maxBitrate: 300_000, scalabilityMode: "L1T1" },
  { maxBitrate: 900_000, scalabilityMode: "L1T1" },
];

/**
 * werift polyfill (`mediaRegister`) → produce VP8 → mediasoup Router → werift consume.
 * No synthetic `writeRtp`: RTP comes from werift's dummy media / packetizer.
 * `simulcast` produces 3 encodings and consumes spatial layer 0 (SimulcastConsumer).
 */
export async function arrangeVp8Pipeline(options: {
  flavor?: MediasoupFlavor;
  mediaRegister?: MediaRegisterFactory;
  consumer?: Vp8ConsumerMode;
}) {
  const session = await arrangeInteropSession({
    flavor: options.flavor,
    mediaRegister: options.mediaRegister,
  });
  try {
    const send = await session.createLinkedSendTransport();
    const recv = await session.createLinkedRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const [track] = stream.getVideoTracks();
    const simulcast = options.consumer === "simulcast";
    const pendingServerProducer = waitServerProducer(send.server);
    const producer = await send.client.produce({
      track,
      ...(simulcast ? { encodings: SIMULCAST_ENCODINGS } : {}),
    });
    session.resources.add(() => producer.close());
    const serverProducer = await pendingServerProducer;
    await session.waitConnected(send);
    const consumed = await session.consumeProducer(
      recv,
      producer.id,
      undefined,
      simulcast ? { spatialLayer: 0 } : undefined,
    );
    await session.waitConnected(recv);
    if (simulcast) {
      await consumed.server.setPreferredLayers({ spatialLayer: 0, temporalLayer: 0 });
      await consumed.server.requestKeyFrame();
    }
    return { consumed, producer, recv, send, serverProducer, session, track };
  } catch (error) {
    await session.close();
    throw error;
  }
}
