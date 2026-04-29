import { type AvatarEmotion, type AvatarPhase, type AvatarSpeechCue, type AvatarStateEvent } from "../avatar/types";

export type SwordVoiceAgentEvent = {
  event_id?: string;
  type?: string;
  timestamp?: number;
  source?: string;
  turn_id?: string | null;
  payload?: unknown;
  data?: unknown;
};

export type AvatarStateCandidate = {
  event: AvatarStateEvent;
  sourceType: string;
  eventId?: string;
  rawTimestamp?: number;
  startsTurn?: boolean;
  terminal?: boolean;
  ttsPhase?: string;
};

export class SwordVoiceAgentAdapter {
  toAvatarState(value: unknown, eventName?: string): AvatarStateCandidate | null {
    if (!isRecord(value)) {
      return null;
    }

    const raw = value as SwordVoiceAgentEvent;
    const sourceType = stringValue(raw.type || eventName);
    if (!sourceType) {
      return null;
    }

    if (isErrorEvent(sourceType, raw)) {
      return this.makeCandidate(raw, sourceType, {
        phase: "error",
        emotion: "troubled",
        text: errorText(raw)
      });
    }

    if (sourceType === "gesture.received") {
      return this.mapGestureReceived(raw, sourceType);
    }

    if (sourceType.startsWith("ai_core.")) {
      return this.mapAiCore(raw, sourceType);
    }

    if (sourceType === "dify.first_token") {
      return this.makeCandidate(raw, sourceType, {
        phase: "thinking",
        emotion: "serious"
      });
    }

    if (sourceType === "dify.response") {
      return this.mapDifyResponse(raw, sourceType);
    }

    if (sourceType === "dify.done") {
      return this.makeCandidate(raw, sourceType, {
        phase: "idle",
        emotion: "neutral",
        terminal: true
      });
    }

    if (sourceType === "tts.state") {
      return this.mapTtsState(raw, sourceType);
    }

    return null;
  }

  private mapGestureReceived(raw: SwordVoiceAgentEvent, sourceType: string): AvatarStateCandidate {
    const payload = eventPayload(raw);
    const response = recordValue(payload.response);
    const decision = recordValue(response.gate_decision);
    const voiceState = recordValue(response.voice_state);
    const command = recordValue(response.voice_control_command);
    const inputGate = recordValue(response.input_gate_response);
    const action = stringValue(command.action);
    const active = booleanValue(decision.raw_active) || booleanValue(decision.active);
    const inputEnabled =
      booleanValue(voiceState.mic_enabled) ||
      booleanValue(voiceState.input_enabled) ||
      booleanValue(inputGate.mic_enabled) ||
      booleanValue(inputGate.input_enabled);
    const hasVoiceCommand = Boolean(action && action !== "none");
    const turnId = stringValue(command.turn_id) || stringValue(raw.turn_id);

    return this.makeCandidate(raw, sourceType, {
      phase: hasVoiceCommand ? "thinking" : active || inputEnabled ? "listening" : "idle",
      emotion: hasVoiceCommand ? "serious" : "neutral",
      gesture: active ? "sword_sign" : "none",
      turnId,
      text: hasVoiceCommand ? action : undefined,
      startsTurn: active || inputEnabled || hasVoiceCommand
    });
  }

  private mapAiCore(raw: SwordVoiceAgentEvent, sourceType: string): AvatarStateCandidate | null {
    const eventName = sourceType.slice("ai_core.".length);
    const payload = eventPayload(raw);
    const text = stringValue(payload.transcript || payload.command || payload.text);

    if (eventName.includes("completed") || eventName.includes("done")) {
      return this.makeCandidate(raw, sourceType, {
        phase: "idle",
        emotion: "neutral",
        terminal: true
      });
    }

    if (eventName.includes("stt_final") || eventName.includes("voice_command")) {
      return this.makeCandidate(raw, sourceType, {
        phase: "thinking",
        emotion: "serious",
        text,
        startsTurn: true
      });
    }

    if (eventName.includes("listening") || eventName.includes("recording")) {
      return this.makeCandidate(raw, sourceType, {
        phase: "listening",
        emotion: "neutral",
        startsTurn: true
      });
    }

    return null;
  }

