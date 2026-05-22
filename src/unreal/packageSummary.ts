export const UNREAL_PACKAGE_MAGIC = 0x9e2a83c1;

export interface UnrealPackageSummary {
  magic: number;
  version: number;
  licenseeVersion: number;
  packageFlags: number;
  nameCount: number;
  nameOffset: number;
  exportCount: number;
  exportOffset: number;
  importCount: number;
  importOffset: number;
}

export class PackageSummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageSummaryError";
  }
}

export function readPackageSummary(buffer: ArrayBuffer): UnrealPackageSummary {
  if (buffer.byteLength < 36) {
    throw new PackageSummaryError("File is too small to contain an Unreal package summary.");
  }

  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);

  if (magic !== UNREAL_PACKAGE_MAGIC) {
    throw new PackageSummaryError(`Unexpected package magic 0x${magic.toString(16)}.`);
  }

  return {
    magic,
    version: view.getUint16(4, true),
    licenseeVersion: view.getUint16(6, true),
    packageFlags: view.getUint32(8, true),
    nameCount: view.getInt32(12, true),
    nameOffset: view.getInt32(16, true),
    exportCount: view.getInt32(20, true),
    exportOffset: view.getInt32(24, true),
    importCount: view.getInt32(28, true),
    importOffset: view.getInt32(32, true)
  };
}

export function formatPackageVersion(summary: UnrealPackageSummary): string {
  return `${summary.version}.${summary.licenseeVersion}`;
}
