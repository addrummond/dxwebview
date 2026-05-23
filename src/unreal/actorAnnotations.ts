import { BinaryReader } from "./binaryReader";
import { resolveObjectName, resolveObjectPath } from "./objectReferences";
import type { UnrealExportEntry, UnrealPackageTables } from "./packageTables";

export type UnrealActorCategory =
  | "Ammo"
  | "Audio"
  | "Brush"
  | "Character"
  | "Decoration"
  | "Item"
  | "Key"
  | "Light"
  | "Mover"
  | "Navigation"
  | "Other"
  | "Trigger"
  | "Weapon";

export interface UnrealVector {
  x: number;
  y: number;
  z: number;
}

export interface UnrealRotator {
  pitch: number;
  roll: number;
  yaw: number;
}

export interface UnrealActorAnnotation {
  brush: UnrealBrushMetadata | null;
  category: UnrealActorCategory;
  className: string;
  classPath: string;
  collisionHeight: number | null;
  collisionRadius: number | null;
  location: UnrealVector;
  objectName: string;
  path: string;
  rotation: UnrealRotator | null;
}

export interface UnrealBrushMetadata {
  brushModel: string | null;
  csgOperation: string | null;
  group: string | null;
  polyFlags: number | null;
}

type UnrealPropertyValue = number | string | boolean | UnrealVector | UnrealRotator;

interface PropertyTag {
  name: string;
  type: number;
  value: UnrealPropertyValue | null;
}

const PROPERTY_TYPE_BYTE = 1;
const PROPERTY_TYPE_INT = 2;
const PROPERTY_TYPE_BOOL = 3;
const PROPERTY_TYPE_FLOAT = 4;
const PROPERTY_TYPE_OBJECT = 5;
const PROPERTY_TYPE_NAME = 6;
const PROPERTY_TYPE_STRING = 7;
const PROPERTY_TYPE_STRUCT = 10;
const PROPERTY_TYPE_VECTOR = 11;
const PROPERTY_TYPE_ROTATOR = 12;
const PROPERTY_TYPE_STR = 13;

const PROPERTY_SIZE_BY_CODE = [1, 2, 4, 12, 16] as const;
const MAX_ACTOR_PROPERTIES = 512;

export function readActorAnnotations(buffer: ArrayBuffer, tables: UnrealPackageTables): UnrealActorAnnotation[] {
  const annotations: UnrealActorAnnotation[] = [];

  for (const entry of tables.exports) {
    if (entry.serialOffset === null || entry.serialSize <= 0) {
      continue;
    }

    const properties = readTaggedProperties(buffer, tables, entry);
    const location = properties.get("location");

    if (!isVector(location)) {
      continue;
    }

    const className = resolveObjectName(entry.classIndex, tables);
    const classPath = resolveObjectPath(entry.classIndex, tables);
    if (shouldSkipExport(className)) {
      continue;
    }

    const rotation = properties.get("rotation");
    const collisionRadius = properties.get("collisionradius");
    const collisionHeight = properties.get("collisionheight");
    const brush = readBrushMetadata(properties, className);

    annotations.push({
      brush,
      category: categorizeActor(className, entry.objectName),
      className,
      classPath,
      collisionHeight: typeof collisionHeight === "number" ? collisionHeight : null,
      collisionRadius: typeof collisionRadius === "number" ? collisionRadius : null,
      location: toViewerVector(location),
      objectName: entry.objectName,
      path: resolveObjectPath(entry.index + 1, tables),
      rotation: isRotator(rotation) ? rotation : null
    });
  }

  return annotations.sort(
    (a, b) =>
      categorySortKey(a.category) - categorySortKey(b.category) ||
      a.className.localeCompare(b.className) ||
      a.objectName.localeCompare(b.objectName)
  );
}

function readTaggedProperties(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  entry: UnrealExportEntry
): Map<string, UnrealPropertyValue> {
  const startOffset = entry.serialOffset ?? 0;
  const stateFrameOffset = readStateFramePropertyOffset(buffer, startOffset, startOffset + entry.serialSize);
  const offsets = stateFrameOffset === null ? [startOffset] : [stateFrameOffset, startOffset];

  for (const offset of offsets) {
    const values = readTaggedPropertiesAtOffset(buffer, tables, entry, offset);
    if (values.has("location")) {
      return values;
    }
  }

  return new Map();
}

