import { BinaryReader } from "./binaryReader";
import { resolveObjectName, resolveObjectPath } from "./objectReferences";
import type { UnrealExportEntry, UnrealPackageTables } from "./packageTables";

export interface UnrealModelGeometry {
  sourceExport: string;
  points: Float32Array;
  triangles: Float32Array;
  triangleColors: Float32Array;
  triangleMaterialSpans: UnrealTriangleMaterialSpan[];
  triangleUvs: Float32Array;
  backdropTriangles: Float32Array;
  backdropTriangleColors: Float32Array;
  backdropTriangleMaterialSpans: UnrealTriangleMaterialSpan[];
  backdropTriangleUvs: Float32Array;
  invisibleTriangles: Float32Array;
  invisibleTriangleColors: Float32Array;
  invisibleTriangleMaterialSpans: UnrealTriangleMaterialSpan[];
  invisibleTriangleUvs: Float32Array;
  materials: UnrealSurfaceMaterialUsage[];
  surfaceCount: number;
}

export interface UnrealSurfaceMaterialUsage {
  textureName: string;
  triangleCount: number;
}

export interface UnrealTriangleMaterialSpan {
  count: number;
  renderMode: UnrealSurfaceRenderMode;
  start: number;
  textureName: string;
}

export type UnrealSurfaceRenderMode = "masked" | "opaque" | "translucent";

interface ModelCandidate extends UnrealExportEntry {
  className: string;
}

interface BspNode {
  vertexPoolIndex: number;
  surfaceIndex: number;
  vertexCount: number;
}

interface BspSurface {
  panU: number;
  panV: number;
  pBase: number;
  polyFlags: number;
  textureName: string;
  textureU: number;
  textureV: number;
}

interface BspVert {
  pointIndex: number;
}

const POLY_FLAG_INVISIBLE = 0x00000001;
const POLY_FLAG_MASKED = 0x00000002;
const POLY_FLAG_TRANSLUCENT = 0x00000004;
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

  if (!model) {
    return null;
  }

  return readModelGeometry(buffer, tables, model);
}

export function readModelGeometryByName(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  objectName: string
): UnrealModelGeometry | null {
  const model = tables.exports
    .map((entry) => ({ ...entry, className: resolveObjectName(entry.classIndex, tables) }))
    .find(
      (entry): entry is ModelCandidate =>
        entry.className === "Model" &&
        entry.objectName === objectName &&
        entry.serialOffset !== null &&
        entry.serialSize > 0
    );

  return model ? readModelGeometry(buffer, tables, model) : null;
}

function readModelGeometry(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  model: ModelCandidate
): UnrealModelGeometry | null {
  if (model.serialOffset === null) {
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
  const vectors = readVectorArray(reader);
  const { points, rawPoints } = readPointArray(reader);
  const nodes = readBspNodes(reader);
  const surfaces = readBspSurfaces(reader, tables);
  const verts = readBspVerts(reader);
  const geometry = triangulateNodes(points, rawPoints, vectors, nodes, surfaces, verts);

  return {
    sourceExport: model.objectName,
    points,
    triangles: geometry.solid.positions,
    triangleColors: geometry.solid.colors,
    triangleMaterialSpans: geometry.solid.materialSpans,
    triangleUvs: geometry.solid.uvs,
    backdropTriangles: geometry.backdrop.positions,
    backdropTriangleColors: geometry.backdrop.colors,
    backdropTriangleMaterialSpans: geometry.backdrop.materialSpans,
    backdropTriangleUvs: geometry.backdrop.uvs,
    invisibleTriangles: geometry.invisible.positions,
    invisibleTriangleColors: geometry.invisible.colors,
    invisibleTriangleMaterialSpans: geometry.invisible.materialSpans,
    invisibleTriangleUvs: geometry.invisible.uvs,
    materials: geometry.materials,
    surfaceCount: surfaces.length
  };
}

function readVectorArray(reader: BinaryReader): Float32Array {
  const count = reader.readCompactIndex();
  const vectors = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const target = index * 3;
    vectors[target] = reader.readFloat32();
    vectors[target + 1] = reader.readFloat32();
    vectors[target + 2] = reader.readFloat32();
  }

  return vectors;
}

