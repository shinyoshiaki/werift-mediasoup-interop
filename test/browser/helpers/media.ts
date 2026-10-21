import { delay, markedPayload, pumpMarkedRtp } from "../../helpers/rtp.js";
import { arrangeVp8MediaRegister } from "../../helpers/vp8.js";
import type { MediasoupFlavor } from "../../helpers/worker.js";
import { arrangeBrowserInteropSession } from "./session.js";

export const OPUS_COMFORT_NOISE = Buffer.from([0xf8, 0xff, 0xfe]);

export async function pumpWeriftDummyRtp(options: {
  kind: "audio" | "video";
  track: { writeRtp: (packet: unknown) => void };
  ssrc: number;
  count?: number;
}) {
  const payload =
    options.kind === "audio"
      ? OPUS_COMFORT_NOISE
      : markedPayload("video/VP8", Buffer.from([0x00]));
  await pumpMarkedRtp({
    track: options.track,
    ssrc: options.ssrc,
    payload,
    count: options.count ?? 24,
    timestampStep: options.kind === "audio" ? 960 : 3000,
  });
  await delay(50);
}

/**
 * werift polyfill plays the VP8 WebM fixture (`createMp4WebmRegister`, i.e.
 * werift's `Vp8Packetizer`) → mediasoup Router → Chromium `mediasoup-client` consume.
 */
export async function arrangeWeriftVp8WebmToBrowser(options: { flavor?: MediasoupFlavor } = {}) {
  const mediaRegister = await arrangeVp8MediaRegister("webm");
  const { session } = await arrangeBrowserInteropSession({
    flavor: options.flavor,
    mediaRegister,
  });
  try {
    const send = await session.createWeriftSendTransport();
    const recv = await session.createBrowserRecvTransport();
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const [track] = stream.getVideoTracks();
    const producer = await send.client.produce({ track });
    session.resources.add(() => producer.close());
    await session.waitWeriftConnected(send);
    const consumed = await session.consumeOnBrowser(recv, producer.id);
    return { consumed, producer, session };
  } catch (error) {
    await session.close();
    throw error;
  }
}
