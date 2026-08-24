import { importWeriftPolyfill, resolveWeriftRoot } from "../../src/weriftSource.js";

export async function arrangeWeriftSource() {
  const root = await resolveWeriftRoot();
  const polyfill = await importWeriftPolyfill();

  return { polyfill, root };
}

