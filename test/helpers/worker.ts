import * as mediasoup from "mediasoup";
import * as mediasoupLegacy from "mediasoup-legacy";
import type { Router, RouterRtpCodecCapability, Worker } from "mediasoup/types";

/**
 * - `current`: pinned `mediasoup` (main interop target).
 * - `legacy`: `mediasoup-legacy` (npm alias of mediasoup 3.19.2). Regression target
 *   for the pre-PR #1612 VP8 parser, which drops X=0 payload descriptors and
 *   never detects their keyframes.
 */
export type MediasoupFlavor = "current" | "legacy";

export const LEGACY_MEDIASOUP_VERSION = "3.19.2";

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

type MediasoupModule = Pick<typeof mediasoup, "createWorker" | "version">;

/** Legacy types differ from the pinned ones; the worker API used here is shared. */
export function mediasoupModule(flavor: MediasoupFlavor = "current"): MediasoupModule {
  return flavor === "legacy"
    ? (mediasoupLegacy as unknown as MediasoupModule)
    : mediasoup;
}

export async function arrangeWorkerRouter(options: { flavor?: MediasoupFlavor } = {}) {
  const module = mediasoupModule(options.flavor);
  const worker: Worker = await module.createWorker({ logLevel: "warn" });
  const router: Router = await worker.createRouter({
    mediaCodecs: ROUTER_MEDIA_CODECS,
  });
  return { router, worker, version: module.version };
}
