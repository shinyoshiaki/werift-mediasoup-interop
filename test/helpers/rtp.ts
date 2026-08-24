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
        new Error(`timed out waiting for ${count} RTP packets with marker`),
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
