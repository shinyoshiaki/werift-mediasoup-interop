import type { RtpCapabilities } from "mediasoup-client/types";

type BrowserMediasoupApi = {
  detect(): string | undefined;
  rtpCapabilities(): RtpCapabilities | undefined;
  loadDevice(routerRtpCapabilities: unknown): Promise<{
    handler: string | undefined;
    handlerName: string;
    loaded: boolean;
  }>;
  createTransport(
    direction: "send" | "recv",
    options: unknown,
  ): Promise<{ id: string }>;
  connectionState(transportId: string): string;
  produce(
    transportId: string,
    kind: "audio" | "video",
  ): Promise<{ id: string; kind: string; paused: boolean }>;
  consume(
    transportId: string,
    options: {
      id: string;
      producerId: string;
      kind: "audio" | "video";
      rtpParameters: unknown;
    },
  ): Promise<{
    id: string;
    kind: string;
    paused: boolean;
    readyState: string;
  }>;
  produceData(
    transportId: string,
    options: { label?: string; protocol?: string; ordered?: boolean },
  ): Promise<{
    id: string;
    label: string;
    protocol: string;
    readyState: string;
  }>;
  consumeData(
    transportId: string,
    options: unknown,
  ): Promise<{
    id: string;
    label: string;
    protocol: string;
    readyState: string;
  }>;
  sendData(producerId: string, payload: string): void;
  takeMessages(consumerId: string): string[];
  closeData(kind: "producer" | "consumer", id: string): void;
  dataClosed(kind: "producer" | "consumer", id: string): boolean;
  dataReadyState(kind: "producer" | "consumer", id: string): string;
  pauseProducer(id: string): Promise<boolean>;
  closeProducer(id: string): void;
  closeTransport(id: string): void;
  waitPacketsReceived(
    consumerId: string,
    min: number,
    timeoutMs: number,
  ): Promise<number>;
  consumerReadyState(consumerId: string): string;
  tryWaitVideoPlay(timeoutMs: number): Promise<boolean>;
};

declare global {
  var window: {
    __mediasoup: BrowserMediasoupApi;
  };
}

export {};
