import { pathToFileURL } from "node:url";
import path from "node:path";

import { Device, testFakeParameters } from "mediasoup-client";
import type { Transport } from "mediasoup-client/types";

import { arrangeInstalledPolyfill } from "../../helpers/polyfill.js";
import { resolveWeriftRoot } from "../../../src/weriftSource.js";

export async function importWeriftRtcDataChannel() {
  const root = await resolveWeriftRoot();
  const module = await import(
    pathToFileURL(path.join(root, "packages/webrtc/src/dataChannel.ts")).href
  );
  return module.RTCDataChannel as new (...args: never[]) => object;
}

export async function arrangeMediasoupPolyfill(options?: { userAgent?: string }) {
  return arrangeInstalledPolyfill(options);
}

export async function arrangeLoadedDevice(options?: { userAgent?: string }) {
  const installed = await arrangeMediasoupPolyfill(options);
  try {
    const device = await Device.factory();
    await device.load({
      routerRtpCapabilities: structuredClone(
        testFakeParameters.generateRouterRtpCapabilities(),
      ),
    });
    return {
      device,
      MediaStreamTrack: installed.MediaStreamTrack,
      uninstall: installed.uninstall,
    };
  } catch (error) {
    installed.uninstall();
    throw error;
  }
}

export function cloneTransportRemoteParameters() {
  return structuredClone(testFakeParameters.generateTransportRemoteParameters());
}

export function wireFakeSendTransport(transport: Transport) {
  transport.on("connect", (_params, callback) => {
    callback();
  });
  transport.on("produce", (_params, callback) => {
    callback({ id: testFakeParameters.generateProducerRemoteParameters().id });
  });
  transport.on("producedata", (_params, callback) => {
    callback({
      id: testFakeParameters.generateDataProducerRemoteParameters().id,
    });
  });
}

export function arrangeFakeConsumerOptions(codecMimeType: string) {
  return structuredClone(
    testFakeParameters.generateConsumerRemoteParameters({ codecMimeType }),
  );
}

export type AutodetectedDevice = Awaited<ReturnType<typeof Device.factory>>;
