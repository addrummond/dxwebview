import { describe, expect, it } from "vitest";
import {
  PackageSummaryError,
  UNREAL_PACKAGE_MAGIC,
  readPackageSummary
} from "./packageSummary";

function makeSummaryBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(40);
  const view = new DataView(buffer);

  view.setUint32(0, UNREAL_PACKAGE_MAGIC, true);
  view.setUint16(4, 69, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, 0x00000001, true);
  view.setInt32(12, 42, true);
  view.setInt32(16, 128, true);
  view.setInt32(20, 12, true);
  view.setInt32(24, 640, true);
  view.setInt32(28, 8, true);
  view.setInt32(32, 512, true);

  return buffer;
}

describe("readPackageSummary", () => {
  it("reads the UE1 package summary fields used by the viewer", () => {
    expect(readPackageSummary(makeSummaryBuffer())).toEqual({
      magic: UNREAL_PACKAGE_MAGIC,
      version: 69,
      licenseeVersion: 0,
      packageFlags: 1,
      nameCount: 42,
      nameOffset: 128,
      exportCount: 12,
      exportOffset: 640,
      importCount: 8,
      importOffset: 512
    });
  });

  it("rejects files with the wrong package magic", () => {
    const buffer = makeSummaryBuffer();
    new DataView(buffer).setUint32(0, 0, true);

    expect(() => readPackageSummary(buffer)).toThrow(PackageSummaryError);
  });
});
