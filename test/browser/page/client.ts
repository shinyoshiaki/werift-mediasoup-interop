import { Device, detectDevice } from "mediasoup-client";
import type {
  Consumer,
  DataConsumer,
  DataProducer,
  Producer,
  RtpCapabilities,
  Transport,
} from "mediasoup-client/types";

type ProduceParams = {
  kind: "audio" | "video";
  rtpParameters: unknown;
  appData?: Record<string, unknown>;
};

type ProduceDataParams = {
  sctpStreamParameters: {
    streamId?: number;
    ordered?: boolean;
    maxPacketLifeTime?: number;
    maxRetransmits?: number;
  };
  label?: string;
  protocol?: string;
  appData?: Record<string, unknown>;
};

type TransportOptions = {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
  sctpParameters: unknown;
  iceServers: { urls: string }[];
};

declare global {
  interface Window {
    __nodeConnect: (transportId: string, dtlsParameters: unknown) => Promise<void>;
    __nodeProduce: (
      transportId: string,
      params: ProduceParams,
    ) => Promise<{ id: string }>;
    __nodeProduceData: (
      transportId: string,
      params: ProduceDataParams,
    ) => Promise<{ id: string }>;
    __nodeCloseProducer: (producerId: string) => Promise<void>;
    __nodeCloseDataProducer: (producerId: string) => Promise<void>;
    __mediasoup: BrowserMediasoupApi;
  }
}

class BrowserMediasoupApi {
  device?: Device;
  private readonly transports = new Map<string, Transport>();
  private readonly producers = new Map<string, Producer>();
  private readonly consumers = new Map<string, Consumer>();
  private readonly dataProducers = new Map<string, DataProducer>();
  private readonly dataConsumers = new Map<string, DataConsumer>();
  private readonly inboundMessages = new Map<string, string[]>();
  private readonly localStreams: MediaStream[] = [];

  detect() {
    return detectDevice();
  }

  rtpCapabilities() {
    return this.device?.rtpCapabilities;
  }

  async loadDevice(routerRtpCapabilities: RtpCapabilities) {
    this.device = await Device.factory();
    await this.device.load({ routerRtpCapabilities });
    return {
      handler: detectDevice(),
      handlerName: this.device.handlerName,
      loaded: this.device.loaded,
    };
  }

