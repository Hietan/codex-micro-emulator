import "./styles.css";
import type {
  BridgeCallResult,
  BridgeRequest,
  AgentSlotState,
  JoystickRequest,
  KeyRequest,
  MicroKeyId,
} from "../shared/protocol";

declare global {
  interface Window {
    microBridge: {
      send(socketPath: string, request: BridgeRequest): Promise<BridgeCallResult>;
      defaultSocketPath(): Promise<string>;
      version(): Promise<string>;
    };
  }
}

interface StoredSettings {
  socketPath?: string;
  separateMic?: boolean;
}

type Direction = "up" | "right" | "down" | "left";

const STORAGE_KEY = "codex-micro-emulator.settings.v1";
const JOYSTICK_ANGLES: Record<Direction, number> = { up: 0.75, right: 0, down: 0.25, left: 0.5 };
const heldKeys = new Set<MicroKeyId>();
let heldDirection: Direction | null = null;
let dialRotation = -28;
let toastTimer: number | undefined;
let pollTimer: number | undefined;
let settings: StoredSettings = loadSettings();
let agentSlots: AgentSlotState[] = Array.from({ length: 6 }, (_, id) => ({
  id,
  assigned: false,
  status: "off",
  selected: false,
}));

const titlebarStatus = element<HTMLDivElement>("titlebarStatus");
const connectionState = element<HTMLDivElement>("connectionState");
const socketPathInput = element<HTMLInputElement>("socketPath");
const agentSettings = element<HTMLDivElement>("agentSettings");
const eventLog = element<HTMLDivElement>("eventLog");
const separateMic = element<HTMLInputElement>("separateMic");
const micGroup = element<HTMLDivElement>("micGroup");
const joystickControl = element<HTMLDivElement>("joystickControl");
const dialKnob = element<HTMLButtonElement>("dialKnob");
const toast = element<HTMLDivElement>("toast");

await initialize();

async function initialize(): Promise<void> {
  const defaultPath = await window.microBridge.defaultSocketPath();
  socketPathInput.value = settings.socketPath || defaultPath;
  settings.socketPath = socketPathInput.value;
  separateMic.checked = settings.separateMic === true;
  renderMicMode();
  renderAgentSettings();
  updateAgentKeys();
  bindControls();
  emptyLog();
  await refreshConnection(false);
  pollTimer = window.setInterval(() => void refreshConnection(true), 750);
}

function bindControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-command-key]").forEach((button) => {
    button.addEventListener("click", () => void tapKey(button.dataset.commandKey as MicroKeyId, button));
  });

  document.querySelectorAll<HTMLButtonElement>("[data-agent]").forEach((button) => {
    button.addEventListener("click", () => void tapAgent(button));
  });

  document.querySelectorAll<HTMLButtonElement>("[data-hold-key]").forEach((button) => bindHoldKey(button));

  document.querySelectorAll<HTMLButtonElement>("[data-direction]").forEach((button) => bindJoystick(button));

  element<HTMLButtonElement>("dialLeft").addEventListener("click", () => void turnDial("ccw"));
  element<HTMLButtonElement>("dialRight").addEventListener("click", () => void turnDial("cw"));
  dialKnob.addEventListener("click", () => void tapKey("ENC", dialKnob));
  dialKnob.addEventListener("wheel", (event) => {
    event.preventDefault();
    void turnDial(event.deltaY >= 0 ? "cw" : "ccw");
  }, { passive: false });

  element<HTMLButtonElement>("refreshButton").addEventListener("click", () => void refreshConnection(false));
  element<HTMLButtonElement>("settingsButton").addEventListener("click", () => {
    socketPathInput.focus();
    showToast("Bridge設定とCodex Agent状態は右側で確認できます");
  });
  element<HTMLButtonElement>("clearLog").addEventListener("click", emptyLog);

  socketPathInput.addEventListener("change", () => {
    settings.socketPath = socketPathInput.value.trim();
    persistSettings();
    void refreshConnection(false);
  });
  separateMic.addEventListener("change", () => {
    settings.separateMic = separateMic.checked;
    persistSettings();
    renderMicMode();
  });

  window.addEventListener("blur", () => void releaseAll());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void releaseAll();
  });
  window.addEventListener("beforeunload", () => {
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
  });
}

