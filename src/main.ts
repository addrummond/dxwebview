import "./styles.css";
import { ViewerScene, type TriangleLayerVisibility } from "./render/ViewerScene";
import {
  buildPackageIndex,
  formatBytes,
  readIndexedPackageSummary,
  type IndexedPackage,
  type IndexedPackageWithSummary,
  type PackageIndex
} from "./unreal/packageIndex";
import { formatPackageVersion } from "./unreal/packageSummary";
import type { UnrealActorAnnotation, UnrealActorCategory } from "./unreal/actorAnnotations";

interface AppState {
  actorAnnotationsVisible: boolean;
  index: PackageIndex | null;
  selectedActorPath: string | null;
  selectedMap: IndexedPackageWithSummary | null;
  surfaceVisibility: TriangleLayerVisibility;
  status: string;
  error: string | null;
}

const state: AppState = {
  actorAnnotationsVisible: true,
  index: null,
  selectedActorPath: null,
  selectedMap: null,
  surfaceVisibility: {
    backdrop: false,
    invisible: false,
    solid: true
  },
  status: "Choose an extracted Deus Ex GOTY folder to begin.",
  error: null
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root.");
}

app.innerHTML = `
  <main class="shell">
    <aside class="sidebar" aria-label="Package browser">
      <div class="toolbar">
        <button class="primary-button" id="choose-folder" type="button">Choose Folder</button>
      </div>
      <section class="panel">
        <h1>Deus Ex GOTY</h1>
        <p id="status" class="status"></p>
        <p id="error" class="error" hidden></p>
      </section>
      <section class="panel">
        <h2>Packages</h2>
        <dl class="stats" id="stats"></dl>
      </section>
      <section class="panel map-panel">
        <h2>Maps</h2>
        <div class="map-list" id="map-list"></div>
      </section>
    </aside>

    <section class="workspace">
      <div class="viewport-header">
        <div>
          <p class="eyebrow">Viewport</p>
          <h2 id="viewport-title">No map loaded</h2>
        </div>
        <div class="viewport-actions">
          <label class="toggle"><input id="toggle-solid" type="checkbox" /> Geometry</label>
          <label class="toggle"><input id="toggle-backdrop" type="checkbox" /> Backdrops</label>
          <label class="toggle"><input id="toggle-invisible" type="checkbox" /> Invisible</label>
          <label class="toggle"><input id="toggle-actors" type="checkbox" /> Actors</label>
          <button id="reset-view" type="button">Reset</button>
        </div>
      </div>
      <div class="viewport" id="viewport"></div>
    </section>

    <aside class="inspector" aria-label="Inspector">
      <section class="panel">
        <h2>Inspector</h2>
        <div id="inspector-content" class="inspector-content"></div>
      </section>
    </aside>
  </main>
`;

const chooseFolderButton = getElement<HTMLButtonElement>("choose-folder");
const statusElement = getElement<HTMLParagraphElement>("status");
const errorElement = getElement<HTMLParagraphElement>("error");
const statsElement = getElement<HTMLElement>("stats");
const mapListElement = getElement<HTMLDivElement>("map-list");
const viewportTitleElement = getElement<HTMLHeadingElement>("viewport-title");
const inspectorContentElement = getElement<HTMLDivElement>("inspector-content");
const viewportElement = getElement<HTMLDivElement>("viewport");
const solidToggleElement = getElement<HTMLInputElement>("toggle-solid");
const backdropToggleElement = getElement<HTMLInputElement>("toggle-backdrop");
const invisibleToggleElement = getElement<HTMLInputElement>("toggle-invisible");
const actorsToggleElement = getElement<HTMLInputElement>("toggle-actors");
const resetViewButton = getElement<HTMLButtonElement>("reset-view");

const viewerScene = new ViewerScene(viewportElement);
viewerScene.setActorSelectHandler((actorPath) => {
  selectActor(actorPath, { focusViewport: false, scrollInspector: true });
});
render();

chooseFolderButton.addEventListener("click", () => {
  void chooseInstallFolder();
});

