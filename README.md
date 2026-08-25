# werift-mediasoup-interop

`mediasoup-client` + werift polyfill と実 `mediasoup` server の Node.js 相互接続を検証する独立 fixture です。
werift の npm package や build output ではなく、親 checkout の
`packages/webrtc/src/polyfill/index.ts` を `tsx` で直接 import します。

`mediasoup-client` には `handlerName` / `handlerFactory` を渡しません。各 E2E は
`installPolyfill({ mediaRegister, userAgent? })` を Arrange し、`finally` で uninstall します。

## Checkout layouts

次の順で werift source root を解決します。

1. `WERIFT_REPO_ROOT`
2. この repository が `integration/werift-mediasoup-interop` submodule の場合の親 checkout
3. IDE project が `werift-webrtc` と同じ directory にある場合の sibling checkout

```bash
npm ci
npm run type
npm run test:small
npm test
```

`npm run test:small` は mediasoup worker を起動せず、`mediasoup-client` の Handler 自動選択と Device 制御フローだけを検証します。実 worker の ICE/DTLS/RTP/DataChannel は `npm test` または `npm run test:interop` です。

Pinned CI は Node 22 / 24 で `mediasoup@3.26.0` と `mediasoup-client@3.22.0` を使います。
最新版 compatibility probe は定期ジョブで、失敗しても本体の必須 CI は壊しません。

## Interop matrix

相互接続テストは Arrange helper を `test/helpers` の単一責務ファイル群へ集約し、各ケースの
Act / Assert には日本語コメントを付けます。実 server を起動するテストでは worker、transport、
producer、consumer、polyfill を `finally` で確実に close / uninstall します。

| Area | Cases |
| --- | --- |
| small | worker なしの `detectDevice()` / `Device.factory()` / `load()` / produce / consume / produceData |
| bootstrap | 実 worker 上の Handler 自動選択、明示 User-Agent、uninstall 復元 |
| capabilities | Router RTP capabilities、audio/video `canProduce()`、unsupported codec rejection |
| transport | send/recv WebRtcTransport、ICE/DTLS connect、ICE restart、close/failure propagation |
| audio | Opus produce/consume、pause/resume、replaceTrack、producer/consumer close、RTP/RTCP 往復 |
| video | VP8/H264 produce/consume、simulcast、preferred layers、key-frame request、track replacement |
| data | reliable/unreliable DataProducer/DataConsumer、ordered/unordered、label/protocol、bidirectional messages |
| lifecycle | multiple transports/producers/consumers、server-first/client-first close、reconnect、open-handle check |
| compatibility | Node 22/24、pinned versions、current mediasoup-client compatibility probe |

OS camera/microphone や codec encode/decode 自体は対象外です。決定的な synthetic RTP source/sink を使い、
シグナリングと実 mediasoup worker を通る protocol interoperability を対象にします。
Native Windows は対象外です。listen port は OS に割り当てさせます。