  private mapDifyResponse(raw: SwordVoiceAgentEvent, sourceType: string): AvatarStateCandidate {
    const payload = eventPayload(raw);
    const skipped = booleanValue(payload.skipped);
    const text = stringValue(payload.response_text || payload.text || payload.answer);

    if (skipped) {
      return this.makeCandidate(raw, sourceType, {
        phase: "error",
        emotion: "troubled",
        text: stringValue(payload.skip_reason) || undefined,
        terminal: true
      });
    }

    return this.makeCandidate(raw, sourceType, {
      phase: "speaking",
      emotion: "happy",
      text
    });
  }

  private mapTtsState(raw: SwordVoiceAgentEvent, sourceType: string): AvatarStateCandidate {
    const payload = eventPayload(raw);
    const phase = stringValue(payload.phase).toLowerCase();
    const hasError = phase === "error" || Boolean(stringValue(payload.error));
    let avatarPhase: AvatarPhase = "thinking";
    let emotion: AvatarEmotion = "serious";
    let terminal = false;

    if (hasError) {
      avatarPhase = "error";
      emotion = "troubled";
      terminal = true;
    } else if (phase === "speaking") {
      avatarPhase = "speaking";
      emotion = "happy";
    } else if (["completed", "done", "idle", "skipped"].includes(phase)) {
      avatarPhase = "idle";
      emotion = "neutral";
      terminal = true;
    }

    return this.makeCandidate(raw, sourceType, {
      phase: avatarPhase,
      emotion,
      text: stringValue(payload.text) || undefined,
      terminal,
      ttsPhase: phase,
      speech: speechCueFromTtsPayload(payload, phase)
    });
  }

  private makeCandidate(
    raw: SwordVoiceAgentEvent,
    sourceType: string,
    options: {
      phase: AvatarPhase;
      emotion: AvatarEmotion;
      gesture?: string;
      text?: string;
      turnId?: string;
      startsTurn?: boolean;
      terminal?: boolean;
      ttsPhase?: string;
      speech?: AvatarSpeechCue;
    }
  ): AvatarStateCandidate {
    const payload = eventPayload(raw);
    const turnId = options.turnId || stringValue(raw.turn_id) || stringValue(payload.turn_id);
    const event: AvatarStateEvent = {
      type: "avatar_state",
      phase: options.phase,
      emotion: options.emotion,
      gesture: options.gesture,
      speech: options.speech,
      turn_id: turnId || undefined,
      text: cleanText(options.text),
      timestamp: timestampMs(raw.timestamp)
    };

    return {
      event,
      sourceType,
      eventId: stringValue(raw.event_id) || undefined,
      rawTimestamp: raw.timestamp,
      startsTurn: options.startsTurn,
      terminal: options.terminal,
      ttsPhase: options.ttsPhase
    };
  }
}

function eventPayload(raw: SwordVoiceAgentEvent): Record<string, unknown> {
  return recordValue(raw.payload) || recordValue(raw.data);
}

function isErrorEvent(sourceType: string, raw: SwordVoiceAgentEvent): boolean {
  if (sourceType.endsWith(".error") || sourceType.includes("error")) {
    return true;
  }
  const payload = eventPayload(raw);
  return Boolean(stringValue(payload.error));
}

function errorText(raw: SwordVoiceAgentEvent): string | undefined {
  const payload = eventPayload(raw);
  return stringValue(payload.error || payload.message || payload.reason) || undefined;
}

function timestampMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Date.now();
  }
  return value > 1_000_000_000_000 ? value : Math.round(value * 1_000);
}

function cleanText(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text || text === "[redacted]") {
    return undefined;
  }
  return text;
}

function speechCueFromTtsPayload(payload: Record<string, unknown>, phase: string): AvatarSpeechCue {
  const speech: AvatarSpeechCue = {
    state: phase || "speaking",
    source: "tts.state"
  };

  const rms = numberValue(payload.rms);
  const volume = numberValue(payload.volume ?? payload.app_volume);
  if (rms !== null) {
    speech.rms = rms;
  }
  if (volume !== null) {
    speech.volume = volume;
  }

  const viseme = stringValue(payload.viseme);
  const phoneme = stringValue(payload.phoneme);
  if (viseme) {
    speech.viseme = viseme;
  }
  if (phoneme) {
    speech.phoneme = phoneme;
  }

  return speech;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}
