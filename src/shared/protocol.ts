export const PROTOCOL_VERSION = 1 as const;

export const MICRO_KEY_IDS = [
  "AG00",
  "AG01",
  "AG02",
  "AG03",
  "AG04",
  "AG05",
  "ACT06",
  "ACT07",
  "ACT08",
  "ACT09",
  "ACT10",
  "ACT11",
  "ACT12",
  "ENC",
  "ENC_CW",
  "ENC_CC",
] as const;

export type MicroKeyId = (typeof MICRO_KEY_IDS)[number];

export interface PingRequest {
  v: 1;
  id: string;
  type: "ping";
}

export interface SnapshotRequest {
  v: 1;
  id: string;
  type: "snapshot";
}

export interface KeyRequest {
  v: 1;
  id: string;
  type: "key";
  key: MicroKeyId;
  act: 0 | 1 | 2;
  threadKey?: string;
}

export interface JoystickRequest {
  v: 1;
  id: string;
  type: "joystick";
  angle: number;
  distance: number;
}

export type BridgeRequest = PingRequest | SnapshotRequest | KeyRequest | JoystickRequest;

export interface ReadyResponse {
  v: 1;
  type: "ready";
  mode: "codex" | "mock";
  target?: string;
  port?: number;
}

export interface AckResponse {
  v: 1;
  type: "ack";
  id?: string;
  status: "ready" | "dispatched";
}

export interface ErrorResponse {
  v: 1;
  type: "error";
  id?: string;
  error: {
    code: string;
    message: string;
  };
}

export interface AgentSlotState {
  id: number;
  assigned: boolean;
  status: string;
  selected: boolean;
}

export interface SnapshotResponse {
  v: 1;
  type: "snapshot";
  id?: string;
  slots: AgentSlotState[];
}

export type BridgeResponse = ReadyResponse | AckResponse | ErrorResponse | SnapshotResponse;

export interface BridgeCallSuccess {
  ok: true;
  ready: ReadyResponse;
  response: AckResponse | SnapshotResponse;
}

export interface BridgeCallFailure {
  ok: false;
  error: string;
  code?: string;
}

export type BridgeCallResult = BridgeCallSuccess | BridgeCallFailure;

const KEY_SET = new Set<string>(MICRO_KEY_IDS);

export function parseBridgeRequest(value: unknown): BridgeRequest {
  if (!isRecord(value) || value.v !== 1 || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("Invalid bridge request envelope.");
  }
  if (value.type === "ping") return { v: 1, type: "ping", id: value.id };
  if (value.type === "snapshot") return { v: 1, type: "snapshot", id: value.id };
  if (value.type === "key") {
    if (typeof value.key !== "string" || !KEY_SET.has(value.key)) throw new Error("Invalid Micro key.");
    if (value.act !== 0 && value.act !== 1 && value.act !== 2) throw new Error("Invalid key action.");
    const isStep = value.key === "ENC_CW" || value.key === "ENC_CC";
    if ((isStep && value.act !== 2) || (!isStep && value.act === 2)) throw new Error("Invalid encoder action.");
    if (value.threadKey !== undefined && (typeof value.threadKey !== "string" || value.threadKey.length === 0)) {
      throw new Error("Invalid thread key.");
    }
    return {
      v: 1,
      type: "key",
      id: value.id,
      key: value.key as MicroKeyId,
      act: value.act,
      ...(typeof value.threadKey === "string" ? { threadKey: value.threadKey } : {}),
    };
  }
  if (value.type === "joystick") {
    if (!isNormalized(value.angle) || !isNormalized(value.distance)) throw new Error("Invalid joystick vector.");
    return { v: 1, type: "joystick", id: value.id, angle: value.angle, distance: value.distance };
  }
  throw new Error("Unsupported bridge request type.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNormalized(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseBridgeResponse(value: unknown): BridgeResponse {
  if (!isRecord(value) || value.v !== 1 || typeof value.type !== "string") {
    throw new Error("Invalid bridge response envelope.");
  }
  if (value.type === "ready") {
    if (value.mode !== "codex" && value.mode !== "mock") throw new Error("Invalid bridge mode.");
    if (value.target !== undefined && typeof value.target !== "string") throw new Error("Invalid bridge target.");
    if (value.port !== undefined && (!Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65535)) {
      throw new Error("Invalid bridge port.");
    }
    return {
      v: 1,
      type: "ready",
      mode: value.mode,
      ...(typeof value.target === "string" ? { target: value.target } : {}),
      ...(typeof value.port === "number" ? { port: value.port } : {}),
    };
  }
  const id = value.id === undefined ? undefined : boundedString(value.id, "response id", 200);
  if (value.type === "ack") {
    if (value.status !== "ready" && value.status !== "dispatched") throw new Error("Invalid acknowledgement status.");
    return { v: 1, type: "ack", ...(id ? { id } : {}), status: value.status };
  }
  if (value.type === "error") {
    if (!isRecord(value.error)) throw new Error("Invalid bridge error.");
    const code = boundedString(value.error.code, "error code", 100);
    const message = boundedString(value.error.message, "error message", 2_000);
    return { v: 1, type: "error", ...(id ? { id } : {}), error: { code, message } };
  }
  if (value.type === "snapshot") {
    if (!Array.isArray(value.slots) || value.slots.length !== 6) throw new Error("Agent snapshot must contain six slots.");
    const slots = value.slots.map((slot, index): AgentSlotState => {
      if (!isRecord(slot) || slot.id !== index || typeof slot.assigned !== "boolean" ||
          typeof slot.selected !== "boolean" || typeof slot.status !== "string" || slot.status.length > 64) {
        throw new Error(`Invalid Agent snapshot slot ${index}.`);
      }
      return { id: index, assigned: slot.assigned, status: slot.status, selected: slot.selected };
    });
    return { v: 1, type: "snapshot", ...(id ? { id } : {}), slots };
  }
  throw new Error("Unsupported bridge response type.");
}

function boundedString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}
