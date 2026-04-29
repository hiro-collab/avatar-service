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

const controller = new AvatarController();
const renderer = new AvatarRenderer(canvas, controller, updateLoadStatus);
const removePostMessageBridge = installPostMessageAvatarBridge();
const unsubscribeState = subscribeAvatarState((event) => {
  controller.applyState(event);
  phaseReadout.textContent = event.phase;
  updatePhaseButtons(event.phase);
  if (event.emotion) {
    emotionSelect.value = event.emotion;
  }
  eventPreview.textContent = JSON.stringify(event, null, 2);
});

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

window.addEventListener("beforeunload", () => {
  unsubscribeState();
  removePostMessageBridge();
  renderer.dispose();
});

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
