import * as mediasoup from "mediasoup";
import type { Router, RouterRtpCodecCapability, Worker } from "mediasoup/types";

export const ROUTER_MEDIA_CODECS: RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
    },
  },
];

export async function arrangeWorkerRouter() {
  const worker: Worker = await mediasoup.createWorker({ logLevel: "warn" });
  const router: Router = await worker.createRouter({
    mediaCodecs: ROUTER_MEDIA_CODECS,
  });
  return { router, worker };
}
