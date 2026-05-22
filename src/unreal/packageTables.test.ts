import { describe, expect, it } from "vitest";
import { readPackageTables } from "./packageTables";
import { UNREAL_PACKAGE_MAGIC } from "./packageSummary";

function writeCompact(bytes: number[], value: number): void {
  if (value < 0 || value > 0x1fff) {
    throw new Error("Test helper only writes small positive compact indexes.");
  }

  if (value <= 0x3f) {
    bytes.push(value);
    return;
  }

  bytes.push((value & 0x3f) | 0x40);
  bytes.push((value >>> 6) & 0x7f);
}

function writeUint32(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function writeString(bytes: number[], value: string): void {
  const encoded = new TextEncoder().encode(`${value}\0`);
  writeCompact(bytes, encoded.length);
  bytes.push(...encoded);
}

function makePackageBuffer(): ArrayBuffer {
  const bytes = new Uint8Array(256);
  const view = new DataView(bytes.buffer);
  const nameTable: number[] = [];
  const importTable: number[] = [];
  const exportTable: number[] = [];

  for (const name of ["Engine", "Class", "LevelInfo", "MyLevel"]) {
    writeString(nameTable, name);
    writeUint32(nameTable, 0);
  }

  writeCompact(importTable, 0);
  writeCompact(importTable, 1);
  writeUint32(importTable, 0);
  writeCompact(importTable, 2);

  writeCompact(exportTable, -0);
  writeCompact(exportTable, 0);
  writeUint32(exportTable, 0);
  writeCompact(exportTable, 3);
  writeUint32(exportTable, 0x00000001);
  writeCompact(exportTable, 12);
  writeCompact(exportTable, 96);

  const nameOffset = 64;
  const importOffset = nameOffset + nameTable.length;
  const exportOffset = importOffset + importTable.length;

  view.setUint32(0, UNREAL_PACKAGE_MAGIC, true);
  view.setUint16(4, 68, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, 1, true);
  view.setInt32(12, 4, true);
  view.setInt32(16, nameOffset, true);
  view.setInt32(20, 1, true);
  view.setInt32(24, exportOffset, true);
  view.setInt32(28, 1, true);
  view.setInt32(32, importOffset, true);

  bytes.set(nameTable, nameOffset);
  bytes.set(importTable, importOffset);
  bytes.set(exportTable, exportOffset);

  return bytes.buffer;
}

describe("readPackageTables", () => {
  it("reads names, imports, and exports", () => {
    const tables = readPackageTables(makePackageBuffer());

    expect(tables.names.map((entry) => entry.name)).toEqual([
      "Engine",
      "Class",
      "LevelInfo",
      "MyLevel"
    ]);
    expect(tables.imports[0]).toMatchObject({
      classPackage: "Engine",
      className: "Class",
      objectName: "LevelInfo"
    });
    expect(tables.exports[0]).toMatchObject({
      objectName: "MyLevel",
      serialSize: 12,
      serialOffset: 96
    });
  });
});
