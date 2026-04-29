import { type AvatarPhase, type AvatarStateEvent } from "../avatar/types";
import { type AvatarStateCandidate } from "./swordVoiceAgent";

export type ResolveResult =
  | { accepted: true; event: AvatarStateEvent; reason: string }
  | { accepted: false; reason: string };

type ResolverOptions = {
  preferTtsSpeaking?: boolean;
};

const ACTIVE_TTS_PHASES = new Set(["queued", "preparing", "synthesizing", "playing", "speaking"]);
const TERMINAL_TTS_PHASES = new Set(["completed", "done", "idle", "skipped", "error"]);

export class AvatarStateResolver {
  private currentTurnId = "";
  private currentPhase: AvatarPhase = "idle";
  private lastAcceptedTimestamp = 0;
  private lastTtsPhase = "";
  private lastTtsTurnId = "";
  private lastTtsAt = 0;
  private preferTtsSpeaking: boolean;

  constructor(options: ResolverOptions = {}) {
    this.preferTtsSpeaking = options.preferTtsSpeaking ?? true;
  }

  setPreferTtsSpeaking(value: boolean): void {
    this.preferTtsSpeaking = value;
  }

  reset(): void {
    this.currentTurnId = "";
    this.currentPhase = "idle";
    this.lastAcceptedTimestamp = 0;
    this.lastTtsPhase = "";
    this.lastTtsTurnId = "";
    this.lastTtsAt = 0;
  }

  resolve(candidate: AvatarStateCandidate): ResolveResult {
    const event = { ...candidate.event };
    const turnId = event.turn_id?.trim() ?? "";
    const eventTimestamp = event.timestamp ?? Date.now();

    if (this.isOlderTurn(turnId, candidate.startsTurn)) {
      return { accepted: false, reason: `ignored old turn ${turnId}` };
    }

    if (this.shouldIgnoreLowerPhase(candidate)) {
      return { accepted: false, reason: "ignored lower-priority state after speaking" };
    }

    if (candidate.sourceType === "dify.done" && this.shouldWaitForTts(turnId)) {
      return { accepted: false, reason: "ignored dify.done while waiting for TTS" };
    }

    if (candidate.sourceType === "dify.response" && this.shouldWaitForTts(turnId)) {
      event.phase = "thinking";
      event.emotion = "serious";
    }

    if (turnId && this.shouldAdoptTurn(turnId, candidate.startsTurn)) {
      this.currentTurnId = turnId;
    }

    this.currentPhase = event.phase;
    this.lastAcceptedTimestamp = Math.max(this.lastAcceptedTimestamp, eventTimestamp);

    if (candidate.sourceType === "tts.state") {
      this.lastTtsPhase = candidate.ttsPhase ?? "";
      this.lastTtsTurnId = turnId;
      this.lastTtsAt = Date.now();
    }

    if (candidate.terminal && turnId && turnId === this.currentTurnId && event.phase === "idle") {
      this.currentTurnId = "";
    }

    return { accepted: true, event, reason: "accepted" };
  }

  private isOlderTurn(turnId: string, startsTurn = false): boolean {
    if (!turnId || !this.currentTurnId || turnId === this.currentTurnId) {
      return false;
    }

    if (this.currentPhase === "idle" || startsTurn) {
      return false;
    }

    return true;
  }

  private shouldAdoptTurn(turnId: string, startsTurn = false): boolean {
    return !this.currentTurnId || turnId === this.currentTurnId || this.currentPhase === "idle" || startsTurn;
  }

  private shouldIgnoreLowerPhase(candidate: AvatarStateCandidate): boolean {
    if (this.currentPhase !== "speaking") {
      return false;
    }

    if (candidate.event.phase !== "listening" && candidate.event.phase !== "thinking") {
      return false;
    }

    const turnId = candidate.event.turn_id?.trim() ?? "";
    const startsDifferentTurn = Boolean(candidate.startsTurn && turnId && turnId !== this.currentTurnId);
    return !startsDifferentTurn;
  }

  private shouldWaitForTts(turnId: string): boolean {
    if (!this.preferTtsSpeaking || !this.lastTtsPhase) {
      return false;
    }

    if (this.lastTtsTurnId && turnId && this.lastTtsTurnId !== turnId) {
      return false;
    }

    if (TERMINAL_TTS_PHASES.has(this.lastTtsPhase)) {
      return false;
    }

    return ACTIVE_TTS_PHASES.has(this.lastTtsPhase) || Date.now() - this.lastTtsAt < 12_000;
  }
}
