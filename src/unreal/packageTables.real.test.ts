import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readLargestModelGeometry } from "./modelPoints";
import { readPackageTables } from "./packageTables";

const deusExRoot = process.env.DEUS_EX_GOTY_PATH ?? "/Users/alex/deus_ex_goty_51757";
const unatcoIslandPath = `${deusExRoot}/Maps/01_NYC_UNATCOIsland.dx`;
const trainingPath = `${deusExRoot}/Maps/00_Training.dx`;

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
    expect(totalMaterialTriangles(geometry)).toBe(26021);
    expect(geometry?.materials.length).toBeGreaterThan(10);
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

function totalMaterialTriangles(geometry: ReturnType<typeof readLargestModelGeometry>): number {
  return geometry?.materials.reduce((total, material) => total + material.triangleCount, 0) ?? 0;
}
