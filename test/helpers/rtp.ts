import { importWeriftRtp } from "./polyfill.js";

export async function createMarkedRtp(options: {
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  marker: boolean;
  payload: Buffer;
}) {
  const { RtpHeader, RtpPacket } = await importWeriftRtp();
  const Packet = RtpPacket as new (header: unknown, payload: Buffer) => unknown;
  const Header = RtpHeader as new (props?: Record<string, unknown>) => unknown;
  return new Packet(
    new Header({
      version: 2,
      payloadType: 96,
      sequenceNumber: options.sequenceNumber,
      timestamp: options.timestamp,
      ssrc: options.ssrc,
      marker: options.marker,
    }),
    options.payload,
  );
}

export async function sendMarkedRtp(options: {
  track: { writeRtp: (packet: unknown) => void };
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
  marker: boolean;
  payload: Buffer;
}) {
  const packet = await createMarkedRtp(options);
  options.track.writeRtp(packet);
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pumpMarkedRtp(options: {
  track: { writeRtp: (packet: unknown) => void };
  sequenceNumber?: number;
  timestampStep?: number;
  ssrc: number;
  payload: Buffer;
  count?: number;
}) {
  const count = options.count ?? 12;
  for (let index = 0; index < count; index++) {
    await sendMarkedRtp({
      track: options.track,
      sequenceNumber: (options.sequenceNumber ?? 1) + index,
      timestamp: (options.timestampStep ?? 3000) * index,
      ssrc: options.ssrc,
      marker: index % 2 === 1,
      payload: options.payload,
    });
    await delay(20);
  }
}

export function markedPayload(mimeType: string, marker: Buffer) {
  if (/h264/i.test(mimeType)) {
    // mediasoup は NAL type 7 (SPS) をキーフレームとして転送開始する。
    return Buffer.concat([Buffer.from([0x67, 0x42]), marker]);
  }
  if (/vp8/i.test(mimeType)) {
    // RFC 7741: S=1 の descriptor の直後の P=0 がキーフレーム。marker 先頭バイトに依存させない。
    return Buffer.concat([Buffer.from([0x10, 0x00]), marker]);
  }
  return marker;
}

export function waitForRtpHeaders(
  track: {
    onReceiveRtp: {
      subscribe: (
        listener: (rtp: {
          header: {
            sequenceNumber: number;
            timestamp: number;
            ssrc: number;
          };
        }) => void,
      ) => { unSubscribe: () => void };
    };
  },
  count = 2,
  timeoutMs = 15_000,
) {
  return new Promise<
    Array<{ sequenceNumber: number; timestamp: number; ssrc: number }>
  >((resolve, reject) => {
    const received: Array<{
      sequenceNumber: number;
      timestamp: number;
      ssrc: number;
    }> = [];
    const timer = setTimeout(() => {
      unSubscribe();
      reject(
        new Error(
          `timed out waiting for RTP progress (got ${received.length}, seq=${received.map((p) => p.sequenceNumber).join(",")}, ts=${received.map((p) => p.timestamp).join(",")})`,
        ),
      );
    }, timeoutMs);
    const { unSubscribe } = track.onReceiveRtp.subscribe((rtp) => {
      received.push({
        sequenceNumber: rtp.header.sequenceNumber,
        timestamp: rtp.header.timestamp,
        ssrc: rtp.header.ssrc,
      });
      if (received.length < count) {
        return;
      }
      const seqChanged = received.some(
        (packet) => packet.sequenceNumber !== received[0].sequenceNumber,
      );
      const tsChanged = received.some(
        (packet) => packet.timestamp !== received[0].timestamp,
      );
      const ssrcs = new Set(received.map((packet) => packet.ssrc));
      if (seqChanged && tsChanged && ssrcs.size === 1) {
        clearTimeout(timer);
        unSubscribe();
        resolve(received);
      }
    });
  });
}

export function assertRtpHeadersProgress(
  packets: Array<{ sequenceNumber: number; timestamp: number; ssrc: number }>,
) {
  if (packets.length < 2) {
    throw new Error(`expected at least 2 RTP packets, got ${packets.length}`);
  }
  if (!packets.some((packet) => packet.sequenceNumber !== packets[0].sequenceNumber)) {
    throw new Error("RTP sequenceNumber did not change");
  }
  if (!packets.some((packet) => packet.timestamp !== packets[0].timestamp)) {
    throw new Error("RTP timestamp did not change");
  }
  const ssrcs = new Set(packets.map((packet) => packet.ssrc));
  if (ssrcs.size !== 1) {
    throw new Error(`RTP SSRC was not stable: ${[...ssrcs].join(",")}`);
  }
}

export function waitForMarkedRtp(
  track: {
    onReceiveRtp: {
      subscribe: (
        listener: (rtp: {
          header: {
            sequenceNumber: number;
            timestamp: number;
            ssrc: number;
            marker: boolean;
          };
          payload: Buffer;
        }) => void,
      ) => { unSubscribe: () => void };
    };
  },
  marker: Buffer,
  count = 2,
  timeoutMs = 10_000,
) {
  return new Promise<
    Array<{
      sequenceNumber: number;
      timestamp: number;
      ssrc: number;
      marker: boolean;
      payload: Buffer;
    }>
  >((resolve, reject) => {
    const received: Array<{
      sequenceNumber: number;
      timestamp: number;
      ssrc: number;
      marker: boolean;
      payload: Buffer;
    }> = [];
    const timer = setTimeout(() => {
      unSubscribe();
      reject(
        new Error(
          `timed out waiting for ${count} RTP packets with marker (got ${received.length})`,
        ),
      );
    }, timeoutMs);
    const { unSubscribe } = track.onReceiveRtp.subscribe((rtp) => {
      if (rtp.payload.indexOf(marker) === -1) {
        return;
      }
      received.push({
        sequenceNumber: rtp.header.sequenceNumber,
        timestamp: rtp.header.timestamp,
        ssrc: rtp.header.ssrc,
        marker: rtp.header.marker,
        payload: rtp.payload,
      });
      if (received.length >= count) {
        clearTimeout(timer);
        unSubscribe();
        resolve(received);
      }
    });
  });
}