function readPointArray(reader: BinaryReader): { points: Float32Array; rawPoints: Float32Array } {
  const pointCount = reader.readCompactIndex();
  const points = new Float32Array(pointCount * 3);
  const rawPoints = new Float32Array(pointCount * 3);

  for (let index = 0; index < pointCount; index += 1) {
    const x = reader.readFloat32();
    const y = reader.readFloat32();
    const z = reader.readFloat32();
    const target = index * 3;
    rawPoints[target] = x;
    rawPoints[target + 1] = y;
    rawPoints[target + 2] = z;
    writePoint(points, index, x, y, z);
  }

  return { points, rawPoints };
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
    const pBase = reader.readCompactIndex();
    reader.readCompactIndex();
    const textureU = reader.readCompactIndex();
    const textureV = reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readCompactIndex();
    const panU = reader.readInt16();
    const panV = reader.readInt16();
    reader.readCompactIndex();
    surfaces.push({ panU, panV, pBase, polyFlags, textureName: resolveObjectPath(textureIndex, tables), textureU, textureV });
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
  rawPoints: Float32Array,
  vectors: Float32Array,
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
    const renderMode = renderModeForSurface(surface);
    const color = colorForTexture(surface?.textureName);

    for (let index = 1; index < polygon.length - 1; index += 1) {
      const textureName = surface?.textureName ?? "None";
      startMaterialSpan(target, textureName, renderMode);
      pushColoredPoint(target, points, rawPoints, vectors, polygon[0], surface, color);
      pushColoredPoint(target, points, rawPoints, vectors, polygon[index], surface, color);
      pushColoredPoint(target, points, rawPoints, vectors, polygon[index + 1], surface, color);
      extendMaterialSpan(target, 3);
      materialCounts.set(textureName, (materialCounts.get(textureName) ?? 0) + 1);
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
  materialSpans: UnrealTriangleMaterialSpan[];
  positions: number[];
  uvs: number[];
}

interface TriangleLayerBuffers {
  colors: Float32Array;
  materialSpans: UnrealTriangleMaterialSpan[];
  positions: Float32Array;
  uvs: Float32Array;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function createTriangleLayerWriter(): TriangleLayerWriter {
  return {
    colors: [],
    materialSpans: [],
    positions: [],
    uvs: []
  };
}

function finishTriangleLayer(layer: TriangleLayerWriter): TriangleLayerBuffers {
  return {
    colors: new Float32Array(layer.colors),
    materialSpans: layer.materialSpans,
    positions: new Float32Array(layer.positions),
    uvs: new Float32Array(layer.uvs)
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
  points[target + 2] = y;
}

function startMaterialSpan(
  layer: TriangleLayerWriter,
  textureName: string,
  renderMode: UnrealSurfaceRenderMode
): void {
  const start = layer.positions.length / 3;
  const previous = layer.materialSpans.at(-1);

  if (
    previous &&
    previous.start + previous.count === start &&
    previous.textureName === textureName &&
    previous.renderMode === renderMode
  ) {
    return;
  }

  layer.materialSpans.push({ count: 0, renderMode, start, textureName });
}

function extendMaterialSpan(layer: TriangleLayerWriter, count: number): void {
  const span = layer.materialSpans.at(-1);

  if (span) {
    span.count += count;
  }
}

function pushColoredPoint(
  layer: TriangleLayerWriter,
  points: Float32Array,
  rawPoints: Float32Array,
  vectors: Float32Array,
  pointIndex: number,
  surface: BspSurface | undefined,
  color: RgbColor
): void {
  const source = pointIndex * 3;
  layer.positions.push(points[source], points[source + 1], points[source + 2]);
  layer.colors.push(color.r, color.g, color.b);
  pushSurfaceUv(layer, rawPoints, vectors, pointIndex, surface);
}

function pushSurfaceUv(
  layer: TriangleLayerWriter,
  rawPoints: Float32Array,
  vectors: Float32Array,
  pointIndex: number,
  surface: BspSurface | undefined
): void {
  if (!surface || !hasVector(rawPoints, surface.pBase) || !hasVector(vectors, surface.textureU) || !hasVector(vectors, surface.textureV)) {
    layer.uvs.push(0, 0);
    return;
  }

  const point = pointIndex * 3;
  const base = surface.pBase * 3;
  const textureU = surface.textureU * 3;
  const textureV = surface.textureV * 3;
  const x = rawPoints[point] - rawPoints[base];
  const y = rawPoints[point + 1] - rawPoints[base + 1];
  const z = rawPoints[point + 2] - rawPoints[base + 2];
  const u = -(x * vectors[textureU] + y * vectors[textureU + 1] + z * vectors[textureU + 2] + surface.panU);
  const v = x * vectors[textureV] + y * vectors[textureV + 1] + z * vectors[textureV + 2] + surface.panV;
  layer.uvs.push(u, v);
}

function hasVector(values: Float32Array, index: number): boolean {
  return index >= 0 && index * 3 + 2 < values.length;
}

function renderModeForSurface(surface: BspSurface | undefined): UnrealSurfaceRenderMode {
  const flags = surface?.polyFlags ?? 0;

  if ((flags & POLY_FLAG_MASKED) !== 0) {
    return "masked";
  }

  if ((flags & POLY_FLAG_TRANSLUCENT) !== 0) {
    return "translucent";
  }

  return "opaque";
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
