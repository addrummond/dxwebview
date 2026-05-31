import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { meshVerticalCenter, unrealMeshQuaternion } from "./ViewerScene";

describe("unrealMeshQuaternion", () => {
  it("keeps the decoded mesh basis correction separate from actor yaw", () => {
    expectVector(meshForward({ pitch: 0, yaw: 0, roll: 0 }), [0, 0, -1]);
    expectVector(meshForward({ pitch: 0, yaw: -16384, roll: 0 }), [-1, 0, 0]);
    expectVector(meshForward({ pitch: 0, yaw: -32768, roll: 0 }), [0, 0, 1]);
  });

  it("turns wall-mounted device meshes so their shallow axis sits against the wall", () => {
    expectVector(meshForward({ pitch: 0, yaw: -32768, roll: 0 }, "ComputerPublic"), [1, 0, 0]);
    expectVector(meshForward({ pitch: 0, yaw: 32768, roll: 0 }, "ATM"), [1, 0, 0]);
  });
});

describe("meshVerticalCenter", () => {
  it("uses the local mesh vertical midpoint", () => {
    expect(meshVerticalCenter(new Float32Array([0, 0.25, 0, 1, 95.25, 1]))).toBeCloseTo(47.75, 6);
  });
});

function meshForward(rotation: { pitch: number; roll: number; yaw: number }, meshSource?: string): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(unrealMeshQuaternion(rotation, meshSource));
}

function expectVector(received: THREE.Vector3, expected: [number, number, number]): void {
  expect(received.x).toBeCloseTo(expected[0], 6);
  expect(received.y).toBeCloseTo(expected[1], 6);
  expect(received.z).toBeCloseTo(expected[2], 6);
}
