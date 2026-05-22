import { BinaryReader } from "./binaryReader";
import type { UnrealExportEntry, UnrealImportEntry, UnrealPackageTables } from "./packageTables";

export interface UnrealModelGeometry {
  sourceExport: string;
  points: Float32Array;
  triangles: Float32Array;
}

interface ModelCandidate extends UnrealExportEntry {
  className: string;
}

interface BspNode {
  vertexPoolIndex: number;
  vertexCount: number;
}

interface BspVert {
  pointIndex: number;
}

export function readLargestModelGeometry(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables
): UnrealModelGeometry | null {
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
  const points = readPointArray(reader);
  const nodes = readBspNodes(reader);
  skipBspSurfaces(reader);
  const verts = readBspVerts(reader);
  const triangles = triangulateNodes(points, nodes, verts);

  return {
    sourceExport: model.objectName,
    points,
    triangles
  };
}

function skipVectorArray(reader: BinaryReader): void {
  const count = reader.readCompactIndex();
  reader.skip(count * 12);
}

function readPointArray(reader: BinaryReader): Float32Array {
  const pointCount = reader.readCompactIndex();
  const points = new Float32Array(pointCount * 3);

  for (let index = 0; index < pointCount; index += 1) {
    const x = reader.readFloat32();
    const y = reader.readFloat32();
    const z = reader.readFloat32();
    writePoint(points, index, x, y, z);
  }

  return points;
}

function readBspNodes(reader: BinaryReader): BspNode[] {
  const nodeCount = reader.readCompactIndex();
  const nodes: BspNode[] = [];

  for (let index = 0; index < nodeCount; index += 1) {
    reader.skip(16);
    reader.skip(8);
    reader.readUint8();
    const vertexPoolIndex = reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    const vertexCount = reader.readUint8();
    reader.skip(8);
    nodes.push({ vertexPoolIndex, vertexCount });
  }

  return nodes;
}

function skipBspSurfaces(reader: BinaryReader): void {
  const surfaceCount = reader.readCompactIndex();

  for (let index = 0; index < surfaceCount; index += 1) {
    reader.readCompactIndex();
    reader.readUint32();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.skip(4);
    reader.readCompactIndex();
  }
}

function readBspVerts(reader: BinaryReader): BspVert[] {
  const vertCount = reader.readCompactIndex();
  const verts: BspVert[] = [];

  for (let index = 0; index < vertCount; index += 1) {
    verts.push({
      pointIndex: reader.readCompactIndex()
    });
    reader.readCompactIndex();
  }

  return verts;
}

function triangulateNodes(points: Float32Array, nodes: BspNode[], verts: BspVert[]): Float32Array {
  const positions: number[] = [];
  const pointCount = points.length / 3;

  for (const node of nodes) {
    if (node.vertexCount < 3 || node.vertexCount > 64 || node.vertexPoolIndex < 0) {
      continue;
    }

    const polygon = verts
      .slice(node.vertexPoolIndex, node.vertexPoolIndex + node.vertexCount)
      .map((vert) => vert.pointIndex)
      .filter((pointIndex) => pointIndex >= 0 && pointIndex < pointCount);

    if (polygon.length < 3) {
      continue;
    }

    for (let index = 1; index < polygon.length - 1; index += 1) {
      pushPoint(positions, points, polygon[0]);
      pushPoint(positions, points, polygon[index]);
      pushPoint(positions, points, polygon[index + 1]);
    }
  }

  return new Float32Array(positions);
}

function writePoint(points: Float32Array, index: number, x: number, y: number, z: number): void {
  const target = index * 3;
  points[target] = x;
  points[target + 1] = z;
  points[target + 2] = -y;
}

function pushPoint(positions: number[], points: Float32Array, pointIndex: number): void {
  const source = pointIndex * 3;
  positions.push(points[source], points[source + 1], points[source + 2]);
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
