import { pathToFileURL } from "node:url";
import path from "node:path";

import { acquireSharedRuntimeLock } from "./lock.js";
import { arrangeWeriftSource } from "./weriftSource.js";
import {
  importWeriftCodecs,
  resolveWeriftRoot,
} from "../../src/weriftSource.js";

export type WeriftPolyfillModule = {
  installPolyfill: (options: {
    mediaRegister: unknown[];
    userAgent?: string;
  }) => () => void;
  createCallbackRegister: (options: {
    mimeType: string;
    kinds: Array<"audio" | "video">;
    createTracks: () => Promise<unknown[]>;
  }) => unknown;
};

export async function installPolyfillUnlocked(options?: { userAgent?: string }) {
  const { polyfill } = await arrangeWeriftSource();
  const module = polyfill as WeriftPolyfillModule;
  const MediaStreamTrack = await importWeriftMediaStreamTrack();
  const uninstall = module.installPolyfill({
    userAgent: options?.userAgent,
    mediaRegister: [
      module.createCallbackRegister({
        mimeType: "audio/opus",
        kinds: ["audio"],
        async createTracks() {
          return [new MediaStreamTrack({ kind: "audio" })];
        },
      }),
      module.createCallbackRegister({
        mimeType: "video/VP8",
        kinds: ["video"],
        async createTracks() {
          return [new MediaStreamTrack({ kind: "video" })];
        },
      }),
      module.createCallbackRegister({
        mimeType: "video/H264",
        kinds: ["video"],
        async createTracks() {
          return [new MediaStreamTrack({ kind: "video" })];
        },
      }),
    ],
  });

  return { MediaStreamTrack, uninstall };
}

type PeerConnectionConfig = {
  codecs?: {
    video?: unknown[];
    [key: string]: unknown;
  };
  headerExtensions?: {
    video?: unknown[];
    [key: string]: unknown;
  };
  pendingRtp?: boolean | { enabled?: boolean; maxLength?: number };
  [key: string]: unknown;
};

type PeerConnectionConstructor = new (
  config?: PeerConnectionConfig,
) => object;

/**
 * Add H264 to the native capability probe used by mediasoup-client.
 *
 * The werift default PeerConnection intentionally advertises VP8 only until a
 * sender track selects another codec. mediasoup-client probes an empty
 * PeerConnection, so this fixture-local wrapper keeps H264 interop coverage
 * without changing the public default codec list.
 */
export async function installInteropPeerConnection() {
  const target = globalThis as unknown as {
    RTCPeerConnection?: PeerConnectionConstructor;
  };
  const original = target.RTCPeerConnection;
  if (!original) {
    throw new Error("RTCPeerConnection is not installed");
  }

  const codecs = await importWeriftCodecs();
  const useOPUS = codecs.useOPUS as () => unknown;
  const usePCMU = codecs.usePCMU as () => unknown;
  const useH264 = codecs.useH264 as () => unknown;
  const useVP8 = codecs.useVP8 as () => unknown;
  const rtpStreamIdUri = "urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id";

  const isH264 = (codec: unknown) =>
    typeof codec === "object" &&
    codec !== null &&
    "mimeType" in codec &&
    typeof codec.mimeType === "string" &&
    codec.mimeType.toLowerCase() === "video/h264";

  class InteropPeerConnection extends original {
    constructor(config: PeerConnectionConfig = {}) {
      const configuredCodecs = config.codecs ?? {};
      const configuredAudio = Array.isArray(configuredCodecs.audio)
        ? [...configuredCodecs.audio]
        : [useOPUS(), usePCMU()];
      const configuredVideo = Array.isArray(configuredCodecs.video)
        ? [...configuredCodecs.video]
        : [useVP8()];
      const video = configuredVideo.some(isH264)
        ? configuredVideo
        : [...configuredVideo, useH264()];
      const configuredHeaderExtensions = config.headerExtensions ?? {};
      const configuredVideoHeaderExtensions = Array.isArray(
        configuredHeaderExtensions.video,
      )
        ? [...configuredHeaderExtensions.video]
        : [];
      if (
        !configuredVideoHeaderExtensions.some(
          (extension) =>
            typeof extension === "object" &&
            extension !== null &&
            "uri" in extension &&
            extension.uri === rtpStreamIdUri,
        )
      ) {
        configuredVideoHeaderExtensions.push({ uri: rtpStreamIdUri });
      }

      super({
        ...config,
        pendingRtp: config.pendingRtp ?? true,
        codecs: {
          ...configuredCodecs,
          audio: configuredAudio,
          video,
        },
        headerExtensions: {
          ...configuredHeaderExtensions,
          video: configuredVideoHeaderExtensions,
        },
      });
    }
  }

  target.RTCPeerConnection = InteropPeerConnection;
  return () => {
    if (target.RTCPeerConnection === InteropPeerConnection) {
      target.RTCPeerConnection = original;
    }
  };
}

export async function arrangeInstalledPolyfill(options?: { userAgent?: string }) {
  const release = await acquireSharedRuntimeLock();
  try {
    const installed = await installPolyfillUnlocked(options);
    return {
      MediaStreamTrack: installed.MediaStreamTrack,
      uninstall() {
        try {
          installed.uninstall();
        } finally {
          release();
        }
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}

export async function importWeriftMediaStreamTrack() {
  const root = await resolveWeriftRoot();
  const media = await import(
    pathToFileURL(path.join(root, "packages/webrtc/src/media/track.ts")).href
  );
  return media.MediaStreamTrack as new (props: { kind: "audio" | "video" }) => {
    kind: string;
    readyState: string;
    writeRtp: (rtp: unknown) => void;
    onReceiveRtp: { subscribe: (listener: (rtp: { header: unknown; payload: Buffer }) => void) => { unSubscribe: () => void } };
  };
}

export async function importWeriftRtp() {
  const root = await resolveWeriftRoot();
  return import(
    pathToFileURL(path.join(root, "packages/rtp/src/rtp/rtp.ts")).href
  ) as Promise<{
    RtpHeader: new (props?: Record<string, unknown>) => unknown;
    RtpPacket: new (
      header: unknown,
      payload: Buffer,
    ) => unknown;
  }>;
}
