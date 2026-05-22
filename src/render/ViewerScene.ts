import * as THREE from "three";

export class ViewerScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
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
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.addBaseScene();
    this.resize();
    this.animate();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrameId);
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

    const key = new THREE.DirectionalLight(0xf6efe2, 2.2);
    key.position.set(4, 8, 5);
    this.scene.add(key);

    const fill = new THREE.HemisphereLight(0x9fc8d8, 0x3a332c, 1.4);
    this.scene.add(fill);
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

    const cube = this.scene.getObjectByName("placeholder-world");
    if (cube) {
      cube.rotation.y += 0.004;
    }

    this.renderer.render(this.scene, this.camera);
  };
}
