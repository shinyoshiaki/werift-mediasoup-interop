import { existsSync, readFile } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { ResourceBag } from "../../helpers/cleanup.js";

const PAGE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../page",
);

export const CHROMIUM_LAUNCH_ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--ignore-certificate-errors",
  "--allow-insecure-localhost",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
  "--force-webrtc-ip-handling-policy=default_public_interface_only",
];

export const CONTAINER_LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"];

export type PlaywrightRuntime = {
  browser: Browser;
  context: BrowserContext;
  firstLaunchError?: unknown;
  origin: string;
  page: Page;
  usedContainerArgs: boolean;
};

function resolveSystemChrome() {
  return [
    process.env.CHROME_BIN,
    process.env.GOOGLE_CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((candidate) => candidate && existsSync(candidate));
}

export async function startStaticPageServer() {
  const server = http.createServer((request, response) => {
    const urlPath = request.url?.split("?")[0] ?? "/";
    const relative = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = path.normalize(path.join(PAGE_ROOT, relative));
    if (!filePath.startsWith(PAGE_ROOT)) {
      response.statusCode = 403;
      response.end();
      return;
    }
    readFile(filePath, (error, data) => {
      if (error) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader(
        "Content-Type",
        filePath.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8",
      );
      response.end(data);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
  };
}

export async function launchChromiumPage(
  resources: ResourceBag,
): Promise<PlaywrightRuntime> {
  const { origin, server } = await startStaticPageServer();
  resources.add(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const executablePath = resolveSystemChrome();
  const launchOptions = {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  };

  let usedContainerArgs = false;
  let firstLaunchError: unknown;
  let browser: Browser;
  try {
    browser = await chromium.launch({
      ...launchOptions,
      args: CHROMIUM_LAUNCH_ARGS,
    });
  } catch (error) {
    firstLaunchError = error;
    usedContainerArgs = true;
    browser = await chromium.launch({
      ...launchOptions,
      args: [...CHROMIUM_LAUNCH_ARGS, ...CONTAINER_LAUNCH_ARGS],
    });
  }

  resources.add(() => browser.close());
  const context = await browser.newContext();
  resources.add(() => context.close());
  const page = await context.newPage();
  resources.add(() => page.close());

  return {
    browser,
    context,
    firstLaunchError,
    origin,
    page,
    usedContainerArgs,
  };
}
