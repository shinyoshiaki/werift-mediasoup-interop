interface Navigator {
  mediaDevices: {
    getUserMedia(constraints: {
      audio?: boolean;
      video?: boolean;
    }): Promise<{
      getAudioTracks(): Array<{ writeRtp: (rtp: unknown) => void }>;
      getVideoTracks(): Array<{ writeRtp: (rtp: unknown) => void }>;
    }>;
  };
  userAgent: string;
}

declare var navigator: Navigator;