function bindHoldKey(button: HTMLButtonElement): void {
  const key = button.dataset.holdKey as MicroKeyId;
  const press = (event: PointerEvent): void => {
    if (heldKeys.has(key)) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    heldKeys.add(key);
    button.classList.add("is-pressed");
    void sendKey(key, 1, undefined, `${key} press`);
  };
  const release = (event: PointerEvent): void => {
    if (!heldKeys.delete(key)) return;
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    button.classList.remove("is-pressed");
    void sendKey(key, 0, undefined, `${key} release`);
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
}

function bindJoystick(button: HTMLButtonElement): void {
  const direction = button.dataset.direction as Direction;
  const press = (event: PointerEvent): void => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    if (heldDirection && heldDirection !== direction) void sendJoystick(heldDirection, 0, true);
    heldDirection = direction;
    joystickControl.dataset.active = direction;
    void sendJoystick(direction, 1);
  };
  const release = (event: PointerEvent): void => {
    if (heldDirection !== direction) return;
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    heldDirection = null;
    delete joystickControl.dataset.active;
    void sendJoystick(direction, 0);
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
}

async function tapAgent(button: HTMLButtonElement): Promise<void> {
  const index = Number(button.dataset.agent);
  await tapKey(`AG0${index}` as MicroKeyId, button);
}

async function tapKey(key: MicroKeyId, button?: HTMLElement, threadKey?: string): Promise<void> {
  button?.classList.add("is-pressed");
  const pressed = await sendKey(key, 1, threadKey, `${key} press`);
  await delay(42);
  await sendKey(key, 0, threadKey, `${key} release`, !pressed);
  button?.classList.remove("is-pressed");
  if (pressed) flash(button);
}

async function turnDial(direction: "cw" | "ccw"): Promise<void> {
  dialRotation += direction === "cw" ? 24 : -24;
  dialKnob.style.transform = `rotate(${dialRotation}deg)`;
  const key: MicroKeyId = direction === "cw" ? "ENC_CW" : "ENC_CC";
  await sendKey(key, 2, undefined, `Dial ${direction.toUpperCase()}`);
}

async function sendKey(
  key: MicroKeyId,
  act: 0 | 1 | 2,
  threadKey: string | undefined,
  label: string,
  quiet = false,
): Promise<boolean> {
  const request: KeyRequest = {
    v: 1,
    id: crypto.randomUUID(),
    type: "key",
    key,
    act,
    ...(threadKey ? { threadKey } : {}),
  };
  return await dispatch(request, label, quiet);
}

async function sendJoystick(direction: Direction, distance: 0 | 1, quiet = false): Promise<boolean> {
  const request: JoystickRequest = {
    v: 1,
    id: crypto.randomUUID(),
    type: "joystick",
    angle: JOYSTICK_ANGLES[direction],
    distance,
  };
  return await dispatch(request, `Stick ${direction} · ${distance ? "press" : "release"}`, quiet);
}

async function dispatch(request: BridgeRequest, label: string, quiet = false): Promise<boolean> {
  const result = await window.microBridge.send(socketPathInput.value.trim(), request);
  if (result.ok) {
    markOnline(result.ready.mode, result.ready.port);
    if (!quiet) addLog(label, "success");
    return true;
  }
  markOffline(result.error);
  if (!quiet) addLog(`${label} · ${result.error}`, "error");
  return false;
}

async function refreshConnection(quiet: boolean): Promise<void> {
  if (!quiet) markChecking();
  const result = await window.microBridge.send(socketPathInput.value.trim(), {
    v: 1,
    id: crypto.randomUUID(),
    type: "snapshot",
  });
  if (result.ok) {
    markOnline(result.ready.mode, result.ready.port);
    if (result.response.type === "snapshot") {
      agentSlots = result.response.slots;
      renderAgentSettings();
      updateAgentKeys();
    }
    if (!quiet) addLog(`Bridge connected · ${result.ready.mode}`, "success");
  } else {
    markOffline(result.error);
    if (!quiet) addLog(`Bridge unavailable · ${result.error}`, "error");
  }
}

async function releaseAll(): Promise<void> {
  const keys = [...heldKeys];
  heldKeys.clear();
  document.querySelectorAll(".is-pressed").forEach((item) => item.classList.remove("is-pressed"));
  await Promise.all(keys.map((key) => sendKey(key, 0, undefined, `${key} safety release`, true)));
  if (heldDirection) {
    const direction = heldDirection;
    heldDirection = null;
    delete joystickControl.dataset.active;
    await sendJoystick(direction, 0, true);
  }
}

function renderAgentSettings(): void {
  agentSettings.replaceChildren();
  agentSlots.forEach((slot, index) => {
    const row = document.createElement("div");
    row.className = "agent-setting";
    row.innerHTML = `
      <span class="agent-number">${index + 1}</span>
      <strong>Agent ${index + 1}</strong>
      <span class="agent-status">${escapeHtml(agentStatusLabel(slot))}</span>
    `;
    agentSettings.append(row);
  });
}

function updateAgentKeys(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-agent]").forEach((button) => {
    const index = Number(button.dataset.agent);
    const slot = agentSlots[index];
    const configured = slot?.assigned === true;
    button.classList.toggle("is-unassigned", !configured);
    button.classList.toggle("is-selected", slot?.selected === true);
    button.classList.remove("agent-green", "agent-amber", "agent-blue", "agent-red", "agent-idle");
    button.classList.add(agentStatusClass(slot?.status ?? "off"));
    const label = `Agent ${index + 1}`;
    const labelElement = button.querySelector<HTMLElement>(".agent-label");
    if (labelElement) labelElement.textContent = label;
    button.title = `${label} · ${agentStatusLabel(slot)}`;
  });
}