solidToggleElement.addEventListener("change", () => {
  state.surfaceVisibility.solid = solidToggleElement.checked;
  refreshSelectedGeometry();
});

backdropToggleElement.addEventListener("change", () => {
  state.surfaceVisibility.backdrop = backdropToggleElement.checked;
  refreshSelectedGeometry();
});

invisibleToggleElement.addEventListener("change", () => {
  state.surfaceVisibility.invisible = invisibleToggleElement.checked;
  refreshSelectedGeometry();
});

actorsToggleElement.addEventListener("change", () => {
  state.actorAnnotationsVisible = actorsToggleElement.checked;
  refreshSelectedGeometry();
});

resetViewButton.addEventListener("click", () => {
  viewerScene.resetView();
});

inspectorContentElement.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-actor-path]");
  if (button?.dataset.actorPath) {
    selectActor(button.dataset.actorPath, { focusViewport: true, scrollInspector: false });
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && state.selectedActorPath) {
    clearSelectedActor();
  }
});

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}.`);
  }

  return element as T;
}

function selectActor(
  actorPath: string,
  options: { focusViewport: boolean; scrollInspector: boolean }
): void {
  const actor = state.selectedMap?.actorAnnotations.find((annotation) => annotation.path === actorPath);

  if (!actor) {
    return;
  }

  state.actorAnnotationsVisible = true;
  state.selectedActorPath = actor.path;
  refreshSelectedGeometry({ frameView: false });

  if (options.focusViewport) {
    viewerScene.focusPoint(
      actor.location,
      Math.max(actor.collisionRadius ?? 0, actor.collisionHeight ?? 0, actor.category === "Brush" ? 96 : 48)
    );
  }

  render();

  if (options.scrollInspector) {
    requestAnimationFrame(scrollSelectedActorIntoView);
  }
}

function clearSelectedActor(): void {
  state.selectedActorPath = null;
  refreshSelectedGeometry({ frameView: false });
  render();
}

function scrollSelectedActorIntoView(): void {
  const selectedPath = state.selectedActorPath;
  if (!selectedPath) {
    return;
  }

  for (const button of inspectorContentElement.querySelectorAll<HTMLButtonElement>("[data-actor-path]")) {
    if (button.dataset.actorPath === selectedPath) {
      button.scrollIntoView({ block: "center" });
      return;
    }
  }
}

async function chooseInstallFolder(): Promise<void> {
  if (!window.showDirectoryPicker) {
    setError("This browser does not expose folder access. Use a Chromium-based browser for now.");
    return;
  }

  clearError();
  setStatus("Waiting for folder selection...");

  try {
    const root = await window.showDirectoryPicker();
    setStatus(`Indexing ${root.name}...`);

    const index = await buildPackageIndex(root);
    state.index = index;
    state.selectedActorPath = null;
    state.selectedMap = null;
    viewerScene.showPlaceholder();
    setStatus(`Indexed ${index.packages.length} Unreal package files from ${index.rootName}.`);
    render();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      setStatus("Folder selection cancelled.");
      return;
    }

    setError(error instanceof Error ? error.message : "Unable to index selected folder.");
  }
}

async function selectMap(entry: IndexedPackage): Promise<void> {
  clearError();
  state.selectedActorPath = null;
  state.selectedMap = null;
  setStatus(`Reading ${entry.path}...`);
  render();

  try {
    state.selectedMap = await readIndexedPackageSummary(entry, state.index ?? undefined);
    state.selectedActorPath = null;
    if (state.selectedMap.geometry && totalTriangleCount(state.selectedMap.geometry) > 0) {
      state.surfaceVisibility = defaultSurfaceVisibility(state.selectedMap.geometry);
      refreshSelectedGeometry();
    } else if (state.selectedMap.geometry) {
      viewerScene.showPointCloud(state.selectedMap.geometry.points);
      setStatus(
        `Loaded ${state.selectedMap.geometry.points.length / 3} points from ${state.selectedMap.geometry.sourceExport}.`
      );
    } else {
      viewerScene.showPlaceholder();
      setStatus(`Loaded package tables for ${entry.path}; no model point cloud found.`);
    }
    render();
  } catch (error) {
    setError(error instanceof Error ? error.message : `Unable to read ${entry.path}.`);
  }
}

function setStatus(status: string): void {
  state.status = status;
  render();
}

function setError(message: string): void {
  state.error = message;
  render();
}

function clearError(): void {
  state.error = null;
  render();
}

function render(): void {
  statusElement.textContent = state.status;
  errorElement.hidden = !state.error;
  errorElement.textContent = state.error ?? "";

  renderStats();
  renderMapList();
  renderViewportControls();
  renderInspector();
}

function refreshSelectedGeometry(options: { frameView?: boolean } = {}): void {
  const selectedMap = state.selectedMap;
  const geometry = selectedMap?.geometry;
  const frameView = options.frameView ?? true;

  if (!geometry) {
    render();
    return;
  }

  viewerScene.showTriangles(
    {
      backdrop: {
        colors: geometry.backdropTriangleColors,
        materialSpans: geometry.backdropTriangleMaterialSpans,
        positions: geometry.backdropTriangles,
        uvs: geometry.backdropTriangleUvs
      },
      invisible: {
        colors: geometry.invisibleTriangleColors,
        materialSpans: geometry.invisibleTriangleMaterialSpans,
        positions: geometry.invisibleTriangles,
        uvs: geometry.invisibleTriangleUvs
      },
      solid: {
        colors: geometry.triangleColors,
        materialSpans: geometry.triangleMaterialSpans,
        positions: geometry.triangles,
        uvs: geometry.triangleUvs
      }
    },
    state.surfaceVisibility,
    selectedMap.textures,
    state.actorAnnotationsVisible ? selectedMap.actorAnnotations : [],
    state.selectedActorPath,
    frameView
  );
  setStatus(
    `Rendered ${displayedTriangleCount(geometry, state.surfaceVisibility)} of ${totalTriangleCount(
      geometry
    )} BSP triangles from ${geometry.sourceExport} with ${selectedMap.textures.size} decoded textures and ${
      selectedMap.actorAnnotations.length
    } actor annotations.`
  );
}

function renderStats(): void {
  const index = state.index;

  if (!index) {
    statsElement.innerHTML = `
      <div><dt>Root</dt><dd>None</dd></div>
      <div><dt>Maps</dt><dd>0</dd></div>
      <div><dt>Total</dt><dd>0</dd></div>
    `;
    return;
  }

  statsElement.innerHTML = `
    <div><dt>Root</dt><dd>${escapeHtml(index.rootName)}</dd></div>
    <div><dt>Maps</dt><dd>${index.countsByFolder.Maps}</dd></div>
    <div><dt>Textures</dt><dd>${index.countsByFolder.Textures}</dd></div>
    <div><dt>System</dt><dd>${index.countsByFolder.System}</dd></div>
    <div><dt>Audio</dt><dd>${index.countsByFolder.Sounds + index.countsByFolder.Music}</dd></div>
    <div><dt>Total</dt><dd>${index.packages.length}</dd></div>
  `;
}

function renderMapList(): void {
  const index = state.index;

  mapListElement.replaceChildren();

  if (!index) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No install folder selected.";
    mapListElement.append(empty);
    return;
  }

  for (const map of index.maps) {
    const button = document.createElement("button");
    button.className = "map-row";
    button.type = "button";
    button.dataset.selected = String(state.selectedMap?.path === map.path);
    button.innerHTML = `
      <span>${escapeHtml(map.baseName)}</span>
      <small>${escapeHtml(formatBytes(map.size))}</small>
    `;
    button.addEventListener("click", () => {
      void selectMap(map);
    });
    mapListElement.append(button);
  }
}

function renderViewportControls(): void {
  const geometry = state.selectedMap?.geometry;
  const hasGeometry = Boolean(geometry && totalTriangleCount(geometry) > 0);

  solidToggleElement.checked = state.surfaceVisibility.solid;
  backdropToggleElement.checked = state.surfaceVisibility.backdrop;
  invisibleToggleElement.checked = state.surfaceVisibility.invisible;
  actorsToggleElement.checked = state.actorAnnotationsVisible;

  solidToggleElement.disabled = !hasGeometry || geometry?.triangles.length === 0;
  backdropToggleElement.disabled = !hasGeometry || geometry?.backdropTriangles.length === 0;
  invisibleToggleElement.disabled = !hasGeometry || geometry?.invisibleTriangles.length === 0;
  actorsToggleElement.disabled = !state.selectedMap || state.selectedMap.actorAnnotations.length === 0;
  resetViewButton.disabled = !hasGeometry;
}

function renderInspector(): void {
  const selected = state.selectedMap;

  if (!selected) {
    viewportTitleElement.textContent = "No map loaded";
    inspectorContentElement.innerHTML = `<p class="muted">Select a map to read its package summary.</p>`;
    return;
  }

  viewportTitleElement.textContent = selected.baseName;
  const { summary, names, imports, exports } = selected.tables;
  const sampleNames = names.slice(0, 10).map((entry) => entry.name);
  const sampleImports = imports
    .slice(0, 8)
    .map((entry) => `${entry.objectName} : ${entry.classPackage}.${entry.className}`);
  const sampleExports = exports
    .slice(0, 8)
    .map((entry) => `${entry.objectName} (${formatBytes(entry.serialSize)})`);
  const geometry = selected.geometry;
  const actorCategoryCounts = countActorCategories(selected.actorAnnotations);
  const sampleMaterials = geometry?.materials
    .slice(0, 10)
    .map((entry) => `${entry.textureName} (${entry.triangleCount} tris)`);

  inspectorContentElement.innerHTML = `
    <dl class="stats inspector-stats">
      <div><dt>Path</dt><dd>${escapeHtml(selected.path)}</dd></div>
      <div><dt>Size</dt><dd>${formatBytes(selected.size)}</dd></div>
      <div><dt>Version</dt><dd>${formatPackageVersion(summary)}</dd></div>
      <div><dt>Names</dt><dd>${summary.nameCount}</dd></div>
      <div><dt>Name Table</dt><dd>@ ${summary.nameOffset}</dd></div>
      <div><dt>Imports</dt><dd>${summary.importCount}</dd></div>
      <div><dt>Import Table</dt><dd>@ ${summary.importOffset}</dd></div>
      <div><dt>Exports</dt><dd>${summary.exportCount}</dd></div>
      <div><dt>Export Table</dt><dd>@ ${summary.exportOffset}</dd></div>
      <div><dt>Flags</dt><dd>0x${summary.packageFlags.toString(16).padStart(8, "0")}</dd></div>
      <div><dt>Geometry</dt><dd>${
        geometry
          ? `${geometry.triangles.length / 9} visible, ${geometry.backdropTriangles.length / 9} backdrop, ${
              geometry.invisibleTriangles.length / 9
            } invisible triangles from ${escapeHtml(geometry.sourceExport)}`
          : "None"
      }</dd></div>
      <div><dt>Actors</dt><dd>${selected.actorAnnotations.length}</dd></div>
    </dl>
    ${renderActorCategoryCounts(actorCategoryCounts)}
    ${renderActorAnnotations(selected.actorAnnotations)}
    ${renderListSection("Names", sampleNames)}
    ${renderListSection("Imports", sampleImports)}
    ${renderListSection("Exports", sampleExports)}
    ${renderListSection("Surface Textures", sampleMaterials ?? [])}
  `;
}

function countActorCategories(annotations: UnrealActorAnnotation[]): Map<UnrealActorCategory, number> {
  const counts = new Map<UnrealActorCategory, number>();

  for (const annotation of annotations) {
    counts.set(annotation.category, (counts.get(annotation.category) ?? 0) + 1);
  }

  return counts;
}

function renderActorCategoryCounts(counts: Map<UnrealActorCategory, number>): string {
  if (counts.size === 0) {
    return "";
  }

  return `
    <section class="sample-section">
      <h3>Actor Categories</h3>
      <div class="category-grid">
        ${[...counts]
          .map(
            ([category, count]) => `
              <span class="category-pill" data-category="${escapeHtml(category)}">
                <span>${escapeHtml(category)}</span>
                <strong>${count}</strong>
              </span>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderActorAnnotations(annotations: UnrealActorAnnotation[]): string {
  if (annotations.length === 0) {
    return "";
  }

  const displayedAnnotations = actorAnnotationRows(annotations);

  return `
    <section class="sample-section">
      <h3>Actor Annotations</h3>
      <ol class="actor-list">
        ${displayedAnnotations
          .map(
            (actor) => `
              <li>
                <button class="actor-row-button" type="button" data-actor-path="${escapeHtml(
                  actor.path
                )}" data-selected="${String(actor.path === state.selectedActorPath)}">
                  <span class="actor-title">
                    <span class="actor-dot" data-category="${escapeHtml(actor.category)}"></span>
                    ${escapeHtml(actor.objectName)}
                  </span>
                  <span class="actor-meta">${escapeHtml(actor.category)} · ${escapeHtml(actor.classPath)}</span>
                  ${renderActorMetadata(actor)}
                  <span class="actor-meta">${formatVector(actor.location)}</span>
                </button>
              </li>
            `
          )
          .join("")}
      </ol>
      ${
        annotations.length > 200
          ? `<p class="muted actor-overflow">Showing 200 of ${annotations.length} placed actors.</p>`
          : ""
      }
    </section>
  `;
}

function renderActorMetadata(actor: UnrealActorAnnotation): string {
  if (!actor.brush) {
    return "";
  }

  const values = [
    actor.brush.csgOperation ? `CSG ${actor.brush.csgOperation}` : null,
    actor.brush.group ? `group ${actor.brush.group}` : null,
    actor.brush.polyFlags !== null ? `flags 0x${actor.brush.polyFlags.toString(16)}` : null,
    actor.brush.brushModel ? `model ${actor.brush.brushModel}` : null
  ].filter((value): value is string => value !== null);

  if (values.length === 0) {
    return "";
  }

  return `<span class="actor-meta">${values.map(escapeHtml).join(" · ")}</span>`;
}

function actorAnnotationRows(annotations: UnrealActorAnnotation[]): UnrealActorAnnotation[] {
  const rows = annotations.slice(0, 200);
  const selectedPath = state.selectedActorPath;

  if (selectedPath && !rows.some((actor) => actor.path === selectedPath)) {
    const selected = annotations.find((actor) => actor.path === selectedPath);
    if (selected) {
      rows.push(selected);
    }
  }

  return rows;
}

function renderListSection(title: string, values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  return `
    <section class="sample-section">
      <h3>${escapeHtml(title)}</h3>
      <ol>
        ${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}
      </ol>
    </section>
  `;
}

function defaultSurfaceVisibility(geometry: NonNullable<IndexedPackageWithSummary["geometry"]>): TriangleLayerVisibility {
  const solid = geometry.triangles.length > 0;
  const backdrop = !solid && geometry.backdropTriangles.length > 0;

  return {
    backdrop,
    invisible: !solid && !backdrop && geometry.invisibleTriangles.length > 0,
    solid
  };
}

function totalTriangleCount(geometry: NonNullable<IndexedPackageWithSummary["geometry"]>): number {
  return (
    geometry.triangles.length / 9 + geometry.backdropTriangles.length / 9 + geometry.invisibleTriangles.length / 9
  );
}

function displayedTriangleCount(
  geometry: NonNullable<IndexedPackageWithSummary["geometry"]>,
  visibility: TriangleLayerVisibility
): number {
  return (
    (visibility.solid ? geometry.triangles.length / 9 : 0) +
    (visibility.backdrop ? geometry.backdropTriangles.length / 9 : 0) +
    (visibility.invisible ? geometry.invisibleTriangles.length / 9 : 0)
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function formatVector(vector: { x: number; y: number; z: number }): string {
  return `x ${formatCoordinate(vector.x)}, y ${formatCoordinate(vector.y)}, z ${formatCoordinate(vector.z)}`;
}

function formatCoordinate(value: number): string {
  return value.toFixed(Math.abs(value) >= 100 ? 0 : 1);
}
