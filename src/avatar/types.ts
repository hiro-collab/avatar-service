export const AVATAR_PHASES = ["idle", "listening", "thinking", "speaking", "error"] as const;
export type AvatarPhase = (typeof AVATAR_PHASES)[number];

export const AVATAR_EMOTIONS = ["neutral", "happy", "serious", "surprised", "troubled"] as const;
export type AvatarEmotion = (typeof AVATAR_EMOTIONS)[number];

export type AvatarSpeechCue = {
  state?: "idle" | "preparing" | "speaking" | "completed" | "error" | string;
  volume?: number;
  rms?: number;
  viseme?: string;
  phoneme?: string;
  source?: string;
  timestamp?: number;
};

export type AvatarStateEvent = {
  type: "avatar_state";
  turn_id?: string;
  phase: AvatarPhase;
  emotion?: AvatarEmotion;
  gesture?: "sword_sign" | "none" | string;
  speech?: AvatarSpeechCue;
  text?: string;
  timestamp?: number;
};

export function isAvatarPhase(value: unknown): value is AvatarPhase {
  return typeof value === "string" && AVATAR_PHASES.includes(value as AvatarPhase);
}

export function isAvatarEmotion(value: unknown): value is AvatarEmotion {
  return typeof value === "string" && AVATAR_EMOTIONS.includes(value as AvatarEmotion);
}
