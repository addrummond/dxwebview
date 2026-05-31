import { BinaryReader } from "./binaryReader";
import { resolveObjectName, resolveObjectPath } from "./objectReferences";
import type { UnrealExportEntry, UnrealPackageTables } from "./packageTables";

interface ClassCandidate extends UnrealExportEntry {
  className: string;
}

export interface UnrealClassDefaultVisuals {
  collisionHeight: number | null;
  collisionRadius: number | null;
  meshPath: string | null;
  skins: (string | null)[];
}

const PROPERTY_TYPE_BOOL = 3;
const PROPERTY_TYPE_FLOAT = 4;
const PROPERTY_TYPE_OBJECT = 5;
const PROPERTY_TYPE_STRUCT = 10;
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

  return readClassDefaultVisualsForExport(buffer, tables, classExport, new Set());
}

function readClassDefaultVisualsForExport(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  classExport: ClassCandidate,
  seen: Set<number>
): UnrealClassDefaultVisuals | null {
  if (classExport.serialOffset === null || seen.has(classExport.index)) {
    return null;
  }

  seen.add(classExport.index);
  const superExport = classExport.superIndex > 0 ? tables.exports[classExport.superIndex - 1] : undefined;
  const inherited = superExport
    ? readClassDefaultVisualsForExport(
        buffer,
        tables,
        { ...superExport, className: resolveObjectName(superExport.classIndex, tables) },
        seen
      )
    : null;
  const own = readOwnClassDefaultVisuals(buffer, tables, classExport);
  return mergeClassDefaultVisuals(inherited, own);
}

function readOwnClassDefaultVisuals(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  classExport: ClassCandidate
): UnrealClassDefaultVisuals | null {
  if (classExport.serialOffset === null) {
    return null;
  }

  const visuals = emptyClassDefaultVisuals();
  const endOffset = classExport.serialOffset + classExport.serialSize;
  for (let offset = classExport.serialOffset; offset < endOffset; offset += 1) {
    const candidate = readVisualPropertiesAtOffset(buffer, tables, offset, endOffset);
    if (candidate) {
      mergeClassDefaultVisualsInto(visuals, candidate);
    }
  }

  return hasClassDefaultVisuals(visuals) ? visuals : null;
}

function readVisualPropertiesAtOffset(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  offset: number,
  endOffset: number
): UnrealClassDefaultVisuals | null {
  const reader = new BinaryReader(buffer);
  const visuals = emptyClassDefaultVisuals();
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
      if (type === PROPERTY_TYPE_STRUCT) {
        reader.readCompactIndex();
      }
      const size = type === PROPERTY_TYPE_BOOL ? 0 : readPropertySize(reader, (info >> 4) & 0x07);
      const arrayIndex = (info & 0x80) !== 0 ? reader.readCompactIndex() : null;
      const valueEnd = Math.min(endOffset, reader.offset + size);

      if (type === PROPERTY_TYPE_OBJECT && name === "Mesh") {
        const meshPath = resolveObjectPath(reader.readCompactIndex(), tables);
        visuals.meshPath = meshPath !== "None" ? meshPath : null;
      } else if (type === PROPERTY_TYPE_OBJECT && name === "MultiSkins") {
        const skinObjectIndex = reader.readCompactIndex();
        if (isTextureObjectReference(skinObjectIndex, tables)) {
          const skinPath = resolveObjectPath(skinObjectIndex, tables);
          const skinIndex = arrayIndex ?? nextSkinIndex;
          visuals.skins[skinIndex] = skinPath !== "None" ? skinPath : null;
          nextSkinIndex = Math.max(nextSkinIndex, skinIndex + 1);
        }
      } else if (type === PROPERTY_TYPE_FLOAT && size === 4 && name === "CollisionHeight") {
        visuals.collisionHeight = reader.readFloat32();
      } else if (type === PROPERTY_TYPE_FLOAT && size === 4 && name === "CollisionRadius") {
        visuals.collisionRadius = reader.readFloat32();
      }

      reader.seek(valueEnd);
    }

    return hasClassDefaultVisuals(visuals) ? visuals : null;
  } catch {
    return null;
  }
}

function emptyClassDefaultVisuals(): UnrealClassDefaultVisuals {
  return {
    collisionHeight: null,
    collisionRadius: null,
    meshPath: null,
    skins: []
  };
}

function mergeClassDefaultVisuals(
  inherited: UnrealClassDefaultVisuals | null,
  own: UnrealClassDefaultVisuals | null
): UnrealClassDefaultVisuals | null {
  const merged = emptyClassDefaultVisuals();
  if (inherited) {
    mergeClassDefaultVisualsInto(merged, inherited);
  }
  if (own) {
    mergeClassDefaultVisualsInto(merged, own);
  }

  return hasClassDefaultVisuals(merged) ? merged : null;
}

function mergeClassDefaultVisualsInto(
  target: UnrealClassDefaultVisuals,
  source: UnrealClassDefaultVisuals
): void {
  target.collisionHeight = source.collisionHeight ?? target.collisionHeight;
  target.collisionRadius = source.collisionRadius ?? target.collisionRadius;
  target.meshPath = source.meshPath ?? target.meshPath;
  for (let index = 0; index < source.skins.length; index += 1) {
    if (index in source.skins) {
      target.skins[index] = source.skins[index];
    }
  }
}

function hasClassDefaultVisuals(visuals: UnrealClassDefaultVisuals): boolean {
  return (
    visuals.collisionHeight !== null ||
    visuals.collisionRadius !== null ||
    visuals.meshPath !== null ||
    visuals.skins.some((skin) => skin !== undefined)
  );
}

function isTextureObjectReference(index: number, tables: UnrealPackageTables): boolean {
  if (index === 0) {
    return true;
  }

  if (index < 0) {
    return tables.imports[-index - 1]?.className === "Texture";
  }

  return resolveObjectName(tables.exports[index - 1]?.classIndex ?? 0, tables) === "Texture";
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
