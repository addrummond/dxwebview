import { BinaryReader } from "./binaryReader";
import { resolveObjectName, resolveObjectPath } from "./objectReferences";
import type { UnrealExportEntry, UnrealPackageTables } from "./packageTables";
import type { UnrealSurfaceMaterialUsage, UnrealTriangleMaterialSpan } from "./modelPoints";

export interface UnrealMeshGeometry {
  colors: Float32Array;
  materialSpans: UnrealTriangleMaterialSpan[];
  materials: UnrealSurfaceMaterialUsage[];
  positions: Float32Array;
  sourceExport: string;
  uvs: Float32Array;
}

interface MeshCandidate extends UnrealExportEntry {
  className: string;
}

interface MeshFace {
  materialIndex: number;
  wedgeIndexes: [number, number, number];
}

interface MeshMaterial {
  textureIndex: number;
}

interface MeshVertex {
  x: number;
  y: number;
  z: number;
}

interface MeshWedge {
  s: number;
  t: number;
  vertexIndex: number;
}

interface TriangleLayerWriter {
  colors: number[];
  materialSpans: UnrealTriangleMaterialSpan[];
  positions: number[];
  uvs: number[];
}

interface RgbColor {
  b: number;
  g: number;
  r: number;
}

const BOUNDING_BOX_BYTES = 25;
const BOUNDING_SPHERE_BYTES = 16;

export function readLodMeshGeometryByName(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  objectName: string,
  packageName = ""
): UnrealMeshGeometry | null {
  const mesh = tables.exports
    .map((entry) => ({ ...entry, className: resolveObjectName(entry.classIndex, tables) }))
    .find(
      (entry): entry is MeshCandidate =>
        entry.className === "LodMesh" &&
        entry.objectName.toLowerCase() === objectName.toLowerCase() &&
        entry.serialOffset !== null &&
        entry.serialSize > 0
    );

  return mesh ? readLodMeshGeometry(buffer, tables, mesh, packageName) : null;
}

function readLodMeshGeometry(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  mesh: MeshCandidate,
  packageName: string
): UnrealMeshGeometry | null {
  if (mesh.serialOffset === null) {
    return null;
  }

  const reader = new BinaryReader(buffer);
  reader.seek(mesh.serialOffset);

  if (resolveName(reader.readCompactIndex(), tables) !== "None") {
    return null;
  }

  reader.skip(BOUNDING_BOX_BYTES + BOUNDING_SPHERE_BYTES);
  const vertices = readMeshVertices(reader);
  skipLegacyTriangles(reader);
  skipAnimSeqs(reader);
  skipConnects(reader);
  reader.skip(BOUNDING_BOX_BYTES + BOUNDING_SPHERE_BYTES);
  skipVertLinks(reader);
  const textures = readTextureReferences(reader, tables, packageName);
  skipBoundingBoxes(reader);
  skipBoundingSpheres(reader);
  const frameVerts = reader.readUint32();
  reader.readUint32();
  reader.readUint32();
  reader.readUint32();
  reader.skip(12 + 12 + 12);
  reader.readUint32();
  reader.readUint32();
  skipTextureLods(reader, tables);

  skipUint16Array(reader);
  skipUint16Array(reader);
  const faces = readFaces(reader);
  skipUint16Array(reader);
  const wedges = readWedges(reader);
  const materials = readMaterials(reader);
  skipFaces(reader);
  reader.readUint32();
  const specialVerts = reader.readUint32();

  const geometry = triangulateLodMesh(mesh.objectName, vertices, faces, wedges, materials, textures, frameVerts, specialVerts);
  return geometry.positions.length > 0 ? geometry : null;
}

function readMeshVertices(reader: BinaryReader): MeshVertex[] {
  const jumpOffset = reader.readUint32();
  const count = reader.readCompactIndex();
  const vertices: MeshVertex[] = [];

  for (let index = 0; index < count; index += 1) {
    vertices.push(decodeDeusExMeshVertex(reader));
  }

  reader.seek(jumpOffset);
  return vertices;
}

