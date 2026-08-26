# AGENTS.md

## Purpose

Instructions for coding agents working in `integration/werift-mediasoup-interop`.

## Scope

* Independent fixture for `mediasoup-client` + werift polyfill on Node.js.
* Imports werift TypeScript source (`packages/webrtc/src/polyfill`) rather than a published npm build.
* `test/small` covers Handler autodetect and Device control flow without a mediasoup worker.
* `test/interop` covers real ICE/DTLS/SRTP/SCTP against a mediasoup worker (werift polyfill clients).
* `test/browser` covers Playwright Chromium `mediasoup-client` ↔ mediasoup worker/router ↔ werift polyfill. Chromium is required.

## Do

1. Prefer `npm run test:small` when changing polyfill UA, Device/Handler flow, or Arrange helpers used without a worker.
2. Run `npm test` (or `npm run test:interop`) when changing worker, transport, RTP, or DataChannel interop between werift clients.
3. Run `npm run install:browsers` then `npm run test:browser` when changing Playwright launch, browser page RPC, or Chrome↔werift media/data paths.
4. Keep Arrange helpers reusable; small-test Arrange lives in `test/small/helpers/client.ts`. Browser Arrange lives in `test/browser/helpers`.
5. Add Japanese comments in Act / Assert phases when operation order or expectations are not obvious.
6. When adding package scripts, update this guide's Commands table in the same change.

## Don't

* Do not pass `handlerName` / `handlerFactory` to `mediasoup-client`.
* Do not add `mediasoup-client` to the parent werift package dependencies; keep it in this fixture.
* Do not spawn a mediasoup worker from `test/small`.
* Do not call `installPolyfill` in the browser page.
* Do not include `test/browser` in `npm test`; Chromium is opt-in via `test:browser`.

## Commands

| Task | Command |
| --- | --- |
| type-check | `npm run type` |
| small tests (no worker) | `npm run test:small` |
| interop E2E (worker, no Chromium) | `npm run test:interop` |
| small + interop | `npm test` |
| install Chromium | `npm run install:browsers` |
| Playwright Chromium ↔ werift | `npm run test:browser` |
| source-import smoke | `npm run test:source-import` |

## Validation

* Small / polyfill-only changes: `npm run type` and `npm run test:small`.
* Worker or protocol interop changes: `npm run type` and `npm test`. Repeat `npm test` when changing polyfill/worker sharing or runner isolation.
* Browser interop changes: `npm run type`, `npm run install:browsers`, and `npm run test:browser`.

## Maintenance

* Keep this guide aligned with `package.json` scripts.
* When test directories or isolation flags change, update the Commands and Validation sections together.
