import type { Router, WebRtcTransport } from "mediasoup/types";

export async function arrangeServerWebRtcTransport(router: Router) {
  const transport: WebRtcTransport = await router.createWebRtcTransport({
    listenInfos: [
      { protocol: "udp", ip: "127.0.0.1" },
      { protocol: "tcp", ip: "127.0.0.1" },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    enableSctp: true,
  });

  return transport;
}

export function clientTransportOptions(serverTransport: WebRtcTransport) {
  return {
    id: serverTransport.id,
    iceParameters: structuredClone(serverTransport.iceParameters),
    iceCandidates: structuredClone(serverTransport.iceCandidates),
    dtlsParameters: structuredClone(serverTransport.dtlsParameters),
    sctpParameters: structuredClone(serverTransport.sctpParameters),
    iceServers: [] as { urls: string }[],
    additionalSettings: {
      iceAdditionalHostAddresses: ["127.0.0.1"],
      iceServers: [],
      iceUseIpv6: false,
    },
  };
}

export function browserClientTransportOptions(serverTransport: WebRtcTransport) {
  const options = clientTransportOptions(serverTransport);
  return {
    id: options.id,
    iceParameters: options.iceParameters,
    iceCandidates: options.iceCandidates,
    dtlsParameters: options.dtlsParameters,
    sctpParameters: options.sctpParameters,
    iceServers: options.iceServers,
  };
}
