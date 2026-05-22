import { BinaryReader } from "./binaryReader";
import { readPackageSummary, type UnrealPackageSummary } from "./packageSummary";

export interface UnrealNameEntry {
  index: number;
  name: string;
  flags: number;
}

export interface UnrealImportEntry {
  index: number;
  classPackageIndex: number;
  classPackage: string;
  classNameIndex: number;
  className: string;
  outerIndex: number;
  objectNameIndex: number;
  objectName: string;
}

export interface UnrealExportEntry {
  index: number;
  classIndex: number;
  superIndex: number;
  outerIndex: number;
  objectNameIndex: number;
  objectName: string;
  objectFlags: number;
  serialSize: number;
  serialOffset: number | null;
}

export interface UnrealPackageTables {
  summary: UnrealPackageSummary;
  names: UnrealNameEntry[];
  imports: UnrealImportEntry[];
  exports: UnrealExportEntry[];
}

export function readPackageTables(buffer: ArrayBuffer): UnrealPackageTables {
  const summary = readPackageSummary(buffer);
  const reader = new BinaryReader(buffer);
  const names = readNameTable(reader, summary);
  const imports = readImportTable(reader, summary, names);
  const exports = readExportTable(reader, summary, names);

  return {
    summary,
    names,
    imports,
    exports
  };
}

function readNameTable(reader: BinaryReader, summary: UnrealPackageSummary): UnrealNameEntry[] {
  reader.seek(summary.nameOffset);

  return Array.from({ length: summary.nameCount }, (_, index) => ({
    index,
    name: reader.readSerializedString(),
    flags: reader.readUint32()
  }));
}

function readImportTable(
  reader: BinaryReader,
  summary: UnrealPackageSummary,
  names: UnrealNameEntry[]
): UnrealImportEntry[] {
  reader.seek(summary.importOffset);

  return Array.from({ length: summary.importCount }, (_, index) => {
    const classPackageIndex = reader.readCompactIndex();
    const classNameIndex = reader.readCompactIndex();
    const outerIndex = reader.readInt32();
    const objectNameIndex = reader.readCompactIndex();

    return {
      index,
      classPackageIndex,
      classPackage: resolveName(names, classPackageIndex),
      classNameIndex,
      className: resolveName(names, classNameIndex),
      outerIndex,
      objectNameIndex,
      objectName: resolveName(names, objectNameIndex)
    };
  });
}

function readExportTable(
  reader: BinaryReader,
  summary: UnrealPackageSummary,
  names: UnrealNameEntry[]
): UnrealExportEntry[] {
  reader.seek(summary.exportOffset);

  return Array.from({ length: summary.exportCount }, (_, index) => {
    const classIndex = reader.readCompactIndex();
    const superIndex = reader.readCompactIndex();
    const outerIndex = reader.readInt32();
    const objectNameIndex = reader.readCompactIndex();
    const objectFlags = reader.readUint32();
    const serialSize = reader.readCompactIndex();
    const serialOffset = serialSize > 0 ? reader.readCompactIndex() : null;

    return {
      index,
      classIndex,
      superIndex,
      outerIndex,
      objectNameIndex,
      objectName: resolveName(names, objectNameIndex),
      objectFlags,
      serialSize,
      serialOffset
    };
  });
}

function resolveName(names: UnrealNameEntry[], index: number): string {
  return names[index]?.name ?? `#${index}`;
}
