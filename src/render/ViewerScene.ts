import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type TriangleBuffer = Float32Array<ArrayBufferLike>;

export interface TriangleLayers {
  backdrop: TriangleBuffer;
  invisible: TriangleBuffer;
  solid: TriangleBuffer;
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
  private readonly controls: OrbitControls;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly content = new THREE.Group();
  private readonly placeholder: THREE.Mesh;
  private frameTargets: THREE.Object3D[] = [];
  private animationFrameId = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x151719, 1);
    this.renderer.domElement.className = "viewport-canvas";

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10000);
    this.camera.position.set(4, 3, 6);
    this.camera.lookAt(0, 0, 0);

    this.container.append(this.renderer.domElement);
    this.scene.add(this.content);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

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

    if (visibility.solid && layers.solid.length > 0) {
      const mesh = this.createTriangleMesh(layers.solid, 0x9fc3cf, 1);
      const wire = this.createWireMesh(layers.solid, 0x263238);
      this.content.add(mesh, wire);
      frameTargets.push(mesh);
    }

    if (visibility.backdrop && layers.backdrop.length > 0) {
      const backdrop = this.createTriangleMesh(layers.backdrop, 0x3d5363, 0.18);
      const backdropWire = this.createWireMesh(layers.backdrop, 0x4e6c7c);
      this.content.add(backdrop, backdropWire);
      frameTargets.push(backdrop);
    }

    if (visibility.invisible && layers.invisible.length > 0) {
      const invisible = this.createTriangleMesh(layers.invisible, 0xc4926a, 0.24);
      const invisibleWire = this.createWireMesh(layers.invisible, 0x8c6247);
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
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  resetView(): void {
    this.frameLoadedContent();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.controls.dispose();
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

  private createTriangleMesh(triangles: TriangleBuffer, color: number, opacity: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(triangles, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0,
      opacity,
      roughness: 0.9,
      side: THREE.DoubleSide,
      transparent: opacity < 1
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
    this.camera.near = Math.max(radius / 10000, 1);
    this.camera.far = Math.max(radius * 8, 1000);
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.camera.updateProjectionMatrix();
    this.controls.update();
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

    if (this.placeholder.visible) {
      this.placeholder.rotation.y += 0.004;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