function readTaggedPropertiesAtOffset(
  buffer: ArrayBuffer,
  tables: UnrealPackageTables,
  entry: UnrealExportEntry,
  startOffset: number
): Map<string, UnrealPropertyValue> {
  const values = new Map<string, UnrealPropertyValue>();
  const reader = new BinaryReader(buffer);
  const endOffset = Math.min(buffer.byteLength, (entry.serialOffset ?? 0) + entry.serialSize);

  try {
    reader.seek(startOffset);

    for (let count = 0; count < MAX_ACTOR_PROPERTIES && reader.offset < endOffset; count += 1) {
      const tag = readPropertyTag(reader, tables, endOffset);
      if (!tag) {
        break;
      }

      if (tag.value !== null) {
        values.set(tag.name.toLowerCase(), tag.value);
      }
    }
  } catch {
    return values;
  }

  return values;
}

function readStateFramePropertyOffset(buffer: ArrayBuffer, startOffset: number, endOffset: number): number | null {
  const reader = new BinaryReader(buffer);

  try {
    reader.seek(startOffset);
    reader.readCompactIndex();
    reader.readCompactIndex();
    reader.skip(8);
    reader.readInt32();
    reader.readCompactIndex();
  } catch {
    return null;
  }

  return reader.offset <= endOffset ? reader.offset : null;
}