  async createTransport(direction: "send" | "recv", options: TransportOptions) {
    if (!this.device) {
      throw new Error("device is not loaded");
    }
    const transport =
      direction === "send"
        ? this.device.createSendTransport(options as never)
        : this.device.createRecvTransport(options as never);
    this.transports.set(options.id, transport);
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      window.__nodeConnect(options.id, dtlsParameters).then(callback).catch(errback);
    });
    if (direction === "send") {
      transport.on("produce", (params, callback, errback) => {
        window
          .__nodeProduce(options.id, params as ProduceParams)
          .then(callback)
          .catch(errback);
      });
      transport.on("producedata", (params, callback, errback) => {
        window
          .__nodeProduceData(options.id, params as ProduceDataParams)
          .then(callback)
          .catch(errback);
      });
    }
    return { id: options.id };
  }

  connectionState(transportId: string) {
    return this.transports.get(transportId)?.connectionState ?? "missing";
  }

  transportClosed(transportId: string) {
    return this.transports.get(transportId)?.closed ?? true;
  }

  async produce(transportId: string, kind: "audio" | "video") {
    const transport = this.requireTransport(transportId);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: kind === "audio",
      video: kind === "video",
    });
    this.localStreams.push(stream);
    const track =
      kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
    const producer = await transport.produce({ track });
    this.producers.set(producer.id, producer);
    producer.observer.on("close", () => {
      void window.__nodeCloseProducer(producer.id);
    });
    return {
      id: producer.id,
      kind: producer.kind,
      paused: producer.paused,
    };
  }

  async consume(
    transportId: string,
    options: {
      id: string;
      producerId: string;
      kind: "audio" | "video";
      rtpParameters: unknown;
    },
  ) {
    const transport = this.requireTransport(transportId);
    const consumer = await withTimeout(
      transport.consume(options as never),
      15_000,
      `timed out in browser consume (${options.kind})`,
    );
    this.consumers.set(consumer.id, consumer);
    const elementId = consumer.kind === "video" ? "remote-video" : "remote-audio";
    const mediaEl = document.getElementById(elementId) as
      | HTMLVideoElement
      | HTMLAudioElement
      | null;
    if (mediaEl) {
      mediaEl.srcObject = new MediaStream([consumer.track]);
      void mediaEl.play().catch(() => undefined);
    }
    if (consumer.paused) {
      await consumer.resume();
    }
    return {
      id: consumer.id,
      kind: consumer.kind,
      paused: consumer.paused,
      readyState: consumer.track.readyState,
    };
  }

  async produceData(
    transportId: string,
    options: {
      label?: string;
      protocol?: string;
      ordered?: boolean;
    },
  ) {
    const transport = this.requireTransport(transportId);
    const producer = await transport.produceData(options);
    this.dataProducers.set(producer.id, producer);
    producer.observer.on("close", () => {
      void window.__nodeCloseDataProducer(producer.id);
    });
    await waitChannelOpen(producer);
    return {
      id: producer.id,
      label: producer.label,
      protocol: producer.protocol,
      readyState: producer.readyState,
    };
  }

  async consumeData(
    transportId: string,
    options: {
      id: string;
      dataProducerId: string;
      sctpStreamParameters: unknown;
      label?: string;
      protocol?: string;
    },
  ) {
    const transport = this.requireTransport(transportId);
    const consumer = await transport.consumeData(options as never);
    this.dataConsumers.set(consumer.id, consumer);
    this.inboundMessages.set(consumer.id, []);
    consumer.on("message", (data: unknown) => {
      this.inboundMessages.get(consumer.id)?.push(String(data));
    });
    await waitChannelOpen(consumer);
    return {
      id: consumer.id,
      label: consumer.label,
      protocol: consumer.protocol,
      readyState: consumer.readyState,
    };
  }

  sendData(producerId: string, payload: string) {
    const producer = this.dataProducers.get(producerId);
    if (!producer) {
      throw new Error(`unknown data producer ${producerId}`);
    }
    producer.send(payload);
  }

  takeMessages(consumerId: string) {
    const messages = this.inboundMessages.get(consumerId) ?? [];
    this.inboundMessages.set(consumerId, []);
    return messages;
  }

  dataReadyState(kind: "producer" | "consumer", id: string) {
    const channel =
      kind === "producer"
        ? this.dataProducers.get(id)
        : this.dataConsumers.get(id);
    return channel?.readyState ?? "missing";
  }

  dataClosed(kind: "producer" | "consumer", id: string) {
    const channel =
      kind === "producer"
        ? this.dataProducers.get(id)
        : this.dataConsumers.get(id);
    return channel?.closed ?? true;
  }

  closeData(kind: "producer" | "consumer", id: string) {
    if (kind === "producer") {
      this.dataProducers.get(id)?.close();
      return;
    }
    this.dataConsumers.get(id)?.close();
  }

  async pauseProducer(id: string) {
    await this.producers.get(id)?.pause();
    return this.producers.get(id)?.paused ?? true;
  }

  closeProducer(id: string) {
    this.producers.get(id)?.close();
  }

  producerClosed(id: string) {
    return this.producers.get(id)?.closed ?? true;
  }

  closeTransport(id: string) {
    this.transports.get(id)?.close();
  }

  async inboundPacketsReceived(consumerId: string) {
    const consumer = this.consumers.get(consumerId);
    if (!consumer) {
      throw new Error(`unknown consumer ${consumerId}`);
    }
    const stats = await withTimeout(
      consumer.getStats(),
      5_000,
      `timed out in consumer.getStats(${consumerId})`,
    );
    let packets = 0;
    stats.forEach((stat: { type: string; packetsReceived?: number }) => {
      if (stat.type === "inbound-rtp" && typeof stat.packetsReceived === "number") {
        packets += stat.packetsReceived;
      }
    });
    return packets;
  }

  async waitPacketsReceived(consumerId: string, min: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    let last = 0;
    while (Date.now() < deadline) {
      last = await this.inboundPacketsReceived(consumerId);
      if (last >= min) {
        return last;
      }
      await delay(100);
    }
    throw new Error(
      `timed out waiting for packetsReceived>=${min} (last=${last})`,
    );
  }

  consumerReadyState(consumerId: string) {
    return this.consumers.get(consumerId)?.track.readyState ?? "missing";
  }

  async tryWaitVideoPlay(timeoutMs: number) {
    const video = document.getElementById("remote-video") as HTMLVideoElement | null;
    const canvas = document.getElementById("probe") as HTMLCanvasElement | null;
    if (!video || !canvas) {
      return false;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return false;
    }
    const snapshot = hashFrame(context, video, canvas);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await delay(100);
      if (hashFrame(context, video, canvas) !== snapshot) {
        return true;
      }
    }
    return false;
  }

  closeAll() {
    for (const producer of this.producers.values()) {
      producer.close();
    }
    for (const consumer of this.consumers.values()) {
      consumer.close();
    }
    for (const producer of this.dataProducers.values()) {
      producer.close();
    }
    for (const consumer of this.dataConsumers.values()) {
      consumer.close();
    }
    for (const transport of this.transports.values()) {
      transport.close();
    }
    for (const stream of this.localStreams) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  }

  private requireTransport(id: string) {
    const transport = this.transports.get(id);
    if (!transport) {
      throw new Error(`unknown transport ${id}`);
    }
    return transport;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(message);
    }),
  ]);
}

function waitChannelOpen(
  channel: {
    readyState: string;
    on: (event: "open", listener: () => void) => unknown;
  },
  timeoutMs = 15_000,
) {
  if (channel.readyState === "open") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`timed out waiting for open (state=${channel.readyState})`),
      );
    }, timeoutMs);
    channel.on("open", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function hashFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
) {
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 0;
  for (let index = 0; index < data.length; index += 16) {
    hash = (hash * 33 + data[index]) >>> 0;
  }
  return hash;
}

window.__mediasoup = new BrowserMediasoupApi();
