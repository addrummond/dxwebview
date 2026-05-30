import { BinaryReader } from "./binaryReader";
import { resolveObjectName, resolveObjectPath } from "./objectReferences";
import type { UnrealExportEntry, UnrealPackageTables } from "./packageTables";

interface ClassCandidate extends UnrealExportEntry {
  className: string;
}

const PROPERTY_TYPE_OBJECT = 5;
const PROPERTY_SIZE_BY_CODE = [1, 2, 4, 12, 16] as const;

export function readClassDefaultMeshPath(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  className: string
): string | null {
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
    const meshPath = readMeshPropertyAtOffset(buffer, tables, offset, endOffset);
    if (meshPath) {
      return meshPath;
    }
  }

  return null;
}

function readMeshPropertyAtOffset(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  offset: number,
  endOffset: number
): string | null {
  const reader = new BinaryReader(buffer);

  try {
    reader.seek(offset);
    const nameIndex = reader.readCompactIndex();
    if (tables.names[nameIndex]?.name !== "Mesh" || reader.offset >= endOffset) {
      return null;
    }

    const info = reader.readUint8();
    if ((info & 0x0f) !== PROPERTY_TYPE_OBJECT) {
      return null;
    }

    const size = readPropertySize(reader, (info >> 4) & 0x07);
    if ((info & 0x80) !== 0) {
      reader.readCompactIndex();
    }

    const valueEnd = Math.min(endOffset, reader.offset + size);
    const meshPath = resolveObjectPath(reader.readCompactIndex(), tables);
    return reader.offset <= valueEnd && meshPath !== "None" ? meshPath : null;
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
