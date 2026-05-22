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
    expect(geometry?.triangles.length).toBe(37117 * 9);
  });

  it.skipIf(!existsSync(trainingPath))("triangulates the training map BSP model", async () => {
    const file = await readFile(trainingPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const tables = readPackageTables(buffer);
    const geometry = readLargestModelGeometry(buffer, tables);

    expect(geometry?.sourceExport).toBe("Model36");
    expect(geometry?.points.length).toBe(16399 * 3);
    expect(geometry?.triangles.length).toBe(26021 * 9);
  });
});
