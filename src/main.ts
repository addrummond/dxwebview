import "./styles.css";
import { ViewerScene } from "./render/ViewerScene";
import {
  buildPackageIndex,
  formatBytes,
  readIndexedPackageSummary,
  type IndexedPackage,
  type IndexedPackageWithSummary,
  type PackageIndex
} from "./unreal/packageIndex";
import { formatPackageVersion } from "./unreal/packageSummary";

interface AppState {
  index: PackageIndex | null;
  selectedMap: IndexedPackageWithSummary | null;
  status: string;
  error: string | null;
}

const state: AppState = {
  index: null,
  selectedMap: null,
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
          <button type="button" disabled>Geometry</button>
          <button type="button" disabled>Actors</button>
          <button type="button" disabled>Lights</button>
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

const viewerScene = new ViewerScene(viewportElement);
render();

chooseFolderButton.addEventListener("click", () => {
  void chooseInstallFolder();
});

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}.`);
  }

  return element as T;
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
  state.selectedMap = null;
  setStatus(`Reading ${entry.path}...`);
  render();

  try {
    state.selectedMap = await readIndexedPackageSummary(entry);
    if (state.selectedMap.geometry && state.selectedMap.geometry.triangles.length > 0) {
      viewerScene.showTriangles(state.selectedMap.geometry.triangles);
      setStatus(
        `Rendered ${state.selectedMap.geometry.triangles.length / 9} triangles from ${state.selectedMap.geometry.sourceExport}.`
      );
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
  renderInspector();
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
          ? `${geometry.triangles.length / 9} triangles, ${geometry.points.length / 3} points from ${escapeHtml(
              geometry.sourceExport
            )}`
          : "None"
      }</dd></div>
    </dl>
    ${renderListSection("Names", sampleNames)}
    ${renderListSection("Imports", sampleImports)}
    ${renderListSection("Exports", sampleExports)}
  `;
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
