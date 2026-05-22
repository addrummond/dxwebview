import { BinaryReader } from "./binaryReader";
import type { UnrealExportEntry, UnrealImportEntry, UnrealPackageTables } from "./packageTables";

export interface UnrealPointCloud {
  sourceExport: string;
  points: Float32Array;
}

interface ModelCandidate extends UnrealExportEntry {
  className: string;
}

export function readLargestModelPointCloud(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables
): UnrealPointCloud | null {
  const model = tables.exports
    .map((entry) => ({ ...entry, className: resolveObjectName(entry.classIndex, tables) }))
    .filter((entry): entry is ModelCandidate => entry.className === "Model")
    .filter((entry) => entry.serialOffset !== null && entry.serialSize > 128)
    .sort((a, b) => b.serialSize - a.serialSize)[0];

  if (model?.serialOffset === null || model?.serialOffset === undefined) {
    return null;
  }

  const reader = new BinaryReader(buffer);
  reader.seek(model.serialOffset);

  const firstPropertyNameIndex = reader.readCompactIndex();
  if (tables.names[firstPropertyNameIndex]?.name !== "None") {
    return null;
  }

  // UModel serializes FBox + FSphere before its model arrays in UE1.
  reader.skip(41);
  skipVectorArray(reader);
  const pointCount = reader.readCompactIndex();
  const points = new Float32Array(pointCount * 3);

  for (let index = 0; index < pointCount; index += 1) {
    const x = reader.readFloat32();
    const y = reader.readFloat32();
    const z = reader.readFloat32();
    const target = index * 3;

    points[target] = x;
    points[target + 1] = z;
    points[target + 2] = -y;
  }

  return {
    sourceExport: model.objectName,
    points
  };
}

function skipVectorArray(reader: BinaryReader): void {
  const count = reader.readCompactIndex();
  reader.skip(count * 12);
}

function resolveObjectName(index: number, tables: UnrealPackageTables): string {
  if (index === 0) {
    return "None";
  }

  if (index < 0) {
    return resolveImportName(tables.imports[-index - 1]);
  }

  return tables.exports[index - 1]?.objectName ?? `#${index}`;
}

function resolveImportName(entry: UnrealImportEntry | undefined): string {
  return entry?.objectName ?? "None";
}
