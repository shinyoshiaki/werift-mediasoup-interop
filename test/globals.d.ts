interface Navigator {
  mediaDevices: {
    getUserMedia(constraints: {
      audio?: boolean;
      video?: boolean;
    }): Promise<{
      getAudioTracks(): MediaStreamTrack[];
      getVideoTracks(): MediaStreamTrack[];
    }>;
  };
  userAgent: string;
}

interface MediaStreamTrack {
  kind: string;
  readyState: string;
  writeRtp: (rtp: unknown) => void;
  onReceiveRtp: unknown;
}

declare var navigator: Navigator;
