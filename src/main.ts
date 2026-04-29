import "./style.css";
import { AvatarController } from "./avatar/AvatarController";
import { AvatarRenderer, type AvatarLoadStatus } from "./avatar/AvatarRenderer";
import {
  createAvatarStateEvent,
  dispatchAvatarState,
  installPostMessageAvatarBridge,
  subscribeAvatarState
} from "./avatar/events";
import { type AvatarEmotion, type AvatarPhase, type AvatarPostureCue, AVATAR_PHASES } from "./avatar/types";
import { AvatarStateResolver } from "./integrations/avatarStateResolver";
import { SseConnector, type SseConnectionStatus } from "./integrations/sse";
import { SwordVoiceAgentAdapter } from "./integrations/swordVoiceAgent";

const canvas = getElement<HTMLCanvasElement>("avatar-canvas");
const fileInput = getElement<HTMLInputElement>("vrm-input");
const modelUrlInput = getElement<HTMLInputElement>("model-url-input");
const loadModelUrlButton = getElement<HTMLButtonElement>("load-model-url-button");
const backgroundColorInput = getElement<HTMLInputElement>("background-color-input");
const backgroundDetail = getElement<HTMLElement>("background-detail");
const modelName = getElement<HTMLElement>("model-name");
const runtimeStatus = getElement<HTMLElement>("runtime-status");
const sseGlobalStatus = getElement<HTMLElement>("sse-global-status");
const phaseReadout = getElement<HTMLElement>("phase-readout");
const phaseButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-phase]"));
const emotionSelect = getElement<HTMLSelectElement>("emotion-select");
const gestureSelect = getElement<HTMLSelectElement>("gesture-select");
const postureSelect = getElement<HTMLSelectElement>("posture-select");
const postureIntensityInput = getElement<HTMLInputElement>("posture-intensity-input");
const postureIntensityReadout = getElement<HTMLOutputElement>("posture-intensity-readout");
const turnIdInput = getElement<HTMLInputElement>("turn-id-input");
const textInput = getElement<HTMLTextAreaElement>("text-input");
const dispatchButton = getElement<HTMLButtonElement>("dispatch-button");
const eventPreview = getElement<HTMLPreElement>("event-preview");
const emptyState = getElement<HTMLElement>("empty-state");
const emptyStateMark = getElement<HTMLElement>("empty-state-mark");
const emptyStateTitle = getElement<HTMLElement>("empty-state-title");
const emptyStateMessage = getElement<HTMLElement>("empty-state-message");
const eventsUrlInput = getElement<HTMLInputElement>("events-url-input");
const eventsTokenInput = getElement<HTMLInputElement>("events-token-input");
const preferTtsInput = getElement<HTMLInputElement>("prefer-tts-input");
const connectEventsButton = getElement<HTMLButtonElement>("connect-events-button");
const disconnectEventsButton = getElement<HTMLButtonElement>("disconnect-events-button");
const sseStatus = getElement<HTMLElement>("sse-status");
const sseDetail = getElement<HTMLElement>("sse-detail");

const controller = new AvatarController();
const renderer = new AvatarRenderer(canvas, controller, updateLoadStatus);
const swordAdapter = new SwordVoiceAgentAdapter();
const stateResolver = new AvatarStateResolver({ preferTtsSpeaking: preferTtsInput.checked });
let sseConnector: SseConnector | null = null;
const removePostMessageBridge = installPostMessageAvatarBridge();
const removeConfigBridge = installAvatarConfigBridge();
const unsubscribeState = subscribeAvatarState((event) => {
  controller.applyState(event);
  phaseReadout.textContent = event.phase;
  updatePhaseButtons(event.phase);
  if (event.emotion) {
    emotionSelect.value = event.emotion;
  }
  if (event.posture?.preset) {
    postureSelect.value = hasSelectOption(postureSelect, event.posture.preset) ? event.posture.preset : "auto";
  }
  if (typeof event.posture?.intensity === "number") {
    postureIntensityInput.value = String(Math.max(0, Math.min(1, event.posture.intensity)));
    updatePostureIntensityReadout();
  }
  eventPreview.textContent = JSON.stringify(redactAvatarEvent(event), null, 2);
});

