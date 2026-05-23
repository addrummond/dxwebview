import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readLargestModelGeometry } from "./modelPoints";
import {
  packageKey,
  readIndexedPackageSummary,
  type IndexedPackage,
  type PackageIndex,
  type PackageFolder
} from "./packageIndex";
import { readPackageTables } from "./packageTables";
import { readTextureImages } from "./textureDecoder";

const deusExRoot = process.env.DEUS_EX_GOTY_PATH ?? "/Users/alex/deus_ex_goty_51757";
const unatcoIslandPath = `${deusExRoot}/Maps/01_NYC_UNATCOIsland.dx`;
const trainingPath = `${deusExRoot}/Maps/00_Training.dx`;
const hongKongCanalPath = `${deusExRoot}/Maps/06_HongKong_WanChai_Canal.dx`;
const concreteTexturePath = `${deusExRoot}/Textures/CoreTexConcrete.utx`;

describe("readPackageTables with Deus Ex GOTY data", () => {
  it.skipIf(!existsSync(unatcoIslandPath))("reads a real Deus Ex map package", async () => {
    const file = await readFile(unatcoIslandPath);
    const tables = readPackageTables(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

    expect(tables.summary.version).toBe(68);
    expect(tables.names.length).toBe(7328);
    expect(tables.imports.length).toBe(367);
    expect(tables.exports.length).toBe(6531);
    expect(tables.names.slice(0, 4).map((entry) => entry.name)).toEqual([
      "OUTSIDE",
      "Vector",
      "PrunedPaths",
      "None"
    ]);
    expect(tables.exports.slice(0, 25).some((entry) => !entry.objectName.startsWith("#"))).toBe(true);

    const geometry = readLargestModelGeometry(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      tables
    );

    expect(geometry?.sourceExport).toBe("Model189");
    expect(geometry?.points.length).toBe(22433 * 3);
    expect(totalTriangleCoordinates(geometry)).toBe(37117 * 9);
    expect(totalColorCoordinates(geometry)).toBe(totalTriangleCoordinates(geometry));
    expect(totalUvCoordinates(geometry)).toBe((totalTriangleCoordinates(geometry) / 3) * 2);
    expect(totalMaterialTriangles(geometry)).toBe(37117);
    expect(geometry?.materials.length).toBeGreaterThan(10);
  });

  it.skipIf(!existsSync(trainingPath))("triangulates the training map BSP model", async () => {
    const file = await readFile(trainingPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const tables = readPackageTables(buffer);
    const geometry = readLargestModelGeometry(buffer, tables);

    expect(geometry?.sourceExport).toBe("Model36");
    expect(geometry?.points.length).toBe(16399 * 3);
    expect(totalTriangleCoordinates(geometry)).toBe(26021 * 9);
    expect(totalColorCoordinates(geometry)).toBe(totalTriangleCoordinates(geometry));
    expect(totalUvCoordinates(geometry)).toBe((totalTriangleCoordinates(geometry) / 3) * 2);
    expect(totalMaterialTriangles(geometry)).toBe(26021);
    expect(geometry?.materials.length).toBeGreaterThan(10);
  });

  it.skipIf(!existsSync(hongKongCanalPath))("marks masked surfaces in Hong Kong canal geometry", async () => {
    const file = await readFile(hongKongCanalPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const tables = readPackageTables(buffer);
    const geometry = readLargestModelGeometry(buffer, tables);

    expect(geometry?.triangleMaterialSpans.some((span) => span.renderMode === "masked")).toBe(true);
  });

  it.skipIf(!existsSync(concreteTexturePath))("decodes real Deus Ex paletted textures", async () => {
    const file = await readFile(concreteTexturePath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const tables = readPackageTables(buffer);
    const textures = readTextureImages(buffer, tables, "CoreTexConcrete");

    expect(textures.size).toBeGreaterThan(10);
    expect([...textures.values()].some((texture) => texture.width > 0 && texture.height > 0)).toBe(true);
    for (const texture of textures.values()) {
      expect(texture.rgba.length).toBe(texture.width * texture.height * 4);
    }
  });

  it.skipIf(!existsSync(trainingPath) || !existsSync(`${deusExRoot}/Textures`))(
    "loads decoded textures for real map geometry",
    async () => {
      const index = await buildRealPackageIndex();
      const training = index.maps.find((entry) => entry.name === "00_Training.dx");

      expect(training).toBeDefined();
      const loaded = await readIndexedPackageSummary(training!, index);

      expect(loaded.geometry?.materials.length).toBeGreaterThan(10);
      expect(loaded.textures.size).toBeGreaterThan(0);
      expect(loaded.brushGeometries.size).toBeGreaterThan(0);
    }
  );
});

function totalTriangleCoordinates(geometry: ReturnType<typeof readLargestModelGeometry>): number {
  return (
    (geometry?.triangles.length ?? 0) +
    (geometry?.backdropTriangles.length ?? 0) +
    (geometry?.invisibleTriangles.length ?? 0)
  );
}

function totalColorCoordinates(geometry: ReturnType<typeof readLargestModelGeometry>): number {
  return (
    (geometry?.triangleColors.length ?? 0) +
    (geometry?.backdropTriangleColors.length ?? 0) +
    (geometry?.invisibleTriangleColors.length ?? 0)
  );
}

function totalUvCoordinates(geometry: ReturnType<typeof readLargestModelGeometry>): number {
  return (
    (geometry?.triangleUvs.length ?? 0) +
    (geometry?.backdropTriangleUvs.length ?? 0) +
    (geometry?.invisibleTriangleUvs.length ?? 0)
  );
}

function totalMaterialTriangles(geometry: ReturnType<typeof readLargestModelGeometry>): number {
  return geometry?.materials.reduce((total, material) => total + material.triangleCount, 0) ?? 0;
}

async function buildRealPackageIndex(): Promise<PackageIndex> {
  const packages: IndexedPackage[] = [await realPackage("Maps", "00_Training.dx")];
  const textureNames = await readdir(`${deusExRoot}/Textures`);

  for (const textureName of textureNames.filter((name) => name.toLowerCase().endsWith(".utx"))) {
    packages.push(await realPackage("Textures", textureName));
  }

  const byKey = new Map<string, IndexedPackage>();
  for (const entry of packages) {
    byKey.set(packageKey(entry.baseName, entry.extension), entry);
  }

  return {
    byKey,
    countsByFolder: {
      Maps: 1,
      Textures: packages.length - 1,
      System: 0,
      Sounds: 0,
      Music: 0
    },
    maps: packages.filter((entry) => entry.extension.toLowerCase() === "dx"),
    packages,
    rootName: "deus_ex_goty_51757"
  };
}

async function realPackage(folder: PackageFolder, name: string): Promise<IndexedPackage> {
  const path = `${deusExRoot}/${folder}/${name}`;
  const dotIndex = name.lastIndexOf(".");
  const baseName = name.slice(0, dotIndex);
  const extension = name.slice(dotIndex + 1);
  const file = new File([await readFile(path)], name);

  return {
    baseName,
    extension,
    file,
    folder,
    name,
    path: `${folder}/${name}`,
    size: (await stat(path)).size
  };
}
