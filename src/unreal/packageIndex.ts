import { readActorAnnotations, type UnrealActorAnnotation } from "./actorAnnotations";
import { readClassDefaultMeshPath } from "./classDefaults";
import { readLodMeshGeometryByName, type UnrealMeshGeometry } from "./meshGeometry";
import { readPackageTables, type UnrealPackageTables } from "./packageTables";
import { readLargestModelGeometry, readModelGeometryByName, type UnrealModelGeometry } from "./modelPoints";
import { readTextureImages, type UnrealTextureImage } from "./textureDecoder";

export const KNOWN_PACKAGE_FOLDERS = ["Maps", "Textures", "System", "Sounds", "Music"] as const;

export type PackageFolder = (typeof KNOWN_PACKAGE_FOLDERS)[number];

export interface IndexedPackage {
  name: string;
  baseName: string;
  extension: string;
  folder: PackageFolder;
  path: string;
  size: number;
  file: File;
}

export interface PackageIndex {
  rootName: string;
  packages: IndexedPackage[];
  maps: IndexedPackage[];
  byKey: Map<string, IndexedPackage>;
  countsByFolder: Record<PackageFolder, number>;
}

export interface IndexedPackageWithSummary extends IndexedPackage {
  actorAnnotations: UnrealActorAnnotation[];
  brushGeometries: Map<string, UnrealModelGeometry>;
  meshGeometries: Map<string, UnrealMeshGeometry>;
  tables: UnrealPackageTables;
  geometry: UnrealModelGeometry | null;
  textures: Map<string, UnrealTextureImage>;
}

export function isUnrealPackageFile(fileName: string): boolean {
  return /\.(dx|u|utx|uax|umx)$/i.test(fileName);
}

export function packageKey(baseName: string, extension: string): string {
  return `${baseName.toLowerCase()}.${extension.toLowerCase()}`;
}

export async function buildPackageIndex(root: FileSystemDirectoryHandle): Promise<PackageIndex> {
  const packages: IndexedPackage[] = [];
  const countsByFolder = Object.fromEntries(
    KNOWN_PACKAGE_FOLDERS.map((folder) => [folder, 0])
  ) as Record<PackageFolder, number>;

  for (const folder of KNOWN_PACKAGE_FOLDERS) {
    let directory: FileSystemDirectoryHandle;

    try {
      directory = await root.getDirectoryHandle(folder);
    } catch {
      continue;
    }

    for await (const handle of directory.values()) {
      if (handle.kind !== "file" || !isUnrealPackageFile(handle.name)) {
        continue;
      }

      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const dotIndex = file.name.lastIndexOf(".");
      const baseName = file.name.slice(0, dotIndex);
      const extension = file.name.slice(dotIndex + 1);

      packages.push({
        name: file.name,
        baseName,
        extension,
        folder,
        path: `${folder}/${file.name}`,
        size: file.size,
        file
      });
      countsByFolder[folder] += 1;
    }
  }

  packages.sort((a, b) => a.path.localeCompare(b.path));

  const byKey = new Map<string, IndexedPackage>();
  for (const entry of packages) {
    byKey.set(packageKey(entry.baseName, entry.extension), entry);
  }

  return {
    rootName: root.name,
    packages,
    maps: packages.filter((entry) => entry.extension.toLowerCase() === "dx"),
    byKey,
    countsByFolder
  };
}

export async function readIndexedPackageSummary(
  entry: IndexedPackage,
  index?: PackageIndex
): Promise<IndexedPackageWithSummary> {
  const buffer = await entry.file.arrayBuffer();
  const tables = readPackageTables(buffer);
  const geometry = readLargestModelGeometry(buffer, tables);
  const actorAnnotations = readActorAnnotations(buffer, tables);
  const brushGeometries = readBrushActorGeometries(buffer, tables, actorAnnotations);
  const meshGeometries = await readMeshActorGeometries(entry, buffer, tables, actorAnnotations, index);
  const textures = geometry ? await loadGeometryTextures(entry, buffer, tables, geometry, index) : new Map();
  await loadMeshGeometryTextures(textures, entry, buffer, tables, meshGeometries, index);

  return {
    ...entry,
    actorAnnotations,
    brushGeometries,
    meshGeometries,
    tables,
    geometry,
    textures
  };
}

