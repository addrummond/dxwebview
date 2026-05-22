import { BinaryReader } from "./binaryReader";
import type { UnrealExportEntry, UnrealImportEntry, UnrealPackageTables } from "./packageTables";

export interface UnrealTextureImage {
  height: number;
  indices: Uint8Array;
  name: string;
  rgba: Uint8Array;
  width: number;
}

interface UnrealObjectProperty {
  name: string;
  type: string;
  value: number | string | boolean | null;
}

interface MipMap {
  data: Uint8Array;
  height: number;
  width: number;
}

interface RgbaColor {
  a: number;
  b: number;
  g: number;
  r: number;
}

interface TextureCandidate extends UnrealExportEntry {
  className: string;
  objectPath: string;
}

const PROPERTY_TYPES = [
  "Unknown",
  "Byte",
  "Integer",
  "Boolean",
  "Float",
  "Object",
  "Name",
  "String",
  "Class",
  "Array",
  "Struct",
  "Vector",
  "Rotator",
  "Str",
  "Map",
  "Fixed Array"
] as const;

export function readTextureImages(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  packageName: string,
  requestedPaths?: Set<string>
): Map<string, UnrealTextureImage> {
  const images = new Map<string, UnrealTextureImage>();
  const textures = tables.exports
    .map((entry) => ({
      ...entry,
      className: resolveObjectName(entry.classIndex, tables),
      objectPath: resolveExportPath(entry, tables)
    }))
    .filter((entry): entry is TextureCandidate => entry.className === "Texture")
    .filter((entry) => entry.serialOffset !== null && entry.serialSize > 0)
    .filter((entry) => !requestedPaths || shouldDecodeTexture(entry, packageName, requestedPaths));

  for (const texture of textures) {
    const image = readTextureImage(buffer, tables, texture);
    if (!image) {
      continue;
    }

    for (const alias of textureAliases(texture, packageName)) {
      images.set(alias.toLowerCase(), image);
    }
  }

  return images;
}

function shouldDecodeTexture(texture: TextureCandidate, packageName: string, requestedPaths: Set<string>): boolean {
  const aliases = textureAliases(texture, packageName).map((alias) => alias.toLowerCase());

  for (const requestedPath of requestedPaths) {
    const normalized = requestedPath.toLowerCase();
    if (aliases.includes(normalized) || aliases.some((alias) => normalized.endsWith(`.${alias}`))) {
      return true;
    }
  }

  return false;
}

function textureAliases(texture: TextureCandidate, packageName: string): string[] {
  return [
    texture.objectName,
    texture.objectPath,
    `${packageName}.${texture.objectName}`,
    `${packageName}.${texture.objectPath}`
  ];
}

function readTextureImage(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  texture: TextureCandidate
): UnrealTextureImage | null {
  if (texture.serialOffset === null) {
    return null;
  }

  const reader = new BinaryReader(buffer);
  reader.seek(texture.serialOffset);
  const properties = readObjectProperties(reader, tables);
  const paletteIndex = objectProperty(properties, "Palette");
  const palette = paletteIndex === null ? null : readPalette(buffer, tables, paletteIndex);

  if (!palette) {
    return null;
  }

  const mipCount = reader.readUint8();
  if (mipCount <= 0) {
    return null;
  }

  const mip = readMipMap(reader, tables);
  if (mip.width <= 0 || mip.height <= 0 || mip.data.length === 0) {
    return null;
  }

  return {
    height: mip.height,
    indices: mip.data,
    name: texture.objectPath,
    rgba: indexedPixelsToRgba(mip, palette),
    width: mip.width
  };
}

function readPalette(buffer: ArrayBuffer, tables: UnrealPackageTables, objectIndex: number): RgbaColor[] | null {
  if (objectIndex <= 0) {
    return null;
  }

  const entry = tables.exports[objectIndex - 1];
  if (!entry || resolveObjectName(entry.classIndex, tables) !== "Palette" || entry.serialOffset === null) {
    return null;
  }

  const reader = new BinaryReader(buffer);
  reader.seek(entry.serialOffset);
  readObjectProperties(reader, tables);
  const colorCount = reader.readCompactIndex();
  const colors: RgbaColor[] = [];

  for (let index = 0; index < colorCount; index += 1) {
    colors.push({
      r: reader.readUint8(),
      g: reader.readUint8(),
      b: reader.readUint8(),
      a: reader.readUint8()
    });
  }

  return colors;
}

function readMipMap(reader: BinaryReader, tables: UnrealPackageTables): MipMap {
  if (tables.summary.version >= 63) {
    reader.readUint32();
  }

  const size = reader.readCompactIndex();
  const data = new Uint8Array(reader.readBytes(size));
  const width = reader.readUint32();
  const height = reader.readUint32();
  reader.readUint8();
  reader.readUint8();

  return { data, height, width };
}

