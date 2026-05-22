import { BinaryReader } from "./binaryReader";
import type { UnrealExportEntry, UnrealImportEntry, UnrealPackageTables } from "./packageTables";

export interface UnrealModelGeometry {
  sourceExport: string;
  points: Float32Array;
  triangles: Float32Array;
  triangleColors: Float32Array;
  backdropTriangles: Float32Array;
  backdropTriangleColors: Float32Array;
  invisibleTriangles: Float32Array;
  invisibleTriangleColors: Float32Array;
  materials: UnrealSurfaceMaterialUsage[];
  surfaceCount: number;
}

export interface UnrealSurfaceMaterialUsage {
  textureName: string;
  triangleCount: number;
}

interface ModelCandidate extends UnrealExportEntry {
  className: string;
}

interface BspNode {
  vertexPoolIndex: number;
  surfaceIndex: number;
  vertexCount: number;
}

interface BspSurface {
  polyFlags: number;
  textureName: string;
}

interface BspVert {
  pointIndex: number;
}

const POLY_FLAG_INVISIBLE = 0x00000001;
const POLY_FLAG_FAKE_BACKDROP = 0x00000080;

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
  const surfaces = readBspSurfaces(reader, tables);
  const verts = readBspVerts(reader);
  const geometry = triangulateNodes(points, nodes, surfaces, verts);

  return {
    sourceExport: model.objectName,
    points,
    triangles: geometry.solid.positions,
    triangleColors: geometry.solid.colors,
    backdropTriangles: geometry.backdrop.positions,
    backdropTriangleColors: geometry.backdrop.colors,
    invisibleTriangles: geometry.invisible.positions,
    invisibleTriangleColors: geometry.invisible.colors,
    materials: geometry.materials,
    surfaceCount: surfaces.length
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
    const surfaceIndex = reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    const vertexCount = reader.readUint8();
    reader.skip(8);
    nodes.push({ vertexPoolIndex, surfaceIndex, vertexCount });
  }

  return nodes;
}

function readBspSurfaces(reader: BinaryReader, tables: UnrealPackageTables): BspSurface[] {
  const surfaceCount = reader.readCompactIndex();
  const surfaces: BspSurface[] = [];

  for (let index = 0; index < surfaceCount; index += 1) {
    const textureIndex = reader.readCompactIndex();
    const polyFlags = reader.readUint32();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.skip(4);
    reader.readCompactIndex();
    surfaces.push({ polyFlags, textureName: resolveObjectName(textureIndex, tables) });
  }

  return surfaces;
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

function triangulateNodes(
  points: Float32Array,
  nodes: BspNode[],
  surfaces: BspSurface[],
  verts: BspVert[]
): {
  backdrop: TriangleLayerBuffers;
  invisible: TriangleLayerBuffers;
  materials: UnrealSurfaceMaterialUsage[];
  solid: TriangleLayerBuffers;
} {
  const solid = createTriangleLayerWriter();
  const backdrop = createTriangleLayerWriter();
  const invisible = createTriangleLayerWriter();
  const materialCounts = new Map<string, number>();
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

    const surface = surfaces[node.surfaceIndex];
    const target = triangleTargetForSurface(surface, solid, backdrop, invisible);
    const color = colorForTexture(surface?.textureName);

    for (let index = 1; index < polygon.length - 1; index += 1) {
      pushColoredPoint(target, points, polygon[0], color);
      pushColoredPoint(target, points, polygon[index], color);
      pushColoredPoint(target, points, polygon[index + 1], color);
      materialCounts.set(surface?.textureName ?? "None", (materialCounts.get(surface?.textureName ?? "None") ?? 0) + 1);
    }
  }

  return {
    backdrop: finishTriangleLayer(backdrop),
    invisible: finishTriangleLayer(invisible),
    materials: [...materialCounts]
      .map(([textureName, triangleCount]) => ({ textureName, triangleCount }))
      .sort((a, b) => b.triangleCount - a.triangleCount || a.textureName.localeCompare(b.textureName)),
    solid: finishTriangleLayer(solid)
  };
}

interface TriangleLayerWriter {
  colors: number[];
  positions: number[];
}

interface TriangleLayerBuffers {
  colors: Float32Array;
  positions: Float32Array;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function createTriangleLayerWriter(): TriangleLayerWriter {
  return {
    colors: [],
    positions: []
  };
}

function finishTriangleLayer(layer: TriangleLayerWriter): TriangleLayerBuffers {
  return {
    colors: new Float32Array(layer.colors),
    positions: new Float32Array(layer.positions)
  };
}

function triangleTargetForSurface(
  surface: BspSurface | undefined,
  solid: TriangleLayerWriter,
  backdrop: TriangleLayerWriter,
  invisible: TriangleLayerWriter
): TriangleLayerWriter {
  const flags = surface?.polyFlags ?? 0;

  if ((flags & POLY_FLAG_INVISIBLE) !== 0) {
    return invisible;
  }

  if ((flags & POLY_FLAG_FAKE_BACKDROP) !== 0) {
    return backdrop;
  }

  return solid;
}

function writePoint(points: Float32Array, index: number, x: number, y: number, z: number): void {
  const target = index * 3;
  points[target] = x;
  points[target + 1] = z;
  points[target + 2] = -y;
}

function pushColoredPoint(layer: TriangleLayerWriter, points: Float32Array, pointIndex: number, color: RgbColor): void {
  const source = pointIndex * 3;
  layer.positions.push(points[source], points[source + 1], points[source + 2]);
  layer.colors.push(color.r, color.g, color.b);
}

function colorForTexture(textureName = "None"): RgbColor {
  let hash = 0;

  for (let index = 0; index < textureName.length; index += 1) {
    hash = (hash * 31 + textureName.charCodeAt(index)) >>> 0;
  }

  const hue = (hash % 360) / 360;
  return hslToRgb(hue, 0.42, 0.68);
}

function hslToRgb(hue: number, saturation: number, lightness: number): RgbColor {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = lightness - chroma / 2;
  const sector = Math.floor(hue * 6);
  let r = 0;
  let g = 0;
  let b = 0;

  if (sector === 0) {
    r = chroma;
    g = x;
  } else if (sector === 1) {
    r = x;
    g = chroma;
  } else if (sector === 2) {
    g = chroma;
    b = x;
  } else if (sector === 3) {
    g = x;
    b = chroma;
  } else if (sector === 4) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  return {
    r: r + m,
    g: g + m,
    b: b + m
  };
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
