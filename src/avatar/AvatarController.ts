import { Euler, MathUtils, Vector3, type Object3D } from "three";
import { type VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { type AvatarEmotion, type AvatarPhase, type AvatarPostureCue, type AvatarStateEvent } from "./types";

type HumanBoneName = (typeof VRMHumanBoneName)[keyof typeof VRMHumanBoneName];

type MotionPose = {
  headPitch: number;
  headYaw: number;
  headRoll: number;
  neckPitch: number;
  chestPitch: number;
  spinePitch: number;
  leftUpperArmPitch: number;
  leftUpperArmYaw: number;
  leftUpperArmRoll: number;
  rightUpperArmPitch: number;
  rightUpperArmYaw: number;
  rightUpperArmRoll: number;
  leftLowerArmPitch: number;
  leftLowerArmYaw: number;
  leftLowerArmRoll: number;
  rightLowerArmPitch: number;
  rightLowerArmYaw: number;
  rightLowerArmRoll: number;
  leftHandPitch: number;
  leftHandYaw: number;
  leftHandRoll: number;
  rightHandPitch: number;
  rightHandYaw: number;
  rightHandRoll: number;
  mouthOpen: number;
};

type PostureOffset = Partial<MotionPose>;

type ArmPose = Pick<
  MotionPose,
  | "leftUpperArmPitch"
  | "leftUpperArmYaw"
  | "leftUpperArmRoll"
  | "rightUpperArmPitch"
  | "rightUpperArmYaw"
  | "rightUpperArmRoll"
  | "leftLowerArmPitch"
  | "leftLowerArmYaw"
  | "leftLowerArmRoll"
  | "rightLowerArmPitch"
  | "rightLowerArmYaw"
  | "rightLowerArmRoll"
  | "leftHandPitch"
  | "leftHandYaw"
  | "leftHandRoll"
  | "rightHandPitch"
  | "rightHandYaw"
  | "rightHandRoll"
>;

type RotationCueTarget =
  | "head"
  | "neck"
  | "chest"
  | "spine"
  | "leftUpperArm"
  | "rightUpperArm"
  | "leftLowerArm"
  | "rightLowerArm"
  | "leftHand"
  | "rightHand";

const CONTROLLED_BONES = [
  VRMHumanBoneName.Head,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightHand
] satisfies HumanBoneName[];

const ZERO_POSE: MotionPose = {
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  neckPitch: 0,
  chestPitch: 0,
  spinePitch: 0,
  leftUpperArmPitch: 0,
  leftUpperArmYaw: 0,
  leftUpperArmRoll: 0,
  rightUpperArmPitch: 0,
  rightUpperArmYaw: 0,
  rightUpperArmRoll: 0,
  leftLowerArmPitch: 0,
  leftLowerArmYaw: 0,
  leftLowerArmRoll: 0,
  rightLowerArmPitch: 0,
  rightLowerArmYaw: 0,
  rightLowerArmRoll: 0,
  leftHandPitch: 0,
  leftHandYaw: 0,
  leftHandRoll: 0,
  rightHandPitch: 0,
  rightHandYaw: 0,
  rightHandRoll: 0,
  mouthOpen: 0
};

const DEFAULT_ARM_REST_POSE: ArmPose = {
  leftUpperArmPitch: 0,
  leftUpperArmYaw: 0,
  leftUpperArmRoll: 1.05,
  rightUpperArmPitch: 0,
  rightUpperArmYaw: 0,
  rightUpperArmRoll: -1.05,
  leftLowerArmPitch: 0.04,
  leftLowerArmYaw: 0,
  leftLowerArmRoll: 0.12,
  rightLowerArmPitch: 0.04,
  rightLowerArmYaw: 0,
  rightLowerArmRoll: -0.12,
  leftHandPitch: 0,
  leftHandYaw: 0,
  leftHandRoll: 0.04,
  rightHandPitch: 0,
  rightHandYaw: 0,
  rightHandRoll: -0.04
};

const POSTURE_OFFSET_KEYS = Object.keys(ZERO_POSE).filter((key) => key !== "mouthOpen") as (keyof MotionPose)[];

const tempWorldPositionA = new Vector3();
const tempWorldPositionB = new Vector3();

export class AvatarController {
  private vrm: VRM | null = null;
  private phase: AvatarPhase = "idle";
  private emotion: AvatarEmotion = "neutral";
  private baseRotations = new Map<HumanBoneName, Euler>();
  private currentPose: MotionPose = { ...ZERO_POSE };
  private armRestPose: ArmPose = { ...DEFAULT_ARM_REST_POSE };
  private blinkValue = 0;
  private blinkProgress = 0;
  private nextBlinkAt = 1.2;
  private posture: AvatarPostureCue | null = null;
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

    this.armRestPose = this.estimateArmRestPose();
    this.currentPose = { ...this.currentPose, ...this.armRestPose };
    this.applyState({ type: "avatar_state", phase: this.phase, emotion: this.emotion });
  }

  applyState(event: AvatarStateEvent): void {
    this.phase = event.phase;
    this.emotion = event.emotion ?? this.defaultEmotionForPhase(event.phase);
    this.posture = event.posture ?? null;
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
    const target = this.applyPostureCue(this.getTargetPose(elapsed), elapsed);

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
    this.applyBoneRotation(VRMHumanBoneName.LeftUpperArm, {
      x: this.currentPose.leftUpperArmPitch,
      y: this.currentPose.leftUpperArmYaw,
      z: this.currentPose.leftUpperArmRoll
    });
    this.applyBoneRotation(VRMHumanBoneName.RightUpperArm, {
      x: this.currentPose.rightUpperArmPitch,
      y: this.currentPose.rightUpperArmYaw,
      z: this.currentPose.rightUpperArmRoll
    });
    this.applyBoneRotation(VRMHumanBoneName.LeftLowerArm, {
      x: this.currentPose.leftLowerArmPitch,
      y: this.currentPose.leftLowerArmYaw,
      z: this.currentPose.leftLowerArmRoll
    });
    this.applyBoneRotation(VRMHumanBoneName.RightLowerArm, {
      x: this.currentPose.rightLowerArmPitch,
      y: this.currentPose.rightLowerArmYaw,
      z: this.currentPose.rightLowerArmRoll
    });
    this.applyBoneRotation(VRMHumanBoneName.LeftHand, {
      x: this.currentPose.leftHandPitch,
      y: this.currentPose.leftHandYaw,
      z: this.currentPose.leftHandRoll
    });
    this.applyBoneRotation(VRMHumanBoneName.RightHand, {
      x: this.currentPose.rightHandPitch,
      y: this.currentPose.rightHandYaw,
      z: this.currentPose.rightHandRoll
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
        return this.withBasePose({
          headPitch: -0.035 + smallNod,
          headYaw: Math.sin(elapsed * 0.9) * 0.018,
          headRoll: 0,
          neckPitch: -0.025,
          chestPitch: -0.085 + breath,
          spinePitch: -0.035,
          mouthOpen: 0
        });
      case "thinking":
        return this.withBasePose({
          headPitch: 0.025,
          headYaw: -0.055 + Math.sin(elapsed * 0.8) * 0.01,
          headRoll: 0.13,
          neckPitch: 0.01,
          chestPitch: breath * 0.5,
          spinePitch: 0,
          mouthOpen: 0
        });
      case "speaking":
        return this.withBasePose({
          headPitch: smallNod,
          headYaw: Math.sin(elapsed * 1.6) * 0.02,
          headRoll: Math.sin(elapsed * 1.2) * 0.018,
          neckPitch: 0,
          chestPitch: -0.035 + breath,
          spinePitch: -0.012,
          mouthOpen: speechMouth
        });
      case "error":
        return this.withBasePose({
          headPitch: 0.07,
          headYaw: 0,
          headRoll: -0.09,
          neckPitch: 0.025,
          chestPitch: 0.045 + breath * 0.4,
          spinePitch: 0.02,
          mouthOpen: 0
        });
      case "idle":
      default:
        return this.withBasePose({
          headPitch: breath * 0.45,
          headYaw: Math.sin(elapsed * 0.45) * 0.012,
          headRoll: Math.sin(elapsed * 0.35) * 0.01,
          neckPitch: 0,
          chestPitch: breath,
          spinePitch: breath * 0.35,
          mouthOpen: 0
        });
    }
  }

  private withBasePose(overrides: Partial<MotionPose>): MotionPose {
    return {
      ...ZERO_POSE,
      ...this.armRestPose,
      ...overrides
    };
  }

  private applyPostureCue(basePose: MotionPose, elapsed: number): MotionPose {
    if (!this.posture || this.posture.preset === "auto") {
      return basePose;
    }

    const intensity = MathUtils.clamp(this.posture.intensity ?? 1, 0, 1);
    const offset = this.getPosturePresetOffset(this.posture.preset, elapsed);
    const pose: MotionPose = { ...basePose };

    for (const key of POSTURE_OFFSET_KEYS) {
      pose[key] += (offset[key] ?? 0) * intensity;
    }

    this.applyRotationCue(pose, "head", intensity);
    this.applyRotationCue(pose, "neck", intensity);
    this.applyRotationCue(pose, "chest", intensity);
    this.applyRotationCue(pose, "spine", intensity);
    this.applyRotationCue(pose, "leftUpperArm", intensity);
    this.applyRotationCue(pose, "rightUpperArm", intensity);
    this.applyRotationCue(pose, "leftLowerArm", intensity);
    this.applyRotationCue(pose, "rightLowerArm", intensity);
    this.applyRotationCue(pose, "leftHand", intensity);
    this.applyRotationCue(pose, "rightHand", intensity);

    return pose;
  }

  private getPosturePresetOffset(preset: string | undefined, elapsed: number): PostureOffset {
    switch (preset) {
      case "neutral":
        return {
          headPitch: 0,
          headYaw: 0,
          headRoll: 0,
          neckPitch: 0,
          chestPitch: 0,
          spinePitch: 0
        };
      case "attentive":
        return {
          headPitch: -0.035,
          neckPitch: -0.02,
          chestPitch: -0.075,
          spinePitch: -0.025,
          leftUpperArmPitch: -0.035,
          rightUpperArmPitch: -0.035
        };
      case "thinking":
        return {
          headPitch: 0.025,
          headYaw: -0.035,
          headRoll: 0.12,
          chestPitch: 0.015,
          leftLowerArmPitch: 0.035,
          rightLowerArmPitch: 0.035
        };
      case "speaking":
        return {
          headPitch: Math.sin(elapsed * 2.2) * 0.018,
          headYaw: Math.sin(elapsed * 1.4) * 0.02,
          chestPitch: -0.035,
          spinePitch: -0.012,
          leftUpperArmYaw: Math.sin(elapsed * 1.7) * 0.035,
          rightUpperArmYaw: -Math.sin(elapsed * 1.7) * 0.035
        };
      case "bow":
        return {
          headPitch: 0.1,
          neckPitch: 0.055,
          chestPitch: -0.2,
          spinePitch: -0.08,
          leftUpperArmPitch: 0.035,
          rightUpperArmPitch: 0.035
        };
      case "lean_forward":
        return { headPitch: -0.025, neckPitch: -0.02, chestPitch: -0.13, spinePitch: -0.05 };
      case "lean_back":
        return { headPitch: 0.035, neckPitch: 0.015, chestPitch: 0.095, spinePitch: 0.045 };
      case "look_left":
        return { headYaw: 0.24, headRoll: -0.025 };
      case "look_right":
        return { headYaw: -0.24, headRoll: 0.025 };
      case "nod":
        return { headPitch: Math.sin(elapsed * 5.6) * 0.11, neckPitch: Math.sin(elapsed * 5.6) * 0.035 };
      case "shake":
        return { headYaw: Math.sin(elapsed * 6.4) * 0.16, neckPitch: 0.005 };
      default:
        return {};
    }
  }

  private applyRotationCue(pose: MotionPose, target: RotationCueTarget, intensity: number): void {
    const rotation = this.posture?.[target];
    if (!rotation) {
      return;
    }

    const pitch = MathUtils.clamp(rotation.pitch ?? 0, -0.7, 0.7) * intensity;
    const yaw = MathUtils.clamp(rotation.yaw ?? 0, -0.7, 0.7) * intensity;
    const roll = MathUtils.clamp(rotation.roll ?? 0, -0.7, 0.7) * intensity;

    if (target === "head") {
      pose.headPitch += pitch;
      pose.headYaw += yaw;
      pose.headRoll += roll;
    } else if (target === "neck") {
      pose.neckPitch += pitch;
      pose.headYaw += yaw * 0.35;
      pose.headRoll += roll * 0.35;
    } else if (target === "chest") {
      pose.chestPitch += pitch;
      pose.headYaw += yaw * 0.12;
      pose.headRoll += roll * 0.12;
    } else if (target === "spine") {
      pose.spinePitch += pitch;
      pose.chestPitch += yaw * 0.08;
      pose.headRoll += roll * 0.08;
    } else if (target === "leftUpperArm") {
      pose.leftUpperArmPitch += pitch;
      pose.leftUpperArmYaw += yaw;
      pose.leftUpperArmRoll += roll;
    } else if (target === "rightUpperArm") {
      pose.rightUpperArmPitch += pitch;
      pose.rightUpperArmYaw += yaw;
      pose.rightUpperArmRoll += roll;
    } else if (target === "leftLowerArm") {
      pose.leftLowerArmPitch += pitch;
      pose.leftLowerArmYaw += yaw;
      pose.leftLowerArmRoll += roll;
    } else if (target === "rightLowerArm") {
      pose.rightLowerArmPitch += pitch;
      pose.rightLowerArmYaw += yaw;
      pose.rightLowerArmRoll += roll;
    } else if (target === "leftHand") {
      pose.leftHandPitch += pitch;
      pose.leftHandYaw += yaw;
      pose.leftHandRoll += roll;
    } else {
      pose.rightHandPitch += pitch;
      pose.rightHandYaw += yaw;
      pose.rightHandRoll += roll;
    }
  }

  private estimateArmRestPose(): ArmPose {
    this.vrm?.scene.updateMatrixWorld(true);

    const leftUpperArmRoll = this.estimateUpperArmDropRoll(
      VRMHumanBoneName.LeftUpperArm,
      VRMHumanBoneName.LeftLowerArm,
      DEFAULT_ARM_REST_POSE.leftUpperArmRoll
    );
    const rightUpperArmRoll = this.estimateUpperArmDropRoll(
      VRMHumanBoneName.RightUpperArm,
      VRMHumanBoneName.RightLowerArm,
      DEFAULT_ARM_REST_POSE.rightUpperArmRoll
    );

    return {
      leftUpperArmPitch: 0,
      leftUpperArmYaw: 0,
      leftUpperArmRoll,
      rightUpperArmPitch: 0,
      rightUpperArmYaw: 0,
      rightUpperArmRoll,
      leftLowerArmPitch: DEFAULT_ARM_REST_POSE.leftLowerArmPitch,
      leftLowerArmYaw: 0,
      leftLowerArmRoll: leftUpperArmRoll * 0.12,
      rightLowerArmPitch: DEFAULT_ARM_REST_POSE.rightLowerArmPitch,
      rightLowerArmYaw: 0,
      rightLowerArmRoll: rightUpperArmRoll * 0.12,
      leftHandPitch: 0,
      leftHandYaw: 0,
      leftHandRoll: leftUpperArmRoll * 0.04,
      rightHandPitch: 0,
      rightHandYaw: 0,
      rightHandRoll: rightUpperArmRoll * 0.04
    };
  }

  private estimateUpperArmDropRoll(upperArmName: HumanBoneName, lowerArmName: HumanBoneName, fallback: number): number {
    const upperArm = this.getBone(upperArmName);
    const lowerArm = this.getBone(lowerArmName);
    if (!upperArm || !lowerArm) {
      return fallback;
    }

    upperArm.getWorldPosition(tempWorldPositionA);
    lowerArm.getWorldPosition(tempWorldPositionB);
    const armDirection = tempWorldPositionB.sub(tempWorldPositionA);
    if (armDirection.lengthSq() < 0.000001) {
      return fallback;
    }

    const targetRoll = Math.atan2(armDirection.x, -armDirection.y) * 0.72;
    return MathUtils.clamp(targetRoll, -1.12, 1.12);
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
