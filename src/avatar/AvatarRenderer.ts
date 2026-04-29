import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { type VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { AvatarController } from "./AvatarController";

export type AvatarLoadStatus =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string; fileName: string }
  | { status: "loaded"; message: string; fileName: string }
  | { status: "error"; message: string; fileName?: string };

export type CameraProjection = "perspective" | "orthographic";

export type AvatarViewSettings = {
  projection: CameraProjection;
  cameraDistance: number;
  cameraFov: number;
  orthographicWidth: number;
  avatarHeight: number;
  lightHeight: number;
};

export const DEFAULT_AVATAR_VIEW_SETTINGS: AvatarViewSettings = {
  projection: "perspective",
  cameraDistance: 3.1,
  cameraFov: 28,
  orthographicWidth: 2.1,
  avatarHeight: 1.7,
  lightHeight: 1.25
};

type AvatarMeasurement = {
  centerX: number;
  centerZ: number;
  minY: number;
  height: number;
};

export class AvatarRenderer {
  private readonly scene = new THREE.Scene();
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(DEFAULT_AVATAR_VIEW_SETTINGS.cameraFov, 1, 0.01, 100);
  private readonly orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly loader = new GLTFLoader();
  private readonly resizeObserver: ResizeObserver;
  private readonly keyLightTarget = new THREE.Object3D();
  private readonly fillLightTarget = new THREE.Object3D();
  private activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspectiveCamera;
  private keyLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private currentVrm: VRM | null = null;
  private avatarMeasurement: AvatarMeasurement | null = null;
  private viewSettings: AvatarViewSettings = { ...DEFAULT_AVATAR_VIEW_SETTINGS };
  private viewportAspect = 1;
  private frameId = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly controller: AvatarController,
    private readonly onStatus: (status: AvatarLoadStatus) => void
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.activeCamera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 9.5;

    this.loader.register((parser) => new VRMLoaderPlugin(parser));

