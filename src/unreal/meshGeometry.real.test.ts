import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readLodMeshGeometryByName } from "./meshGeometry";
import { readPackageTables } from "./packageTables";

const deusExRoot = process.env.DEUS_EX_GOTY_PATH ?? "/Users/alex/deus_ex_goty_51757";
const decoPath = `${deusExRoot}/System/DeusExDeco.u`;

describe("readLodMeshGeometryByName", () => {
  it.skipIf(!existsSync(decoPath))("reads Deus Ex decoration LodMesh geometry", async () => {
    const file = await readFile(decoPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const geometry = readLodMeshGeometryByName(buffer, readPackageTables(buffer), "CouchLeather");

    expect(geometry).not.toBeNull();
    expect(geometry?.positions.length).toBeGreaterThan(0);
    expect(geometry?.positions.length).toBe((geometry?.uvs.length ?? 0) / 2 * 3);
    expect(geometry?.materials.some((material) => material.textureName.includes("CouchLeatherTex1"))).toBe(true);
  });

  it.skipIf(!existsSync(decoPath))("marks masked LodMesh materials", async () => {
    const file = await readFile(decoPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const geometry = readLodMeshGeometryByName(buffer, readPackageTables(buffer), "Tree3");

    expect(geometry).not.toBeNull();
    expect(geometry?.materialSpans.some((span) => span.renderMode === "masked")).toBe(true);
  });
});
