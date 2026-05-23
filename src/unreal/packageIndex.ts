import { readActorAnnotations, type UnrealActorAnnotation } from "./actorAnnotations";
import { readPackageTables, type UnrealPackageTables } from "./packageTables";
import { readLargestModelGeometry, type UnrealModelGeometry } from "./modelPoints";
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

  return {
    ...entry,
    actorAnnotations,
    tables,
    geometry,
    textures: geometry ? await loadGeometryTextures(entry, buffer, tables, geometry, index) : new Map()
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
