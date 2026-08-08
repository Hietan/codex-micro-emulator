import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sendBridgeRequest } from "../src/main/bridge-client";

test("exchanges one request with the local bridge protocol", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-micro-emulator-test-"));
  const socketPath = join(directory, "bridge.sock");
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write('{"v":1,"type":"ready","mode":"mock"}\n');
    socket.once("data", (raw: string) => {
      const request = JSON.parse(raw.trim()) as { id: string; key: string };
      assert.equal(request.key, "ACT06");
      socket.end(`${JSON.stringify({ v: 1, type: "ack", id: request.id, status: "dispatched" })}\n`);
    });
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolveListen);
    });
    const result = await sendBridgeRequest(socketPath, {
      v: 1,
      id: "event-1",
      type: "key",
      key: "ACT06",
      act: 1,
    });
    assert.equal(result.ready.mode, "mock");
    assert.equal(result.response.type, "ack");
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(directory, { recursive: true, force: true });
  }
});