function readBrushActorGeometries(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  actorAnnotations: UnrealActorAnnotation[]
): Map<string, UnrealModelGeometry> {
  const geometries = new Map<string, UnrealModelGeometry>();
  const byModelName = new Map<string, UnrealModelGeometry | null>();

  for (const actor of actorAnnotations) {
    const modelName = actor.brush?.brushModel;
    if (!modelName) {
      continue;
    }

    if (!byModelName.has(modelName)) {
      byModelName.set(modelName, readModelGeometryByName(buffer, tables, modelName));
    }

    const geometry = byModelName.get(modelName);
    if (geometry) {
      geometries.set(actor.path, geometry);
    }
  }

  return geometries;
}

async function readMeshActorGeometries(
  entry: IndexedPackage,
  mapBuffer: ArrayBuffer,
  mapTables: UnrealPackageTables,
  actorAnnotations: UnrealActorAnnotation[],
  index: PackageIndex | undefined
): Promise<Map<string, UnrealMeshGeometry>> {
  const geometries = new Map<string, UnrealMeshGeometry>();
  const packageCache = new Map<string, Promise<{ buffer: ArrayBuffer; tables: UnrealPackageTables } | null>>();
  const meshCache = new Map<string, UnrealMeshGeometry | null>();
  const classDefaultMeshCache = new Map<string, Promise<string | null>>();

  for (const actor of actorAnnotations) {
    if (actor.brush) {
      continue;
    }

    const geometry = await readMeshGeometryForActor(
      actor,
      entry,
      mapBuffer,
      mapTables,
      index,
      packageCache,
      meshCache,
      classDefaultMeshCache
    );
    if (geometry) {
      geometries.set(actor.path, geometry);
    }
  }

  return geometries;
}

async function readMeshGeometryForActor(
  actor: UnrealActorAnnotation,
  entry: IndexedPackage,
  mapBuffer: ArrayBuffer,
  mapTables: UnrealPackageTables,
  index: PackageIndex | undefined,
  packageCache: Map<string, Promise<{ buffer: ArrayBuffer; tables: UnrealPackageTables } | null>>,
  meshCache: Map<string, UnrealMeshGeometry | null>,
  classDefaultMeshCache: Map<string, Promise<string | null>>
): Promise<UnrealMeshGeometry | null> {
  for (const reference of await meshReferencesForActor(
    actor,
    entry,
    mapBuffer,
    mapTables,
    index,
    packageCache,
    classDefaultMeshCache
  )) {
    const key = `${reference.packageName.toLowerCase()}:${reference.meshName.toLowerCase()}`;
    if (!meshCache.has(key)) {
      const meshPackage = await loadMeshPackage(reference.packageName, entry, mapBuffer, mapTables, index, packageCache);
      meshCache.set(
        key,
        meshPackage
          ? readLodMeshGeometryByName(meshPackage.buffer, meshPackage.tables, reference.meshName, reference.packageName)
          : null
      );
    }

    const geometry = meshCache.get(key);
    if (geometry) {
      return geometry;
    }
  }

  return null;
}

