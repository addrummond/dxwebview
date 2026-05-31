import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readClassDefaultVisuals } from "./classDefaults";
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
const trainingCombatPath = `${deusExRoot}/Maps/00_TrainingCombat.dx`;
const freeClinicPath = `${deusExRoot}/Maps/02_NYC_FreeClinic.dx`;
const hotelPath = `${deusExRoot}/Maps/04_NYC_Hotel.dx`;
const hongKongCanalPath = `${deusExRoot}/Maps/06_HongKong_WanChai_Canal.dx`;
const concreteTexturePath = `${deusExRoot}/Textures/CoreTexConcrete.utx`;
const deusExSystemPath = `${deusExRoot}/System/DeusEx.u`;

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

  it.skipIf(!existsSync(freeClinicPath) || !existsSync(`${deusExRoot}/System/DeusExDeco.u`))(
    "loads decoration meshes referenced by actor classes",
    async () => {
      const index = await buildRealPackageIndex(["02_NYC_FreeClinic.dx"], [], ["DeusExDeco.u"]);
      const freeClinic = index.maps.find((entry) => entry.name === "02_NYC_FreeClinic.dx");

      expect(freeClinic).toBeDefined();
      const loaded = await readIndexedPackageSummary(freeClinic!, index);
      const couch = loaded.actorAnnotations.find((actor) => actor.objectName === "CouchLeather0");

      expect(couch).toBeDefined();
      expect(loaded.meshGeometries.get(couch!.path)?.positions.length).toBeGreaterThan(0);
      expect([...loaded.textures.keys()].some((key) => key.includes("couchleathertex1"))).toBe(true);
    }
  );

  it.skipIf(!existsSync(freeClinicPath) || !existsSync(`${deusExRoot}/System/DeusEx.u`) || !existsSync(`${deusExRoot}/System/DeusExCharacters.u`))(
    "loads live character meshes referenced by class defaults",
    async () => {
      const index = await buildRealPackageIndex(["02_NYC_FreeClinic.dx"], [], ["DeusEx.u", "DeusExCharacters.u"]);
      const freeClinic = index.maps.find((entry) => entry.name === "02_NYC_FreeClinic.dx");

      expect(freeClinic).toBeDefined();
      const loaded = await readIndexedPackageSummary(freeClinic!, index);
      const doctor = loaded.actorAnnotations.find((actor) => actor.objectName === "Doctor0");

      expect(doctor).toBeDefined();
      expect(loaded.meshGeometries.get(doctor!.path)?.sourceExport).toBe("GM_Trench");
      expect(loaded.meshGeometries.get(doctor!.path)?.positions.length).toBeGreaterThan(0);
      expect(loaded.meshGeometries.get(doctor!.path)?.materials[0]?.textureName).not.toBe("None");
    }
  );

  it.skipIf(!existsSync(hotelPath) || !existsSync(`${deusExRoot}/System/DeusEx.u`) || !existsSync(`${deusExRoot}/System/DeusExCharacters.u`))(
    "loads actors whose tagged properties follow state data",
    async () => {
      const index = await buildRealPackageIndex(["04_NYC_Hotel.dx"], [], ["DeusEx.u", "DeusExCharacters.u"]);
      const hotel = index.maps.find((entry) => entry.name === "04_NYC_Hotel.dx");

      expect(hotel).toBeDefined();
      const loaded = await readIndexedPackageSummary(hotel!, index);
      const paul = loaded.actorAnnotations.find((actor) => actor.objectName === "PaulDenton0");

      expect(paul).toBeDefined();
      expect(loaded.meshGeometries.get(paul!.path)?.sourceExport).toBe("GM_Trench");
      expect(loaded.meshGeometries.get(paul!.path)?.materials[0]?.textureName).not.toBe("None");
    }
  );

  it.skipIf(!existsSync(trainingCombatPath) || !existsSync(`${deusExRoot}/System/DeusEx.u`) || !existsSync(`${deusExRoot}/System/DeusExCharacters.u`))(
    "applies inherited class default collision sizes to mesh actors",
    async () => {
      const index = await buildRealPackageIndex(["00_TrainingCombat.dx"], [], ["DeusEx.u", "DeusExCharacters.u"]);
      const trainingCombat = index.maps.find((entry) => entry.name === "00_TrainingCombat.dx");

      expect(trainingCombat).toBeDefined();
      const loaded = await readIndexedPackageSummary(trainingCombat!, index);
      const securityBot = loaded.actorAnnotations.find((actor) => actor.objectName === "SecurityBot0");

      expect(securityBot).toBeDefined();
      expect(securityBot!.collisionHeight).toBeCloseTo(58.28, 2);
      expect(securityBot!.collisionRadius).toBeCloseTo(62, 2);
      expect(loaded.meshGeometries.get(securityBot!.path)?.sourceExport).toBe("SecurityBot2");
    }
  );

  it.skipIf(!existsSync(deusExSystemPath))("ignores false-positive non-texture class default skins", async () => {
    const file = await readFile(deusExSystemPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const tables = readPackageTables(buffer);

    const earth = readClassDefaultVisuals(buffer, tables, "Earth");
    const doctor = readClassDefaultVisuals(buffer, tables, "Doctor");

    expect(earth?.meshPath).toBe("DeusExDeco.Earth");
    expect(earth?.skins).not.toContain("ColorTheme");
    expect(doctor?.skins.some((skin) => skin?.includes("DoctorTex"))).toBe(true);
  });
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

async function buildRealPackageIndex(
  mapNames = ["00_Training.dx"],
  texturePackageNames: string[] | null = null,
  systemPackageNames: string[] = []
): Promise<PackageIndex> {
  const packages: IndexedPackage[] = [];

  for (const mapName of mapNames) {
    packages.push(await realPackage("Maps", mapName));
  }

  const textureNames =
    texturePackageNames ?? (await readdir(`${deusExRoot}/Textures`)).filter((name) => name.toLowerCase().endsWith(".utx"));
  for (const textureName of textureNames) {
    packages.push(await realPackage("Textures", textureName));
  }
  for (const systemName of systemPackageNames) {
    packages.push(await realPackage("System", systemName));
  }

  const byKey = new Map<string, IndexedPackage>();
  for (const entry of packages) {
    byKey.set(packageKey(entry.baseName, entry.extension), entry);
  }

  return {
    byKey,
    countsByFolder: {
      Maps: mapNames.length,
      Textures: textureNames.length,
      System: systemPackageNames.length,
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