function decodeDeusExMeshVertex(reader: BinaryReader): MeshVertex {
  const bytes = reader.readBytes(8);
  const packed =
    BigInt(bytes[0]) |
    (BigInt(bytes[1]) << 8n) |
    (BigInt(bytes[2]) << 16n) |
    (BigInt(bytes[3]) << 24n) |
    (BigInt(bytes[4]) << 32n) |
    (BigInt(bytes[5]) << 40n) |
    (BigInt(bytes[6]) << 48n) |
    (BigInt(bytes[7]) << 56n);
  let x = Number(packed & 0xffffn) / 256;
  let y = Number((packed >> 16n) & 0xffffn) / 256;
  let z = Number((packed >> 32n) & 0xffffn) / 256;

  if (x > 128) x -= 256;
  if (y > 128) y -= 256;
  if (z > 128) z -= 256;

  return {
    x: -x,
    y: z,
    z: -y
  };
}

function skipLegacyTriangles(reader: BinaryReader): void {
  const jumpOffset = reader.readUint32();
  const count = reader.readCompactIndex();
  reader.skip(count * 24);
  reader.seek(jumpOffset);
}

function skipAnimSeqs(reader: BinaryReader): void {
  const count = reader.readCompactIndex();

  for (let index = 0; index < count; index += 1) {
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.readUint32();
    reader.readUint32();
    const functionCount = reader.readCompactIndex();
    for (let functionIndex = 0; functionIndex < functionCount; functionIndex += 1) {
      reader.readUint32();
      reader.readCompactIndex();
    }
    reader.readFloat32();
  }
}

function skipConnects(reader: BinaryReader): void {
  const jumpOffset = reader.readUint32();
  const count = reader.readCompactIndex();
  reader.skip(count * 8);
  reader.seek(jumpOffset);
}

function skipVertLinks(reader: BinaryReader): void {
  const jumpOffset = reader.readUint32();
  const count = reader.readCompactIndex();
  reader.skip(count * 4);
  reader.seek(jumpOffset);
}

function readTextureReferences(reader: BinaryReader, tables: UnrealPackageTables, packageName: string): string[] {
  const count = reader.readCompactIndex();
  const textures: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const texturePath = resolveObjectPath(reader.readCompactIndex(), tables);
    textures.push(packageName && texturePath !== "None" ? `${packageName}.${texturePath}` : texturePath);
  }

  return textures;
}

function skipBoundingBoxes(reader: BinaryReader): void {
  reader.skip(reader.readCompactIndex() * BOUNDING_BOX_BYTES);
}

function skipBoundingSpheres(reader: BinaryReader): void {
  reader.skip(reader.readCompactIndex() * BOUNDING_SPHERE_BYTES);
}

function skipTextureLods(reader: BinaryReader, tables: UnrealPackageTables): void {
  if (tables.summary.version === 65) {
    reader.readFloat32();
    return;
  }

  if (tables.summary.version >= 66) {
    const count = reader.readCompactIndex();
    reader.skip(count * 4);
  }
}

function skipUint16Array(reader: BinaryReader): void {
  reader.skip(reader.readCompactIndex() * 2);
}

function readFaces(reader: BinaryReader): MeshFace[] {
  const count = reader.readCompactIndex();
  const faces: MeshFace[] = [];

  for (let index = 0; index < count; index += 1) {
    faces.push({
      wedgeIndexes: [reader.readUint16(), reader.readUint16(), reader.readUint16()],
      materialIndex: reader.readUint16()
    });
  }

  return faces;
}

function skipFaces(reader: BinaryReader): void {
  reader.skip(reader.readCompactIndex() * 8);
}