async function meshReferencesForActor(
  actor: UnrealActorAnnotation,
  entry: IndexedPackage,
  mapBuffer: ArrayBuffer,
  mapTables: UnrealPackageTables,
  index: PackageIndex | undefined,
  packageCache: Map<string, Promise<{ buffer: ArrayBuffer; tables: UnrealPackageTables } | null>>,
  classDefaultMeshCache: Map<string, Promise<string | null>>
): Promise<{ meshName: string; packageName: string }[]> {
  const references: { meshName: string; packageName: string }[] = [];
  const explicitMesh = meshPathReference(actor.mesh);
  if (explicitMesh) {
    references.push(explicitMesh);
  }

  const classParts = actor.classPath.split(".").filter(Boolean);
  const classPackage = classParts.length > 1 ? classParts[0] : null;
  if (classPackage) {
    const classDefaultMesh = meshPathReference(
      await readClassDefaultMeshForActor(
        actor,
        classPackage,
        entry,
        mapBuffer,
        mapTables,
        index,
        packageCache,
        classDefaultMeshCache
      )
    );
    if (classDefaultMesh) {
      references.push(classDefaultMesh);
    }
    references.push({ meshName: actor.className, packageName: classPackage });
  }

  for (const packageName of fallbackMeshPackageNames(actor)) {
    references.push({ meshName: actor.className, packageName });
  }

  return uniqueMeshReferences(references);
}

async function readClassDefaultMeshForActor(
  actor: UnrealActorAnnotation,
  classPackage: string,
  entry: IndexedPackage,
  mapBuffer: ArrayBuffer,
  mapTables: UnrealPackageTables,
  index: PackageIndex | undefined,
  packageCache: Map<string, Promise<{ buffer: ArrayBuffer; tables: UnrealPackageTables } | null>>,
  classDefaultMeshCache: Map<string, Promise<string | null>>
): Promise<string | null> {
  const key = `${classPackage.toLowerCase()}:${actor.className.toLowerCase()}`;
  if (!classDefaultMeshCache.has(key)) {
    classDefaultMeshCache.set(
      key,
      loadMeshPackage(classPackage, entry, mapBuffer, mapTables, index, packageCache).then((classPackageData) =>
        classPackageData
          ? readClassDefaultMeshPath(classPackageData.buffer, classPackageData.tables, actor.className)
          : null
      )
    );
  }

  return classDefaultMeshCache.get(key) ?? null;
}

function meshPathReference(meshPath: string | null): { meshName: string; packageName: string } | null {
  if (!meshPath || meshPath === "None") {
    return null;
  }

  const parts = meshPath.split(".").filter(Boolean);
  const meshName = parts.at(-1);
  const packageName = parts.length > 1 ? parts[0] : null;
  return meshName && packageName ? { meshName, packageName } : null;
}

function fallbackMeshPackageNames(actor: UnrealActorAnnotation): string[] {
  switch (actor.category) {
    case "Decoration":
      return ["DeusExDeco"];
    case "Ammo":
    case "Item":
    case "Key":
    case "Weapon":
      return ["DeusExItems", "DeusExDeco"];
    case "Character":
      return ["DeusExCharacters"];
    default:
      return ["DeusExDeco", "DeusExItems", "DeusExCharacters"];
  }
}