hydrateSettingsFromUrl();
updatePostureIntensityReadout();
dispatchManualState("idle");

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    await renderer.loadVRMFile(file);
  } catch (error) {
    console.error(error);
  }
});

loadModelUrlButton.addEventListener("click", () => {
  void loadModelFromUrl(modelUrlInput.value);
});

for (const button of phaseButtons) {
  button.addEventListener("click", () => {
    const phase = button.dataset.phase;
    if (isPhase(phase)) {
      dispatchManualState(phase);
    }
  });
}

dispatchButton.addEventListener("click", () => {
  dispatchManualState(controller.getCurrentPhase());
});

postureIntensityInput.addEventListener("input", updatePostureIntensityReadout);
connectEventsButton.addEventListener("click", connectSse);
disconnectEventsButton.addEventListener("click", () => disconnectSse());
preferTtsInput.addEventListener("change", () => {
  stateResolver.setPreferTtsSpeaking(preferTtsInput.checked);
});

window.addEventListener("beforeunload", () => {
  unsubscribeState();
  removePostMessageBridge();
  removeConfigBridge();
  sseConnector?.stop();
  renderer.dispose();
});

backgroundColorInput.addEventListener("input", () => {
  applyBackgroundColor(backgroundColorInput.value);
});

if (eventsUrlInput.value.trim()) {
  connectSse();
}

if (modelUrlInput.value.trim()) {
  void loadModelFromUrl(modelUrlInput.value);
}

function dispatchManualState(phase: AvatarPhase): void {
  const event = createAvatarStateEvent({
    phase,
    emotion: emotionSelect.value as AvatarEmotion,
    gesture: gestureSelect.value,
    posture: manualPostureCue(),
    turn_id: turnIdInput.value.trim() || undefined,
    text: textInput.value.trim() || undefined
  });
  dispatchAvatarState(event);
}

function updateLoadStatus(status: AvatarLoadStatus): void {
  runtimeStatus.dataset.status = status.status;
  runtimeStatus.textContent = status.message;
  emptyState.dataset.status = status.status;

  if (status.status === "loaded" || status.status === "loading") {
    modelName.textContent = status.fileName;
  }

  if (status.status === "error") {
    modelName.textContent = status.fileName ? `${status.fileName}: ${status.message}` : status.message;
  }

  if (status.status === "loading") {
    emptyStateMark.textContent = "...";
    emptyStateTitle.textContent = "Loading model";
    emptyStateMessage.textContent = status.fileName;
  } else if (status.status === "error") {
    emptyStateMark.textContent = "!";
    emptyStateTitle.textContent = "Model load failed";
    emptyStateMessage.textContent = status.fileName ? `${status.fileName}: ${status.message}` : status.message;
  } else {
    emptyStateMark.textContent = "VRM";
    emptyStateTitle.textContent = "No model loaded";
    emptyStateMessage.textContent = "Select a local .vrm file or load a model URL to start.";
  }

  emptyState.classList.toggle("is-hidden", status.status === "loaded");
}

function updatePhaseButtons(phase: AvatarPhase): void {
  for (const button of phaseButtons) {
    button.classList.toggle("is-active", button.dataset.phase === phase);
  }
}

function manualPostureCue(): AvatarPostureCue | undefined {
  const preset = postureSelect.value.trim();
  if (!preset || preset === "auto") {
    return undefined;
  }

  return {
    preset,
    intensity: Number(postureIntensityInput.value),
    source: "manual_ui"
  };
}

function updatePostureIntensityReadout(): void {
  postureIntensityReadout.textContent = Number(postureIntensityInput.value).toFixed(2);
}

