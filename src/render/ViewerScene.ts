import * as THREE from "three";

type TriangleBuffer = Float32Array<ArrayBufferLike>;
const MOVEMENT_RAMP_SECONDS = 0.5;

export interface TriangleLayer {
  colors: TriangleBuffer;
  positions: TriangleBuffer;
}

export interface TriangleLayers {
  backdrop: TriangleLayer;
  invisible: TriangleLayer;
  solid: TriangleLayer;
}

export interface TriangleLayerVisibility {
  backdrop: boolean;
  invisible: boolean;
  solid: boolean;
}

export class ViewerScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly content = new THREE.Group();
  private readonly placeholder: THREE.Mesh;
  private readonly pressedKeys = new Set<string>();
  private readonly keyPressStartTimes = new Map<string, number>();
  private readonly lookEuler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly moveVector = new THREE.Vector3();
  private readonly forwardVector = new THREE.Vector3();
  private readonly rightVector = new THREE.Vector3();
  private readonly upVector = new THREE.Vector3(0, 1, 0);
  private frameTargets: THREE.Object3D[] = [];
  private isMouseLooking = false;
  private yaw = 0;
  private pitch = 0;
  private movementSpeed = 400;
  private animationFrameId = 0;
  private lastFrameTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x151719, 1);
    this.renderer.domElement.className = "viewport-canvas";
    this.renderer.domElement.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10000);
    this.camera.position.set(4, 3, 6);
    this.camera.lookAt(0, 0, 0);
    this.syncLookAnglesFromCamera();

    this.container.append(this.renderer.domElement);
    this.scene.add(this.content);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.addInputListeners();

    this.addBaseScene();
    this.placeholder = this.addPlaceholderCube();
    this.resize();
    this.animate();
  }

  showPointCloud(points: TriangleBuffer): void {
    this.clearContent();
    this.placeholder.visible = false;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      color: 0xb6d7e4,
      size: 14,
      sizeAttenuation: false
    });
    const cloud = new THREE.Points(geometry, material);
    this.content.add(cloud);
    this.frameTargets = [cloud];
    this.frameLoadedContent();
  }

  showTriangles(layers: TriangleLayers, visibility: TriangleLayerVisibility): void {
    this.clearContent();
    this.placeholder.visible = false;
    const frameTargets: THREE.Object3D[] = [];

    if (visibility.solid && layers.solid.positions.length > 0) {
      const mesh = this.createTriangleMesh(layers.solid, 0x9fc3cf, 1);
      const wire = this.createWireMesh(layers.solid.positions, 0x263238);
      this.content.add(mesh, wire);
      frameTargets.push(mesh);
    }

    if (visibility.backdrop && layers.backdrop.positions.length > 0) {
      const backdrop = this.createTriangleMesh(layers.backdrop, 0x3d5363, 0.18);
      const backdropWire = this.createWireMesh(layers.backdrop.positions, 0x4e6c7c);
      this.content.add(backdrop, backdropWire);
      frameTargets.push(backdrop);
    }

    if (visibility.invisible && layers.invisible.positions.length > 0) {
      const invisible = this.createTriangleMesh(layers.invisible, 0xc4926a, 0.24);
      const invisibleWire = this.createWireMesh(layers.invisible.positions, 0x8c6247);
      this.content.add(invisible, invisibleWire);
      frameTargets.push(invisible);
    }

    this.frameTargets = frameTargets;
    this.frameLoadedContent();
  }

  showPlaceholder(): void {
    this.clearContent();
    this.placeholder.visible = true;
    this.frameTargets = [this.placeholder];
    this.camera.position.set(4, 3, 6);
    this.camera.lookAt(0, 0, 0);
    this.syncLookAnglesFromCamera();
  }

  resetView(): void {
    this.frameLoadedContent();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.removeInputListeners();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private addBaseScene(): void {
    const grid = new THREE.GridHelper(12, 12, 0x56606a, 0x2f363d);
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(2);
    axes.position.y = 0.01;
    this.scene.add(axes);

    const key = new THREE.DirectionalLight(0xf6efe2, 2.2);
    key.position.set(4, 8, 5);
    this.scene.add(key);

    const fill = new THREE.HemisphereLight(0x9fc8d8, 0x3a332c, 1.4);
    this.scene.add(fill);
  }

  private addPlaceholderCube(): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8fb7c9,
      roughness: 0.65,
      metalness: 0.05
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.y = 1;
    cube.name = "placeholder-world";
    this.scene.add(cube);
    this.frameTargets = [cube];
    return cube;
  }

  private clearContent(): void {
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      this.disposeObject(child);
    }
  }

  private createTriangleMesh(layer: TriangleLayer, color: number, opacity: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(layer.positions, 3));
    if (layer.colors.length === layer.positions.length) {
      geometry.setAttribute("color", new THREE.BufferAttribute(layer.colors, 3));
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0,
      opacity,
      roughness: 0.9,
      side: THREE.DoubleSide,
      transparent: opacity < 1,
      vertexColors: layer.colors.length === layer.positions.length
    });

    return new THREE.Mesh(geometry, material);
  }

  private createWireMesh(triangles: TriangleBuffer, color: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(triangles, 3));

    const material = new THREE.MeshBasicMaterial({
      color,
      wireframe: true
    });

    return new THREE.Mesh(geometry, material);
  }

  private addInputListeners(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("blur", this.handleBlur);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
  }

  private removeInputListeners(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("blur", this.handleBlur);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }

    this.renderer.domElement.focus();
    this.isMouseLooking = true;
    if (isTopLevelWindow()) {
      try {
        void this.renderer.domElement.requestPointerLock().catch(() => undefined);
      } catch {
        // Some browser surfaces disallow pointer lock; focused-canvas freelook still works.
      }
    }
    event.preventDefault();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.isMouseLooking && document.pointerLockElement !== this.renderer.domElement) {
      return;
    }

    this.yaw -= event.movementX * 0.002;
    this.pitch -= event.movementY * 0.002;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.applyLookAngles();
  };

  private handlePointerLockChange = (): void => {
    this.isMouseLooking = document.pointerLockElement === this.renderer.domElement;
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Escape" && this.isKeyboardInputActive()) {
      this.isMouseLooking = false;
      if (document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock();
      }
      return;
    }

    if (!this.isKeyboardInputActive() || !isMovementKey(event.code)) {
      return;
    }

    this.pressedKeys.add(event.code);
    if (!this.keyPressStartTimes.has(event.code)) {
      this.keyPressStartTimes.set(event.code, performance.now());
    }
    event.preventDefault();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (isMovementKey(event.code)) {
      this.pressedKeys.delete(event.code);
      this.keyPressStartTimes.delete(event.code);
    }
  };

  private handleBlur = (): void => {
    this.pressedKeys.clear();
    this.keyPressStartTimes.clear();
    if (document.pointerLockElement !== this.renderer.domElement) {
      this.isMouseLooking = false;
    }
  };

  private isKeyboardInputActive(): boolean {
    return document.activeElement === this.renderer.domElement || this.isMouseLooking;
  }

  private syncLookAnglesFromCamera(): void {
    this.lookEuler.setFromQuaternion(this.camera.quaternion, "YXZ");
    this.pitch = this.lookEuler.x;
    this.yaw = this.lookEuler.y;
  }

  private applyLookAngles(): void {
    this.lookEuler.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(this.lookEuler);
  }

  private updateFreeFly(deltaSeconds: number, now: number): void {
    if (this.pressedKeys.size === 0) {
      return;
    }

    this.moveVector.set(0, 0, 0);
    this.camera.getWorldDirection(this.forwardVector);
    this.rightVector.crossVectors(this.forwardVector, this.upVector).normalize();

    if (this.pressedKeys.has("KeyW")) {
      this.moveVector.addScaledVector(this.forwardVector, this.movementRampForKey("KeyW", now));
    }
    if (this.pressedKeys.has("KeyS")) {
      this.moveVector.addScaledVector(this.forwardVector, -this.movementRampForKey("KeyS", now));
    }
    if (this.pressedKeys.has("KeyD")) {
      this.moveVector.addScaledVector(this.rightVector, this.movementRampForKey("KeyD", now));
    }
    if (this.pressedKeys.has("KeyA")) {
      this.moveVector.addScaledVector(this.rightVector, -this.movementRampForKey("KeyA", now));
    }
    if (this.pressedKeys.has("Space") || this.pressedKeys.has("KeyE")) {
      this.moveVector.addScaledVector(this.upVector, this.largestMovementRamp(["Space", "KeyE"], now));
    }
    if (this.pressedKeys.has("ControlLeft") || this.pressedKeys.has("ControlRight") || this.pressedKeys.has("KeyQ")) {
      this.moveVector.addScaledVector(
        this.upVector,
        -this.largestMovementRamp(["ControlLeft", "ControlRight", "KeyQ"], now)
      );
    }

    if (this.moveVector.lengthSq() === 0) {
      return;
    }

    if (this.moveVector.lengthSq() > 1) {
      this.moveVector.normalize();
    }

    const speedMultiplier =
      this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight") ? 3 : 1;
    this.camera.position.addScaledVector(
      this.moveVector,
      this.movementSpeed * speedMultiplier * deltaSeconds
    );
  }

  private movementRampForKey(code: string, now: number): number {
    const startTime = this.keyPressStartTimes.get(code);

    if (startTime === undefined) {
      return 0;
    }

    const progress = THREE.MathUtils.clamp((now - startTime) / 1000 / MOVEMENT_RAMP_SECONDS, 0, 1);
    return progress * progress * (3 - 2 * progress);
  }

  private largestMovementRamp(codes: string[], now: number): number {
    return codes.reduce((largest, code) => Math.max(largest, this.movementRampForKey(code, now)), 0);
  }

  private disposeObject(object: THREE.Object3D): void {
    for (const child of object.children) {
      this.disposeObject(child);
    }

    if (object instanceof THREE.Points || object instanceof THREE.Mesh) {
      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material.dispose();
      }
    }
  }

  private frameLoadedContent(): void {
    if (this.frameTargets.length === 0) {
      return;
    }

    this.frameObjects(this.frameTargets);
  }

  private frameObjects(objects: THREE.Object3D[]): void {
    const box = new THREE.Box3().makeEmpty();
    let hasBox = false;

    for (const object of objects) {
      const objectBox = new THREE.Box3().setFromObject(object);
      if (!objectBox.isEmpty()) {
        box.union(objectBox);
        hasBox = true;
      }
    }

    if (!hasBox) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);

    this.camera.position.set(center.x + radius * 0.55, center.y + radius * 0.35, center.z + radius * 0.9);
    this.movementSpeed = Math.max(radius * 0.65, 250);
    this.camera.near = Math.max(radius / 10000, 1);
    this.camera.far = Math.max(radius * 8, 1000);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.syncLookAnglesFromCamera();
  }

  private resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    const safeWidth = Math.max(width, 1);
    const safeHeight = Math.max(height, 1);

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(safeWidth, safeHeight, false);
  }

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const deltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    if (this.placeholder.visible) {
      this.placeholder.rotation.y += 0.004;
    }

    this.updateFreeFly(deltaSeconds, now);
    this.renderer.render(this.scene, this.camera);
  };
}

function isMovementKey(code: string): boolean {
  return (
    code === "KeyW" ||
    code === "KeyA" ||
    code === "KeyS" ||
    code === "KeyD" ||
    code === "KeyQ" ||
    code === "KeyE" ||
    code === "Space" ||
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "ControlLeft" ||
    code === "ControlRight"
  );
}

function isTopLevelWindow(): boolean {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}
