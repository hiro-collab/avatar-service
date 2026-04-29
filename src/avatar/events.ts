import {
  type AvatarEmotion,
  type AvatarPhase,
  type AvatarPostureCue,
  type AvatarRotationCue,
  type AvatarSpeechCue,
  type AvatarStateEvent,
  isAvatarEmotion,
  isAvatarPhase
} from "./types";

export const AVATAR_STATE_EVENT = "avatar_state";

type AvatarStatePayload = {
  type?: unknown;
  turn_id?: unknown;
  phase?: unknown;
  emotion?: unknown;
  gesture?: unknown;
  posture?: unknown;
  speech?: unknown;
  text?: unknown;
  timestamp?: unknown;
};

export function toAvatarStateEvent(value: unknown): AvatarStateEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as AvatarStatePayload;
  if (payload.type !== AVATAR_STATE_EVENT || !isAvatarPhase(payload.phase)) {
    return null;
  }

  const event: AvatarStateEvent = {
    type: AVATAR_STATE_EVENT,
    phase: payload.phase
  };

  if (typeof payload.turn_id === "string" && payload.turn_id.length > 0) {
    event.turn_id = payload.turn_id;
  }

  if (isAvatarEmotion(payload.emotion)) {
    event.emotion = payload.emotion;
  }

  if (typeof payload.gesture === "string" && payload.gesture.length > 0) {
    event.gesture = payload.gesture;
  }

  const posture = toAvatarPostureCue(payload.posture);
  if (posture) {
    event.posture = posture;
  }

  const speech = toAvatarSpeechCue(payload.speech);
  if (speech) {
    event.speech = speech;
  }

  if (typeof payload.text === "string" && payload.text.length > 0) {
    event.text = payload.text;
  }

  if (typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)) {
    event.timestamp = payload.timestamp;
  }

  return event;
}

export function createAvatarStateEvent(input: {
  phase: AvatarPhase;
  emotion?: AvatarEmotion;
  gesture?: string;
  posture?: AvatarPostureCue;
  speech?: AvatarSpeechCue;
  turn_id?: string;
  text?: string;
}): AvatarStateEvent {
  return {
    type: AVATAR_STATE_EVENT,
    phase: input.phase,
    emotion: input.emotion,
    gesture: input.gesture,
    posture: input.posture,
    speech: input.speech,
    turn_id: input.turn_id,
    text: input.text,
    timestamp: Date.now()
  };
}

export function dispatchAvatarState(event: AvatarStateEvent): AvatarStateEvent {
  const normalized = {
    ...event,
    timestamp: event.timestamp ?? Date.now()
  };

  window.dispatchEvent(new CustomEvent<AvatarStateEvent>(AVATAR_STATE_EVENT, { detail: normalized }));
  return normalized;
}

export function subscribeAvatarState(listener: (event: AvatarStateEvent) => void): () => void {
  const handler = (domEvent: Event) => {
    const event = toAvatarStateEvent((domEvent as CustomEvent<AvatarStateEvent>).detail);
    if (event) {
      listener(event);
    }
  };

  window.addEventListener(AVATAR_STATE_EVENT, handler);
  return () => window.removeEventListener(AVATAR_STATE_EVENT, handler);
}

export function installPostMessageAvatarBridge(): () => void {
  const handler = (messageEvent: MessageEvent) => {
    const event = toAvatarStateEvent(messageEvent.data);
    if (event) {
      dispatchAvatarState(event);
    }
  };

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

function toAvatarSpeechCue(value: unknown): AvatarSpeechCue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const cue: AvatarSpeechCue = {};

  for (const key of ["state", "viseme", "phoneme", "source"] as const) {
    if (typeof payload[key] === "string" && payload[key].length > 0) {
      cue[key] = payload[key];
    }
  }

  for (const key of ["volume", "rms", "timestamp"] as const) {
    if (typeof payload[key] === "number" && Number.isFinite(payload[key])) {
      cue[key] = payload[key];
    }
  }

  return Object.keys(cue).length > 0 ? cue : null;
}

function toAvatarPostureCue(value: unknown): AvatarPostureCue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const cue: AvatarPostureCue = {};

  if (typeof payload.preset === "string" && payload.preset.length > 0) {
    cue.preset = payload.preset;
  }

  if (typeof payload.intensity === "number" && Number.isFinite(payload.intensity)) {
    cue.intensity = payload.intensity;
  }

  for (const key of ["head", "neck", "chest", "spine"] as const) {
    const rotation = toAvatarRotationCue(payload[key]);
    if (rotation) {
      cue[key] = rotation;
    }
  }

  if (typeof payload.source === "string" && payload.source.length > 0) {
    cue.source = payload.source;
  }

  if (typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)) {
    cue.timestamp = payload.timestamp;
  }

  return Object.keys(cue).length > 0 ? cue : null;
}

function toAvatarRotationCue(value: unknown): AvatarRotationCue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const cue: AvatarRotationCue = {};
  for (const key of ["pitch", "yaw", "roll"] as const) {
    if (typeof payload[key] === "number" && Number.isFinite(payload[key])) {
      cue[key] = payload[key];
    }
  }

  return Object.keys(cue).length > 0 ? cue : null;
}
