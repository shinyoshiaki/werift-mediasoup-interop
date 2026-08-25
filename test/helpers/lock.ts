// Serializes polyfill/navigator and mediasoup worker use in one process.
// acquire once per session or standalone polyfill; do not nest with arrangeInstalledPolyfill.
let tail = Promise.resolve();

export async function acquireSharedRuntimeLock(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = tail;
  tail = next;
  await previous;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    release();
  };
}