function readPropertyTag(
  reader: BinaryReader,
  tables: UnrealPackageTables,
  endOffset: number
): PropertyTag | null {
  const nameIndex = reader.readCompactIndex();
  const name = tables.names[nameIndex]?.name;

  if (!name || name === "None") {
    return null;
  }

  if (reader.offset >= endOffset) {
    return null;
  }

  const info = reader.readUint8();
  const type = info & 0x0f;
  let structName = "";
  if (type === PROPERTY_TYPE_STRUCT) {
    structName = tables.names[reader.readCompactIndex()]?.name ?? "";
  }
  const size = type === PROPERTY_TYPE_BOOL ? 0 : readPropertySize(reader, (info >> 4) & 0x07);

  if ((info & 0x80) !== 0) {
    reader.readCompactIndex();
  }

  const valueStart = reader.offset;
  const valueEnd = Math.min(endOffset, valueStart + size);
  const value = readPropertyValue(reader, tables, type, size, structName, valueEnd);

  if (reader.offset < valueEnd) {
    reader.skip(valueEnd - reader.offset);
  }

  return { name, type, value };
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

function readPropertyValue(
  reader: BinaryReader,
  tables: UnrealPackageTables,
  type: number,
  size: number,
  structName: string,
  valueEnd: number
): UnrealPropertyValue | null {
  if (type === PROPERTY_TYPE_VECTOR || (type === PROPERTY_TYPE_STRUCT && structName === "Vector")) {
    return readVectorValue(reader, valueEnd);
  }

  if (type === PROPERTY_TYPE_ROTATOR || (type === PROPERTY_TYPE_STRUCT && structName === "Rotator")) {
    return readRotatorValue(reader, valueEnd);
  }

  if (type === PROPERTY_TYPE_FLOAT && size === 4) {
    return reader.readFloat32();
  }

  if (type === PROPERTY_TYPE_INT && size === 4) {
    return reader.readInt32();
  }

  if (type === PROPERTY_TYPE_BOOL) {
    return true;
  }

  if (type === PROPERTY_TYPE_BYTE && size === 1) {
    return reader.readUint8();
  }

  if (type === PROPERTY_TYPE_OBJECT) {
    return resolveObjectPath(reader.readCompactIndex(), tables);
  }

  if (type === PROPERTY_TYPE_NAME) {
    const nameIndex = reader.readCompactIndex();
    return tables.names[nameIndex]?.name ?? `#${nameIndex}`;
  }

  if ((type === PROPERTY_TYPE_STRING || type === PROPERTY_TYPE_STR) && size > 0) {
    return reader.readSerializedString();
  }

  return null;
}

function readVectorValue(reader: BinaryReader, valueEnd: number): UnrealVector | null {
  if (reader.offset + 12 > valueEnd) {
    return null;
  }

  return {
    x: reader.readFloat32(),
    y: reader.readFloat32(),
    z: reader.readFloat32()
  };
}

function readRotatorValue(reader: BinaryReader, valueEnd: number): UnrealRotator | null {
  if (reader.offset + 12 > valueEnd) {
    return null;
  }

  return {
    pitch: reader.readInt32(),
    yaw: reader.readInt32(),
    roll: reader.readInt32()
  };
}

function shouldSkipExport(className: string): boolean {
  return className === "Model" || className === "Level" || className === "Polys";
}

function readBrushMetadata(
  properties: Map<string, UnrealPropertyValue>,
  className: string
): UnrealBrushMetadata | null {
  if (!className.toLowerCase().includes("brush")) {
    return null;
  }

  const csgOper = properties.get("csgoper");
  const group = properties.get("group");
  const polyFlags = properties.get("polyflags");
  const brushModel = properties.get("brush");

  return {
    brushModel: typeof brushModel === "string" ? brushModel : null,
    csgOperation: typeof csgOper === "number" ? csgOperationName(csgOper) : null,
    group: typeof group === "string" ? group : null,
    polyFlags: typeof polyFlags === "number" ? polyFlags : null
  };
}

function toViewerVector(vector: UnrealVector): UnrealVector {
  return {
    x: vector.x,
    y: vector.z,
    z: vector.y
  };
}

function isVector(value: UnrealPropertyValue | undefined): value is UnrealVector {
  return typeof value === "object" && value !== null && "x" in value && "y" in value && "z" in value;
}

function isRotator(value: UnrealPropertyValue | undefined): value is UnrealRotator {
  return typeof value === "object" && value !== null && "pitch" in value && "yaw" in value && "roll" in value;
}

function categorizeActor(className: string, objectName: string): UnrealActorCategory {
  const key = `${className} ${objectName}`.toLowerCase();

  if (key.includes("brush")) {
    return "Brush";
  }
  if (key.includes("ammo")) {
    return "Ammo";
  }
  if (key.includes("weapon")) {
    return "Weapon";
  }
  if (key.includes("nanokey") || key.includes("keypad") || key.includes("datacube")) {
    return "Key";
  }
  if (
    includesAny(key, [
      "augmentation",
      "bioelectric",
      "candybar",
      "credits",
      "flare",
      "lockpick",
      "medkit",
      "multitool",
      "pickup",
      "repairbot",
      "soyfood"
    ])
  ) {
    return "Item";
  }
  if (
    includesAny(key, [
      "bum",
      "child",
      "cop",
      "doctor",
      "guard",
      "janitor",
      "mechanic",
      "mib",
      "military",
      "nsf",
      "nurse",
      "sailor",
      "scientist",
      "soldier",
      "terrorist",
      "thug",
      "troop",
      "wib"
    ])
  ) {
    return "Character";
  }
  if (key.includes("light")) {
    return "Light";
  }
  if (key.includes("mover") || key.includes("door") || key.includes("elevator")) {
    return "Mover";
  }
  if (key.includes("trigger") || key.includes("button") || key.includes("laser")) {
    return "Trigger";
  }
  if (key.includes("pathnode") || key.includes("navigationpoint") || key.includes("patrolpoint")) {
    return "Navigation";
  }
  if (key.includes("ambient") || key.includes("sound")) {
    return "Audio";
  }
  if (key.includes("decoration") || key.includes("plant") || key.includes("chair") || key.includes("table")) {
    return "Decoration";
  }

  return "Other";
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function categorySortKey(category: UnrealActorCategory): number {
  return [
    "Character",
    "Ammo",
    "Weapon",
    "Item",
    "Key",
    "Trigger",
    "Mover",
    "Brush",
    "Light",
    "Decoration",
    "Audio",
    "Navigation",
    "Other"
  ].indexOf(category);
}

function csgOperationName(value: number): string {
  switch (value) {
    case 0:
      return "Active";
    case 1:
      return "Add";
    case 2:
      return "Subtract";
    case 3:
      return "Intersect";
    case 4:
      return "Deintersect";
    default:
      return `Unknown ${value}`;
  }
}
