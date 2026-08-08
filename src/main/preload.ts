import { contextBridge, ipcRenderer } from "electron";
import type { BridgeCallResult, BridgeRequest } from "../shared/protocol";

contextBridge.exposeInMainWorld("microBridge", {
  send: (socketPath: string, request: BridgeRequest): Promise<BridgeCallResult> =>
    ipcRenderer.invoke("bridge:request", { socketPath, request }) as Promise<BridgeCallResult>,
  defaultSocketPath: (): Promise<string> => ipcRenderer.invoke("bridge:default-socket") as Promise<string>,
  version: (): Promise<string> => ipcRenderer.invoke("app:version") as Promise<string>,
});
