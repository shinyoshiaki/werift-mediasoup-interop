import type { Transport } from "mediasoup-client/types";
import type { WebRtcTransport } from "mediasoup/types";

export function wireConnect(
  clientTransport: Transport,
  serverTransport: WebRtcTransport,
) {
  clientTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    serverTransport.connect({ dtlsParameters }).then(callback).catch(errback);
  });
}

export function wireProduce(
  clientTransport: Transport,
  serverTransport: WebRtcTransport,
) {
  clientTransport.on(
    "produce",
    ({ kind, rtpParameters, appData }, callback, errback) => {
      serverTransport
        .produce({ kind, rtpParameters, appData })
        .then((producer) => callback({ id: producer.id }))
        .catch(errback);
    },
  );
}

export function wireProduceData(
  clientTransport: Transport,
  serverTransport: WebRtcTransport,
) {
  clientTransport.on(
    "producedata",
    ({ sctpStreamParameters, label, protocol, appData }, callback, errback) => {
      serverTransport
        .produceData({
          sctpStreamParameters: {
            streamId: sctpStreamParameters.streamId ?? 0,
            ordered: sctpStreamParameters.ordered,
            maxPacketLifeTime: sctpStreamParameters.maxPacketLifeTime,
            maxRetransmits: sctpStreamParameters.maxRetransmits,
          },
          label,
          protocol,
          appData,
        })
        .then((producer) => callback({ id: producer.id }))
        .catch(errback);
    },
  );
}

export function waitForOpen(
  emitter: {
    readyState?: string;
    on: (event: any, listener: any) => unknown;
    off?: (event: any, listener: any) => unknown;
  },
  timeoutMs = 15_000,
) {
  if (emitter.readyState === "open") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off?.("open", onOpen);
      reject(
        new Error(`timed out waiting for open (state=${emitter.readyState})`),
      );
    }, timeoutMs);
    const onOpen = () => {
      clearTimeout(timer);
      emitter.off?.("open", onOpen);
      resolve();
    };
    emitter.on("open", onOpen);
  });
}

export function waitForClientConnected(
  transport: Transport,
  timeoutMs = 15_000,
) {
  if (transport.connectionState === "connected") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      transport.removeListener("connectionstatechange", onChange);
      reject(
        new Error(
          `timed out waiting for connected (state=${transport.connectionState})`,
        ),
      );
    }, timeoutMs);
    const onChange = () => {
      if (transport.connectionState === "connected") {
        clearTimeout(timer);
        transport.removeListener("connectionstatechange", onChange);
        resolve();
      }
      if (transport.connectionState === "failed") {
        clearTimeout(timer);
        transport.removeListener("connectionstatechange", onChange);
        reject(new Error("transport connection failed"));
      }
    };
    transport.on("connectionstatechange", onChange);
  });
}