    this.setupScene();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.animate();
  }

  async loadVRMFile(file: File): Promise<void> {
    this.onStatus({ status: "loading", message: "Loading model", fileName: file.name });
    const fileUrl = URL.createObjectURL(file);

    try {
      await this.loadVRMSource(fileUrl);
      this.onStatus({ status: "loaded", message: "Model loaded", fileName: file.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load model";
      this.onStatus({ status: "error", message, fileName: file.name });
      throw error;
    } finally {
      URL.revokeObjectURL(fileUrl);
    }
  }

  async loadVRMUrl(url: string): Promise<void> {
    const label = urlLabel(url);
    this.onStatus({ status: "loading", message: "Loading model", fileName: label });

    try {
      await this.loadVRMSource(url);
      this.onStatus({ status: "loaded", message: "Model loaded", fileName: label });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load model";
      this.onStatus({ status: "error", message, fileName: label });
      throw error;
    }
  }

  setBackgroundColor(color: string): void {
    this.scene.background = new THREE.Color(color);
  }

  setViewSettings(settings: Partial<AvatarViewSettings>): AvatarViewSettings {
    const next = normalizeViewSettings({
      ...this.viewSettings,
      ...settings
    });
    const projectionChanged = next.projection !== this.viewSettings.projection;
    this.viewSettings = next;

    if (projectionChanged) {
      this.setActiveProjection(next.projection);
    }

    this.applyAvatarLayout();
    this.updateCamera();
    this.updateLighting();
    return this.getViewSettings();
  }

  getViewSettings(): AvatarViewSettings {
    return { ...this.viewSettings };
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.setCurrentVRM(null);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private setupScene(): void {
    this.setBackgroundColor("#f3f4f1");

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x667064, 2.2);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.target = this.keyLightTarget;
    this.keyLight = keyLight;
    this.scene.add(this.keyLightTarget);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xaec7ba, 1.2);
    fillLight.target = this.fillLightTarget;
    this.fillLight = fillLight;
    this.scene.add(this.fillLightTarget);
    this.scene.add(fillLight);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1.35, 64),
      new THREE.MeshBasicMaterial({ color: 0xdde2dc, transparent: true, opacity: 0.72 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(2.7, 18, 0xb6beb5, 0xd1d6cf);
    grid.position.y = 0;
    this.scene.add(grid);

    this.updateCamera();
    this.updateLighting();
  }

  private async loadVRMSource(url: string): Promise<void> {
    const gltf = await this.loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) {
      throw new Error("The selected file did not contain VRM data.");
    }

    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.removeUnnecessaryJoints(vrm.scene);
    VRMUtils.rotateVRM0(vrm);

    this.setCurrentVRM(vrm);
    this.measureCurrentAvatar();
    this.applyAvatarLayout();
    this.updateCamera();
  }

  private setCurrentVRM(vrm: VRM | null): void {
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      this.disposeObject(this.currentVrm.scene);
    }

    if (vrm) {
      vrm.scene.scale.setScalar(1);
      vrm.scene.position.set(0, 0, 0);
      vrm.scene.rotation.y = Math.PI;
      if (vrm.lookAt) {
        vrm.lookAt.target = this.activeCamera;
      }
      this.scene.add(vrm.scene);
    }

    this.currentVrm = vrm;
    this.avatarMeasurement = null;
    this.controller.setVRM(vrm);
  }

  private measureCurrentAvatar(): void {
    if (!this.currentVrm) {
      this.avatarMeasurement = null;
      return;
    }

    const avatar = this.currentVrm.scene;
    avatar.scale.setScalar(1);
    avatar.position.set(0, 0, 0);
    avatar.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(avatar);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    this.avatarMeasurement = {
      centerX: center.x,
      centerZ: center.z,
      minY: box.min.y,
      height: Math.max(size.y, 0.01)
    };
  }

  private applyAvatarLayout(): void {
    if (!this.currentVrm || !this.avatarMeasurement) {
      return;
    }

    const scale = this.viewSettings.avatarHeight / this.avatarMeasurement.height;
    this.currentVrm.scene.scale.setScalar(scale);
    this.currentVrm.scene.position.set(
      -this.avatarMeasurement.centerX * scale,
      -this.avatarMeasurement.minY * scale,
      -this.avatarMeasurement.centerZ * scale
    );
    this.currentVrm.scene.updateMatrixWorld(true);
  }

  private setActiveProjection(projection: CameraProjection): void {
    const previousCamera = this.activeCamera;
    this.activeCamera = projection === "orthographic" ? this.orthographicCamera : this.perspectiveCamera;
    this.activeCamera.position.copy(previousCamera.position);
    this.activeCamera.quaternion.copy(previousCamera.quaternion);
    this.controls.object = this.activeCamera;

    if (this.currentVrm?.lookAt) {
      this.currentVrm.lookAt.target = this.activeCamera;
    }
  }

  private updateCamera(): void {
    const targetHeight = THREE.MathUtils.clamp(this.viewSettings.avatarHeight * 0.68, 0.35, 2.2);
    const nextTarget = new THREE.Vector3(0, targetHeight, 0);
    const direction = this.activeCamera.position.clone().sub(this.controls.target);

    if (direction.lengthSq() < 0.000001) {
      direction.set(0, 0.04, 1);
    }

    direction.normalize().multiplyScalar(this.viewSettings.cameraDistance);
    this.controls.target.copy(nextTarget);
    this.activeCamera.position.copy(nextTarget).add(direction);
    this.activeCamera.lookAt(this.controls.target);
    this.updateProjection();
    this.controls.update();
  }

  private updateProjection(): void {
    this.perspectiveCamera.aspect = this.viewportAspect;
    this.perspectiveCamera.fov = this.viewSettings.cameraFov;
    this.perspectiveCamera.updateProjectionMatrix();

    const halfWidth = this.viewSettings.orthographicWidth / 2;
    const halfHeight = halfWidth / this.viewportAspect;
    this.orthographicCamera.left = -halfWidth;
    this.orthographicCamera.right = halfWidth;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.orthographicCamera.updateProjectionMatrix();
  }

  private updateLighting(): void {
    const lightHeight = this.viewSettings.lightHeight;
    this.keyLightTarget.position.set(0, lightHeight, 0);
    this.fillLightTarget.position.set(0, lightHeight, 0);

    if (this.keyLight) {
      this.keyLight.position.set(2.3, lightHeight + 2.95, 3.4);
    }
    if (this.fillLight) {
      this.fillLight.position.set(-3, lightHeight + 1.35, 2);
    }
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    const elapsed = this.clock.elapsedTime;

    this.controller.update(delta, elapsed);
    this.controls.update();
    this.renderer.render(this.scene, this.activeCamera);
  };

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    this.viewportAspect = width / height;
    this.updateProjection();
    this.renderer.setSize(width, height, false);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }

      const material = mesh.material;
      if (!material) {
        return;
      }

      const materials = Array.isArray(material) ? material : [material];
      for (const item of materials) {
        item.dispose();
      }
    });
  }
}

function urlLabel(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.pathname.split("/").filter(Boolean).pop() || parsed.href;
  } catch {
    return url;
  }
}

function normalizeViewSettings(settings: AvatarViewSettings): AvatarViewSettings {
  return {
    projection: settings.projection === "orthographic" ? "orthographic" : "perspective",
    cameraDistance: THREE.MathUtils.clamp(settings.cameraDistance, 0.8, 9.5),
    cameraFov: THREE.MathUtils.clamp(settings.cameraFov, 12, 70),
    orthographicWidth: THREE.MathUtils.clamp(settings.orthographicWidth, 0.8, 4.8),
    avatarHeight: THREE.MathUtils.clamp(settings.avatarHeight, 0.6, 2.6),
    lightHeight: THREE.MathUtils.clamp(settings.lightHeight, 0.2, 2.6)
  };
}
