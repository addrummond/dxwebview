import { describe, expect, it } from "vitest";
import { renderModeForPolyFlags } from "./modelPoints";

describe("renderModeForPolyFlags", () => {
  it("renders environment-mapped reflective surfaces as opaque", () => {
    expect(renderModeForPolyFlags(0x00000004 | 0x00000010)).toBe("opaque");
  });

  it("renders mirrored reflective surfaces as opaque", () => {
    expect(renderModeForPolyFlags(0x00000004 | 0x08000000)).toBe("opaque");
  });

  it("keeps masked surfaces masked even when other render flags are present", () => {
    expect(renderModeForPolyFlags(0x00000002 | 0x00000004 | 0x00000010)).toBe("masked");
  });

  it("keeps plain translucent surfaces translucent", () => {
    expect(renderModeForPolyFlags(0x00000004)).toBe("translucent");
  });
});
