# AGENTS.md

## Purpose

Instructions for coding agents working in `integration/werift-mediasoup-interop`.

## Scope

* Independent fixture for `mediasoup-client` + werift polyfill on Node.js.
* Imports werift TypeScript source (`packages/webrtc/src/polyfill`) rather than a published npm build.
* `test/small` covers Handler autodetect and Device control flow without a mediasoup worker.
* `test/interop` covers real ICE/DTLS/SRTP/SCTP against a mediasoup worker.

## Do

1. Prefer `npm run test:small` when changing polyfill UA, Device/Handler flow, or Arrange helpers used without a worker.
2. Run `npm test` (or `npm run test:interop`) when changing worker, transport, RTP, or DataChannel interop.
3. Keep Arrange helpers reusable; small-test Arrange lives in `test/small/helpers/client.ts`.
4. Add Japanese comments in Act / Assert phases when operation order or expectations are not obvious.
5. When adding package scripts, update this guide's Commands table in the same change.

## Don't

* Do not pass `handlerName` / `handlerFactory` to `mediasoup-client`.
* Do not add `mediasoup-client` to the parent werift package dependencies; keep it in this fixture.
* Do not spawn a mediasoup worker from `test/small`.

## Commands

| Task | Command |
| --- | --- |
| type-check | `npm run type` |
| small tests (no worker) | `npm run test:small` |
| interop E2E (worker) | `npm run test:interop` |
| all tests | `npm test` |
| source-import smoke | `npm run test:source-import` |

## Validation

* Small / polyfill-only changes: `npm run type` and `npm run test:small`.
* Worker or protocol interop changes: `npm run type` and `npm test`. Repeat `npm test` when changing polyfill/worker sharing or runner isolation.

## Maintenance

* Keep this guide aligned with `package.json` scripts.
* When test directories or isolation flags change, update the Commands and Validation sections together.
