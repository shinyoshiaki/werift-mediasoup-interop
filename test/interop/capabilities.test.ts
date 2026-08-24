import assert from "node:assert/strict";
import test from "node:test";

import { arrangeInteropSession } from "../helpers/session.js";

test("Router capabilities と未対応 codec の拒否", async () => {
  const session = await arrangeInteropSession();
  try {
    const capabilities = session.device!.rtpCapabilities;
    const mimeTypes = (capabilities.codecs ?? []).map((codec) =>
      codec.mimeType.toLowerCase(),
    );

    // 実行: 交渉可能な codec を確認する。
    assert.ok(mimeTypes.some((type) => type === "audio/opus"));
    assert.ok(mimeTypes.some((type) => type === "video/vp8"));
    assert.ok(mimeTypes.some((type) => type === "video/h264"));
    assert.equal(session.device!.canProduce("audio"), true);
    assert.equal(session.device!.canProduce("video"), true);

    // 検証: 存在しない producer は consume できない。
    assert.equal(
      session.router!.canConsume({
        producerId: "missing",
        rtpCapabilities: capabilities,
      }),
      false,
    );
  } finally {
    await session.close();
  }
});
