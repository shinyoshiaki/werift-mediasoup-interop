import { pathToFileURL } from "node:url";
import path from "node:path";

import { acquireSharedRuntimeLock } from "./lock.js";
import { arrangeWeriftSource } from "./weriftSource.js";
import { resolveWeriftRoot } from "../../src/weriftSource.js";

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