function indexedPixelsToRgba(mip: MipMap, palette: RgbaColor[]): Uint8Array {
  const rgba = new Uint8Array(mip.width * mip.height * 4);
  const pixelCount = Math.min(mip.data.length, mip.width * mip.height);

  for (let index = 0; index < pixelCount; index += 1) {
    const color = palette[mip.data[index]];
    const target = index * 4;
    rgba[target] = color?.r ?? 255;
    rgba[target + 1] = color?.g ?? 0;
    rgba[target + 2] = color?.b ?? 255;
    rgba[target + 3] = color?.a ?? 255;
  }

  return rgba;
}

function readObjectProperties(reader: BinaryReader, tables: UnrealPackageTables): UnrealObjectProperty[] {
  const properties: UnrealObjectProperty[] = [];
  let name = readName(reader, tables);

  while (name.toLowerCase() !== "none") {
    const infoByte = reader.readUint8();
    const type = PROPERTY_TYPES[infoByte & 0x0f] ?? "Unknown";
    let subtype = "";

    if (type === "Struct") {
      subtype = readName(reader, tables);
    }

    const size = readPropertySize(reader, infoByte);
    const isArray = (infoByte & 0x80) !== 0;
    if (type !== "Boolean" && isArray) {
      skipArrayIndex(reader, properties.at(-1));
    }

    properties.push({
      name,
      type,
      value: readPropertyValue(reader, tables, type, subtype, size, isArray)
    });
    name = readName(reader, tables);
  }

  return properties;
}

function readPropertySize(reader: BinaryReader, infoByte: number): number {
  const sizeInfo = (infoByte >> 4) & 0x07;

  if (sizeInfo === 0) return 1;
  if (sizeInfo === 1) return 2;
  if (sizeInfo === 2) return 4;
  if (sizeInfo === 3) return 12;
  if (sizeInfo === 4) return 16;
  if (sizeInfo === 5) return reader.readUint8();
  if (sizeInfo === 6) return reader.readUint16();
  if (sizeInfo === 7) return reader.readUint32();
  return 1;
}

function skipArrayIndex(reader: BinaryReader, previous: UnrealObjectProperty | undefined): void {
  if (!previous) {
    reader.readUint8();
    return;
  }

  // UE1 uses a compact-but-not-CompactIndex array index encoding keyed from the previous index.
  reader.readUint8();
}

function readPropertyValue(
  reader: BinaryReader,
  tables: UnrealPackageTables,
  type: string,
  subtype: string,
  size: number,
  isArray: boolean
): number | string | boolean | null {
  if (type === "Byte") return reader.readUint8();
  if (type === "Integer") return reader.readInt32();
  if (type === "Boolean") return isArray;
  if (type === "Float") return reader.readFloat32();
  if (type === "Object") return reader.readCompactIndex();
  if (type === "Name") return readName(reader, tables);
  if (type === "Str") return reader.readSerializedString();

  if (type === "Struct" && subtype.toLowerCase() === "color") {
    reader.skip(4);
    return null;
  }

  reader.skip(size);
  return null;
}

function objectProperty(properties: UnrealObjectProperty[], name: string): number | null {
  const value = properties.find((property) => property.name.toLowerCase() === name.toLowerCase())?.value;
  return typeof value === "number" ? value : null;
}

function readName(reader: BinaryReader, tables: UnrealPackageTables): string {
  return tables.names[reader.readCompactIndex()]?.name ?? "None";
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

function resolveObjectPath(index: number, tables: UnrealPackageTables): string {
  if (index === 0) {
    return "None";
  }

  if (index < 0) {
    return resolveImportPath(tables.imports[-index - 1], tables);
  }

  return resolveExportPath(tables.exports[index - 1], tables);
}

function resolveImportPath(entry: UnrealImportEntry | undefined, tables: UnrealPackageTables): string {
  if (!entry) {
    return "None";
  }

  const outer = entry.outerIndex === 0 ? "" : resolveObjectPath(entry.outerIndex, tables);
  return outer && outer !== "None" ? `${outer}.${entry.objectName}` : entry.objectName;
}

function resolveExportPath(entry: UnrealExportEntry | undefined, tables: UnrealPackageTables): string {
  if (!entry) {
    return "None";
  }

  const outer = entry.outerIndex === 0 ? "" : resolveObjectPath(entry.outerIndex, tables);
  return outer && outer !== "None" ? `${outer}.${entry.objectName}` : entry.objectName;
}
