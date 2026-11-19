import * as THREE from 'three';
import ironKnightRaw from '../../data/models/iron_knight.json';

export type RiggedVoxelPaletteEntry = {
  hex: string;
  name?: string;
  mc?: string;
};

export type RiggedVoxelBoneSpec = {
  parent: string | null;
  pivot: [number, number, number];
};

export type RiggedVoxelAsset = {
  palette: RiggedVoxelPaletteEntry[];
  parts: string[];
  rig: Record<string, RiggedVoxelBoneSpec>;
  voxels: Array<[number, number, number, number, number]>;
};

export type KnightAnimName =
  | 'idle'
  | 'walk'
  | 'slash'
  | 'block'
  | 'salute'
  | 'spin'
  | 'death'
  | 'rest';

export interface RiggedVoxelTemplate {
  readonly asset: RiggedVoxelAsset;
  readonly geometry: THREE.BufferGeometry;
  readonly voxelCount: number;
  readonly quadCount: number;
  readonly triangleCount: number;
  readonly vertexCount: number;
}

export interface RiggedVoxelInstanceOptions {
  scale?: number;
  yOffset?: number;
  shading?: 'lambert' | 'standard';
  initialAnim?: KnightAnimName;
  tint?: number;
}

export interface RiggedVoxelInstance {
  readonly group: THREE.Group;
  readonly skinnedMesh: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;
  setAnimation(name: KnightAnimName, restart?: boolean): void;
  getAnimation(): KnightAnimName;
  update(dt: number): void;
  setTint(scalarMultiplier: number): void;
  setShading(shading: 'lambert' | 'standard'): void;
  dispose(): void;
}

interface FaceDirSpec {
  readonly axis: 0 | 1 | 2;
  readonly sign: 1 | -1;
  readonly u: 0 | 1 | 2;
  readonly v: 0 | 1 | 2;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly flip: boolean;
}

// Winding is chosen so ((c1 - c0) x (c2 - c0)) . normal > 0 (Three.js CCW FrontSide).
const FACE_DIRS: readonly FaceDirSpec[] = [
  { axis: 0, sign: 1, u: 1, v: 2, nx: 1, ny: 0, nz: 0, flip: false },
  { axis: 0, sign: -1, u: 1, v: 2, nx: -1, ny: 0, nz: 0, flip: true },
  { axis: 1, sign: 1, u: 0, v: 2, nx: 0, ny: 1, nz: 0, flip: true },
  { axis: 1, sign: -1, u: 0, v: 2, nx: 0, ny: -1, nz: 0, flip: false },
  { axis: 2, sign: 1, u: 0, v: 1, nx: 0, ny: 0, nz: 1, flip: false },
  { axis: 2, sign: -1, u: 0, v: 1, nx: 0, ny: 0, nz: -1, flip: true },
];

type PartVoxel = readonly [number, number, number, number];

const Y_SHIFT = 0.5;
const DEFAULT_SCALE = 0.055;
const DEFAULT_Y_OFFSET = -0.65;
const MIN_TINT = 0.25;
const MAX_TINT = 1.2;

function clampTint(scalarMultiplier: number): number {
  if (!Number.isFinite(scalarMultiplier)) return 1.0;
  return Math.max(MIN_TINT, Math.min(MAX_TINT, scalarMultiplier));
}

function createKnightMaterial(
  shading: 'lambert' | 'standard',
  tint: number,
): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const mat =
    shading === 'lambert'
      ? new THREE.MeshLambertMaterial({
          vertexColors: true,
          flatShading: true,
          side: THREE.FrontSide,
        })
      : new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.48,
          metalness: 0.34,
          flatShading: true,
          side: THREE.FrontSide,
        });
  mat.color.setScalar(clampTint(tint));
  return mat;
}

/**
 * Builds a single merged, bone-weighted BufferGeometry for all parts using
 * per-bone hidden-face culling and 2D greedy meshing.
 */
