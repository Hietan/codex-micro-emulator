import { createConnection } from "node:net";
import { isAbsolute } from "node:path";
import {
  parseBridgeResponse,
  parseBridgeRequest,
  type BridgeRequest,
  type BridgeResponse,
  type ReadyResponse,
} from "../shared/protocol";

export interface BridgeExchange {
  ready: ReadyResponse;
  response: BridgeResponse;
}

export async function sendBridgeRequest(
  socketPath: string,
  input: unknown,
  timeoutMs = 3_000,
): Promise<BridgeExchange> {
  validateSocketPath(socketPath);
  const request: BridgeRequest = parseBridgeRequest(input);
  const socket = createConnection(socketPath);
  socket.setEncoding("utf8");
  let buffer = "";
  let ready: ReadyResponse | undefined;
  let settled = false;

  return await new Promise<BridgeExchange>((resolve, reject) => {
    const finish = (error?: Error, result?: BridgeExchange): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("Timed out waiting for the Codex Micro bridge.")), timeoutMs);
    socket.once("error", (error) => finish(error));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: BridgeResponse;
        try {
          message = parseBridgeResponse(JSON.parse(line));
        } catch {
          finish(new Error("Bridge returned invalid JSON."));
          return;
        }
        if (message.type === "ready") {
          ready = message;
          socket.write(`${JSON.stringify(request)}\n`);
          continue;
        }
        if (!ready) {
          finish(new Error("Bridge replied before sending its ready envelope."));
          return;
        }
        if (message.type === "error") {
          const error = new Error(message.error.message) as Error & { code?: string };
          error.code = message.error.code;
          finish(error);
          return;
        }
        if (message.type === "ack" || message.type === "snapshot") {
          finish(undefined, { ready, response: message });
          return;
        }
      }
    });
  });
}

export function validateSocketPath(socketPath: string): void {
  if (!isAbsolute(socketPath) || socketPath.length > 4_096 || socketPath.includes("\0")) {
    throw new Error("Bridge socket path must be a valid absolute local path.");
  }
}