function uniqueMeshReferences(
  references: { meshName: string; packageName: string }[]
): { meshName: string; packageName: string }[] {
  const seen = new Set<string>();
  const unique: { meshName: string; packageName: string }[] = [];

  for (const reference of references) {
    const key = `${reference.packageName.toLowerCase()}:${reference.meshName.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(reference);
  }

  return unique;
}

async function loadMeshPackage(
  packageName: string,
  entry: IndexedPackage,
  mapBuffer: ArrayBuffer,
  mapTables: UnrealPackageTables,
  index: PackageIndex | undefined,
  cache: Map<string, Promise<{ buffer: ArrayBuffer; tables: UnrealPackageTables } | null>>
): Promise<{ buffer: ArrayBuffer; tables: UnrealPackageTables } | null> {
  const normalized = packageName.toLowerCase();
  if (normalized === entry.baseName.toLowerCase()) {
    return { buffer: mapBuffer, tables: mapTables };
  }

  if (!cache.has(normalized)) {
    cache.set(normalized, loadIndexedPackage(packageName, index));
  }

  return cache.get(normalized) ?? null;
}

async function loadIndexedPackage(
  packageName: string,
  index: PackageIndex | undefined
): Promise<{ buffer: ArrayBuffer; tables: UnrealPackageTables } | null> {
  const packageEntry =
    index?.byKey.get(packageKey(packageName, "u")) ??
    index?.byKey.get(packageKey(packageName, "dx")) ??
    index?.byKey.get(packageKey(packageName, "utx")) ??
    null;

  if (!packageEntry) {
    return null;
  }

  const buffer = await packageEntry.file.arrayBuffer();
  return {
    buffer,
    tables: readPackageTables(buffer)
  };
}

async function loadGeometryTextures(
  entry: IndexedPackage,
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  geometry: UnrealModelGeometry,
  index: PackageIndex | undefined
): Promise<Map<string, UnrealTextureImage>> {
  const textures = readTextureImages(buffer, tables, entry.baseName, materialSetForPackage(geometry, entry.baseName, true));
  const packageNames = new Set(geometry.materials.map((material) => material.textureName.split(".")[0]).filter(Boolean));

  for (const packageName of packageNames) {
    if (packageName.toLowerCase() === entry.baseName.toLowerCase()) {
      continue;
    }

    const packageEntry = findTexturePackage(index, packageName);
    if (!packageEntry) {
      continue;
    }

    const packageBuffer = await packageEntry.file.arrayBuffer();
    const packageTables = readPackageTables(packageBuffer);
    mergeTextureMaps(
      textures,
      readTextureImages(packageBuffer, packageTables, packageEntry.baseName, materialSetForPackage(geometry, packageName))
    );
  }

  return textures;
}

async function loadMeshGeometryTextures(
  target: Map<string, UnrealTextureImage>,
  entry: IndexedPackage,
  mapBuffer: ArrayBuffer,
  mapTables: UnrealPackageTables,
  meshGeometries: Map<string, UnrealMeshGeometry>,
  index: PackageIndex | undefined
): Promise<void> {
  const requestedByPackage = new Map<string, Set<string>>();

  for (const geometry of meshGeometries.values()) {
    for (const material of geometry.materials) {
      const packageName = material.textureName.split(".")[0];
      if (!packageName || packageName === "None") {
        continue;
      }
      let requested = requestedByPackage.get(packageName);
      if (!requested) {
        requested = new Set<string>();
        requestedByPackage.set(packageName, requested);
      }
      requested.add(material.textureName);
    }
  }

  for (const [packageName, requested] of requestedByPackage) {
    if (packageName.toLowerCase() === entry.baseName.toLowerCase()) {
      mergeTextureMaps(target, readTextureImages(mapBuffer, mapTables, entry.baseName, requested));
      continue;
    }

    const packageEntry = findTexturePackage(index, packageName);
    if (!packageEntry) {
      continue;
    }

    const packageBuffer = await packageEntry.file.arrayBuffer();
    const packageTables = readPackageTables(packageBuffer);
    mergeTextureMaps(
      target,
      readTextureImages(packageBuffer, packageTables, packageEntry.baseName, requested)
    );
  }
}

function materialSetForPackage(
  geometry: UnrealModelGeometry,
  packageName: string,
  includeLocalMaterials = false
): Set<string> {
  const requested = new Set<string>();

  for (const material of geometry.materials) {
    const normalized = material.textureName.toLowerCase();
    if (normalized === "none") {
      continue;
    }

    if (includeLocalMaterials) {
      requested.add(material.textureName);
    } else if (normalized.startsWith(`${packageName.toLowerCase()}.`)) {
      requested.add(material.textureName);
    }
  }

  return requested;
}

function findTexturePackage(index: PackageIndex | undefined, packageName: string): IndexedPackage | null {
  if (!index) {
    return null;
  }

  return (
    index.byKey.get(packageKey(packageName, "utx")) ??
    index.byKey.get(packageKey(packageName, "dx")) ??
    index.byKey.get(packageKey(packageName, "u")) ??
    null
  );
}

function mergeTextureMaps(target: Map<string, UnrealTextureImage>, source: Map<string, UnrealTextureImage>): void {
  for (const [key, image] of source) {
    target.set(key, image);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