export function buildRiggedVoxelTemplate(asset: RiggedVoxelAsset): RiggedVoxelTemplate {
  const partCount = asset.parts.length;
  const voxelsByPart: PartVoxel[][] = Array.from({ length: partCount }, () => []);

  for (let i = 0; i < asset.voxels.length; i++) {
    const [x, y, z, matIdx, partIdx] = asset.voxels[i];
    if (partIdx < 0 || partIdx >= partCount) {
      throw new Error(`Invalid part index ${partIdx} at voxel ${i}`);
    }
    if (matIdx < 0 || matIdx >= asset.palette.length) {
      throw new Error(`Invalid material index ${matIdx} at voxel ${i}`);
    }
    voxelsByPart[partIdx].push([x, y, z, matIdx]);
  }

  // Convert sRGB palette hex values to linear RGB via THREE.Color.
  const paletteColors = asset.palette.map((entry) => new THREE.Color(entry.hex));

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  let vertCount = 0;
  let quadCount = 0;

  const p0: [number, number, number] = [0, 0, 0];
  const p1: [number, number, number] = [0, 0, 0];
  const p2: [number, number, number] = [0, 0, 0];
  const p3: [number, number, number] = [0, 0, 0];

  for (let partIdx = 0; partIdx < partCount; partIdx++) {
    const list = voxelsByPart[partIdx];
    if (list.length === 0) continue;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < list.length; i++) {
      const [vx, vy, vz] = list[i];
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;
      if (vz < minZ) minZ = vz;
      if (vz > maxZ) maxZ = vz;
    }

    const sx = maxX - minX + 1;
    const sy = maxY - minY + 1;
    const sz = maxZ - minZ + 1;
    const sxy = sx * sy;

    // Store matIdx + 1 so 0 denotes empty space in the flat lookup grid.
    const grid = new Int32Array(sxy * sz);
    for (let i = 0; i < list.length; i++) {
      const [vx, vy, vz, matIdx] = list[i];
      const gx = vx - minX;
      const gy = vy - minY;
      const gz = vz - minZ;
      grid[gx + sx * gy + sxy * gz] = matIdx + 1;
    }

    const bMin: readonly [number, number, number] = [minX, minY, minZ];
    const dims: readonly [number, number, number] = [sx, sy, sz];
    const strides: readonly [number, number, number] = [1, sx, sxy];

    for (let d = 0; d < FACE_DIRS.length; d++) {
      const dir = FACE_DIRS[d];
      const a = dir.axis;
      const uA = dir.u;
      const vA = dir.v;

      const aLen = dims[a];
      const uLen = dims[uA];
      const vLen = dims[vA];

      const aStride = strides[a];
      const uStride = strides[uA];
      const vStride = strides[vA];

      const mask = new Int32Array(uLen * vLen);

      for (let ia = 0; ia < aLen; ia++) {
        mask.fill(0);
        const aOffset = ia * aStride;
        const hasNeighborSlice = dir.sign > 0 ? ia + 1 < aLen : ia - 1 >= 0;
        const neighborDelta = dir.sign * aStride;

        // 1. Per-bone hidden-face culling (keeps inter-part joint caps closed).
        for (let iv = 0; iv < vLen; iv++) {
          const rowOffset = aOffset + iv * vStride;
          const maskRow = iv * uLen;
          for (let iu = 0; iu < uLen; iu++) {
            const cellIdx = rowOffset + iu * uStride;
            const val = grid[cellIdx];
            if (val === 0) continue;
            if (hasNeighborSlice && grid[cellIdx + neighborDelta] !== 0) continue;
            mask[maskRow + iu] = val;
          }
        }

        // 2. 2D greedy meshing across exposed faces with matching material index.
        const sliceCoord = bMin[a] + ia;
        const planeCoord = sliceCoord + (dir.sign > 0 ? 0.5 : -0.5);

        for (let iv = 0; iv < vLen; iv++) {
          let iu = 0;
          while (iu < uLen) {
            const val = mask[iv * uLen + iu];
            if (val === 0) {
              iu++;
              continue;
            }

            let w = 1;
            while (iu + w < uLen && mask[iv * uLen + iu + w] === val) {
              w++;
            }

            let h = 1;
            outer: while (iv + h < vLen) {
              const nextRow = (iv + h) * uLen + iu;
              for (let k = 0; k < w; k++) {
                if (mask[nextRow + k] !== val) {
                  break outer;
                }
              }
              h++;
            }

            for (let dv = 0; dv < h; dv++) {
              const clearRow = (iv + dv) * uLen + iu;
              for (let du = 0; du < w; du++) {
                mask[clearRow + du] = 0;
              }
            }

            const u0 = bMin[uA] + iu - 0.5;
            const u1 = u0 + w;
            const v0 = bMin[vA] + iv - 0.5;
            const v1 = v0 + h;

            p0[a] = planeCoord;
            p1[a] = planeCoord;
            p2[a] = planeCoord;
            p3[a] = planeCoord;

            p0[uA] = u0;
            p0[vA] = v0;
            p1[uA] = u1;
            p1[vA] = v0;
            p2[uA] = u1;
            p2[vA] = v1;
            p3[uA] = u0;
            p3[vA] = v1;

            const col = paletteColors[val - 1];
            const c0 = p0;
            const c1 = dir.flip ? p3 : p1;
            const c2 = p2;
            const c3 = dir.flip ? p1 : p3;

            // Emit rest-pose template coordinates shifted by +0.5 on Y so minY=0 sits at y=0.
            positions.push(
              c0[0], c0[1] + Y_SHIFT, c0[2],
              c1[0], c1[1] + Y_SHIFT, c1[2],
              c2[0], c2[1] + Y_SHIFT, c2[2],
              c3[0], c3[1] + Y_SHIFT, c3[2],
            );

            for (let k = 0; k < 4; k++) {
              normals.push(dir.nx, dir.ny, dir.nz);
              colors.push(col.r, col.g, col.b);
              skinIndices.push(partIdx, 0, 0, 0);
              skinWeights.push(1, 0, 0, 0);
            }

            indices.push(
              vertCount,
              vertCount + 1,
              vertCount + 2,
              vertCount,
              vertCount + 2,
              vertCount + 3,
            );
            vertCount += 4;
            quadCount++;

            iu += w;
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const indexAttr =
    vertCount <= 65535
      ? new THREE.Uint16BufferAttribute(indices, 1)
      : new THREE.Uint32BufferAttribute(indices, 1);
  geometry.setIndex(indexAttr);

  // Generous static bounding sphere so limb swings never trigger frustum clipping.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 19, 0), 34);

  return {
    asset,
    geometry,
    voxelCount: asset.voxels.length,
    quadCount,
    triangleCount: quadCount * 2,
    vertexCount: vertCount,
  };
}

interface RigBoneEntry {
  readonly bone: THREE.Bone;
  readonly basePos: THREE.Vector3;
}

interface KnightBones {
  hips?: RigBoneEntry;
  torso?: RigBoneEntry;
  cape?: RigBoneEntry;
  head?: RigBoneEntry;
  leftUpperArm?: RigBoneEntry;
  leftForearm?: RigBoneEntry;
  shield?: RigBoneEntry;
  rightUpperArm?: RigBoneEntry;
  rightForearm?: RigBoneEntry;
  sword?: RigBoneEntry;
  leftThigh?: RigBoneEntry;
  leftShin?: RigBoneEntry;
  rightThigh?: RigBoneEntry;
  rightShin?: RigBoneEntry;
}

/**
 * Creates a standalone animated SkinnedMesh instance sharing the template's
 * geometry while owning its own Skeleton and Material.
 */
export function createRiggedVoxelInstance(
  template: RiggedVoxelTemplate,
  options: RiggedVoxelInstanceOptions = {},
): RiggedVoxelInstance {
  const scale = options.scale ?? DEFAULT_SCALE;
  const yOffset = options.yOffset ?? DEFAULT_Y_OFFSET;
  let currentShading: 'lambert' | 'standard' = options.shading ?? 'standard';
  let currentAnim: KnightAnimName = options.initialAnim ?? 'idle';
  let currentTint = clampTint(options.tint ?? 1.0);
  let animTime = 0;
  let disposed = false;

  const { asset, geometry } = template;
  const bones: THREE.Bone[] = [];
  const entries: RigBoneEntry[] = [];
  const entryByName = new Map<string, RigBoneEntry>();
  const rootBones: THREE.Bone[] = [];

  for (let i = 0; i < asset.parts.length; i++) {
    const partName = asset.parts[i];
    const spec = asset.rig[partName];
    if (!spec) {
      throw new Error(`Missing rig specification for part "${partName}"`);
    }

    const bone = new THREE.Bone();
    bone.name = partName;

    const [px, pyRaw, pz] = spec.pivot;
    const py = pyRaw + Y_SHIFT;

    if (spec.parent === null) {
      bone.position.set(px, py, pz);
      rootBones.push(bone);
    } else {
      const parentSpec = asset.rig[spec.parent];
      if (!parentSpec) {
        throw new Error(`Missing parent rig specification "${spec.parent}" for "${partName}"`);
      }
      const [ppx, ppyRaw, ppz] = parentSpec.pivot;
      const ppy = ppyRaw + Y_SHIFT;
      bone.position.set(px - ppx, py - ppy, pz - ppz);
    }

    const entry: RigBoneEntry = {
      bone,
      basePos: bone.position.clone(),
    };
    bones.push(bone);
    entries.push(entry);
    entryByName.set(partName, entry);
  }

  for (let i = 0; i < asset.parts.length; i++) {
    const partName = asset.parts[i];
    const spec = asset.rig[partName];
    if (spec.parent !== null) {
      const parentEntry = entryByName.get(spec.parent);
      if (!parentEntry) {
        throw new Error(`Parent bone "${spec.parent}" not found for "${partName}"`);
      }
      parentEntry.bone.add(bones[i]);
    }
  }

  const rig: KnightBones = {
    hips: entryByName.get('hips'),
    torso: entryByName.get('torso'),
    cape: entryByName.get('cape'),
    head: entryByName.get('head'),
    leftUpperArm: entryByName.get('leftUpperArm'),
    leftForearm: entryByName.get('leftForearm'),
    shield: entryByName.get('shield'),
    rightUpperArm: entryByName.get('rightUpperArm'),
    rightForearm: entryByName.get('rightForearm'),
    sword: entryByName.get('sword'),
    leftThigh: entryByName.get('leftThigh'),
    leftShin: entryByName.get('leftShin'),
    rightThigh: entryByName.get('rightThigh'),
    rightShin: entryByName.get('rightShin'),
  };

  let material = createKnightMaterial(currentShading, currentTint);

  // Bind skeleton while SkinnedMesh is detached at identity transform.
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  for (let i = 0; i < rootBones.length; i++) {
    skinnedMesh.add(rootBones[i]);
  }
  skinnedMesh.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);
  skinnedMesh.bind(skeleton);

  // Apply instance transforms & flags strictly after skeleton bind.
  skinnedMesh.scale.setScalar(scale);
  skinnedMesh.position.set(0, yOffset, 0);
  skinnedMesh.castShadow = true;
  skinnedMesh.receiveShadow = true;
  skinnedMesh.frustumCulled = false;

  const group = new THREE.Group();
  group.add(skinnedMesh);

  function resetAllBones(): void {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      entry.bone.rotation.set(0, 0, 0);
      entry.bone.position.copy(entry.basePos);
    }
  }

  function applyPose(t: number): void {
    resetAllBones();
    const anim = currentAnim;
    if (anim === 'rest') return;

    const hips = rig.hips;
    const torso = rig.torso;
    const cape = rig.cape;
    const head = rig.head;
    const leftUpperArm = rig.leftUpperArm;
    const leftForearm = rig.leftForearm;
    const shield = rig.shield;
    const rightUpperArm = rig.rightUpperArm;
    const sword = rig.sword;
    const leftThigh = rig.leftThigh;
    const leftShin = rig.leftShin;
    const rightThigh = rig.rightThigh;
    const rightShin = rig.rightShin;

    if (anim === 'idle') {
      const b = Math.sin(t * 2.2);
      if (hips) hips.bone.position.y = hips.basePos.y + b * 0.18;
      if (torso) torso.bone.rotation.x = 0.03 + b * 0.03;
      if (head) head.bone.rotation.y = Math.sin(t * 0.85) * 0.15;
      if (cape) cape.bone.rotation.x = 0.10 + Math.sin(t * 1.9) * 0.08;
      if (leftUpperArm) {
        leftUpperArm.bone.rotation.z = 0.10 + b * 0.03;
        leftUpperArm.bone.rotation.x = -0.12;
      }
      if (leftForearm) leftForearm.bone.rotation.x = -0.22;
      if (rightUpperArm) {
        rightUpperArm.bone.rotation.z = -0.08 - b * 0.03;
        rightUpperArm.bone.rotation.x = -0.05 + b * 0.05;
      }
      if (sword) sword.bone.rotation.x = b * 0.04;
      return;
    }

    if (anim === 'walk') {
      const w = t * 5.0;
      const s = Math.sin(w);
      const c = Math.cos(w);
      if (hips) {
        hips.bone.position.y = hips.basePos.y + Math.abs(c) * 0.75 - 0.30;
        hips.bone.rotation.y = s * 0.10;
      }
      if (torso) {
        torso.bone.rotation.y = -s * 0.14;
        torso.bone.rotation.x = 0.08;
      }
      if (cape) cape.bone.rotation.x = 0.28 + Math.abs(s) * 0.18;
      if (leftThigh) leftThigh.bone.rotation.x = -s * 0.50;
      if (leftShin) leftShin.bone.rotation.x = Math.max(0, c * 0.60);
      if (rightThigh) rightThigh.bone.rotation.x = s * 0.50;
      if (rightShin) rightShin.bone.rotation.x = Math.max(0, -c * 0.60);
      if (leftUpperArm) {
        leftUpperArm.bone.rotation.x = -0.20 + s * 0.32;
        leftUpperArm.bone.rotation.z = 0.12;
      }
      if (leftForearm) leftForearm.bone.rotation.x = -0.25;
      if (rightUpperArm) {
        rightUpperArm.bone.rotation.x = -0.12 - s * 0.28;
        rightUpperArm.bone.rotation.z = -0.10;
      }
      if (sword) sword.bone.rotation.x = -s * 0.10;
      return;
    }

    if (anim === 'slash') {
      const p = (t * 0.68) % 1.0;
      if (p < 0.40) {
        const u = p / 0.40;
        const ease = u * u * (3 - 2 * u);
        if (torso) {
          torso.bone.rotation.x = -0.20 * ease;
          torso.bone.rotation.y = -0.45 * ease;
        }
        if (head) head.bone.rotation.y = 0.28 * ease;
        if (cape) cape.bone.rotation.x = 0.25 * ease;
        if (rightUpperArm) {
          rightUpperArm.bone.rotation.x = -2.10 * ease;
          rightUpperArm.bone.rotation.z = -0.30 * ease;
        }
        if (sword) sword.bone.rotation.x = -0.28 * ease;
        if (leftUpperArm) {
          leftUpperArm.bone.rotation.x = -0.55 * ease;
          leftUpperArm.bone.rotation.z = 0.35 * ease;
        }
        if (leftForearm) leftForearm.bone.rotation.y = -0.45 * ease;
      } else if (p < 0.58) {
        const u = (p - 0.40) / 0.18;
        const ease = u * u;
        if (hips) hips.bone.position.y = hips.basePos.y - 1.5 * ease;
        if (torso) {
          torso.bone.rotation.x = -0.20 + ease * 0.68;
          torso.bone.rotation.y = -0.45 + ease * 0.92;
        }
        if (head) head.bone.rotation.y = 0.28 - ease * 0.52;
        if (cape) cape.bone.rotation.x = 0.25 + ease * 0.65;
        if (rightUpperArm) {
          rightUpperArm.bone.rotation.x = -2.10 + ease * 2.50;
          rightUpperArm.bone.rotation.z = -0.30 + ease * 0.32;
        }
        if (sword) sword.bone.rotation.x = -0.28 + ease * 1.15;
        if (leftUpperArm) {
          leftUpperArm.bone.rotation.x = -0.55 + ease * 0.95;
          leftUpperArm.bone.rotation.z = 0.35 + ease * 0.25;
        }
        if (leftThigh) leftThigh.bone.rotation.x = -0.35 * ease;
        if (leftShin) leftShin.bone.rotation.x = 0.52 * ease;
        if (rightThigh) rightThigh.bone.rotation.x = 0.28 * ease;
        if (rightShin) rightShin.bone.rotation.x = 0.28 * ease;
      } else {
        const u = (p - 0.58) / 0.42;
        const rem = 1 - (1 - (1 - u) * (1 - u));
        if (hips) hips.bone.position.y = hips.basePos.y - 1.5 * rem;
        if (torso) {
          torso.bone.rotation.x = 0.48 * rem;
          torso.bone.rotation.y = 0.47 * rem;
        }
        if (head) head.bone.rotation.y = -0.24 * rem;
        if (cape) cape.bone.rotation.x = 0.10 + 0.80 * rem;
        if (rightUpperArm) rightUpperArm.bone.rotation.x = 0.40 * rem;
        if (sword) sword.bone.rotation.x = 0.87 * rem;
        if (leftUpperArm) {
          leftUpperArm.bone.rotation.x = 0.40 * rem;
          leftUpperArm.bone.rotation.z = 0.60 * rem;
        }
        if (leftThigh) leftThigh.bone.rotation.x = -0.35 * rem;
        if (leftShin) leftShin.bone.rotation.x = 0.52 * rem;
        if (rightThigh) rightThigh.bone.rotation.x = 0.28 * rem;
        if (rightShin) rightShin.bone.rotation.x = 0.28 * rem;
      }
      return;
    }

    if (anim === 'block') {
      // Brace smoothly into raised-shield guard and hold with subtle tension tremor.
      const s = Math.min(1, t * 5.5);
      const brace = Math.sin(t * 14) * 0.02 * s;
      if (hips) {
        hips.bone.position.y = hips.basePos.y - 1.6 * s;
        hips.bone.rotation.y = -0.35 * s;
      }
      if (torso) {
        torso.bone.rotation.x = 0.16 * s;
        torso.bone.rotation.y = -0.18 * s;
      }
      if (head) head.bone.rotation.y = 0.48 * s;
      if (cape) cape.bone.rotation.x = 0.28 * s;
      if (leftThigh) leftThigh.bone.rotation.x = -0.45 * s;
      if (leftShin) leftShin.bone.rotation.x = 0.65 * s;
      if (rightThigh) rightThigh.bone.rotation.x = 0.25 * s;
      if (rightShin) rightShin.bone.rotation.x = 0.45 * s;
      if (leftUpperArm) {
        leftUpperArm.bone.rotation.x = -1.15 * s + brace;
        leftUpperArm.bone.rotation.z = 0.25 * s;
      }
      if (leftForearm) leftForearm.bone.rotation.y = -1.10 * s;
      if (shield) shield.bone.rotation.y = 0.35 * s;
      if (rightUpperArm) {
        rightUpperArm.bone.rotation.x = 0.35 * s;
        rightUpperArm.bone.rotation.z = -0.35 * s;
      }
      if (sword) sword.bone.rotation.x = 0.35 * s;
      return;
    }

    if (anim === 'salute') {
      const s = Math.min(1, (Math.sin(t * 1.4 - 0.6) + 1) * 0.65);
      if (hips) hips.bone.position.y = hips.basePos.y - 5.2 * s;
      if (rightThigh) rightThigh.bone.rotation.x = -0.10 * s;
      if (rightShin) rightShin.bone.rotation.x = 1.52 * s;
      if (leftThigh) leftThigh.bone.rotation.x = -1.35 * s;
      if (leftShin) leftShin.bone.rotation.x = 1.35 * s;
      if (torso) torso.bone.rotation.x = 0.22 * s;
      if (head) head.bone.rotation.x = 0.36 * s;
      if (cape) cape.bone.rotation.x = 0.35 * s;
      if (rightUpperArm) {
        rightUpperArm.bone.rotation.x = -0.45 * s;
        rightUpperArm.bone.rotation.z = -0.12 * s;
      }
      if (sword) sword.bone.rotation.x = Math.PI * s;
      if (leftUpperArm) {
        leftUpperArm.bone.rotation.z = 0.25 * s;
        leftUpperArm.bone.rotation.x = -0.15 * s;
      }
      return;
    }

    if (anim === 'spin') {
      if (hips) {
        hips.bone.rotation.y = t * 13.5;
        hips.bone.position.y = hips.basePos.y - 0.8 + Math.sin(t * 13.5) * 0.25;
      }
      if (torso) torso.bone.rotation.x = 0.16;
      if (cape) cape.bone.rotation.x = 0.72;
      if (leftThigh) leftThigh.bone.rotation.x = -0.20;
      if (leftShin) leftShin.bone.rotation.x = 0.35;
      if (rightThigh) rightThigh.bone.rotation.x = 0.20;
      if (rightShin) rightShin.bone.rotation.x = 0.30;
      if (rightUpperArm) rightUpperArm.bone.rotation.z = -1.48;
      if (sword) sword.bone.rotation.z = Math.PI;
      if (leftUpperArm) leftUpperArm.bone.rotation.z = 0.95;
      if (leftForearm) leftForearm.bone.rotation.x = -0.35;
      return;
    }

    // 'death': advance once to fallen supine pose (p = 0.65) and hold without looping.
    const p = Math.min(0.65, t * 0.55);
    if (p < 0.22) {
      const u = p / 0.22;
      const ease = Math.sin(u * Math.PI * 0.5);
      if (hips) {
        hips.bone.position.y = hips.basePos.y - 0.8 * ease;
        hips.bone.rotation.x = -0.22 * ease;
      }
      if (torso) torso.bone.rotation.x = -0.32 * ease;
      if (head) head.bone.rotation.x = -0.40 * ease;
      if (cape) cape.bone.rotation.x = 0.25 * ease;
      if (rightUpperArm) rightUpperArm.bone.rotation.z = -0.85 * ease;
      if (leftUpperArm) leftUpperArm.bone.rotation.z = 0.90 * ease;
      if (leftThigh) leftThigh.bone.rotation.x = -0.22 * ease;
      if (leftShin) leftShin.bone.rotation.x = 0.42 * ease;
    } else if (p < 0.55) {
      const u = (p - 0.22) / 0.33;
      const fall = u * u;
      if (hips) {
        hips.bone.position.y = hips.basePos.y - 0.8 - fall * 9.3;
        hips.bone.position.z = hips.basePos.z - fall * 6.0;
        hips.bone.rotation.x = -0.22 - fall * (Math.PI * 0.5 - 0.22);
      }
      if (torso) torso.bone.rotation.x = -0.32 * (1 - fall);
      if (head) {
        head.bone.rotation.x = -0.40 * (1 - fall);
        head.bone.rotation.y = 0.45 * fall;
      }
      if (cape) cape.bone.rotation.x = 0.25 * (1 - fall);
      if (rightUpperArm) rightUpperArm.bone.rotation.z = -0.85 - fall * 0.35;
      if (sword) sword.bone.rotation.z = -0.65 * fall;
      if (leftUpperArm) leftUpperArm.bone.rotation.z = 0.90 + fall * 0.35;
      if (leftThigh) {
        leftThigh.bone.rotation.z = 0.20 * fall;
        leftThigh.bone.rotation.x = -0.22 * (1 - fall);
      }
      if (rightThigh) rightThigh.bone.rotation.z = -0.18 * fall;
      if (leftShin) leftShin.bone.rotation.x = 0.42 * (1 - fall);
    } else {
      if (hips) {
        hips.bone.position.y = hips.basePos.y - 10.1;
        hips.bone.position.z = hips.basePos.z - 6.0;
        hips.bone.rotation.x = -Math.PI * 0.5;
      }
      if (head) head.bone.rotation.y = 0.45;
      if (rightUpperArm) rightUpperArm.bone.rotation.z = -1.20;
      if (sword) sword.bone.rotation.z = -0.65;
      if (leftUpperArm) leftUpperArm.bone.rotation.z = 1.25;
      if (leftThigh) leftThigh.bone.rotation.z = 0.20;
      if (rightThigh) rightThigh.bone.rotation.z = -0.18;
    }
  }

  // Apply initial frame 0 pose immediately upon construction.
  applyPose(0);

  return {
    group,
    skinnedMesh,
    skeleton,
    setAnimation(name: KnightAnimName, restart = false): void {
      if (disposed) return;
      if (name === currentAnim && !restart) return;
      currentAnim = name;
      animTime = 0;
      applyPose(0);
    },
    getAnimation(): KnightAnimName {
      return currentAnim;
    },
    update(dt: number): void {
      if (disposed) return;
      if (Number.isFinite(dt) && dt > 0) {
        animTime += dt;
      }
      applyPose(animTime);
    },
    setTint(scalarMultiplier: number): void {
      if (disposed) return;
      currentTint = clampTint(scalarMultiplier);
      material.color.setScalar(currentTint);
    },
    setShading(shading: 'lambert' | 'standard'): void {
      if (disposed || shading === currentShading) return;
      const oldMaterial = material;
      currentShading = shading;
      material = createKnightMaterial(shading, currentTint);
      skinnedMesh.material = material;
      oldMaterial.dispose();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      skeleton.dispose();
      material.dispose();
    },
  };
}

let cachedIronKnightTemplate: RiggedVoxelTemplate | null = null;

export function getIronKnightTemplate(): RiggedVoxelTemplate {
  if (!cachedIronKnightTemplate) {
    const asset = ironKnightRaw as unknown as RiggedVoxelAsset;
    cachedIronKnightTemplate = buildRiggedVoxelTemplate(asset);
  }
  return cachedIronKnightTemplate;
}

export function disposeIronKnightTemplate(): void {
  if (cachedIronKnightTemplate) {
    cachedIronKnightTemplate.geometry.dispose();
    cachedIronKnightTemplate = null;
  }
}
