import type { Page } from "playwright";
import type {
  DataProducer as ServerDataProducer,
  DtlsParameters,
  Producer as ServerProducer,
  Router,
  RtpCapabilities,
  WebRtcTransport,
} from "mediasoup/types";
import type { Device as MediasoupDevice, Transport } from "mediasoup-client/types";

import { delay } from "../../helpers/rtp.js";
import { arrangeInteropSession, InteropSession } from "../../helpers/session.js";
import {
  describeServerTransport,
  waitForClientConnected,
  waitForOpen,
} from "../../helpers/signaling.js";
import {
  arrangeServerWebRtcTransport,
  browserClientTransportOptions,
} from "../../helpers/transport.js";
import { launchChromiumPage, type PlaywrightRuntime } from "./playwright.js";

export type BrowserTransport = {
  id: string;
  server: WebRtcTransport;
};

export class BrowserInteropSession {
  readonly interop: InteropSession;
  runtime?: PlaywrightRuntime;
  page?: Page;
  usedContainerArgs = false;
  firstLaunchError?: unknown;
  private readonly serverById = new Map<string, WebRtcTransport>();
  private readonly serverProducers = new Map<string, ServerProducer>();
  private readonly serverDataProducers = new Map<string, ServerDataProducer>();

  constructor(interop: InteropSession) {
    this.interop = interop;
  }

  get resources() {
    return this.interop.resources;
  }

  get device(): MediasoupDevice | undefined {
    return this.interop.device;
  }

  get router(): Router | undefined {
    return this.interop.router;
  }

  detectedWeriftHandler() {
    return this.interop.detectedHandler();
  }

  async attachBrowser() {
    this.runtime = await launchChromiumPage(this.resources);
    this.page = this.runtime.page;
    this.usedContainerArgs = this.runtime.usedContainerArgs;
    this.firstLaunchError = this.runtime.firstLaunchError;
    await this.page.exposeFunction(
      "__nodeConnect",
      async (transportId: string, dtlsParameters: DtlsParameters) => {
        const server = this.requireServer(transportId);
        await server.connect({ dtlsParameters });
      },
    );
    await this.page.exposeFunction(
      "__nodeProduce",
      async (
        transportId: string,
        params: {
          kind: "audio" | "video";
          rtpParameters: never;
          appData?: Record<string, unknown>;
        },
      ) => {
        const server = this.requireServer(transportId);
        const producer = await server.produce({
          kind: params.kind,
          rtpParameters: params.rtpParameters,
          appData: params.appData,
        });
        this.serverProducers.set(producer.id, producer);
        this.resources.add(() => producer.close());
        return { id: producer.id };
      },
    );
    await this.page.exposeFunction(
      "__nodeProduceData",
      async (
        transportId: string,
        params: {
          sctpStreamParameters: {
            streamId?: number;
            ordered?: boolean;
            maxPacketLifeTime?: number;
            maxRetransmits?: number;
          };
          label?: string;
          protocol?: string;
          appData?: Record<string, unknown>;
        },
      ) => {
        const server = this.requireServer(transportId);
        const producer = await server.produceData({
          sctpStreamParameters: {
            streamId: params.sctpStreamParameters.streamId ?? 0,
            ordered: params.sctpStreamParameters.ordered,
            maxPacketLifeTime: params.sctpStreamParameters.maxPacketLifeTime,
            maxRetransmits: params.sctpStreamParameters.maxRetransmits,
          },
          label: params.label,
          protocol: params.protocol,
          appData: params.appData,
        });
        this.serverDataProducers.set(producer.id, producer);
        this.resources.add(() => producer.close());
        return { id: producer.id };
      },
    );
    await this.page.exposeFunction(
      "__nodeCloseProducer",
      async (producerId: string) => {
        const producer = this.serverProducers.get(producerId);
        if (producer && !producer.closed) {
          producer.close();
        }
      },
    );
    await this.page.exposeFunction(
      "__nodeCloseDataProducer",
      async (producerId: string) => {
        const producer = this.serverDataProducers.get(producerId);
        if (producer && !producer.closed) {
          producer.close();
        }
      },
    );
    this.page.setDefaultTimeout(20_000);
    await this.page.goto(this.runtime.origin, { waitUntil: "domcontentloaded" });
    if (!this.router) {
      throw new Error("session is not started");
    }
    return this.page.evaluate(
      (caps) => window.__mediasoup.loadDevice(caps),
      this.router.rtpCapabilities,
    );
  }

  async detectBrowserHandler() {
    return this.page!.evaluate(() => window.__mediasoup.detect());
  }

  async createWeriftSendTransport() {
    return this.interop.createLinkedSendTransport();
  }

