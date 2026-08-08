import assert from "node:assert/strict";
import test from "node:test";
import { parseBridgeRequest, parseBridgeResponse } from "../src/shared/protocol";

test("accepts command and encoder requests", () => {
  assert.equal(parseBridgeRequest({ v: 1, id: "one", type: "key", key: "ACT06", act: 1 }).type, "key");
  assert.equal(parseBridgeRequest({ v: 1, id: "two", type: "key", key: "ENC_CW", act: 2 }).type, "key");
});

test("lets the bridge resolve Agent identities from native slots", () => {
  assert.equal(parseBridgeRequest({ v: 1, id: "one", type: "key", key: "AG00", act: 1 }).type, "key");
  assert.equal(
    parseBridgeRequest({ v: 1, id: "two", type: "key", key: "AG00", act: 1, threadKey: "thread-1" }).type,
    "key",
  );
});

test("accepts Agent status snapshot requests", () => {
  assert.equal(parseBridgeRequest({ v: 1, id: "state", type: "snapshot" }).type, "snapshot");
});

test("accepts only bounded content-free six-slot responses", () => {
  const slots = Array.from({ length: 6 }, (_, id) => ({
    id,
    assigned: id < 2,
    status: id === 0 ? "working" : "off",
    selected: id === 0,
  }));
  assert.deepEqual(parseBridgeResponse({ v: 1, type: "snapshot", id: "state", slots }), {
    v: 1,
    type: "snapshot",
    id: "state",
    slots,
  });
  assert.throws(() => parseBridgeResponse({ v: 1, type: "snapshot", slots: slots.slice(0, 5) }), /six slots/i);
  assert.throws(() => parseBridgeResponse({ v: 1, type: "snapshot", slots: [{ ...slots[0], title: "private" }] }), /six slots/i);
});

test("rejects arbitrary commands and invalid joystick vectors", () => {
  assert.throws(() => parseBridgeRequest({ v: 1, id: "one", type: "command", command: "eval" }), /unsupported/i);
  assert.throws(
    () => parseBridgeRequest({ v: 1, id: "two", type: "joystick", angle: 2, distance: 1 }),
    /joystick/i,
  );
});
