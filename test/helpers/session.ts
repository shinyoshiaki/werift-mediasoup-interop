import { Device, detectDevice } from "mediasoup-client";
import type { Device as MediasoupDevice, Transport } from "mediasoup-client/types";
import type { Router, WebRtcTransport, Worker } from "mediasoup/types";

import { ResourceBag } from "./cleanup.js";
import { arrangeInstalledPolyfill } from "./polyfill.js";
import {
  waitForClientConnected,
  wireConnect,
  wireProduce,
  wireProduceData,
} from "./signaling.js";
import { arrangeServerWebRtcTransport, clientTransportOptions } from "./transport.js";
import { arrangeWorkerRouter } from "./worker.js";

export class InteropSession {
  readonly resources = new ResourceBag();
  device?: MediasoupDevice;
  router?: Router;
  uninstall?: () => void;
  worker?: Worker;

  async start(options?: { userAgent?: string }) {
    const { worker, router } = await arrangeWorkerRouter();
    this.worker = worker;
    this.router = router;
    this.resources.add(() => {
      worker.close();
    });

    const { uninstall } = await arrangeInstalledPolyfill(options);
    this.uninstall = uninstall;
    this.resources.add(() => uninstall());

    this.device = await Device.factory();
    await this.device.load({ routerRtpCapabilities: router.rtpCapabilities });
    return this;
  }

  detectedHandler() {
    return detectDevice();
  }

  async createLinkedSendTransport() {
    return this.createLinkedTransport("send");
  }

  async createLinkedRecvTransport() {
    return this.createLinkedTransport("recv");
  }

  private async createLinkedTransport(direction: "send" | "recv") {
    if (!this.device || !this.router) {
      throw new Error("session is not started");
    }
    const server = await arrangeServerWebRtcTransport(this.router);
    this.resources.add(() => server.close());
    const options = clientTransportOptions(server);
    const client: Transport =
      direction === "send"
        ? this.device.createSendTransport(options)
        : this.device.createRecvTransport(options);
    this.resources.add(() => client.close());
    wireConnect(client, server);
    if (direction === "send") {
      wireProduce(client, server);
      wireProduceData(client, server);
    }
    return { client, server };
  }

  async waitConnected(transport: Transport) {
    await waitForClientConnected(transport);
  }

  async consumeProducer(
    recv: { client: Transport; server: WebRtcTransport },
    producerId: string,
    rtpCapabilities = this.device?.rtpCapabilities,
  ) {
    if (!this.device || !rtpCapabilities) {
      throw new Error("session is not started");
    }
    const serverConsumer = await recv.server.consume({
      producerId,
      rtpCapabilities,
    });
    this.resources.add(() => serverConsumer.close());
    const clientConsumer = await recv.client.consume({
      id: serverConsumer.id,
      producerId,
      kind: serverConsumer.kind,
      rtpParameters: serverConsumer.rtpParameters,
    });
    this.resources.add(() => clientConsumer.close());
    if (serverConsumer.paused) {
      await serverConsumer.resume();
    }
    return { client: clientConsumer, server: serverConsumer };
  }

  async consumeDataProducer(
    recv: { client: Transport; server: WebRtcTransport },
    dataProducerId: string,
  ) {
    const serverConsumer = await recv.server.consumeData({ dataProducerId });
    this.resources.add(() => serverConsumer.close());
    const clientConsumer = await recv.client.consumeData({
      id: serverConsumer.id,
      dataProducerId,
      sctpStreamParameters: serverConsumer.sctpStreamParameters ?? {
        streamId: 0,
        ordered: true,
      },
      label: serverConsumer.label,
      protocol: serverConsumer.protocol,
    });
    this.resources.add(() => clientConsumer.close());
    return { client: clientConsumer, server: serverConsumer };
  }

  async restartIce(pair: { client: Transport; server: WebRtcTransport }) {
    const iceParameters = await pair.server.restartIce();
    await pair.client.restartIce({ iceParameters });
  }

  async createPeerDevice() {
    if (!this.router) {
      throw new Error("session is not started");
    }
    const device = await Device.factory();
    await device.load({ routerRtpCapabilities: this.router.rtpCapabilities });
    return device;
  }

  async createLinkedTransportFor(
    device: MediasoupDevice,
    direction: "send" | "recv",
  ) {
    if (!this.router) {
      throw new Error("session is not started");
    }
    const server = await arrangeServerWebRtcTransport(this.router);
    this.resources.add(() => server.close());
    const options = clientTransportOptions(server);
    const client: Transport =
      direction === "send"
        ? device.createSendTransport(options)
        : device.createRecvTransport(options);
    this.resources.add(() => client.close());
    wireConnect(client, server);
    if (direction === "send") {
      wireProduce(client, server);
      wireProduceData(client, server);
    }
    return { client, server };
  }

  async close() {
    await this.resources.close();
  }
}

export async function arrangeInteropSession(options?: { userAgent?: string }) {
  const session = new InteropSession();
  try {
    await session.start(options);
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

export type { WebRtcTransport };
