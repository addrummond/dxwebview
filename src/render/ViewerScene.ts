import * as THREE from "three";
import type { UnrealMeshGeometry } from "../unreal/meshGeometry";
import type { UnrealModelGeometry } from "../unreal/modelPoints";
import type { UnrealTextureImage } from "../unreal/textureDecoder";

type TriangleBuffer = Float32Array<ArrayBufferLike>;
const MOVEMENT_RAMP_SECONDS = 1;
const VIEW_CHANGE_MIN_INTERVAL_MS = 500;
// LodMesh vertices are decoded into a viewer-space basis with X/Z flipped relative to map actors.
const MESH_BASIS_CORRECTION_QUATERNION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI
);
const WALL_MOUNTED_DEVICE_YAW_OFFSET_QUATERNION = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI / 2
);
const WALL_MOUNTED_DEVICE_MESHES = new Set([
  "ATM",
  "CigaretteMachine",
  "ComputerPublic",
  "ComputerSecurity",
  "Keypad1",
  "Keypad2"
]);

interface ActorCirclePickTarget {
  center: THREE.Vector3;
  path: string;
  radius: number;
}

export interface TriangleLayer {
  colors: TriangleBuffer;
  materialSpans: TriangleMaterialSpan[];
  positions: TriangleBuffer;
  textureCoordinateScale?: number;
  uvs: TriangleBuffer;
}

export interface TriangleMaterialSpan {
  count: number;
  renderMode: "masked" | "opaque" | "translucent";
  start: number;
  textureName: string;
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

export interface SceneActorAnnotation {
  category: string;
  collisionHeight: number | null;
  className: string;
  collisionRadius: number | null;
  drawScale: number;
  drawScale3D: {
    x: number;
    y: number;
    z: number;
  } | null;
  location: {
    x: number;
    y: number;
    z: number;
  };
  mesh: string | null;
  objectName: string;
  path: string;
  prePivot: {
    x: number;
    y: number;
    z: number;
  } | null;
  rotation: {
    pitch: number;
    roll: number;
    yaw: number;
  } | null;
}

export interface SceneBrushGeometry {
  actor: SceneActorAnnotation;
  geometry: UnrealModelGeometry;
  positions: TriangleBuffer;
}

export interface SceneMeshGeometry {
  actor: SceneActorAnnotation;
  geometry: UnrealMeshGeometry;
}

export interface ViewerViewState {
  position: {
    x: number;
    y: number;
    z: number;
  };
  quaternion: {
    w: number;
    x: number;
    y: number;
    z: number;
  };
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
  private readonly projectedMarkerPosition = new THREE.Vector3();
  private readonly markerRadiusWorldPosition = new THREE.Vector3();
  private readonly projectedMarkerRadiusPosition = new THREE.Vector3();
  private readonly brushMatrix = new THREE.Matrix4();
  private readonly brushQuaternion = new THREE.Quaternion();
  private readonly brushScale = new THREE.Vector3(1, 1, 1);
  private readonly triangleA = new THREE.Vector3();
  private readonly triangleB = new THREE.Vector3();
  private readonly triangleC = new THREE.Vector3();
  private actorCirclePickTargets: ActorCirclePickTarget[] = [];
  private frameTargets: THREE.Object3D[] = [];
  private isMouseLooking = false;
  private actorSelectHandler: ((actorPath: string) => void) | null = null;
  private viewChangeHandler: ((viewState: ViewerViewState) => void) | null = null;
  private yaw = 0;
  private pitch = 0;
  private movementSpeed = 400;
  private animationFrameId = 0;
  private lastFrameTime = performance.now();
  private lastViewChangeEmitTime = 0;
  private lastViewStateKey = "";

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