  async createWeriftRecvTransport() {
    return this.interop.createLinkedRecvTransport();
  }

  async createBrowserSendTransport() {
    return this.createBrowserTransport("send");
  }

  async createBrowserRecvTransport() {
    return this.createBrowserTransport("recv");
  }

  private async createBrowserTransport(direction: "send" | "recv") {
    if (!this.router || !this.page) {
      throw new Error("browser session is not started");
    }
    const server = await arrangeServerWebRtcTransport(this.router);
    this.resources.add(() => server.close());
    this.serverById.set(server.id, server);
    const options = browserClientTransportOptions(server);
    await this.page.evaluate(
      async ({ dir, opts }) => {
        await window.__mediasoup.createTransport(dir, opts);
      },
      { dir: direction, opts: options },
    );
    return { id: server.id, server };
  }

  async waitWeriftConnected(pair: { client: Transport; server: WebRtcTransport }) {
    await waitForClientConnected(pair.client, 15_000, pair.server);
  }

  async waitBrowserConnected(transport: BrowserTransport, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let last = "missing";
    while (Date.now() < deadline) {
      last = await this.page!.evaluate(
        (id) => window.__mediasoup.connectionState(id),
        transport.id,
      );
      if (last === "connected") {
        return;
      }
      if (last === "failed") {
        throw new Error(
          `browser transport failed (${describeServerTransport(transport.server)} connectionState=${last})`,
        );
      }
      await delay(50);
    }
    throw new Error(
      `timed out waiting for browser connected (connectionState=${last} ${describeServerTransport(transport.server)})`,
    );
  }

  async produceBrowserMedia(send: BrowserTransport, kind: "audio" | "video") {
    const producer = await this.page!.evaluate(
      async ({ transportId, mediaKind }) => {
        return window.__mediasoup.produce(transportId, mediaKind);
      },
      { transportId: send.id, mediaKind: kind },
    );
    await this.waitBrowserConnected(send);
    return producer;
  }

  async consumeOnWerift(
    recv: { client: Transport; server: WebRtcTransport },
    producerId: string,
  ) {
    const consumed = await this.interop.consumeProducer(recv, producerId);
    await this.waitWeriftConnected(recv);
    return consumed;
  }

  async browserRtpCapabilities() {
    return this.page!.evaluate(() => window.__mediasoup.rtpCapabilities());
  }

  async consumeOnBrowser(recv: BrowserTransport, producerId: string) {
    const rtpCapabilities = (await this.browserRtpCapabilities()) as RtpCapabilities;
    const serverConsumer = await recv.server.consume({
      producerId,
      rtpCapabilities,
    });
    this.resources.add(() => serverConsumer.close());
    const clientConsumer = await Promise.race([
      this.page!.evaluate(
        async ({ transportId, options }) => {
          return window.__mediasoup.consume(transportId, options);
        },
        {
          transportId: recv.id,
          options: {
            id: serverConsumer.id,
            producerId,
            kind: serverConsumer.kind,
            rtpParameters: serverConsumer.rtpParameters,
          },
        },
      ),
      delay(20_000).then(() => {
        throw new Error(
          `timed out in browser consume (${serverConsumer.kind} ${describeServerTransport(recv.server)})`,
        );
      }),
    ]);
    if (serverConsumer.paused) {
      await serverConsumer.resume();
    }
    if (serverConsumer.kind === "video") {
      await serverConsumer.requestKeyFrame();
    }
    await this.waitBrowserConnected(recv);
    return { client: clientConsumer, server: serverConsumer };
  }

  async produceWeriftData(
    send: { client: Transport; server: WebRtcTransport },
    options: { label?: string; protocol?: string; ordered?: boolean } = {},
  ) {
    const pendingServer = new Promise<ServerDataProducer>((resolve) => {
      const onNew = (dataProducer: ServerDataProducer) => {
        send.server.observer.removeListener("newdataproducer", onNew);
        resolve(dataProducer);
      };
      send.server.observer.on("newdataproducer", onNew);
    });
    const producer = await send.client.produceData(options);
    const serverProducer = await pendingServer;
    this.serverDataProducers.set(serverProducer.id, serverProducer);
    this.resources.add(() => producer.close());
    this.resources.add(() => {
      if (!serverProducer.closed) {
        serverProducer.close();
      }
    });
    (
      producer as { observer: { on: (event: "close", listener: () => void) => void } }
    ).observer.on("close", () => {
      if (!serverProducer.closed) {
        serverProducer.close();
      }
    });
    await this.waitWeriftConnected(send);
    await waitForOpen(producer);
    return producer;
  }

