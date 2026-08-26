import { delay, markedPayload, pumpMarkedRtp } from "../../helpers/rtp.js";

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
