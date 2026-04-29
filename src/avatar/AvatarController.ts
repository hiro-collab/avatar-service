import { Euler, MathUtils, type Object3D } from "three";
import { type VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { type AvatarEmotion, type AvatarPhase, type AvatarStateEvent } from "./types";

type HumanBoneName = (typeof VRMHumanBoneName)[keyof typeof VRMHumanBoneName];

type MotionPose = {
  headPitch: number;
  headYaw: number;
  headRoll: number;
  neckPitch: number;
  chestPitch: number;
  spinePitch: number;
  mouthOpen: number;
};

const CONTROLLED_BONES = [
  VRMHumanBoneName.Head,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Spine
] satisfies HumanBoneName[];

const ZERO_POSE: MotionPose = {
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  neckPitch: 0,
  chestPitch: 0,
  spinePitch: 0,
  mouthOpen: 0
};

export class AvatarController {
  private vrm: VRM | null = null;
  private phase: AvatarPhase = "idle";
  private emotion: AvatarEmotion = "neutral";
  private baseRotations = new Map<HumanBoneName, Euler>();
  private currentPose: MotionPose = { ...ZERO_POSE };
  private blinkValue = 0;
  private blinkProgress = 0;
  private nextBlinkAt = 1.2;
  private speechMouthLevel: number | null = null;

  setVRM(vrm: VRM | null): void {
    this.vrm = vrm;
    this.baseRotations.clear();

    if (!vrm) {
      return;
    }

    for (const boneName of CONTROLLED_BONES) {
      const bone = this.getBone(boneName);
      if (bone) {
        this.baseRotations.set(boneName, bone.rotation.clone());
      }
    }

    this.applyState({ type: "avatar_state", phase: this.phase, emotion: this.emotion });
  }

  applyState(event: AvatarStateEvent): void {
    this.phase = event.phase;
    this.emotion = event.emotion ?? this.defaultEmotionForPhase(event.phase);
    this.speechMouthLevel = this.speechLevelFromEvent(event);
  }

  update(delta: number, elapsed: number): void {
    this.updateBlink(delta, elapsed);
    this.updatePose(delta, elapsed);
    this.updateExpressions(elapsed);
    this.vrm?.update(delta);
  }

  getCurrentPhase(): AvatarPhase {
    return this.phase;
  }

  private updatePose(delta: number, elapsed: number): void {
    const target = this.getTargetPose(elapsed);

    for (const key of Object.keys(this.currentPose) as (keyof MotionPose)[]) {
      this.currentPose[key] = MathUtils.damp(this.currentPose[key], target[key], 8, delta);
    }

    this.applyBoneRotation(VRMHumanBoneName.Head, {
      x: this.currentPose.headPitch,
      y: this.currentPose.headYaw,
      z: this.currentPose.headRoll
    });
    this.applyBoneRotation(VRMHumanBoneName.Neck, {
      x: this.currentPose.neckPitch,
      y: this.currentPose.headYaw * 0.25,
      z: this.currentPose.headRoll * 0.35
    });
    this.applyBoneRotation(VRMHumanBoneName.Chest, {
      x: this.currentPose.chestPitch,
      y: 0,
      z: 0
    });
    this.applyBoneRotation(VRMHumanBoneName.UpperChest, {
      x: this.currentPose.chestPitch * 0.7,
      y: 0,
      z: 0
    });
    this.applyBoneRotation(VRMHumanBoneName.Spine, {
      x: this.currentPose.spinePitch,
      y: 0,
      z: 0
    });
  }

  private getTargetPose(elapsed: number): MotionPose {
    const breath = Math.sin(elapsed * 1.5) * 0.018;
    const smallNod = Math.sin(elapsed * 2.1) * 0.012;
    const proceduralMouth = 0.18 + Math.pow(0.5 + Math.sin(elapsed * 18) * 0.5, 1.3) * 0.78;
    const speechMouth =
      this.speechMouthLevel === null
        ? proceduralMouth
        : MathUtils.clamp(0.08 + this.speechMouthLevel * (0.62 + Math.sin(elapsed * 16) * 0.18), 0, 1);

    switch (this.phase) {
      case "listening":
        return {
          headPitch: -0.035 + smallNod,
          headYaw: Math.sin(elapsed * 0.9) * 0.018,
          headRoll: 0,
          neckPitch: -0.025,
          chestPitch: -0.085 + breath,
          spinePitch: -0.035,
          mouthOpen: 0
        };
      case "thinking":
        return {
          headPitch: 0.025,
          headYaw: -0.055 + Math.sin(elapsed * 0.8) * 0.01,
          headRoll: 0.13,
          neckPitch: 0.01,
          chestPitch: breath * 0.5,
          spinePitch: 0,
          mouthOpen: 0
        };
      case "speaking":
        return {
          headPitch: smallNod,
          headYaw: Math.sin(elapsed * 1.6) * 0.02,
          headRoll: Math.sin(elapsed * 1.2) * 0.018,
          neckPitch: 0,
          chestPitch: -0.035 + breath,
          spinePitch: -0.012,
          mouthOpen: speechMouth
        };
      case "error":
        return {
          headPitch: 0.07,
          headYaw: 0,
          headRoll: -0.09,
          neckPitch: 0.025,
          chestPitch: 0.045 + breath * 0.4,
          spinePitch: 0.02,
          mouthOpen: 0
        };
      case "idle":
      default:
        return {
          headPitch: breath * 0.45,
          headYaw: Math.sin(elapsed * 0.45) * 0.012,
          headRoll: Math.sin(elapsed * 0.35) * 0.01,
          neckPitch: 0,
          chestPitch: breath,
          spinePitch: breath * 0.35,
          mouthOpen: 0
        };
    }
  }

  private updateBlink(delta: number, elapsed: number): void {
    if (this.blinkProgress > 0 || elapsed >= this.nextBlinkAt) {
      this.blinkProgress += delta;
      const duration = 0.18;
      const t = Math.min(this.blinkProgress / duration, 1);
      this.blinkValue = t < 0.5 ? t * 2 : (1 - t) * 2;

      if (t >= 1) {
        this.blinkProgress = 0;
        this.blinkValue = 0;
        this.nextBlinkAt = elapsed + 2.1 + Math.random() * 2.8;
      }
    }
  }

  private updateExpressions(elapsed: number): void {
    const manager = this.vrm?.expressionManager;
    if (!manager) {
      return;
    }

    manager.resetValues();
    for (const [name, value] of Object.entries(this.getEmotionExpressionWeights())) {
      this.setExpression(name, value);
    }

    this.setExpression("blink", this.blinkValue);

    if (this.currentPose.mouthOpen > 0.02) {
      const mouthNames = ["aa", "ih", "ou"];
      const activeMouth = mouthNames[Math.floor(elapsed * 8) % mouthNames.length];
      this.setExpression(activeMouth, this.currentPose.mouthOpen);
    }

    manager.update();
  }

  private getEmotionExpressionWeights(): Record<string, number> {
    if (this.phase === "error") {
      return { sad: 0.65, surprised: 0.2 };
    }

    switch (this.emotion) {
      case "happy":
        return { happy: 0.75, relaxed: 0.25 };
      case "serious":
        return { angry: 0.16 };
      case "surprised":
        return { surprised: 0.72 };
      case "troubled":
        return { sad: 0.55, surprised: 0.12 };
      case "neutral":
      default:
        return {};
    }
  }

  private defaultEmotionForPhase(phase: AvatarPhase): AvatarEmotion {
    switch (phase) {
      case "error":
        return "troubled";
      case "thinking":
        return "serious";
      default:
        return "neutral";
    }
  }

  private speechLevelFromEvent(event: AvatarStateEvent): number | null {
    if (event.phase !== "speaking") {
      return null;
    }

    const value = event.speech?.rms ?? event.speech?.volume;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }

    return MathUtils.clamp(value, 0, 1);
  }

  private setExpression(name: string, value: number): void {
    const manager = this.vrm?.expressionManager;
    if (!manager || !manager.getExpression(name)) {
      return;
    }

    manager.setValue(name, MathUtils.clamp(value, 0, 1));
  }

  private applyBoneRotation(
    name: HumanBoneName,
    offset: {
      x: number;
      y: number;
      z: number;
    }
  ): void {
    const bone = this.getBone(name);
    const base = this.baseRotations.get(name);
    if (!bone || !base) {
      return;
    }

    bone.rotation.set(base.x + offset.x, base.y + offset.y, base.z + offset.z);
  }

  private getBone(name: HumanBoneName): Object3D | null {
    return this.vrm?.humanoid.getNormalizedBoneNode(name) ?? null;
  }
}
