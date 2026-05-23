import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readActorAnnotations } from "./actorAnnotations";
import { readPackageTables } from "./packageTables";
import { UNREAL_PACKAGE_MAGIC } from "./packageSummary";

const deusExRoot = process.env.DEUS_EX_GOTY_PATH ?? "/Users/alex/deus_ex_goty_51757";
const trainingPath = `${deusExRoot}/Maps/00_Training.dx`;

describe("readActorAnnotations", () => {
  it("reads actor location, rotation, collision size, and category from tagged properties", () => {
    const buffer = makeActorPackageBuffer();
    const annotations = readActorAnnotations(buffer, readPackageTables(buffer));

    expect(annotations).toEqual([
      expect.objectContaining({
        category: "Ammo",
        className: "Ammo10mm",
        collisionHeight: 24,
        collisionRadius: 16,
        location: {
          x: 128,
          y: 64,
          z: -256
        },
        objectName: "Ammo10mm0",
        rotation: {
          pitch: 1,
          roll: 3,
          yaw: 2
        }
      })
    ]);
  });

  it("classifies brushes and reads CSG metadata", () => {
    const buffer = makeBrushPackageBuffer();
    const annotations = readActorAnnotations(buffer, readPackageTables(buffer));

    expect(annotations).toEqual([
      expect.objectContaining({
        brush: {
          brushModel: null,
          csgOperation: "Subtract",
          group: "Lobby",
          polyFlags: 0x40000008
        },
        category: "Brush",
        className: "Brush",
        objectName: "Brush12"
      })
    ]);
  });

  it.skipIf(!existsSync(trainingPath))("finds placed actors in a real Deus Ex map", async () => {
    const file = await readFile(trainingPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const annotations = readActorAnnotations(buffer, readPackageTables(buffer));

    expect(annotations.length).toBeGreaterThan(100);
    expect(annotations.some((annotation) => annotation.category === "Light")).toBe(true);
    expect(annotations.some((annotation) => annotation.category === "Brush" && annotation.brush?.csgOperation)).toBe(true);
  });
});

function makeActorPackageBuffer(): ArrayBuffer {
  const bytes = new Uint8Array(512);
  const view = new DataView(bytes.buffer);
  const nameTable: number[] = [];
  const importTable: number[] = [];
  const exportTable: number[] = [];
  const actorSerial: number[] = [];

  for (const name of [
    "None",
    "Engine",
    "Class",
    "Ammo10mm",
    "Ammo10mm0",
    "Location",
    "Rotation",
    "CollisionRadius",
    "CollisionHeight"
  ]) {
    writeString(nameTable, name);
    writeUint32(nameTable, 0);
  }

  writeCompact(importTable, 1);
  writeCompact(importTable, 2);
  writeInt32(importTable, 0);
  writeCompact(importTable, 3);

  writeVectorProperty(actorSerial, 5, 128, -256, 64);
  writeRotatorProperty(actorSerial, 6, 1, 2, 3);
  writeFloatProperty(actorSerial, 7, 16);
  writeFloatProperty(actorSerial, 8, 24);
  writeCompact(actorSerial, 0);

  const nameOffset = 64;
  const importOffset = nameOffset + nameTable.length;
  const exportOffset = importOffset + importTable.length;
  const serialOffset = exportOffset + 16;

  writeCompact(exportTable, -1);
  writeCompact(exportTable, 0);
  writeInt32(exportTable, 0);
  writeCompact(exportTable, 4);
  writeUint32(exportTable, 0);
  writeCompact(exportTable, actorSerial.length);
  writeCompact(exportTable, serialOffset);

  view.setUint32(0, UNREAL_PACKAGE_MAGIC, true);
  view.setUint16(4, 68, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, 1, true);
  view.setInt32(12, 9, true);
  view.setInt32(16, nameOffset, true);
  view.setInt32(20, 1, true);
  view.setInt32(24, exportOffset, true);
  view.setInt32(28, 1, true);
  view.setInt32(32, importOffset, true);

  bytes.set(nameTable, nameOffset);
  bytes.set(importTable, importOffset);
  bytes.set(exportTable, exportOffset);
  bytes.set(actorSerial, serialOffset);

  return bytes.buffer;
}

function makeBrushPackageBuffer(): ArrayBuffer {
  const bytes = new Uint8Array(512);
  const view = new DataView(bytes.buffer);
  const nameTable: number[] = [];
  const importTable: number[] = [];
  const exportTable: number[] = [];
  const actorSerial: number[] = [];

  for (const name of ["None", "Engine", "Class", "Brush", "Brush12", "Location", "CsgOper", "PolyFlags", "Group", "Lobby"]) {
    writeString(nameTable, name);
    writeUint32(nameTable, 0);
  }

  writeCompact(importTable, 1);
  writeCompact(importTable, 2);
  writeInt32(importTable, 0);
  writeCompact(importTable, 3);

  writeVectorProperty(actorSerial, 5, 16, 32, 48);
  writeByteProperty(actorSerial, 6, 2);
  writeIntProperty(actorSerial, 7, 0x40000008);
  writeNameProperty(actorSerial, 8, 9);
  writeCompact(actorSerial, 0);

  const nameOffset = 64;
  const importOffset = nameOffset + nameTable.length;
  const exportOffset = importOffset + importTable.length;
  const serialOffset = exportOffset + 16;

  writeCompact(exportTable, -1);
  writeCompact(exportTable, 0);
  writeInt32(exportTable, 0);
  writeCompact(exportTable, 4);
  writeUint32(exportTable, 0);
  writeCompact(exportTable, actorSerial.length);
  writeCompact(exportTable, serialOffset);

  view.setUint32(0, UNREAL_PACKAGE_MAGIC, true);
  view.setUint16(4, 68, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, 1, true);
  view.setInt32(12, 10, true);
  view.setInt32(16, nameOffset, true);
  view.setInt32(20, 1, true);
  view.setInt32(24, exportOffset, true);
  view.setInt32(28, 1, true);
  view.setInt32(32, importOffset, true);

  bytes.set(nameTable, nameOffset);
  bytes.set(importTable, importOffset);
  bytes.set(exportTable, exportOffset);
  bytes.set(actorSerial, serialOffset);

  return bytes.buffer;
}

function writeVectorProperty(bytes: number[], nameIndex: number, x: number, y: number, z: number): void {
  writeCompact(bytes, nameIndex);
  bytes.push((3 << 4) | 11);
  writeFloat32(bytes, x);
  writeFloat32(bytes, y);
  writeFloat32(bytes, z);
}

function writeRotatorProperty(bytes: number[], nameIndex: number, pitch: number, yaw: number, roll: number): void {
  writeCompact(bytes, nameIndex);
  bytes.push((3 << 4) | 12);
  writeInt32(bytes, pitch);
  writeInt32(bytes, yaw);
  writeInt32(bytes, roll);
}

function writeFloatProperty(bytes: number[], nameIndex: number, value: number): void {
  writeCompact(bytes, nameIndex);
  bytes.push((2 << 4) | 4);
  writeFloat32(bytes, value);
}

function writeByteProperty(bytes: number[], nameIndex: number, value: number): void {
  writeCompact(bytes, nameIndex);
  bytes.push(1);
  bytes.push(value);
}

function writeIntProperty(bytes: number[], nameIndex: number, value: number): void {
  writeCompact(bytes, nameIndex);
  bytes.push((2 << 4) | 2);
  writeInt32(bytes, value);
}

function writeNameProperty(bytes: number[], nameIndex: number, valueNameIndex: number): void {
  writeCompact(bytes, nameIndex);
  bytes.push(6);
  writeCompact(bytes, valueNameIndex);
}

function writeCompact(bytes: number[], value: number): void {
  const magnitude = Math.abs(value);

  if (magnitude > 0x1fff) {
    throw new Error("Test helper only writes small compact indexes.");
  }

  const sign = value < 0 ? 0x80 : 0;
  if (magnitude <= 0x3f) {
    bytes.push(sign | magnitude);
    return;
  }

  bytes.push(sign | (magnitude & 0x3f) | 0x40);
  bytes.push((magnitude >>> 6) & 0x7f);
}

function writeString(bytes: number[], value: string): void {
  const encoded = new TextEncoder().encode(`${value}\0`);
  writeCompact(bytes, encoded.length);
  bytes.push(...encoded);
}

function writeFloat32(bytes: number[], value: number): void {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  bytes.push(...new Uint8Array(buffer));
}

function writeInt32(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function writeUint32(bytes: number[], value: number): void {
  writeInt32(bytes, value);
}