  showTriangles(
    layers: TriangleLayers,
    visibility: TriangleLayerVisibility,
    textures = new Map<string, UnrealTextureImage>(),
    actorAnnotations: SceneActorAnnotation[] = [],
    selectedActorPath: string | null = null,
    brushGeometries: SceneBrushGeometry[] = [],
    meshGeometries: SceneMeshGeometry[] = [],
    showOccludedActors = true,
    frameView = true
  ): void {
    this.clearContent();
    this.placeholder.visible = false;
    const frameTargets: THREE.Object3D[] = [];

    if (visibility.solid && layers.solid.positions.length > 0) {
      const mesh = this.createTriangleMesh(layers.solid, 0x9fc3cf, 1, textures);
      const wire = this.createWireMesh(layers.solid.positions, 0x263238);
      this.content.add(mesh, wire);
      frameTargets.push(mesh);
    }

    if (visibility.backdrop && layers.backdrop.positions.length > 0) {
      const backdrop = this.createTriangleMesh(layers.backdrop, 0x3d5363, 0.18, textures);
      const backdropWire = this.createWireMesh(layers.backdrop.positions, 0x4e6c7c);
      this.content.add(backdrop, backdropWire);
      frameTargets.push(backdrop);
    }

    if (visibility.invisible && layers.invisible.positions.length > 0) {
      const invisible = this.createTriangleMesh(layers.invisible, 0xc4926a, 0.24, textures);
      const invisibleWire = this.createWireMesh(layers.invisible.positions, 0x8c6247);
      this.content.add(invisible, invisibleWire);
      frameTargets.push(invisible);
    }

    for (const brushGeometry of brushGeometries) {
      this.content.add(this.createActorBrushMesh(brushGeometry, textures));
      if (brushGeometry.actor.path === selectedActorPath) {
        this.content.add(this.createSelectedBrushMesh(brushGeometry));
      }
    }

    for (const meshGeometry of meshGeometries) {
      this.content.add(this.createActorMeshMesh(meshGeometry, textures));
    }

    if (actorAnnotations.length > 0) {
      this.content.add(this.createActorMarkerGroup(actorAnnotations, selectedActorPath, showOccludedActors));
    }

    this.frameTargets = frameTargets;
    if (frameView) {
      this.frameLoadedContent();
    }
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

  setActorSelectHandler(handler: ((actorPath: string) => void) | null): void {
    this.actorSelectHandler = handler;
  }

  setViewChangeHandler(handler: ((viewState: ViewerViewState) => void) | null): void {
    this.viewChangeHandler = handler;
  }

  getViewState(): ViewerViewState {
    return {
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z
      },
      quaternion: {
        w: this.camera.quaternion.w,
        x: this.camera.quaternion.x,
        y: this.camera.quaternion.y,
        z: this.camera.quaternion.z
      }
    };
  }

  applyViewState(viewState: ViewerViewState): void {
    this.camera.position.set(viewState.position.x, viewState.position.y, viewState.position.z);
    this.camera.quaternion.set(
      viewState.quaternion.x,
      viewState.quaternion.y,
      viewState.quaternion.z,
      viewState.quaternion.w
    );
    this.camera.updateProjectionMatrix();
    this.syncLookAnglesFromCamera();
    this.emitViewChange(performance.now(), true);
  }

  focusPoint(point: { x: number; y: number; z: number }, radius = 64): void {
    const center = new THREE.Vector3(point.x, point.y, point.z);
    const distance = Math.max(radius * 5, 180);

    this.camera.position.set(
      center.x + distance * 0.75,
      center.y + distance * 0.45,
      center.z + distance * 0.9
    );
    this.movementSpeed = Math.max(distance * 1.25, 250);
    this.camera.near = Math.max(distance / 1000, 1);
    this.camera.far = Math.max(distance * 30, 1000);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.syncLookAnglesFromCamera();
    this.emitViewChange(performance.now(), true);
    this.renderer.domElement.focus();
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
    this.actorCirclePickTargets = [];
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      this.disposeObject(child);
    }
  }