function readWedges(reader: BinaryReader): MeshWedge[] {
  const count = reader.readCompactIndex();
  const wedges: MeshWedge[] = [];

  for (let index = 0; index < count; index += 1) {
    wedges.push({
      vertexIndex: reader.readUint16(),
      s: reader.readUint8(),
      t: reader.readUint8()
    });
  }

  return wedges;
}

function readMaterials(reader: BinaryReader): MeshMaterial[] {
  const count = reader.readCompactIndex();
  const materials: MeshMaterial[] = [];

  for (let index = 0; index < count; index += 1) {
    reader.readUint32();
    materials.push({ textureIndex: reader.readUint32() });
  }

  return materials;
}

function triangulateLodMesh(
  sourceExport: string,
  vertices: MeshVertex[],
  faces: MeshFace[],
  wedges: MeshWedge[],
  materials: MeshMaterial[],
  textures: string[],
  frameVerts: number,
  specialVerts: number
): UnrealMeshGeometry {
  const writer = createTriangleLayerWriter();
  const materialCounts = new Map<string, number>();
  const vertexOffset = specialVerts;
  const vertexLimit = frameVerts > 0 ? Math.min(vertices.length, vertexOffset + frameVerts) : vertices.length;

  for (const face of faces) {
    const faceWedges = face.wedgeIndexes.map((wedgeIndex) => wedges[wedgeIndex]);
    if (faceWedges.some((wedge) => wedge === undefined)) {
      continue;
    }
    const faceVertices = faceWedges.map((wedge) => vertices[wedge.vertexIndex + vertexOffset]);
    if (faceVertices.some((vertex) => vertex === undefined)) {
      continue;
    }
    if (faceWedges.some((wedge) => wedge.vertexIndex + vertexOffset >= vertexLimit)) {
      continue;
    }

    const textureName = textureNameForFace(face, materials, textures);
    const color = colorForTexture(textureName);
    startMaterialSpan(writer, textureName);

    for (let index = 0; index < faceWedges.length; index += 1) {
      const wedge = faceWedges[index];
      const vertex = faceVertices[index];
      writer.positions.push(vertex.x, vertex.y, vertex.z);
      writer.uvs.push(wedge.s / 255, 1 - wedge.t / 255);
      writer.colors.push(color.r, color.g, color.b);
    }

    if (writer.positions.length / 3 === writer.materialSpans.at(-1)?.start) {
      writer.materialSpans.pop();
      continue;
    }

    extendMaterialSpan(writer, 3);
    materialCounts.set(textureName, (materialCounts.get(textureName) ?? 0) + 1);
  }

  return {
    colors: new Float32Array(writer.colors),
    materialSpans: writer.materialSpans,
    materials: [...materialCounts]
      .map(([textureName, triangleCount]) => ({ textureName, triangleCount }))
      .sort((a, b) => b.triangleCount - a.triangleCount || a.textureName.localeCompare(b.textureName)),
    positions: new Float32Array(writer.positions),
    sourceExport,
    uvs: new Float32Array(writer.uvs)
  };
}

function createTriangleLayerWriter(): TriangleLayerWriter {
  return {
    colors: [],
    materialSpans: [],
    positions: [],
    uvs: []
  };
}

function textureNameForFace(face: MeshFace, materials: MeshMaterial[], textures: string[]): string {
  const textureIndex = materials[face.materialIndex]?.textureIndex ?? -1;
  return textures[textureIndex] ?? "None";
}

function startMaterialSpan(layer: TriangleLayerWriter, textureName: string): void {
  const start = layer.positions.length / 3;
  const previous = layer.materialSpans.at(-1);

  if (previous && previous.start + previous.count === start && previous.textureName === textureName) {
    return;
  }

  layer.materialSpans.push({ count: 0, renderMode: "opaque", start, textureName });
}

function extendMaterialSpan(layer: TriangleLayerWriter, count: number): void {
  const span = layer.materialSpans.at(-1);
  if (span) {
    span.count += count;
  }
}

function resolveName(index: number, tables: UnrealPackageTables): string {
  return tables.names[index]?.name ?? "None";
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
