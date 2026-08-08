import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { sendBridgeRequest, validateSocketPath } from "./bridge-client";
import { parseBridgeRequest, type BridgeCallResult } from "../shared/protocol";

const screenshotPath = screenshotArgument(process.argv);

function defaultSocketPath(): string {
  const suffix = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(tmpdir(), `codex-micro-bridge-${suffix}.sock`);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    show: screenshotPath === null,
    title: "Codex Micro Emulator",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#e9f4ff",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

function trustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl) throw new Error("IPC sender frame is unavailable.");
  if (!senderUrl.startsWith("file://")) throw new Error("Untrusted IPC sender.");
}

ipcMain.handle("bridge:default-socket", (event) => {
  trustedSender(event);
  return defaultSocketPath();
});

ipcMain.handle("app:version", (event) => {
  trustedSender(event);
  return app.getVersion();
});

ipcMain.handle("bridge:request", async (event, payload: unknown): Promise<BridgeCallResult> => {
  trustedSender(event);
  try {
    if (typeof payload !== "object" || payload === null || !("socketPath" in payload) || !("request" in payload)) {
      throw new Error("Invalid IPC payload.");
    }
    const socketPath = (payload as { socketPath: unknown }).socketPath;
    if (typeof socketPath !== "string") throw new Error("Invalid socket path.");
    validateSocketPath(socketPath);
    const request = parseBridgeRequest((payload as { request: unknown }).request);
    const result = await sendBridgeRequest(socketPath, request);
    if (result.response.type !== "ack" && result.response.type !== "snapshot") {
      throw new Error("Bridge returned an unexpected response.");
    }
    return { ok: true, ready: result.ready, response: result.response };
  } catch (error) {
    const typed = error as Error & { code?: string };
    return {
      ok: false,
      error: typed instanceof Error ? typed.message : String(error),
      ...(typeof typed.code === "string" ? { code: typed.code } : {}),
    };
  }
});

app.whenReady().then(async () => {
  const window = createWindow();
  if (screenshotPath) {
    await new Promise<void>((resolveReady) => window.webContents.once("did-finish-load", () => resolveReady()));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
    const image = await window.webContents.capturePage();
    await fs.mkdir(dirname(screenshotPath), { recursive: true });
    await fs.writeFile(resolve(screenshotPath), image.toPNG());
    app.quit();
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function screenshotArgument(argv: string[]): string | null {
  const index = argv.indexOf("--screenshot");
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value ? resolve(value) : null;
}
