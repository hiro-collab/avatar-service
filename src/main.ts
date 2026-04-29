import "./style.css";
import { AvatarController } from "./avatar/AvatarController";
import { AvatarRenderer, type AvatarLoadStatus } from "./avatar/AvatarRenderer";
import {
  createAvatarStateEvent,
  dispatchAvatarState,
  installPostMessageAvatarBridge,
  subscribeAvatarState
} from "./avatar/events";
import { type AvatarEmotion, type AvatarPhase, AVATAR_PHASES } from "./avatar/types";
import { AvatarStateResolver } from "./integrations/avatarStateResolver";
import { SseConnector, type SseConnectionStatus } from "./integrations/sse";
import { SwordVoiceAgentAdapter } from "./integrations/swordVoiceAgent";

const canvas = getElement<HTMLCanvasElement>("avatar-canvas");
const fileInput = getElement<HTMLInputElement>("vrm-input");
const modelName = getElement<HTMLElement>("model-name");
const runtimeStatus = getElement<HTMLElement>("runtime-status");
const phaseReadout = getElement<HTMLElement>("phase-readout");
const phaseButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-phase]"));
const emotionSelect = getElement<HTMLSelectElement>("emotion-select");
const gestureSelect = getElement<HTMLSelectElement>("gesture-select");
const turnIdInput = getElement<HTMLInputElement>("turn-id-input");
const textInput = getElement<HTMLTextAreaElement>("text-input");
const dispatchButton = getElement<HTMLButtonElement>("dispatch-button");
const eventPreview = getElement<HTMLPreElement>("event-preview");
const emptyState = getElement<HTMLElement>("empty-state");
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
const unsubscribeState = subscribeAvatarState((event) => {
  controller.applyState(event);
  phaseReadout.textContent = event.phase;
  updatePhaseButtons(event.phase);
  if (event.emotion) {
    emotionSelect.value = event.emotion;
  }
  eventPreview.textContent = JSON.stringify(redactAvatarEvent(event), null, 2);
});

hydrateSseSettingsFromUrl();
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

connectEventsButton.addEventListener("click", connectSse);
disconnectEventsButton.addEventListener("click", () => disconnectSse());
preferTtsInput.addEventListener("change", () => {
  stateResolver.setPreferTtsSpeaking(preferTtsInput.checked);
});

window.addEventListener("beforeunload", () => {
  unsubscribeState();
  removePostMessageBridge();
  sseConnector?.stop();
  renderer.dispose();
});

if (eventsUrlInput.value.trim()) {
  connectSse();
}

function dispatchManualState(phase: AvatarPhase): void {
  const event = createAvatarStateEvent({
    phase,
    emotion: emotionSelect.value as AvatarEmotion,
    gesture: gestureSelect.value,
    turn_id: turnIdInput.value.trim() || undefined,
    text: textInput.value.trim() || undefined
  });
  dispatchAvatarState(event);
}

function updateLoadStatus(status: AvatarLoadStatus): void {
  runtimeStatus.dataset.status = status.status;
  runtimeStatus.textContent = status.message;

  if (status.status === "loaded" || status.status === "loading") {
    modelName.textContent = status.fileName;
  }

  if (status.status === "error") {
    modelName.textContent = status.fileName ? `${status.fileName}: ${status.message}` : status.message;
  }

  emptyState.classList.toggle("is-hidden", status.status === "loaded" || status.status === "loading");
}

function updatePhaseButtons(phase: AvatarPhase): void {
  for (const button of phaseButtons) {
    button.classList.toggle("is-active", button.dataset.phase === phase);
  }
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
  updateSseDetail(status.message);
}

function updateSseDetail(message: string): void {
  sseDetail.textContent = message;
}

function hydrateSseSettingsFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  eventsUrlInput.value = params.get("events") ?? "";
  eventsTokenInput.value = params.get("events_token") ?? params.get("token") ?? "";
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