  async produceBrowserData(
    send: BrowserTransport,
    options: { label?: string; protocol?: string; ordered?: boolean } = {},
  ) {
    const producer = await this.page!.evaluate(
      async ({ transportId, dataOptions }) => {
        return window.__mediasoup.produceData(transportId, dataOptions);
      },
      { transportId: send.id, dataOptions: options },
    );
    await this.waitBrowserConnected(send);
    return producer;
  }

  async consumeDataOnWerift(
    recv: { client: Transport; server: WebRtcTransport },
    dataProducerId: string,
  ) {
    const consumed = await this.interop.consumeDataProducer(recv, dataProducerId);
    await this.waitWeriftConnected(recv);
    await waitForOpen(consumed.client);
    return consumed;
  }

  async consumeDataOnBrowser(recv: BrowserTransport, dataProducerId: string) {
    const serverConsumer = await recv.server.consumeData({ dataProducerId });
    this.resources.add(() => serverConsumer.close());
    const clientConsumer = await this.page!.evaluate(
      async ({ transportId, options }) => {
        return window.__mediasoup.consumeData(transportId, options);
      },
      {
        transportId: recv.id,
        options: {
          id: serverConsumer.id,
          dataProducerId,
          sctpStreamParameters: serverConsumer.sctpStreamParameters ?? {
            streamId: 0,
            ordered: true,
          },
          label: serverConsumer.label,
          protocol: serverConsumer.protocol,
        },
      },
    );
    await this.waitBrowserConnected(recv);
    return { client: clientConsumer, server: serverConsumer };
  }

  async sendBrowserData(producerId: string, payload: string) {
    await this.page!.evaluate(
      ({ id, message }) => {
        window.__mediasoup.sendData(id, message);
      },
      { id: producerId, message: payload },
    );
  }

  async takeBrowserMessages(consumerId: string) {
    return this.page!.evaluate(
      (id) => window.__mediasoup.takeMessages(id),
      consumerId,
    );
  }

  async waitBrowserMessages(consumerId: string, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const messages = await this.takeBrowserMessages(consumerId);
      if (messages.length > 0) {
        return messages[0];
      }
      await delay(50);
    }
    throw new Error("timed out waiting for browser data channel message");
  }

  async waitBrowserPacketsReceived(
    consumerId: string,
    min: number,
    timeoutMs = 15_000,
  ) {
    return this.page!.evaluate(
      async ({ id, minimum, timeout }) => {
        return window.__mediasoup.waitPacketsReceived(id, minimum, timeout);
      },
      { id: consumerId, minimum: min, timeout: timeoutMs },
    );
  }

  async browserConsumerReadyState(consumerId: string) {
    return this.page!.evaluate(
      (id) => window.__mediasoup.consumerReadyState(id),
      consumerId,
    );
  }

  async tryWaitVideoPlay(timeoutMs = 3_000) {
    return this.page!.evaluate(
      (timeout) => window.__mediasoup.tryWaitVideoPlay(timeout),
      timeoutMs,
    );
  }

  async pauseBrowserProducer(id: string) {
    return this.page!.evaluate(
      (producerId) => window.__mediasoup.pauseProducer(producerId),
      id,
    );
  }

  async closeBrowserProducer(id: string) {
    await this.page!.evaluate(
      (producerId) => window.__mediasoup.closeProducer(producerId),
      id,
    );
  }

  async closeBrowserTransport(id: string) {
    await this.page!.evaluate(
      (transportId) => window.__mediasoup.closeTransport(transportId),
      id,
    );
  }

  async closeBrowserData(kind: "producer" | "consumer", id: string) {
    await this.page!.evaluate(
      ({ channelKind, channelId }) => {
        window.__mediasoup.closeData(channelKind, channelId);
      },
      { channelKind: kind, channelId: id },
    );
  }

  async browserDataClosed(kind: "producer" | "consumer", id: string) {
    return this.page!.evaluate(
      ({ channelKind, channelId }) =>
        window.__mediasoup.dataClosed(channelKind, channelId),
      { channelKind: kind, channelId: id },
    );
  }

  async browserDataReadyState(kind: "producer" | "consumer", id: string) {
    return this.page!.evaluate(
      ({ channelKind, channelId }) =>
        window.__mediasoup.dataReadyState(channelKind, channelId),
      { channelKind: kind, channelId: id },
    );
  }

  async close() {
    await this.interop.close();
  }

  private requireServer(transportId: string) {
    const server = this.serverById.get(transportId);
    if (!server) {
      throw new Error(`unknown browser server transport ${transportId}`);
    }
    return server;
  }
}

export async function arrangeBrowserInteropSession() {
  const interop = await arrangeInteropSession();
  const session = new BrowserInteropSession(interop);
  try {
    const loaded = await session.attachBrowser();
    return { loaded, session };
  } catch (error) {
    await session.close();
    throw error;
  }
}
