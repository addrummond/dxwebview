import { BinaryReader } from "./binaryReader";
import { resolveObjectName, resolveObjectPath } from "./objectReferences";
import type { UnrealExportEntry, UnrealPackageTables } from "./packageTables";

interface ClassCandidate extends UnrealExportEntry {
  className: string;
}

export interface UnrealClassDefaultVisuals {
  meshPath: string | null;
  skins: (string | null)[];
}

const PROPERTY_TYPE_OBJECT = 5;
const PROPERTY_SIZE_BY_CODE = [1, 2, 4, 12, 16] as const;

export function readClassDefaultMeshPath(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  className: string
): string | null {
  return readClassDefaultVisuals(buffer, tables, className)?.meshPath ?? null;
}

export function readClassDefaultVisuals(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  className: string
): UnrealClassDefaultVisuals | null {
  const classExport = tables.exports
    .map((entry) => ({ ...entry, className: resolveObjectName(entry.classIndex, tables) }))
    .find(
      (entry): entry is ClassCandidate =>
        entry.objectName === className &&
        entry.className === "None" &&
        entry.serialOffset !== null &&
        entry.serialSize > 0
    );

  if (!classExport || classExport.serialOffset === null) {
    return null;
  }

  const endOffset = classExport.serialOffset + classExport.serialSize;
  for (let offset = classExport.serialOffset; offset < endOffset; offset += 1) {
    const visuals = readVisualPropertiesAtOffset(buffer, tables, offset, endOffset);
    if (visuals?.meshPath) {
      return visuals;
    }
  }

  return null;
}

function readVisualPropertiesAtOffset(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  offset: number,
  endOffset: number
): UnrealClassDefaultVisuals | null {
  const reader = new BinaryReader(buffer);
  const visuals: UnrealClassDefaultVisuals = {
    meshPath: null,
    skins: []
  };
  let nextSkinIndex = 0;

  try {
    reader.seek(offset);

    for (let count = 0; count < 64 && reader.offset < endOffset; count += 1) {
      const nameIndex = reader.readCompactIndex();
      const name = tables.names[nameIndex]?.name;
      if (!name || name === "None" || reader.offset >= endOffset) {
        break;
      }

      const info = reader.readUint8();
      const type = info & 0x0f;
      const size = readPropertySize(reader, (info >> 4) & 0x07);
      const arrayIndex = (info & 0x80) !== 0 ? reader.readCompactIndex() : null;
      const valueEnd = Math.min(endOffset, reader.offset + size);

      if (type === PROPERTY_TYPE_OBJECT && name === "Mesh") {
        const meshPath = resolveObjectPath(reader.readCompactIndex(), tables);
        visuals.meshPath = meshPath !== "None" ? meshPath : null;
      } else if (type === PROPERTY_TYPE_OBJECT && name === "MultiSkins") {
        const skinPath = resolveObjectPath(reader.readCompactIndex(), tables);
        const skinIndex = arrayIndex ?? nextSkinIndex;
        visuals.skins[skinIndex] = skinPath !== "None" ? skinPath : null;
        nextSkinIndex = Math.max(nextSkinIndex, skinIndex + 1);
      }

      reader.seek(valueEnd);
    }

    return visuals.meshPath ? visuals : null;
  } catch {
    return null;
  }
}

function readPropertySize(reader: BinaryReader, sizeCode: number): number {
  if (sizeCode < PROPERTY_SIZE_BY_CODE.length) {
    return PROPERTY_SIZE_BY_CODE[sizeCode];
  }

  if (sizeCode === 5) {
    return reader.readUint8();
  }

  if (sizeCode === 6) {
    return reader.readUint16();
  }

  return reader.readInt32();
}
