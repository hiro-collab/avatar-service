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

export type AvatarPosturePreset =
  | "auto"
  | "neutral"
  | "attentive"
  | "thinking"
  | "speaking"
  | "bow"
  | "lean_forward"
  | "lean_back"
  | "look_left"
  | "look_right"
  | "nod"
  | "shake"
  | string;

export type AvatarRotationCue = {
  pitch?: number;
  yaw?: number;
  roll?: number;
};

export type AvatarPostureCue = {
  preset?: AvatarPosturePreset;
  intensity?: number;
  head?: AvatarRotationCue;
  neck?: AvatarRotationCue;
  chest?: AvatarRotationCue;
  spine?: AvatarRotationCue;
  source?: string;
  timestamp?: number;
};

export type AvatarStateEvent = {
  type: "avatar_state";
  turn_id?: string;
  phase: AvatarPhase;
  emotion?: AvatarEmotion;
  gesture?: "sword_sign" | "none" | string;
  posture?: AvatarPostureCue;
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
