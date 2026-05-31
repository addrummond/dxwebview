import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { actorMeshVerticalOffset, meshVerticalCenter, unrealMeshQuaternion, type SceneActorAnnotation } from "./ViewerScene";

describe("unrealMeshQuaternion", () => {
  it("keeps the decoded mesh basis correction separate from actor yaw", () => {
    expectVector(meshForward({ pitch: 0, yaw: 0, roll: 0 }), [0, 0, -1]);
    expectVector(meshForward({ pitch: 0, yaw: -16384, roll: 0 }), [-1, 0, 0]);
    expectVector(meshForward({ pitch: 0, yaw: -32768, roll: 0 }), [0, 0, 1]);
  });

  it("applies LodMesh RotOrigin after the decoded mesh basis correction", () => {
    const wallDeviceRotOrigin = { pitch: 0, yaw: 16384, roll: 0 };

    expectVector(meshForward({ pitch: 0, yaw: -32768, roll: 0 }, wallDeviceRotOrigin), [-1, 0, 0]);
    expectVector(meshForward({ pitch: 0, yaw: 32768, roll: 0 }, wallDeviceRotOrigin), [-1, 0, 0]);
    expectVector(meshForward({ pitch: 0, yaw: -16384, roll: 0 }, wallDeviceRotOrigin), [0, 0, -1]);
  });
});

describe("meshVerticalCenter", () => {
  it("uses the local mesh vertical midpoint", () => {
    expect(meshVerticalCenter(new Float32Array([0, 0.25, 0, 1, 95.25, 1]))).toBeCloseTo(47.75, 6);
  });
});

describe("actorMeshVerticalOffset", () => {
  const positions = new Float32Array([0, 0, 0, 1, 20, 1]);

  it("uses collision height for Deus Ex pawn-style actor classes", () => {
    expect(
      actorMeshVerticalOffset(
        positions,
        testActor({
          category: "Other",
          className: "PaulDenton",
          classPath: "DeusEx.PaulDenton",
          collisionHeight: 39
        })
      )
    ).toBe(39);
  });

  it("keeps DeusExDeco meshes aligned to their mesh bounds", () => {
    expect(
      actorMeshVerticalOffset(
        positions,
        testActor({
          category: "Other",
          className: "CouchLeather",
          classPath: "DeusExDeco.CouchLeather",
          collisionHeight: 32
        })
      )
    ).toBe(10);
  });
});

function meshForward(
  rotation: { pitch: number; roll: number; yaw: number },
  rotOrigin?: { pitch: number; roll: number; yaw: number }
): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(unrealMeshQuaternion(rotation, rotOrigin));
}

function expectVector(received: THREE.Vector3, expected: [number, number, number]): void {
  expect(received.x).toBeCloseTo(expected[0], 6);
  expect(received.y).toBeCloseTo(expected[1], 6);
  expect(received.z).toBeCloseTo(expected[2], 6);
}

function testActor(overrides: Partial<SceneActorAnnotation>): SceneActorAnnotation {
  return {
    category: "Other",
    className: "TestActor",
    classPath: "TestPackage.TestActor",
    collisionHeight: null,
    collisionRadius: null,
    drawScale: 1,
    drawScale3D: null,
    location: { x: 0, y: 0, z: 0 },
    mesh: null,
    objectName: "TestActor0",
    path: "Level.TestActor0",
    prePivot: null,
    rotation: null,
    ...overrides
  };
}