  private createTriangleMesh(
    layer: TriangleLayer,
    color: number,
    opacity: number,
    textures: Map<string, UnrealTextureImage>
  ): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(layer.positions, 3));
    if (layer.uvs.length === (layer.positions.length / 3) * 2) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(layer.uvs, 2));
    }
    if (layer.colors.length === layer.positions.length) {
      geometry.setAttribute("color", new THREE.BufferAttribute(layer.colors, 3));
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = this.createMaterials(geometry, layer, color, opacity, textures);

    return new THREE.Mesh(geometry, material);
  }

  private createMaterials(
    geometry: THREE.BufferGeometry,
    layer: TriangleLayer,
    color: number,
    opacity: number,
    textures: Map<string, UnrealTextureImage>
  ): THREE.Material | THREE.Material[] {
    if (layer.materialSpans.length === 0) {
      return this.createFallbackMaterial(color, opacity, layer);
    }

    const materials: THREE.Material[] = [];
    const materialIndexes = new Map<string, number>();

    for (const span of layer.materialSpans) {
      const texture = textures.get(span.textureName.toLowerCase());
      const key = texture
        ? `texture:${span.textureName}:${span.renderMode}`
        : `fallback:${span.textureName}:${span.renderMode}`;
      let materialIndex = materialIndexes.get(key);

      if (materialIndex === undefined) {
        materialIndex = materials.length;
        materialIndexes.set(key, materialIndex);
        materials.push(
          texture
            ? this.createTexturedMaterial(texture, opacity, span.renderMode, layer.textureCoordinateScale)
            : this.createFallbackMaterial(color, opacityForRenderMode(opacity, span.renderMode), layer)
        );
      }

      geometry.addGroup(span.start, span.count, materialIndex);
    }

    return materials;
  }

  private createFallbackMaterial(color: number, opacity: number, layer: TriangleLayer): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0,
      opacity,
      roughness: 0.9,
      side: THREE.DoubleSide,
      transparent: opacity < 1,
      vertexColors: layer.colors.length === layer.positions.length
    });
  }

  private createTexturedMaterial(
    textureImage: UnrealTextureImage,
    opacity: number,
    renderMode: TriangleMaterialSpan["renderMode"],
    textureCoordinateScale: number | undefined
  ): THREE.MeshStandardMaterial {
    const texture = new THREE.DataTexture(
      rgbaForRenderMode(textureImage, renderMode),
      textureImage.width,
      textureImage.height,
      THREE.RGBAFormat
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(
      textureCoordinateScale ?? 1 / textureImage.width,
      textureCoordinateScale ?? 1 / textureImage.height
    );
    texture.needsUpdate = true;

    return new THREE.MeshStandardMaterial({
      alphaTest: renderMode === "masked" ? 0.5 : 0,
      map: texture,
      metalness: 0,
      opacity: opacityForRenderMode(opacity, renderMode),
      roughness: 0.9,
      side: THREE.DoubleSide,
      transparent: renderMode === "translucent" || opacity < 1
    });
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

  private createActorMarkerGroup(
    annotations: SceneActorAnnotation[],
    selectedActorPath: string | null,
    showOccludedActors: boolean
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = "actor-annotations";

    for (const annotation of annotations) {
      const isSelected = annotation.path === selectedActorPath;
      const radius = THREE.MathUtils.clamp(
        Math.max(annotation.collisionRadius ?? 32, (annotation.collisionHeight ?? 0) * 0.5) * 0.35,
        8,
        annotation.category === "Brush" ? 42 : 28
      );
      const geometry = new THREE.SphereGeometry(isSelected ? radius * 1.25 : radius, 12, 8);
      const material = new THREE.MeshBasicMaterial({
        color: isSelected ? 0xfff06a : actorCategoryColor(annotation.category),
        depthTest: true,
        depthWrite: false,
        opacity: isSelected ? 1 : 0.88,
        transparent: true
      });
      const marker = new THREE.Mesh(geometry, material);
      marker.name = `${annotation.category}: ${annotation.className}.${annotation.objectName}`;
      marker.position.set(annotation.location.x, annotation.location.y, annotation.location.z);
      marker.renderOrder = isSelected ? 20 : 10;
      marker.userData.actorPath = annotation.path;
      this.actorCirclePickTargets.push({
        center: marker.position.clone(),
        path: annotation.path,
        radius: isSelected ? radius * 1.25 : radius
      });
      group.add(marker);

      if (showOccludedActors || isSelected) {
        const overlayMaterial = new THREE.MeshBasicMaterial({
          color: isSelected ? 0xffffff : 0xcfd6dc,
          depthTest: false,
          depthWrite: false,
          opacity: isSelected ? 0.28 : 0.16,
          transparent: true,
          wireframe: true
        });
        const overlay = new THREE.Mesh(geometry.clone(), overlayMaterial);
        overlay.name = `non-visible overlay ${marker.name}`;
        overlay.position.copy(marker.position);
        overlay.renderOrder = isSelected ? 21 : 11;
        group.add(overlay);
      }

      if (isSelected) {
        const haloGeometry = new THREE.SphereGeometry(radius * 1.9, 16, 10);
        const haloMaterial = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          depthTest: false,
          depthWrite: false,
          opacity: 0.32,
          transparent: true,
          wireframe: true
        });
        const halo = new THREE.Mesh(haloGeometry, haloMaterial);
        halo.name = `selected ${marker.name}`;
        halo.position.copy(marker.position);
        halo.renderOrder = 21;
        group.add(halo);
      }
    }

    return group;
  }

  private createActorBrushMesh(
    geometrySource: SceneBrushGeometry,
    textures: Map<string, UnrealTextureImage>
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `actor brush geometry: ${geometrySource.actor.objectName}`;

    const solid = this.transformedBrushLayer(
      {
        colors: geometrySource.geometry.triangleColors,
        materialSpans: geometrySource.geometry.triangleMaterialSpans,
        positions: geometrySource.geometry.triangles,
        uvs: geometrySource.geometry.triangleUvs
      },
      geometrySource.actor
    );
    const backdrop = this.transformedBrushLayer(
      {
        colors: geometrySource.geometry.backdropTriangleColors,
        materialSpans: geometrySource.geometry.backdropTriangleMaterialSpans,
        positions: geometrySource.geometry.backdropTriangles,
        uvs: geometrySource.geometry.backdropTriangleUvs
      },
      geometrySource.actor
    );
    const invisible = this.transformedBrushLayer(
      {
        colors: geometrySource.geometry.invisibleTriangleColors,
        materialSpans: geometrySource.geometry.invisibleTriangleMaterialSpans,
        positions: geometrySource.geometry.invisibleTriangles,
        uvs: geometrySource.geometry.invisibleTriangleUvs
      },
      geometrySource.actor
    );

    if (solid.positions.length > 0) {
      group.add(this.createTriangleMesh(solid, 0x6aa7a0, 1, textures));
    }
    if (backdrop.positions.length > 0) {
      group.add(this.createTriangleMesh(backdrop, 0x3d5363, 0.28, textures));
    }
    if (invisible.positions.length > 0) {
      group.add(this.createWireMesh(invisible.positions, 0x8fd1cc));
    }

    const overlayWire = new THREE.Mesh(
      this.createPositionGeometry(this.transformBrushPositions(geometrySource.positions, geometrySource.actor)),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        opacity: 0.1,
        transparent: true,
        wireframe: true
      })
    );
    overlayWire.renderOrder = 18;
    group.add(overlayWire);

    return group;
  }

  private transformedBrushLayer(layer: TriangleLayer, actor: SceneActorAnnotation): TriangleLayer {
    return {
      ...layer,
      positions: this.transformBrushPositions(layer.positions, actor)
    };
  }

  private createActorMeshMesh(
    geometrySource: SceneMeshGeometry,
    textures: Map<string, UnrealTextureImage>
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `actor mesh geometry: ${geometrySource.actor.objectName}`;
    group.add(
      this.createTriangleMesh(
        {
          colors: geometrySource.geometry.colors,
          materialSpans: geometrySource.geometry.materialSpans,
          positions: this.transformActorMeshPositions(geometrySource.geometry, geometrySource.actor),
          textureCoordinateScale: 1 / 256,
          uvs: geometrySource.geometry.uvs
        },
        0xa9b0b8,
        1,
        textures
      )
    );
    return group;
  }

  private createSelectedBrushMesh(geometrySource: SceneBrushGeometry): THREE.Group {
    const actor = geometrySource.actor;
    const group = new THREE.Group();
    group.name = `selected brush geometry: ${actor.objectName}`;
    const geometry = this.createPositionGeometry(this.transformBrushPositions(geometrySource.positions, actor));

    const visibleFill = new THREE.Mesh(
      geometry.clone(),
      new THREE.MeshBasicMaterial({
        color: 0xffe45c,
        depthTest: true,
        depthWrite: false,
        opacity: 0.42,
        side: THREE.DoubleSide,
        transparent: true
      })
    );
    visibleFill.renderOrder = 30;

    const visibleWire = new THREE.Mesh(
      geometry.clone(),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: true,
        depthWrite: false,
        opacity: 0.95,
        transparent: true,
        wireframe: true
      })
    );
    visibleWire.renderOrder = 31;

    const overlayWire = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        opacity: 0.16,
        transparent: true,
        wireframe: true
      })
    );
    overlayWire.renderOrder = 32;

    group.add(visibleFill, visibleWire, overlayWire);
    return group;
  }

  private transformBrushPositions(positions: TriangleBuffer, actor: SceneActorAnnotation): Float32Array {
    const transformed: number[] = [];

    this.brushQuaternion.setFromEuler(unrealRotatorEuler(actor.rotation));
    this.brushMatrix.compose(
      new THREE.Vector3(actor.location.x, actor.location.y, actor.location.z),
      this.brushQuaternion,
      this.brushScale
    );
    const prePivot = actor.prePivot ?? { x: 0, y: 0, z: 0 };

    for (let index = 0; index + 8 < positions.length; index += 9) {
      this.triangleA
        .set(positions[index], positions[index + 1], positions[index + 2])
        .sub(prePivot)
        .applyMatrix4(this.brushMatrix);
      this.triangleB
        .set(positions[index + 3], positions[index + 4], positions[index + 5])
        .sub(prePivot)
        .applyMatrix4(this.brushMatrix);
      this.triangleC
        .set(positions[index + 6], positions[index + 7], positions[index + 8])
        .sub(prePivot)
        .applyMatrix4(this.brushMatrix);

      transformed.push(
        this.triangleA.x,
        this.triangleA.y,
        this.triangleA.z,
        this.triangleB.x,
        this.triangleB.y,
        this.triangleB.z,
        this.triangleC.x,
        this.triangleC.y,
        this.triangleC.z
      );
    }

    return new Float32Array(transformed);
  }

  private transformActorMeshPositions(geometry: UnrealMeshGeometry, actor: SceneActorAnnotation): Float32Array {
    const positions = geometry.positions;
    const transformed: number[] = [];
    const drawScale3D = actor.drawScale3D ?? { x: 1, y: 1, z: 1 };
    const verticalCenterOffset =
      actor.category === "Character" ? actor.collisionHeight ?? meshVerticalCenter(positions) : 0;

    this.brushQuaternion.copy(unrealMeshQuaternion(actor.rotation, geometry.sourceExport));
    this.brushMatrix.compose(
      new THREE.Vector3(actor.location.x, actor.location.y, actor.location.z),
      this.brushQuaternion,
      this.brushScale
    );

    for (let index = 0; index + 2 < positions.length; index += 3) {
      this.triangleA
        .set(
          positions[index] * actor.drawScale * drawScale3D.x,
          (positions[index + 1] - verticalCenterOffset) * actor.drawScale * drawScale3D.y,
          positions[index + 2] * actor.drawScale * drawScale3D.z
        )
        .applyMatrix4(this.brushMatrix);
      transformed.push(this.triangleA.x, this.triangleA.y, this.triangleA.z);
    }

    return new Float32Array(transformed);
  }

  private createPositionGeometry(positions: Float32Array): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
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

    const actorPath = this.pickActor(event);
    if (actorPath) {
      this.actorSelectHandler?.(actorPath);
      event.preventDefault();
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

  private pickActor(event: PointerEvent): string | null {
    return this.pickActorCircle(event);
  }

  private pickActorCircle(event: PointerEvent): string | null {
    if (this.actorCirclePickTargets.length === 0) {
      return null;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    this.camera.updateMatrixWorld();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let closestPath: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestDistanceSq = Number.POSITIVE_INFINITY;

    for (const target of this.actorCirclePickTargets) {
      this.projectedMarkerPosition.copy(target.center).project(this.camera);
      if (this.projectedMarkerPosition.z < -1 || this.projectedMarkerPosition.z > 1) {
        continue;
      }

      const markerX = ((this.projectedMarkerPosition.x + 1) / 2) * rect.width;
      const markerY = ((1 - this.projectedMarkerPosition.y) / 2) * rect.height;
      const distanceSq = (markerX - x) ** 2 + (markerY - y) ** 2;
      const radiusPx = this.projectMarkerRadius(target.center, target.radius, rect);

      if (distanceSq > radiusPx ** 2) {
        continue;
      }

      const distance = target.center.distanceToSquared(this.camera.position);
      if (distance < closestDistance || (distance === closestDistance && distanceSq < closestDistanceSq)) {
        closestDistance = distance;
        closestDistanceSq = distanceSq;
        closestPath = target.path;
      }
    }

    return closestPath;
  }

  private projectMarkerRadius(center: THREE.Vector3, radius: number, rect: DOMRect): number {
    this.markerRadiusWorldPosition.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.markerRadiusWorldPosition.multiplyScalar(radius).add(center);
    this.projectedMarkerRadiusPosition.copy(this.markerRadiusWorldPosition).project(this.camera);

    if (this.projectedMarkerRadiusPosition.z < -1 || this.projectedMarkerRadiusPosition.z > 1) {
      return 18;
    }

    const centerX = ((this.projectedMarkerPosition.x + 1) / 2) * rect.width;
    const centerY = ((1 - this.projectedMarkerPosition.y) / 2) * rect.height;
    const radiusX = ((this.projectedMarkerRadiusPosition.x + 1) / 2) * rect.width;
    const radiusY = ((1 - this.projectedMarkerRadiusPosition.y) / 2) * rect.height;
    return Math.max(Math.hypot(radiusX - centerX, radiusY - centerY), 8);
  }

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
        object.material.forEach((material) => disposeMaterial(material));
      } else {
        disposeMaterial(object.material);
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
    this.emitViewChange(performance.now(), true);
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
    this.emitViewChange(now);
  };

  private emitViewChange(now: number, force = false): void {
    if (!this.viewChangeHandler) {
      return;
    }

    if (!force && now - this.lastViewChangeEmitTime < VIEW_CHANGE_MIN_INTERVAL_MS) {
      return;
    }

    const viewState = this.getViewState();
    const key = [
      viewState.position.x.toFixed(2),
      viewState.position.y.toFixed(2),
      viewState.position.z.toFixed(2),
      viewState.quaternion.x.toFixed(4),
      viewState.quaternion.y.toFixed(4),
      viewState.quaternion.z.toFixed(4),
      viewState.quaternion.w.toFixed(4)
    ].join(":");

    if (!force && key === this.lastViewStateKey) {
      return;
    }

    this.lastViewStateKey = key;
    this.lastViewChangeEmitTime = now;
    this.viewChangeHandler(viewState);
  }
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

function disposeMaterial(material: THREE.Material): void {
  if (material instanceof THREE.MeshStandardMaterial) {
    material.map?.dispose();
  }

  material.dispose();
}

function rgbaForRenderMode(
  textureImage: UnrealTextureImage,
  renderMode: TriangleMaterialSpan["renderMode"]
): Uint8Array {
  if (renderMode !== "masked") {
    return textureImage.rgba;
  }

  const rgba = new Uint8Array(textureImage.rgba);
  const pixelCount = Math.min(textureImage.indices.length, textureImage.width * textureImage.height);

  for (let index = 0; index < pixelCount; index += 1) {
    if (textureImage.indices[index] === 0) {
      rgba[index * 4 + 3] = 0;
    }
  }

  return rgba;
}

function opacityForRenderMode(opacity: number, renderMode: TriangleMaterialSpan["renderMode"]): number {
  if (renderMode === "translucent") {
    return Math.min(opacity, 0.45);
  }

  return opacity;
}

function actorCategoryColor(category: string): number {
  switch (category) {
    case "Ammo":
      return 0xf0c84b;
    case "Audio":
      return 0xa184e6;
    case "Brush":
      return 0x46b7a8;
    case "Character":
      return 0x5fb4ff;
    case "Decoration":
      return 0xa9b0b8;
    case "Item":
      return 0x66d182;
    case "Key":
      return 0xf29662;
    case "Light":
      return 0xfff1a8;
    case "Mover":
      return 0x4ec9c2;
    case "Navigation":
      return 0x6c7480;
    case "Trigger":
      return 0xd87aff;
    case "Weapon":
      return 0xff6d70;
    default:
      return 0xe7ecef;
  }
}

function unrealRotatorEuler(rotation: SceneActorAnnotation["rotation"]): THREE.Euler {
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  if (!rotation) {
    return euler;
  }

  const unit = (Math.PI * 2) / 65536;
  return euler.set(rotation.roll * unit, rotation.yaw * unit, rotation.pitch * unit, "YXZ");
}

export function unrealMeshQuaternion(rotation: SceneActorAnnotation["rotation"], meshSource?: string): THREE.Quaternion {
  const quaternion = new THREE.Quaternion()
    .setFromEuler(unrealMeshRotatorEuler(rotation))
    .multiply(MESH_BASIS_CORRECTION_QUATERNION);

  if (meshSource && WALL_MOUNTED_DEVICE_MESHES.has(meshSource)) {
    quaternion.multiply(WALL_MOUNTED_DEVICE_YAW_OFFSET_QUATERNION);
  }

  return quaternion;
}

export function meshVerticalCenter(positions: TriangleBuffer): number {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 1; index < positions.length; index += 3) {
    minY = Math.min(minY, positions[index]);
    maxY = Math.max(maxY, positions[index]);
  }

  return Number.isFinite(minY) && Number.isFinite(maxY) ? (minY + maxY) / 2 : 0;
}

function unrealMeshRotatorEuler(rotation: SceneActorAnnotation["rotation"]): THREE.Euler {
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  if (!rotation) {
    return euler;
  }

  const unit = (Math.PI * 2) / 65536;
  return euler.set(-rotation.roll * unit, -rotation.yaw * unit, -rotation.pitch * unit, "YXZ");
}
