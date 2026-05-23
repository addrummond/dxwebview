import type { UnrealExportEntry, UnrealImportEntry, UnrealPackageTables } from "./packageTables";

export function resolveObjectName(index: number, tables: UnrealPackageTables): string {
  if (index === 0) {
    return "None";
  }

  if (index < 0) {
    return resolveImportName(tables.imports[-index - 1]);
  }

  return tables.exports[index - 1]?.objectName ?? `#${index}`;
}

export function resolveObjectPath(index: number, tables: UnrealPackageTables): string {
  if (index === 0) {
    return "None";
  }

  if (index < 0) {
    return resolveImportPath(tables.imports[-index - 1], tables);
  }

  return resolveExportPath(tables.exports[index - 1], tables);
}

function resolveImportName(entry: UnrealImportEntry | undefined): string {
  return entry?.objectName ?? "None";
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