function renderMicMode(): void {
  micGroup.classList.toggle("is-separate", separateMic.checked);
  element<HTMLElement>("micLeft").querySelector<HTMLElement>(".key-label")!.textContent = separateMic.checked ? "MIC 1" : "PUSH TO TALK";
}

function agentStatusClass(status: string): string {
  if (status === "error") return "agent-red";
  if (["approval", "awaiting-approval", "awaiting-response"].includes(status)) return "agent-amber";
  if (["working", "thinking"].includes(status)) return "agent-blue";
  if (["unread", "complete", "completed", "done"].includes(status)) return "agent-green";
  return "agent-idle";
}

function agentStatusLabel(slot: AgentSlotState | undefined): string {
  if (!slot?.assigned) return "未割当";
  if (slot.status === "error") return "エラー";
  if (["approval", "awaiting-approval", "awaiting-response"].includes(slot.status)) return "承認・入力待ち";
  if (["working", "thinking"].includes(slot.status)) return "実行中";
  if (["unread", "complete", "completed", "done"].includes(slot.status)) return "完了・未読";
  return slot.selected ? "選択中" : "待機";
}

function markChecking(): void {
  connectionState.className = "connection-state is-checking";
  connectionState.innerHTML = '<span class="connection-orb"></span><div><strong>確認中</strong><small>Bridge socketを探しています</small></div>';
  titlebarStatus.className = "titlebar-status";
  titlebarStatus.lastElementChild!.textContent = "Bridgeを確認中";
}

function markOnline(mode: "codex" | "mock", port?: number): void {
  const description = mode === "mock" ? "Mock Bridge · 安全なテストモード" : `Codex renderer${port ? ` · CDP ${port}` : ""}`;
  connectionState.className = "connection-state is-online";
  connectionState.innerHTML = `<span class="connection-orb"></span><div><strong>接続済み</strong><small>${description}</small></div>`;
  titlebarStatus.className = "titlebar-status is-online";
  titlebarStatus.lastElementChild!.textContent = mode === "mock" ? "Mock Bridge" : "Codexに接続済み";
}

function markOffline(message: string): void {
  connectionState.className = "connection-state is-offline";
  connectionState.innerHTML = `<span class="connection-orb"></span><div><strong>未接続</strong><small>${escapeHtml(shorten(message, 68))}</small></div>`;
  titlebarStatus.className = "titlebar-status is-offline";
  titlebarStatus.lastElementChild!.textContent = "Bridge未接続";
}

function addLog(message: string, kind: "success" | "error"): void {
  eventLog.querySelector(".event-empty")?.remove();
  const row = document.createElement("div");
  row.className = `event-item is-${kind}`;
  const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  row.innerHTML = `<time>${time}</time><span>${escapeHtml(shorten(message, 110))}</span>`;
  eventLog.prepend(row);
  while (eventLog.children.length > 14) eventLog.lastElementChild?.remove();
}

function emptyLog(): void {
  eventLog.innerHTML = '<div class="event-empty">操作イベントはここに表示されます</div>';
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("is-visible");
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2_200);
}

function flash(elementToFlash?: HTMLElement): void {
  if (!elementToFlash) return;
  elementToFlash.classList.remove("is-sent");
  requestAnimationFrame(() => elementToFlash.classList.add("is-sent"));
  window.setTimeout(() => elementToFlash.classList.remove("is-sent"), 500);
}

function loadSettings(): StoredSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredSettings;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistSettings(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}
