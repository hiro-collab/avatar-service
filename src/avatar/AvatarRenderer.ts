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

export class AvatarRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly loader = new GLTFLoader();
  private readonly resizeObserver: ResizeObserver;
  private currentVrm: VRM | null = null;
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

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 5.5;
    this.controls.target.set(0, 1.25, 0);

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

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.setCurrentVRM(null);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(0xf3f4f1);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x667064, 2.2);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(2.3, 4.2, 3.4);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xaec7ba, 1.2);
    fillLight.position.set(-3, 2.5, 2);
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

    this.camera.position.set(0, 1.25, 3.1);
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
    this.frameCamera(vrm);
  }

  private setCurrentVRM(vrm: VRM | null): void {
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      this.disposeObject(this.currentVrm.scene);
    }

    this.currentVrm = vrm;
    this.controller.setVRM(vrm);

    if (vrm) {
      vrm.scene.position.set(0, 0, 0);
      vrm.scene.rotation.y = Math.PI;
      if (vrm.lookAt) {
        vrm.lookAt.target = this.camera;
      }
      this.scene.add(vrm.scene);
    }
  }

  private frameCamera(vrm: VRM): void {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const height = Math.max(size.y, 1.35);

    vrm.scene.position.x -= center.x;
    vrm.scene.position.z -= center.z;
    vrm.scene.position.y -= box.min.y;

    const targetHeight = THREE.MathUtils.clamp(height * 0.68, 1.0, 1.55);
    this.controls.target.set(0, targetHeight, 0);
    this.camera.position.set(0, targetHeight + 0.05, THREE.MathUtils.clamp(height * 1.7, 2.3, 4.2));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    const elapsed = this.clock.elapsedTime;

    this.controller.update(delta, elapsed);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
