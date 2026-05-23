import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { unrealMeshQuaternion } from "./ViewerScene";

describe("unrealMeshQuaternion", () => {
  it("keeps the decoded mesh basis correction separate from actor yaw", () => {
    expectVector(meshForward({ pitch: 0, yaw: 0, roll: 0 }), [0, 0, -1]);
    expectVector(meshForward({ pitch: 0, yaw: -16384, roll: 0 }), [-1, 0, 0]);
    expectVector(meshForward({ pitch: 0, yaw: -32768, roll: 0 }), [0, 0, 1]);
  });
});

function meshForward(rotation: { pitch: number; roll: number; yaw: number }): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(unrealMeshQuaternion(rotation));
}

function expectVector(received: THREE.Vector3, expected: [number, number, number]): void {
  expect(received.x).toBeCloseTo(expected[0], 6);
  expect(received.y).toBeCloseTo(expected[1], 6);
  expect(received.z).toBeCloseTo(expected[2], 6);
}