function connectSse(): void {
  const url = eventsUrlInput.value.trim();
  if (!url) {
    updateSseStatus({
      state: "disconnected",
      message: "No SSE source configured.",
      url: "",
      attempt: 0
    });
    return;
  }

  try {
    new URL(url, window.location.href);
  } catch {
    updateSseStatus({
      state: "disconnected",
      message: "Events URL is invalid.",
      url,
      attempt: 0
    });
    return;
  }

  disconnectSse(false);
  stateResolver.reset();
  stateResolver.setPreferTtsSpeaking(preferTtsInput.checked);
  sseConnector = new SseConnector({
    url,
    token: eventsTokenInput.value,
    onStatus: updateSseStatus,
    onEvent: (rawEvent) => {
      const candidate = swordAdapter.toAvatarState(rawEvent.data, rawEvent.event);
      const raw = rawEvent.data && typeof rawEvent.data === "object" ? (rawEvent.data as { type?: unknown; turn_id?: unknown }) : {};
      const rawType = typeof raw.type === "string" ? raw.type : rawEvent.event || "message";
      const turnId = typeof raw.turn_id === "string" ? raw.turn_id : "";

      if (!candidate) {
        updateSseDetail(`Ignored ${rawType}${formatTurn(turnId)}: no avatar mapping`);
        return;
      }

      const result = stateResolver.resolve(candidate);
      if (!result.accepted) {
        updateSseDetail(`${candidate.sourceType}${formatTurn(candidate.event.turn_id)}: ${result.reason}`);
        return;
      }

      dispatchAvatarState(result.event);
      updateSseDetail(`${candidate.sourceType}${formatTurn(result.event.turn_id)} -> ${result.event.phase}`);
    }
  });
  sseConnector.start();
}

function disconnectSse(updateUi = true): void {
  sseConnector?.stop();
  sseConnector = null;
  if (updateUi) {
    updateSseStatus({
      state: "disconnected",
      message: "SSE disconnected",
      url: eventsUrlInput.value.trim(),
      attempt: 0
    });
  }
}

function updateSseStatus(status: SseConnectionStatus): void {
  sseStatus.dataset.state = status.state;
  sseStatus.textContent = status.state;
  sseGlobalStatus.dataset.state = status.state;
  sseGlobalStatus.textContent = `SSE ${status.state}`;
  updateSseDetail(status.message);
}

function updateSseDetail(message: string): void {
  sseDetail.textContent = message;
}

function hydrateSettingsFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  modelUrlInput.value = params.get("model") ?? "";
  applyBackgroundColor(params.get("background") ?? params.get("bg") ?? backgroundColorInput.value);
  eventsUrlInput.value = params.get("events") ?? "";
  eventsTokenInput.value = params.get("events_token") ?? params.get("token") ?? "";
}

async function loadModelFromUrl(input: string): Promise<void> {
  const url = input.trim();
  if (!url) {
    updateLoadStatus({ status: "idle", message: "No model" });
    return;
  }

  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.username || parsed.password) {
      throw new Error("Model URL must not include embedded credentials.");
    }
    await renderer.loadVRMUrl(parsed.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid model URL";
    updateLoadStatus({ status: "error", message, fileName: url });
    console.error(error);
  }
}

function redactAvatarEvent(event: unknown): unknown {
  if (!event || typeof event !== "object") {
    return event;
  }

  const preview = { ...(event as Record<string, unknown>) };
  if (typeof preview.text === "string" && preview.text.length > 0) {
    preview.text = `[redacted:${preview.text.length}]`;
  }
  return preview;
}

function installAvatarConfigBridge(): () => void {
  const handler = (messageEvent: MessageEvent) => {
    const data = messageEvent.data;
    if (!data || typeof data !== "object") {
      return;
    }

    const payload = data as { type?: unknown; background?: unknown; background_color?: unknown };
    if (payload.type !== "avatar_config") {
      return;
    }

    const background = typeof payload.background === "string" ? payload.background : payload.background_color;
    if (typeof background === "string") {
      applyBackgroundColor(background);
    }
  };

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

function applyBackgroundColor(value: string): void {
  const color = normalizeHexColor(value);
  if (!color) {
    backgroundDetail.textContent = `Invalid color: ${value}`;
    return;
  }

  renderer.setBackgroundColor(color);
  document.documentElement.style.setProperty("--avatar-stage-bg", color);
  backgroundColorInput.value = color;
  backgroundDetail.textContent = color;
}

function normalizeHexColor(value: string): string | null {
  const color = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const [, r, g, b] = color;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function formatTurn(turnId: string | undefined): string {
  return turnId ? ` [${turnId.slice(0, 8)}]` : "";
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

function isPhase(value: unknown): value is AvatarPhase {
  return typeof value === "string" && AVATAR_PHASES.includes(value as AvatarPhase);
}

function hasSelectOption(select: HTMLSelectElement, value: string): boolean {
  return Array.from(select.options).some((option) => option.value === value);
}
