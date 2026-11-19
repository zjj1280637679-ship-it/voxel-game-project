/**
 * VoxelWorld: 24 x 14 x 24 headless formal voxel simulation.
 * Pure TypeScript (no DOM / WebGL / Three.js imports).
 */

import type {
  AnchorSpec,
  CompoundPulse,
  Coord3,
  EntityBlock,
  FormKind,
  InteractionLogEntry,
  IVoxelWorld,
  OutcomeStatus,
  PulseCategory,
  PulseOutcome,
  PulseSpec,
  RayHit,
  RulesConfig,
  WorldTickEvents,
} from '../core/contracts.ts';
import { FormalEngine } from '../core/engine.ts';

const PULSE_TICK_INTERVAL = 0.1; // 10 Hz formal pulse ticks
const MAX_LOGS = 200;

const ORTHO_DIRS: readonly Coord3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

type FxBurst = { pos: Coord3; colorHex: number; kind: 'hit' | 'deathrattle' | 'craft' | 'aoe' };

interface ProtoTickMeta {
  emitsAtmo: string | undefined;
  emitsPulse: PulseSpec | undefined;
  selfPulse: PulseSpec | undefined;
  activeAnchor: AnchorSpec | undefined;
}

function catColorHex(cat: PulseCategory | null): number {
  switch (cat) {
    case 'Thermo':
      return 0xff6b2b;
    case 'Magic':
      return 0xb44cff;
    case 'Atmo':
      return 0x3ec6ff;
    case 'Mech':
      return 0xdcdcdc;
    default:
      return 0x8899aa;
  }
}

export class VoxelWorld implements IVoxelWorld {
  readonly sizeX = 24;
  readonly sizeY = 14;
  readonly sizeZ = 24;
  readonly engine: FormalEngine;

  private _tickCount = 0;
  private dirtyRevision = 1;
  private readonly grid: Array<EntityBlock | null>;
  private readonly freeBodies: EntityBlock[] = [];
  private readonly logs: InteractionLogEntry[] = [];
  private pendingFx: FxBurst[] = [];
  private tickAccum = 0;
  private readonly wispCooldown = new Map<number, number>();
  private readonly sheepTurnTimer = new Map<number, number>();
  private readonly anchorRespawnTimer = new Map<number, number>();
  private readonly freeBodyRadiusCache = new Map<string, number>();
  private readonly gravityFragileCache = new Map<string, boolean>();
  private readonly protoTickMetaCache = new Map<string, ProtoTickMeta>();
  private readonly mechToggleMask: number;
  private rngState = 0x12345678;

  constructor(rules: RulesConfig) {
    this.engine = new FormalEngine(rules);
    this.mechToggleMask = this.engine.parseMask('Mech_Toggle');
    this.grid = new Array<EntityBlock | null>(this.sizeX * this.sizeY * this.sizeZ).fill(null);
    this.buildStage1Island();
  }

  get tickCount(): number {
    return this._tickCount;
  }

  getDirtyRevision(): number {
    return this.dirtyRevision;
  }

  private nextRand(): number {
    // Deterministic LCG so headless simulations are reproducible.
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY && z >= 0 && z < this.sizeZ;
  }

  private gridIndex(x: number, y: number, z: number): number {
    return (y * this.sizeZ + z) * this.sizeX + x;
  }

  private setGridBlock(x: number, y: number, z: number, entity: EntityBlock | null): void {
    if (!this.inBounds(x, y, z)) return;
    if (entity) {
      entity.pos = { x, y, z };
    }
    this.grid[this.gridIndex(x, y, z)] = entity;
    this.dirtyRevision++;
  }

  private spawnGrid(protoId: string, x: number, y: number, z: number): EntityBlock {
    const ent = this.engine.spawn(protoId, { x, y, z });
    this.setGridBlock(x, y, z, ent);
    return ent;
  }

  private buildStage1Island(): void {
    // 1. Base island: y=0 Dirt, y=1 Grass.
    for (let z = 0; z < this.sizeZ; z++) {
      for (let x = 0; x < this.sizeX; x++) {
        this.spawnGrid('Dirt', x, 0, z);
        this.spawnGrid('Grass', x, 1, z);
      }
    }

    // 2. Obsidian + Stone + Glass showcase wall at x=7..10, y=2..4, z=10..12 (air gap at z=11).
    for (let x = 7; x <= 10; x++) {
      for (let y = 2; y <= 4; y++) {
        this.spawnGrid('Stone', x, y, 10);
      }
    }
    for (let y = 2; y <= 4; y++) {
      this.spawnGrid('Obsidian', 7, y, 12);
    }
    this.spawnGrid('Stone', 8, 2, 12);
    this.spawnGrid('Glass', 8, 3, 12);
    this.spawnGrid('Stone', 8, 4, 12);
    this.spawnGrid('Stone', 9, 2, 12);
    this.spawnGrid('Glass', 9, 3, 12);
    this.spawnGrid('Stone', 9, 4, 12);
    this.spawnGrid('IronOre', 10, 2, 12);
    this.spawnGrid('Obsidian', 10, 3, 12);
    this.spawnGrid('Obsidian', 10, 4, 12);

    // 3. Oak cabin at x=11..14, z=8..11 with OakLog corners, OakPlank walls, OakPlank_Slab steps,
    // and interactive OakDoor_Closed at (12, 2, 11).
    for (let y = 2; y <= 4; y++) {
      this.spawnGrid('OakLog', 11, y, 8);
      this.spawnGrid('OakLog', 14, y, 8);
      this.spawnGrid('OakLog', 11, y, 11);
      this.spawnGrid('OakLog', 14, y, 11);

      this.spawnGrid('OakPlank', 12, y, 8);
      this.spawnGrid('OakPlank', 13, y, 8);
      this.spawnGrid('OakPlank', 11, y, 9);
      this.spawnGrid('OakPlank', 11, y, 10);
      this.spawnGrid('OakPlank', 14, y, 9);
      this.spawnGrid('OakPlank', 14, y, 10);
      this.spawnGrid('OakPlank', 13, y, 11);
    }
    // Roof & doorway lintel.
    this.spawnGrid('OakDoor_Closed', 12, 2, 11);
    this.spawnGrid('OakPlank', 12, 3, 11);
    this.spawnGrid('OakPlank', 12, 4, 11);
    for (let x = 12; x <= 13; x++) {
      for (let z = 9; z <= 10; z++) {
        this.spawnGrid('OakPlank', x, 4, z);
      }
    }
    // Slab steps beside entrance (keep (12, 2, 12) clear for straight rays to OakDoor_Closed).
    this.spawnGrid('OakPlank_Slab', 13, 2, 12);
    this.spawnGrid('OakPlank_Slab', 14, 2, 12);

    // 4. Dry OakPlank target at (14, 2, 13).
    this.spawnGrid('OakPlank', 14, 2, 13);

    // 5. Wet pool Water + Ice + wet OakPlank adjacent to Water at (15..17, 1..2, 13..15).
    // Pool kept at x=16..17 so (14, 2, 13) and Workbench #2 (14, 2, 15) stay dry.
    this.spawnGrid('Water', 16, 1, 13);
    this.spawnGrid('Water', 17, 1, 13);
    this.spawnGrid('Water', 16, 1, 14);
    this.spawnGrid('Water', 17, 1, 14);
    this.spawnGrid('Water', 16, 1, 15);
    this.spawnGrid('Ice', 17, 1, 15);
    this.spawnGrid('Ice', 17, 2, 15);
    // Wet OakPlank directly atop Water (16, 1, 14) -> receives Atmo_Wet aura.
    this.spawnGrid('OakPlank', 16, 2, 14);

    // 6. Sand stack resting on removable OakPlank support at (9, 3, 14) over air at y=2.
    this.spawnGrid('OakPlank', 9, 3, 14);
    this.spawnGrid('Sand', 9, 4, 14);
    this.spawnGrid('Sand', 9, 5, 14);

    // 7. Sapling at (11, 2, 15).
    this.spawnGrid('Sapling', 11, 2, 15);

    // 8. Workbench #1 (safe craft station) at (13, 2, 14).
    const wb1 = this.spawnGrid('Workbench', 13, 2, 14);
    this.workbenchInsert(wb1.uid, 'Sulfur_Bit');
    this.workbenchInsert(wb1.uid, 'Charcoal_Bit');
    this.workbenchInsert(wb1.uid, 'Saltpeter_Bit');

    // 9. Workbench #2 (explosive break test) at (14, 2, 15).
    const wb2 = this.spawnGrid('Workbench', 14, 2, 15);
    this.workbenchInsert(wb2.uid, 'Sulfur_Bit');
    this.workbenchInsert(wb2.uid, 'Charcoal_Bit');
    this.workbenchInsert(wb2.uid, 'Saltpeter_Bit');

    // 10. Isolated Fire pit on Stone ring at (17, 2, 11).
    for (let x = 16; x <= 18; x++) {
      for (let z = 10; z <= 12; z++) {
        this.spawnGrid('Stone', x, 1, z);
      }
    }
    this.spawnGrid('Stone', 16, 2, 11);
    this.spawnGrid('Stone', 18, 2, 11);
    this.spawnGrid('Stone', 17, 2, 10);
    this.spawnGrid('Fire', 17, 2, 11);

    // 11. Concrete entity-bound PastureStele + MistVeil + Sheep_Live near (10, 2, 16).
    const stele = this.spawnGrid('PastureStele', 10, 2, 16);
    this.spawnGrid('MistVeil', 16, 3, 13);

    const sheep = this.engine.spawn('Sheep_Live', { x: 10.5, y: 2.45, z: 17.5 });
    sheep.vel = { x: 0.4, y: 0, z: 0.25 };
    sheep.homeAnchorUid = stele.uid;
    sheep.homePos = { x: 10.5, y: 2.5, z: 16.5 };
    this.freeBodies.push(sheep);
    this.sheepTurnTimer.set(sheep.uid, 2.0);

    // 12. Concrete entity-bound GuardStele + IronKnight guard near (16, 2, 7).
    const guardStele = this.spawnGrid('GuardStele', 16, 2, 7);
    const knight = this.engine.spawn('IronKnight', { x: 16.5, y: 2.65, z: 8.6 });
    knight.vel = { x: 0, y: 0, z: 0.01 };
    knight.homeAnchorUid = guardStele.uid;
    knight.homePos = { x: 16.5, y: 2.5, z: 7.5 };
    knight.animState = 'idle';
    this.freeBodies.push(knight);
    this.sheepTurnTimer.set(knight.uid, 2.5);
    this.logs.length = 0;
  }

  private isGridBlockCollidable(block: EntityBlock | null): boolean {
    if (!block) return false;
    return this.engine.getAttr<boolean>(block.protoId, 'collidable', block.form === 'GridStatic');
  }

  private isEntityInteractable(entity: EntityBlock): boolean {
    return this.engine.getAttr<boolean>(entity.protoId, 'interactable', true);
  }

  getGridBlock(x: number, y: number, z: number): EntityBlock | null {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    if (!this.inBounds(ix, iy, iz)) return null;
    return this.grid[this.gridIndex(ix, iy, iz)];
  }

  getFreeBodies(): readonly EntityBlock[] {
    return this.freeBodies;
  }

  getCellAtmo(x: number, y: number, z: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    let atmo = 0;

    const self = this.getGridBlock(ix, iy, iz);
    if (self) {
      atmo = (atmo | self.cellAtmo) >>> 0;
      const emits = this.engine.getAttr<string | undefined>(self.protoId, 'emits_atmo', undefined);
      if (emits) {
        atmo = (atmo | this.engine.parseMask(emits)) >>> 0;
      }
    }

    for (const d of ORTHO_DIRS) {
      const nb = this.getGridBlock(ix + d.x, iy + d.y, iz + d.z);
      if (!nb) continue;
      const emits = this.engine.getAttr<string | undefined>(nb.protoId, 'emits_atmo', undefined);
      if (emits) {
        atmo = (atmo | this.engine.parseMask(emits)) >>> 0;
      }
    }

    const cx = ix + 0.5;
    const cy = iy + 0.5;
    const cz = iz + 0.5;
    for (const fb of this.freeBodies) {
      const emits = this.engine.getAttr<string | undefined>(fb.protoId, 'emits_atmo', undefined);
      if (!emits) continue;
      const dist = Math.hypot(fb.pos.x - cx, fb.pos.y - cy, fb.pos.z - cz);
      if (dist <= 1.25) {
        atmo = (atmo | this.engine.parseMask(emits)) >>> 0;
      }
    }

    return atmo;
  }

  private getFreeBodyRadius(protoId: string): number {
    const cached = this.freeBodyRadiusCache.get(protoId);
    if (cached !== undefined) return cached;

    let radius = 0.25;
    if (protoId === 'IronKnight') {
      radius = 0.65;
    } else if (protoId === 'IronKnight_Corpse') {
      radius = 0.55;
    } else if (protoId === 'FallingBlock') {
      radius = 0.45;
    } else {
      const chain = this.engine.lookupChain({
        uid: 0,
        protoId,
        hp: 1,
        maxHp: 1,
        form: 'FreeBody',
        pos: { x: 0, y: 0, z: 0 },
        cellAtmo: 0,
        chamber: [],
      });
      if (chain.includes('@Mat_Fauna') || chain.includes('@Mat_Corpse')) {
        radius = 0.45;
      }
    }
    this.freeBodyRadiusCache.set(protoId, radius);
    return radius;
  }

  private isGravityFragile(block: EntityBlock): boolean {
    const cached = this.gravityFragileCache.get(block.protoId);
    if (cached !== undefined) return cached;
    const fragile = this.engine.lookupChain(block).includes('@Mix_GravityFragile');
    this.gravityFragileCache.set(block.protoId, fragile);
    return fragile;
  }

  private getProtoTickMeta(protoId: string): ProtoTickMeta {
    const cached = this.protoTickMetaCache.get(protoId);
    if (cached) return cached;

    const anchorSpec = this.engine.getAttr<AnchorSpec | undefined>(protoId, 'anchor', undefined);
    const meta: ProtoTickMeta = {
      emitsAtmo: this.engine.getAttr<string | undefined>(protoId, 'emits_atmo', undefined),
      emitsPulse: this.engine.getAttr<PulseSpec | undefined>(protoId, 'emits_pulse', undefined),
      selfPulse: this.engine.getAttr<PulseSpec | undefined>(protoId, 'self_pulse', undefined),
      activeAnchor:
        anchorSpec && (anchorSpec.respawn_sec ?? 0) > 0 && anchorSpec.binds.length > 0
          ? anchorSpec
          : undefined,
    };
    this.protoTickMetaCache.set(protoId, meta);
    return meta;
  }

  private intersectRayAABB(
    origin: Coord3,
    dir: Coord3,
    min: Coord3,
    max: Coord3,
    maxDist: number,
  ): { t: number; normal: Coord3 } | null {
    let tMin = 0;
    let tMax = maxDist;
    let normal: Coord3 = { x: 0, y: 0, z: 0 };

    const axes: Array<['x' | 'y' | 'z', number, number, number]> = [
      ['x', origin.x, dir.x, 1],
      ['y', origin.y, dir.y, 1],
      ['z', origin.z, dir.z, 1],
    ];

    for (const [axis, o, d] of axes) {
      const bMin = min[axis];
      const bMax = max[axis];
      if (Math.abs(d) < 1e-8) {
        if (o < bMin || o > bMax) return null;
      } else {
        let t1 = (bMin - o) / d;
        let t2 = (bMax - o) / d;
        let nSign = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          nSign = 1;
        }
        if (t1 > tMin) {
          tMin = t1;
          normal = {
            x: axis === 'x' ? nSign : 0,
            y: axis === 'y' ? nSign : 0,
            z: axis === 'z' ? nSign : 0,
          };
        }
        if (t2 < tMax) {
          tMax = t2;
        }
        if (tMin > tMax) return null;
      }
    }

    return { t: tMin, normal };
  }

  private getBlockSubAABB(
    block: EntityBlock,
    ix: number,
    iy: number,
    iz: number,
  ): { min: Coord3; max: Coord3 } | null {
    if (block.shape === 'HalfBottom') {
      return {
        min: { x: ix, y: iy, z: iz },
        max: { x: ix + 1, y: iy + 0.5, z: iz + 1 },
      };
    }
    if (block.shape === 'ThinDoor') {
      return {
        min: { x: ix, y: iy, z: iz + 0.41 },
        max: { x: ix + 1, y: iy + 1, z: iz + 0.59 },
      };
    }
    if (block.shape === 'ThinDoorOpen') {
      return {
        min: { x: ix + 0.03, y: iy, z: iz },
        max: { x: ix + 0.21, y: iy + 1, z: iz + 1 },
      };
    }
    return null;
  }

  private raycastGrid(
    origin: Coord3,
    dir: Coord3,
    maxDist: number,
    mode: 'interact' | 'collide' = 'interact',
  ): RayHit | null {
    let ix = Math.floor(origin.x);
    let iy = Math.floor(origin.y);
    let iz = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

    let tMaxX =
      stepX > 0
        ? (ix + 1 - origin.x) * tDeltaX
        : stepX < 0
          ? (origin.x - ix) * tDeltaX
          : Infinity;
    let tMaxY =
      stepY > 0
        ? (iy + 1 - origin.y) * tDeltaY
        : stepY < 0
          ? (origin.y - iy) * tDeltaY
          : Infinity;
    let tMaxZ =
      stepZ > 0
        ? (iz + 1 - origin.z) * tDeltaZ
        : stepZ < 0
          ? (origin.z - iz) * tDeltaZ
          : Infinity;

    let t = 0;
    let normal: Coord3 = { x: 0, y: 0, z: 0 };

    while (t <= maxDist) {
      if (this.inBounds(ix, iy, iz)) {
        const block = this.grid[this.gridIndex(ix, iy, iz)];
        if (block) {
          const skip =
            (mode === 'interact' && !this.isEntityInteractable(block)) ||
            (mode === 'collide' && !this.isGridBlockCollidable(block));
          if (!skip) {
            const subBox = this.getBlockSubAABB(block, ix, iy, iz);
            if (subBox) {
              const subHit = this.intersectRayAABB(origin, dir, subBox.min, subBox.max, maxDist);
              if (subHit) {
                return {
                  kind: 'grid',
                  entity: block,
                  pos: {
                    x: origin.x + dir.x * subHit.t,
                    y: origin.y + dir.y * subHit.t,
                    z: origin.z + dir.z * subHit.t,
                  },
                  normal: subHit.normal,
                  distance: subHit.t,
                };
              }
            } else {
              return {
                kind: 'grid',
                entity: block,
                pos: {
                  x: origin.x + dir.x * t,
                  y: origin.y + dir.y * t,
                  z: origin.z + dir.z * t,
                },
                normal,
                distance: t,
              };
            }
          }
        }
      } else {
        if (
          (ix < 0 && stepX <= 0) ||
          (ix >= this.sizeX && stepX >= 0) ||
          (iy < 0 && stepY <= 0) ||
          (iy >= this.sizeY && stepY >= 0) ||
          (iz < 0 && stepZ <= 0) ||
          (iz >= this.sizeZ && stepZ >= 0)
        ) {
          break;
        }
      }

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        ix += stepX;
        normal = { x: -stepX, y: 0, z: 0 };
      } else if (tMaxY < tMaxZ) {
        t = tMaxY;
        tMaxY += tDeltaY;
        iy += stepY;
        normal = { x: 0, y: -stepY, z: 0 };
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        iz += stepZ;
        normal = { x: 0, y: 0, z: -stepZ };
      }
    }

    return null;
  }

  private raycastFreeBodies(origin: Coord3, dir: Coord3, maxDist: number): RayHit | null {
    let best: RayHit | null = null;

    for (const fb of this.freeBodies) {
      if (!this.isEntityInteractable(fb)) continue;
      if (fb.protoId === 'IronKnight') {
        const aabbHit = this.intersectRayAABB(
          origin,
          dir,
          { x: fb.pos.x - 0.52, y: fb.pos.y - 0.65, z: fb.pos.z - 0.52 },
          { x: fb.pos.x + 0.52, y: fb.pos.y - 0.65 + 2.08, z: fb.pos.z + 0.52 },
          maxDist,
        );
        if (aabbHit && (best === null || aabbHit.t < best.distance)) {
          best = {
            kind: 'free',
            entity: fb,
            pos: {
              x: origin.x + dir.x * aabbHit.t,
              y: origin.y + dir.y * aabbHit.t,
              z: origin.z + dir.z * aabbHit.t,
            },
            normal: aabbHit.normal,
            distance: aabbHit.t,
          };
        }
        continue;
      }
      const r = this.getFreeBodyRadius(fb.protoId);
      const ocX = origin.x - fb.pos.x;
      const ocY = origin.y - fb.pos.y;
      const ocZ = origin.z - fb.pos.z;
      const b = ocX * dir.x + ocY * dir.y + ocZ * dir.z;
      const c = ocX * ocX + ocY * ocY + ocZ * ocZ - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;

      const sqrtDisc = Math.sqrt(disc);
      let t = -b - sqrtDisc;
      if (t < 0) {
        t = c <= 0 ? 0 : -b + sqrtDisc;
      }
      if (t < 0 || t > maxDist) continue;
      if (best && t >= best.distance) continue;

      const hx = origin.x + dir.x * t;
      const hy = origin.y + dir.y * t;
      const hz = origin.z + dir.z * t;
      const nx = hx - fb.pos.x;
      const ny = hy - fb.pos.y;
      const nz = hz - fb.pos.z;
      const nLen = Math.hypot(nx, ny, nz);

      best = {
        kind: 'free',
        entity: fb,
        pos: { x: hx, y: hy, z: hz },
        normal: nLen > 1e-6 ? { x: nx / nLen, y: ny / nLen, z: nz / nLen } : { x: 0, y: 1, z: 0 },
        distance: t,
      };
    }

    return best;
  }

  raycast(origin: Coord3, dir: Coord3, maxDist = 10): RayHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-8) return null;
    const ndir: Coord3 = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

    const gridHit = this.raycastGrid(origin, ndir, maxDist);
    const freeHit = this.raycastFreeBodies(origin, ndir, gridHit ? gridHit.distance : maxDist);

    if (freeHit && (!gridHit || freeHit.distance < gridHit.distance)) {
      return freeHit;
    }
    return gridHit;
  }

  private entityCenter(entity: EntityBlock): Coord3 {
    if (entity.form === 'GridStatic' || entity.form === 'GridFluid') {
      return { x: entity.pos.x + 0.5, y: entity.pos.y + 0.5, z: entity.pos.z + 0.5 };
    }
    return { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z };
  }

  private pushFx(pos: Coord3, colorHex: number, kind: FxBurst['kind'], tickFx?: FxBurst[]): void {
    const burst: FxBurst = { pos: { ...pos }, colorHex, kind };
    this.pendingFx.push(burst);
    if (tickFx) tickFx.push(burst);
  }

  private pushSystemLog(
    action: string,
    target: string,
    status: OutcomeStatus,
    resultText: string,
    atmoMask = 0,
    tickLogs?: InteractionLogEntry[],
  ): InteractionLogEntry {
    const entry: InteractionLogEntry = {
      tick: this._tickCount,
      action,
      target,
      scoresSummary: '-',
      winnerCat: null,
      atmoText: this.engine.formatMask(atmoMask) || 'Dry',
      status,
      resultText,
    };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs.shift();
    }
    if (tickLogs) {
      tickLogs.push(entry);
    }
    return entry;
  }

  private recordLog(
    action: string,
    outcome: PulseOutcome,
    targetAfter: EntityBlock,
    tickLogs?: InteractionLogEntry[],
  ): InteractionLogEntry {
    const scoresParts: string[] = [];
    for (const [k, v] of Object.entries(outcome.channelScores)) {
      if (v !== undefined) {
        scoresParts.push(`${k}:${Number(v).toFixed(1)}`);
      }
    }
    const scoresSummary = scoresParts.join(' ') || 'none';
    const atmoText = this.engine.formatMask(outcome.effAtmo) || 'Dry';

    let resultText: string;
    if (outcome.status === 'immune') {
      resultText = 'Immune (0 dmg)';
    } else if (outcome.status === 'damaged') {
      resultText = `-${outcome.damage.toFixed(1)} HP (${targetAfter.hp.toFixed(1)}/${targetAfter.maxHp})`;
    } else if (outcome.status === 'crafted') {
      resultText = `Crafted ${outcome.spawns.map((s) => s.protoId).join(', ')}`;
    } else {
      const produced = [...outcome.spawns, ...outcome.spilled].map((s) => s.protoId);
      resultText = `-> [${produced.join(', ') || 'none'}]`;
    }

    const entry: InteractionLogEntry = {
      tick: this._tickCount,
      action,
      target: outcome.targetBefore,
      scoresSummary,
      winnerCat: outcome.winnerCat,
      atmoText,
      status: outcome.status,
      resultText,
    };

    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs.shift();
    }
    if (tickLogs) {
      tickLogs.push(entry);
    }
    return entry;
  }

  private findFreeGridCellNear(gx: number, gy: number, gz: number, stepIndex: number): Coord3 | null {
    // Primary multi-block growth slot is directly above (e.g. Sapling -> OakLog + Leaf at y+1).
    const aboveY = gy + stepIndex;
    if (this.inBounds(gx, aboveY, gz) && !this.getGridBlock(gx, aboveY, gz)) {
      return { x: gx, y: aboveY, z: gz };
    }
    for (const d of ORTHO_DIRS) {
      const nx = gx + d.x;
      const ny = gy + d.y;
      const nz = gz + d.z;
      if (this.inBounds(nx, ny, nz) && !this.getGridBlock(nx, ny, nz)) {
        return { x: nx, y: ny, z: nz };
      }
    }
    return null;
  }

  private spawnFreeBodyInWorld(entity: EntityBlock, baseCenter: Coord3, spread: boolean): void {
    entity.pos = { x: baseCenter.x, y: baseCenter.y, z: baseCenter.z };
    if (entity.protoId === 'FallingBlock') {
      entity.vel = { x: 0, y: 0, z: 0 };
    } else if (spread) {
      const angle = this.nextRand() * Math.PI * 2;
      const horiz = 0.8 + this.nextRand() * 1.1;
      entity.vel = {
        x: Math.cos(angle) * horiz,
        y: 2.2 + this.nextRand() * 1.2,
        z: Math.sin(angle) * horiz,
      };
    } else {
      entity.vel = { x: 0, y: 0, z: 0 };
    }
    this.freeBodies.push(entity);
  }

  private applyOutcomeToWorld(
    target: EntityBlock,
    outcome: PulseOutcome,
    actionLabel: string,
    visitedUids: Set<number>,
    tickLogs?: InteractionLogEntry[],
    tickFx?: FxBurst[],
    suppressDamagedLog = false,
  ): { entry: InteractionLogEntry; gridChanged: boolean } {
    visitedUids.add(target.uid);
    let gridChanged = false;
    const center = this.entityCenter(target);

    if (outcome.status === 'immune') {
      this.pushFx(center, 0x8899aa, 'hit', tickFx);
      if (this.engine.getAttr<string | undefined>(target.protoId, 'ai', undefined) === 'guard') {
        target.animState = 'block';
        target.animTimer = 0.95;
      }
    } else if (outcome.status === 'damaged') {
      this.pushFx(center, catColorHex(outcome.winnerCat), 'hit', tickFx);
      if (this.engine.getAttr<string | undefined>(target.protoId, 'ai', undefined) === 'guard') {
        target.animState = 'slash';
        target.animTimer = 0.85;
      }
      if (target.form === 'GridStatic' || target.form === 'GridFluid') {
        this.dirtyRevision++;
        gridChanged = true;
      }
    } else if (outcome.status === 'crafted') {
      this.pushFx(center, 0x44ff88, 'craft', tickFx);
      for (const crafted of outcome.spawns) {
        this.spawnFreeBodyInWorld(
          crafted,
          { x: center.x, y: center.y + 0.75, z: center.z },
          true,
        );
      }
    } else if (outcome.status === 'deathrattle') {
      this.pushFx(center, catColorHex(outcome.winnerCat), 'deathrattle', tickFx);

      const isGrid = target.form === 'GridStatic' || target.form === 'GridFluid';
      const gx = Math.floor(target.pos.x);
      const gy = Math.floor(target.pos.y);
      const gz = Math.floor(target.pos.z);

      if (isGrid) {
        if (this.getGridBlock(gx, gy, gz)?.uid === target.uid) {
          this.setGridBlock(gx, gy, gz, null);
          gridChanged = true;
        }
      } else {
        const idx = this.freeBodies.indexOf(target);
        if (idx !== -1) {
          this.freeBodies.splice(idx, 1);
        }
      }

      const gridSpawns: EntityBlock[] = [];
      const freeSpawns: EntityBlock[] = [];
      for (const s of outcome.spawns) {
        const form = this.engine.getAttr<FormKind>(s.protoId, 'form', 'FreeBody');
        if (form === 'GridStatic' || form === 'GridFluid') {
          gridSpawns.push(s);
        } else {
          freeSpawns.push(s);
        }
      }

      let spawnedFire: EntityBlock | null = null;
      gridSpawns.forEach((gs, i) => {
        if (i === 0 && isGrid && this.inBounds(gx, gy, gz) && !this.getGridBlock(gx, gy, gz)) {
          this.setGridBlock(gx, gy, gz, gs);
          gridChanged = true;
          if (gs.protoId === 'Fire') spawnedFire = gs;
        } else {
          const slot = isGrid
            ? this.findFreeGridCellNear(gx, gy, gz, i)
            : this.inBounds(gx, gy, gz) && !this.getGridBlock(gx, gy, gz)
              ? { x: gx, y: gy, z: gz }
              : null;
          if (slot) {
            this.setGridBlock(slot.x, slot.y, slot.z, gs);
            gridChanged = true;
            if (gs.protoId === 'Fire') spawnedFire = gs;
          }
        }
      });

      const dropCenter =
        isGrid && gridSpawns.length > 0 && gridSpawns[0].protoId !== 'Fire'
          ? { x: center.x, y: center.y + 0.55, z: center.z }
          : center;

      for (const fs of freeSpawns) {
        this.spawnFreeBodyInWorld(
          fs,
          dropCenter,
          fs.protoId !== 'StuckArrow' &&
            fs.protoId !== 'Sheep_Corpse' &&
            fs.protoId !== 'IronKnight_Corpse',
        );
        if (fs.protoId === 'IronKnight_Corpse') {
          fs.animState = 'death';
        }
        const fsAi = this.engine.getAttr<string | undefined>(fs.protoId, 'ai', undefined);
        if (fsAi === 'graze' || fsAi === 'guard') {
          if (fs.protoId === 'IronKnight') {
            fs.vel = { x: 0, y: 0, z: 0.01 };
            fs.animState = 'idle';
            this.sheepTurnTimer.set(fs.uid, 1.5);
          }
          this.bindToCompatibleAnchor(fs);
        }
      }

      const newlySpilled: EntityBlock[] = [];
      for (const sp of outcome.spilled) {
        this.spawnFreeBodyInWorld(sp, center, true);
        newlySpilled.push(sp);
      }

      // If Fire spawned right on top of spilled chamber contents (e.g. Workbench #2 explosion),
      // ignite spilled volatile items immediately so Fire + gunpowder bits chain naturally.
      if (spawnedFire && newlySpilled.length > 0) {
        const firePulseSpec = this.engine.getAttr<PulseSpec | undefined>(
          'Fire',
          'emits_pulse',
          undefined,
        );
        if (firePulseSpec) {
          const firePulse = this.engine.parseSpecPulse(firePulseSpec);
          for (const item of newlySpilled) {
            if (visitedUids.has(item.uid)) continue;
            const ignOutcome = this.engine.applyPulse(item, firePulse, outcome.effAtmo);
            if (ignOutcome.status !== 'immune') {
              const res = this.applyOutcomeToWorld(
                item,
                ignOutcome,
                'Fire(Ignite)',
                visitedUids,
                tickLogs,
                tickFx,
              );
              if (res.gridChanged) gridChanged = true;
            }
          }
        }
      }

      if (outcome.aoePulse) {
        const aoeChanged = this.applyAoePulse(
          center,
          2.5,
          outcome.aoePulse,
          `${target.protoId}:AOE`,
          visitedUids,
          tickLogs,
          tickFx,
        );
        if (aoeChanged) gridChanged = true;
      }
    }

    if (
      suppressDamagedLog &&
      (outcome.status === 'damaged' ||
        (outcome.status === 'deathrattle' && target.protoId === 'ExplosionShock'))
    ) {
      const entry: InteractionLogEntry = {
        tick: this._tickCount,
        action: actionLabel,
        target: outcome.targetBefore,
        scoresSummary: '-',
        winnerCat: outcome.winnerCat,
        atmoText: this.engine.formatMask(outcome.effAtmo) || 'Dry',
        status: outcome.status,
        resultText: `-${outcome.damage.toFixed(1)} HP`,
      };
      return { entry, gridChanged };
    }

    const entry = this.recordLog(actionLabel, outcome, target, tickLogs);
    return { entry, gridChanged };
  }

  private applyAoePulse(
    center: Coord3,
    radius: number,
    basePulse: CompoundPulse,
    actionLabel: string,
    visitedUids: Set<number>,
    tickLogs?: InteractionLogEntry[],
    tickFx?: FxBurst[],
  ): boolean {
    let gridChanged = false;
    this.pushFx(center, 0xff8833, 'aoe', tickFx);

    const minX = Math.max(0, Math.floor(center.x - radius));
    const maxX = Math.min(this.sizeX - 1, Math.ceil(center.x + radius));
    const minY = Math.max(0, Math.floor(center.y - radius));
    const maxY = Math.min(this.sizeY - 1, Math.ceil(center.y + radius));
    const minZ = Math.max(0, Math.floor(center.z - radius));
    const maxZ = Math.min(this.sizeZ - 1, Math.ceil(center.z + radius));

    const gridTargets: Array<{ block: EntityBlock; dist: number }> = [];
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const block = this.getGridBlock(x, y, z);
          if (!block || visitedUids.has(block.uid)) continue;
          const dist = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y, z + 0.5 - center.z);
          if (dist <= radius) {
            gridTargets.push({ block, dist });
          }
        }
      }
    }

    const freeTargets: Array<{ fb: EntityBlock; dist: number }> = [];
    for (const fb of [...this.freeBodies]) {
      if (visitedUids.has(fb.uid)) continue;
      const dist = Math.hypot(fb.pos.x - center.x, fb.pos.y - center.y, fb.pos.z - center.z);
      if (dist <= radius) {
        freeTargets.push({ fb, dist });
      }
    }

    const scalePulse = (dist: number): CompoundPulse => {
      const factor = Math.max(0.25, 1 - dist / (radius + 0.5));
      return {
        amount: basePulse.amount * factor,
        channels: basePulse.channels,
        atmoMask: basePulse.atmoMask,
      };
    };

    for (const { block, dist } of gridTargets) {
      if (visitedUids.has(block.uid)) continue;
      const envAtmo = this.getCellAtmo(block.pos.x, block.pos.y, block.pos.z);
      const out = this.engine.applyPulse(block, scalePulse(dist), envAtmo);
      if (out.status !== 'immune') {
        const res = this.applyOutcomeToWorld(block, out, actionLabel, visitedUids, tickLogs, tickFx);
        if (res.gridChanged) gridChanged = true;
      }
    }

    for (const { fb, dist } of freeTargets) {
      if (visitedUids.has(fb.uid)) continue;
      const envAtmo = this.getCellAtmo(fb.pos.x, fb.pos.y, fb.pos.z);
      const out = this.engine.applyPulse(fb, scalePulse(dist), envAtmo);
      if (out.status !== 'immune') {
        const res = this.applyOutcomeToWorld(fb, out, actionLabel, visitedUids, tickLogs, tickFx);
        if (res.gridChanged) gridChanged = true;
      }
    }

    return gridChanged;
  }

  interactAt(hit: RayHit, pulse: CompoundPulse, label = 'Interact'): InteractionLogEntry {
    const envAtmo =
      hit.kind === 'grid'
        ? this.getCellAtmo(hit.entity.pos.x, hit.entity.pos.y, hit.entity.pos.z)
        : this.getCellAtmo(hit.entity.pos.x, hit.entity.pos.y, hit.entity.pos.z);
    const outcome = this.engine.applyPulse(hit.entity, pulse, envAtmo);
    const visited = new Set<number>();
    const { entry } = this.applyOutcomeToWorld(hit.entity, outcome, label, visited);
    if (
      hit.entity.protoId === 'IronKnight' &&
      outcome.status === 'immune' &&
      pulse.channels.Mech !== undefined &&
      (pulse.channels.Mech[1] & this.mechToggleMask) !== 0
    ) {
      hit.entity.animState = 'salute';
      hit.entity.animTimer = 1.6;
    }
    return entry;
  }

  shootProjectile(protoId: string, origin: Coord3, dir: Coord3, speed = 18): EntityBlock {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    const ndir = len > 1e-8 ? { x: dir.x / len, y: dir.y / len, z: dir.z / len } : { x: 0, y: 0, z: -1 };
    const proj = this.engine.spawn(protoId, origin, 0);
    proj.vel = { x: ndir.x * speed, y: ndir.y * speed, z: ndir.z * speed };
    this.freeBodies.push(proj);
    return proj;
  }

  private countBoundOccupants(anchorUid: number, binds: readonly string[]): number {
    let count = 0;
    for (const fb of this.freeBodies) {
      if (fb.homeAnchorUid === anchorUid && binds.includes(fb.protoId)) {
        count++;
      }
    }
    return count;
  }

  private bindToCompatibleAnchor(entity: EntityBlock): void {
    let bestAnchor: EntityBlock | null = null;
    let bestDist = Infinity;

    const considerAnchor = (candidate: EntityBlock) => {
      const anchor = this.engine.getAttr<AnchorSpec | undefined>(candidate.protoId, 'anchor', undefined);
      if (!anchor || !anchor.binds.includes(entity.protoId)) return;
      const maxCount = anchor.max_count ?? 1;
      if (this.countBoundOccupants(candidate.uid, anchor.binds) >= maxCount) return;

      const c = this.entityCenter(candidate);
      const dist = Math.hypot(entity.pos.x - c.x, entity.pos.y - c.y, entity.pos.z - c.z);
      if (dist <= anchor.radius + 3.0 && dist < bestDist) {
        bestDist = dist;
        bestAnchor = candidate;
      }
    };

    for (const block of this.grid) {
      if (block) considerAnchor(block);
    }
    for (const fb of this.freeBodies) {
      if (fb.uid !== entity.uid) considerAnchor(fb);
    }

    if (bestAnchor) {
      entity.homeAnchorUid = (bestAnchor as EntityBlock).uid;
      entity.homePos = this.entityCenter(bestAnchor);
    } else {
      entity.homeAnchorUid = undefined;
      entity.homePos = { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z };
    }
  }

  placeBlock(pos: Coord3, protoId: string): EntityBlock | null {
    const ix = Math.floor(pos.x);
    const iy = Math.floor(pos.y);
    const iz = Math.floor(pos.z);
    if (!this.inBounds(ix, iy, iz)) return null;
    if (!this.engine.rules.prototypes[protoId]) return null;
    const form = this.engine.getAttr<FormKind>(protoId, 'form', 'FreeBody');

    const existing = this.getGridBlock(ix, iy, iz);
    if (form === 'FreeBody') {
      if (existing && this.isGridBlockCollidable(existing)) return null;
      const r = this.getFreeBodyRadius(protoId);
      const ent = this.engine.spawn(protoId, { x: ix + 0.5, y: iy + r, z: iz + 0.5 }, 0);
      ent.vel = { x: 0, y: 0, z: 0 };
      if (protoId === 'IronKnight_Corpse') {
        ent.animState = 'death';
      }
      const ai = this.engine.getAttr<string | undefined>(protoId, 'ai', undefined);
      if (ai === 'graze' || ai === 'guard') {
        if (protoId === 'IronKnight') {
          ent.vel = { x: 0, y: 0, z: 0.01 };
          ent.animState = 'idle';
          this.sheepTurnTimer.set(ent.uid, 1.5);
        }
        this.bindToCompatibleAnchor(ent);
      }
      this.freeBodies.push(ent);
      return ent;
    }

    if (existing && existing.form === 'GridStatic') return null;
    if (form !== 'GridStatic' && form !== 'GridFluid') return null;
    return this.spawnGrid(protoId, ix, iy, iz);
  }

  private findEntityByUid(uid: number): EntityBlock | null {
    for (const block of this.grid) {
      if (block && block.uid === uid) return block;
    }
    for (const fb of this.freeBodies) {
      if (fb.uid === uid) return fb;
    }
    return null;
  }

  workbenchInsert(wbUid: number, itemProtoId: string): boolean {
    const wb = this.findEntityByUid(wbUid);
    if (!wb) return false;
    const forwards = this.engine.getAttr<string[] | undefined>(
      wb.protoId,
      'forwards_masks',
      undefined,
    );
    if (!forwards || forwards.length === 0) return false;
    if (!this.engine.rules.prototypes[itemProtoId]) return false;

    const item = this.engine.spawn(itemProtoId, wb.pos, 0);
    wb.chamber.push(item);
    this.pushSystemLog(
      '装填工作台',
      wb.protoId,
      'crafted',
      `+${itemProtoId} (腔室 ${wb.chamber.length})`,
      this.getCellAtmo(wb.pos.x, wb.pos.y, wb.pos.z),
    );
    return true;
  }

  workbenchClear(wbUid: number): void {
    const wb = this.findEntityByUid(wbUid);
    if (wb) {
      wb.chamber = [];
    }
  }

  consumeFreeBody(uid: number): EntityBlock | null {
    const idx = this.freeBodies.findIndex((fb) => fb.uid === uid);
    if (idx === -1) return null;
    const [removed] = this.freeBodies.splice(idx, 1);
    this.pushFx(removed.pos, 0x38bdf8, 'craft');
    this.pushSystemLog(
      '拾取吸纳',
      removed.protoId,
      'crafted',
      '已收入方块槽',
      this.getCellAtmo(removed.pos.x, removed.pos.y, removed.pos.z),
    );
    return removed;
  }

  consumeFreeBodies(uids: readonly number[]): EntityBlock[] {
    const uidSet = new Set(uids);
    if (uidSet.size === 0) return [];

    const removed: EntityBlock[] = [];
    for (let i = this.freeBodies.length - 1; i >= 0; i--) {
      const fb = this.freeBodies[i];
      if (uidSet.has(fb.uid)) {
        this.freeBodies.splice(i, 1);
        removed.push(fb);
      }
    }
    if (removed.length === 0) return [];

    removed.reverse();
    for (const ent of removed) {
      this.pushFx(ent.pos, 0x38bdf8, 'craft');
    }

    if (removed.length === 1) {
      const single = removed[0];
      this.pushSystemLog(
        '拾取吸纳',
        single.protoId,
        'crafted',
        '已收入方块槽',
        this.getCellAtmo(single.pos.x, single.pos.y, single.pos.z),
      );
      return removed;
    }

    const counts = new Map<string, number>();
    for (const ent of removed) {
      counts.set(ent.protoId, (counts.get(ent.protoId) ?? 0) + 1);
    }
    const entries = [...counts.entries()];
    const shown = entries.slice(0, 4).map(([protoId, count]) => `${protoId}×${count}`);
    const summary = shown.join(', ') + (entries.length > 4 ? '…' : '');
    const anchor = removed[0];
    this.pushSystemLog(
      '范围收取',
      `${removed.length} 项资源`,
      'crafted',
      `已收取 ${summary}`,
      this.getCellAtmo(anchor.pos.x, anchor.pos.y, anchor.pos.z),
    );
    return removed;
  }

  private stepKinematics(
    dt: number,
    tickLogs: InteractionLogEntry[],
    tickFx: FxBurst[],
  ): boolean {
    let gridChanged = false;
    const maxStep = 0.015;
    const steps = Math.max(1, Math.ceil(dt / maxStep));
    const subDt = dt / steps;

    for (let s = 0; s < steps; s++) {
      // Snapshot active free bodies because collisions can spawn/remove entities.
      const snapshot = [...this.freeBodies];

      for (const fb of snapshot) {
        if (!this.freeBodies.includes(fb)) continue;

        if (fb.animTimer !== undefined && fb.animTimer > 0) {
          fb.animTimer = Math.max(0, fb.animTimer - subDt);
          if (
            fb.animTimer === 0 &&
            (fb.animState === 'block' || fb.animState === 'slash' || fb.animState === 'salute')
          ) {
            fb.animState = 'idle';
            if (fb.vel) {
              fb.vel.x = 0;
              fb.vel.z = 0;
            }
          }
        }

        const ai = this.engine.getAttr<string | undefined>(fb.protoId, 'ai', undefined);
        const hasStrike =
          this.engine.getAttr<PulseSpec | undefined>(fb.protoId, 'impact_pulse', undefined) !==
            undefined ||
          this.engine.getAttr<PulseSpec | undefined>(fb.protoId, 'contact_pulse', undefined) !==
            undefined;

        if (ai === 'graze' || ai === 'guard') {
          this.stepSheepKinematics(fb, subDt, ai === 'guard');
          continue;
        }

        if (ai === 'seek_target') {
          this.steerSeeker(fb, subDt);
        }

        const vel = fb.vel ?? { x: 0, y: 0, z: 0 };

        if (fb.protoId === 'FallingBlock') {
          vel.y -= 18 * subDt;
          fb.vel = vel;
          fb.pos.x += vel.x * subDt;
          fb.pos.y += vel.y * subDt;
          fb.pos.z += vel.z * subDt;

          const gx = Math.floor(fb.pos.x);
          const gz = Math.floor(fb.pos.z);
          const belowY = Math.floor(fb.pos.y - 0.5);
          const belowBlock = this.inBounds(gx, belowY, gz) ? this.getGridBlock(gx, belowY, gz) : null;
          const hitFloor = belowY < 0 || this.isGridBlockCollidable(belowBlock);

          if (hitFloor) {
            let landY = belowY + 1;
            while (landY < this.sizeY && this.getGridBlock(gx, landY, gz) !== null) {
              landY++;
            }
            const idx = this.freeBodies.indexOf(fb);
            if (idx !== -1) this.freeBodies.splice(idx, 1);
            if (this.inBounds(gx, landY, gz)) {
              const payload = fb.payloadProtoId ?? 'Sand';
              this.spawnGrid(payload, gx, landY, gz);
              gridChanged = true;
            }
          }
          continue;
        }

        if (hasStrike) {
          if (ai !== 'seek_target') {
            // Light gravity arc for arrows so aimed shots reliably reach targets across rooms.
            vel.y -= 1.5 * subDt;
            fb.vel = vel;
          }
          if (this.stepProjectileSubstep(fb, subDt, tickLogs, tickFx)) {
            gridChanged = true;
          }
          continue;
        }

        // Standard item / resource bit / corpse settling kinematics.
        if (fb.protoId !== 'StuckArrow') {
          vel.y -= 18 * subDt;
          vel.x *= Math.max(0, 1 - 3 * subDt);
          vel.z *= Math.max(0, 1 - 3 * subDt);
          fb.vel = vel;

          const r = this.getFreeBodyRadius(fb.protoId);
          fb.pos.x = Math.max(0.25, Math.min(this.sizeX - 0.25, fb.pos.x + vel.x * subDt));
          fb.pos.z = Math.max(0.25, Math.min(this.sizeZ - 0.25, fb.pos.z + vel.z * subDt));
          fb.pos.y += vel.y * subDt;

          const gx = Math.floor(fb.pos.x);
          const gz = Math.floor(fb.pos.z);
          const belowY = Math.floor(fb.pos.y - r);
          if (belowY < 0) {
            fb.pos.y = r;
            vel.y = 0;
          } else {
            const support = this.getGridBlock(gx, belowY, gz);
            if (this.isGridBlockCollidable(support)) {
              const topY = belowY + (support!.shape === 'HalfBottom' ? 0.5 : 1.0);
              if (fb.pos.y - r <= topY) {
                fb.pos.y = topY + r;
                vel.y = 0;
              }
            }
          }
        }
      }
    }

    return gridChanged;
  }

  private stepSheepKinematics(sheep: EntityBlock, subDt: number, isGuard = false): void {
    const r = this.getFreeBodyRadius(sheep.protoId);
    let anchorCenter: Coord3;
    let anchorRadius = 3.5;

    if (sheep.homeAnchorUid !== undefined) {
      const anchorEnt = this.findEntityByUid(sheep.homeAnchorUid);
      if (anchorEnt) {
        const anchorSpec = this.engine.getAttr<AnchorSpec | undefined>(
          anchorEnt.protoId,
          'anchor',
          undefined,
        );
        anchorCenter = this.entityCenter(anchorEnt);
        anchorRadius = anchorSpec?.radius ?? 2.4;
      } else {
        sheep.homeAnchorUid = undefined;
        sheep.homePos = { x: sheep.pos.x, y: sheep.pos.y, z: sheep.pos.z };
        anchorCenter = sheep.homePos;
      }
    } else {
      if (!sheep.homePos) {
        sheep.homePos = { x: sheep.pos.x, y: sheep.pos.y, z: sheep.pos.z };
      }
      anchorCenter = sheep.homePos;
    }

    const vel = sheep.vel ?? (isGuard ? { x: 0, y: 0, z: 0.01 } : { x: 0.35, y: 0, z: 0.2 });
    const horizFreeze =
      isGuard &&
      sheep.animTimer !== undefined &&
      sheep.animTimer > 0 &&
      (sheep.animState === 'block' || sheep.animState === 'slash' || sheep.animState === 'salute');

    if (!horizFreeze) {
      const timer = (this.sheepTurnTimer.get(sheep.uid) ?? 0) - subDt;
      if (timer <= 0) {
        const dx = anchorCenter.x - sheep.pos.x;
        const dz = anchorCenter.z - sheep.pos.z;
        const dist = Math.hypot(dx, dz);
        if (isGuard) {
          if (dist <= anchorRadius && this.nextRand() < 0.35) {
            vel.x = 0;
            vel.z = 0;
            sheep.animState = 'idle';
            this.sheepTurnTimer.set(sheep.uid, 1.5 + this.nextRand() * 1.5);
          } else {
            const baseAngle =
              dist > anchorRadius
                ? Math.atan2(dz, dx) + (this.nextRand() - 0.5) * 0.6
                : this.nextRand() * Math.PI * 2;
            const spd = 0.55 + this.nextRand() * 0.3;
            vel.x = Math.cos(baseAngle) * spd;
            vel.z = Math.sin(baseAngle) * spd;
            sheep.animState = 'walk';
            this.sheepTurnTimer.set(sheep.uid, 1.5 + this.nextRand() * 2.0);
          }
        } else {
          if (dist > anchorRadius) {
            const jitter = (this.nextRand() - 0.5) * 0.6;
            const baseAngle = Math.atan2(dz, dx) + jitter;
            const spd = 0.55 + this.nextRand() * 0.35;
            vel.x = Math.cos(baseAngle) * spd;
            vel.z = Math.sin(baseAngle) * spd;
          } else {
            const angle = this.nextRand() * Math.PI * 2;
            const spd = 0.45 + this.nextRand() * 0.35;
            vel.x = Math.cos(angle) * spd;
            vel.z = Math.sin(angle) * spd;
          }
          this.sheepTurnTimer.set(sheep.uid, 1.5 + this.nextRand() * 2.0);
        }
      } else {
        this.sheepTurnTimer.set(sheep.uid, timer);
      }

      let nx = sheep.pos.x + vel.x * subDt;
      let nz = sheep.pos.z + vel.z * subDt;

      if (nx < 0.6 || nx > this.sizeX - 0.6) {
        vel.x = -vel.x;
        nx = Math.max(0.6, Math.min(this.sizeX - 0.6, nx));
      }
      if (nz < 0.6 || nz > this.sizeZ - 0.6) {
        vel.z = -vel.z;
        nz = Math.max(0.6, Math.min(this.sizeZ - 0.6, nz));
      }

      const feetY = sheep.pos.y - r;
      const bodyGridY = Math.floor(feetY + 0.15);
      const frontCell = this.getGridBlock(Math.floor(nx), bodyGridY, Math.floor(nz));
      if (this.isGridBlockCollidable(frontCell)) {
        const stepTopY = bodyGridY + (frontCell!.shape === 'HalfBottom' ? 0.5 : 1.0);
        const headCell = this.getGridBlock(Math.floor(nx), Math.floor(stepTopY + 0.1), Math.floor(nz));
        if (stepTopY - feetY <= 0.55 && !this.isGridBlockCollidable(headCell)) {
          sheep.pos.x = nx;
          sheep.pos.z = nz;
          sheep.pos.y = Math.max(sheep.pos.y, stepTopY + r);
        } else {
          vel.x = -vel.x;
          vel.z = -vel.z;
        }
      } else {
        sheep.pos.x = nx;
        sheep.pos.z = nz;
      }
    }

    vel.y = (vel.y ?? 0) - 18 * subDt;
    sheep.pos.y += vel.y * subDt;

    const gx = Math.floor(sheep.pos.x);
    const gz = Math.floor(sheep.pos.z);
    const belowY = Math.floor(sheep.pos.y - r);
    if (belowY < 0) {
      sheep.pos.y = r;
      vel.y = 0;
    } else {
      const support = this.getGridBlock(gx, belowY, gz);
      if (this.isGridBlockCollidable(support)) {
        const topY = belowY + (support!.shape === 'HalfBottom' ? 0.5 : 1.0);
        if (sheep.pos.y - r <= topY) {
          sheep.pos.y = topY + r;
          vel.y = 0;
        }
      }
    }

    sheep.vel = vel;
  }

  private steerSeeker(seeker: EntityBlock, subDt: number): void {
    const vel = seeker.vel ?? { x: 0, y: 0, z: -8 };
    const speed = Math.max(4, Math.hypot(vel.x, vel.y, vel.z));

    let bestTarget: EntityBlock | null = null;
    let bestDist = 18;
    for (const candidate of this.freeBodies) {
      if (candidate.uid === seeker.uid) continue;
      if (candidate.protoId === 'SummonedWisp' || candidate.protoId === 'HomingOrb_Fire') continue;
      const chain = this.engine.lookupChain(candidate);
      if (!chain.includes('@Mat_Fauna')) continue;
      const d = Math.hypot(
        candidate.pos.x - seeker.pos.x,
        candidate.pos.y - seeker.pos.y,
        candidate.pos.z - seeker.pos.z,
      );
      if (d < bestDist) {
        bestDist = d;
        bestTarget = candidate;
      }
    }

    if (bestTarget) {
      const tx = bestTarget.pos.x - seeker.pos.x;
      const ty = bestTarget.pos.y + 0.15 - seeker.pos.y;
      const tz = bestTarget.pos.z - seeker.pos.z;
      const len = Math.hypot(tx, ty, tz);
      if (len > 1e-4) {
        const turnRate = Math.min(1, 6 * subDt);
        const dx = vel.x / speed;
        const dy = vel.y / speed;
        const dz = vel.z / speed;
        const nx = dx + ((tx / len) - dx) * turnRate;
        const ny = dy + ((ty / len) - dy) * turnRate;
        const nz = dz + ((tz / len) - dz) * turnRate;
        const nLen = Math.hypot(nx, ny, nz) || 1;
        seeker.vel = {
          x: (nx / nLen) * speed,
          y: (ny / nLen) * speed,
          z: (nz / nLen) * speed,
        };
      }
    }
  }

  private stepProjectileSubstep(
    proj: EntityBlock,
    subDt: number,
    tickLogs: InteractionLogEntry[],
    tickFx: FxBurst[],
  ): boolean {
    let gridChanged = false;
    const isWisp = proj.protoId === 'SummonedWisp';

    if (isWisp) {
      const cd = Math.max(0, (this.wispCooldown.get(proj.uid) ?? 0) - subDt);
      this.wispCooldown.set(proj.uid, cd);
    }

    const vel = proj.vel ?? { x: 0, y: 0, z: 0 };
    const stepX = vel.x * subDt;
    const stepY = vel.y * subDt;
    const stepZ = vel.z * subDt;
    const moveDist = Math.hypot(stepX, stepY, stepZ);

    if (moveDist < 1e-6) return false;
    const dir = { x: stepX / moveDist, y: stepY / moveDist, z: stepZ / moveDist };

    // 1. Check collision against target FreeBody entities along path.
    for (const other of [...this.freeBodies]) {
      if (other.uid === proj.uid || !this.freeBodies.includes(other)) continue;
      if (!this.isEntityInteractable(other)) continue;
      if (other.protoId === 'StuckArrow') continue;
      const chain = this.engine.lookupChain(other);
      if (chain.includes('@Mat_Item') || chain.includes('@Mat_Projectile')) continue;
      if (isWisp && other.protoId === 'SummonedWisp') continue;

      const hitRadius = this.getFreeBodyRadius(other.protoId) + 0.25;
      const targetY =
        other.protoId === 'IronKnight'
          ? Math.max(other.pos.y - 0.3, Math.min(other.pos.y + 1.25, proj.pos.y + stepY * 0.5))
          : other.pos.y;
      const distToOther = Math.hypot(
        other.pos.x - (proj.pos.x + stepX * 0.5),
        targetY - (proj.pos.y + stepY * 0.5),
        other.pos.z - (proj.pos.z + stepZ * 0.5),
      );
      if (distToOther <= hitRadius) {
        if (isWisp && (this.wispCooldown.get(proj.uid) ?? 0) > 0) continue;
        const envAtmo = this.getCellAtmo(other.pos.x, other.pos.y, other.pos.z);
        const [attOut, tgtOut] = this.engine.collide(proj, other, envAtmo);
        const visited = new Set<number>();
        const r1 = this.applyOutcomeToWorld(other, tgtOut, proj.protoId, visited, tickLogs, tickFx);
        const r2 = this.applyOutcomeToWorld(
          proj,
          attOut,
          `${other.protoId}(Recoil)`,
          visited,
          tickLogs,
          tickFx,
        );
        if (r1.gridChanged || r2.gridChanged) gridChanged = true;
        if (isWisp) {
          this.wispCooldown.set(proj.uid, 0.5);
        }
        if (attOut.status === 'deathrattle' || !this.freeBodies.includes(proj)) {
          return gridChanged;
        }
      }
    }

    // 2. Sweep against collidable grid blocks (open doors, fluids, mist, saplings pass freely).
    let remaining = moveDist;
    let guard = 0;
    while (remaining > 1e-5 && guard++ < 4) {
      const gridHit = this.raycastGrid(proj.pos, dir, remaining, 'collide');
      if (!gridHit) {
        proj.pos.x += dir.x * remaining;
        proj.pos.y += dir.y * remaining;
        proj.pos.z += dir.z * remaining;
        break;
      }

      const block = gridHit.entity;
      const envAtmo = this.getCellAtmo(block.pos.x, block.pos.y, block.pos.z);
      const [attOut, tgtOut] = this.engine.collide(proj, block, envAtmo);
      const visited = new Set<number>();
      const r1 = this.applyOutcomeToWorld(block, tgtOut, proj.protoId, visited, tickLogs, tickFx);

      // Position projectile right at impact before applying its deathrattle (e.g. StuckArrow / AOE).
      proj.pos = {
        x: gridHit.pos.x - dir.x * 0.12,
        y: gridHit.pos.y - dir.y * 0.12,
        z: gridHit.pos.z - dir.z * 0.12,
      };

      const r2 = this.applyOutcomeToWorld(
        proj,
        attOut,
        `${block.protoId}(Recoil)`,
        visited,
        tickLogs,
        tickFx,
      );
      if (r1.gridChanged || r2.gridChanged) gridChanged = true;

      // HomingOrb_Fire detonates even on GridStatic blocks without recoil (e.g. Ice / Sapling).
      if (
        proj.protoId === 'HomingOrb_Fire' &&
        attOut.status !== 'deathrattle' &&
        block.form === 'GridStatic' &&
        this.freeBodies.includes(proj)
      ) {
        const forceImpact = this.engine.applyPulse(
          proj,
          this.engine.simplePulse(10, 'Mech_Impact'),
          envAtmo,
        );
        const r3 = this.applyOutcomeToWorld(
          proj,
          forceImpact,
          `${block.protoId}(Impact)`,
          visited,
          tickLogs,
          tickFx,
        );
        if (r3.gridChanged) gridChanged = true;
      }

      if (attOut.status === 'deathrattle' || !this.freeBodies.includes(proj)) {
        return gridChanged;
      }

      if (tgtOut.status === 'deathrattle') {
        // Target shattered (e.g. Arrow_Wood broke Glass) and projectile survived -> keep flying!
        const advance = Math.max(0.02, gridHit.distance + 0.02);
        proj.pos.x = gridHit.pos.x + dir.x * 0.02;
        proj.pos.y = gridHit.pos.y + dir.y * 0.02;
        proj.pos.z = gridHit.pos.z + dir.z * 0.02;
        remaining = Math.max(0, remaining - advance);
      } else {
        // Bounced / halted against intact solid block.
        if (isWisp) {
          proj.vel = { x: -vel.x * 0.7, y: Math.abs(vel.y) + 1.0, z: -vel.z * 0.7 };
        } else {
          proj.vel = { x: 0, y: 0, z: 0 };
        }
        break;
      }
    }

    // Despawn projectiles that fly far out of world bounds.
    if (
      proj.pos.x < -4 ||
      proj.pos.x > this.sizeX + 4 ||
      proj.pos.y < -4 ||
      proj.pos.y > this.sizeY + 12 ||
      proj.pos.z < -4 ||
      proj.pos.z > this.sizeZ + 4
    ) {
      const idx = this.freeBodies.indexOf(proj);
      if (idx !== -1) this.freeBodies.splice(idx, 1);
    }

    return gridChanged;
  }

  private findAnchorSpawnSpot(anchorEnt: EntityBlock, entityProtoId: string): Coord3 {
    const center = this.entityCenter(anchorEnt);
    const r = this.getFreeBodyRadius(entityProtoId);
    const ax = Math.floor(center.x);
    const az = Math.floor(center.z);
    const baseY = Math.floor(center.y);

    const candidates: Array<[number, number]> = [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    for (const [dx, dz] of candidates) {
      const gx = ax + dx;
      const gz = az + dz;
      if (!this.inBounds(gx, baseY, gz)) continue;
      for (let dy = 1; dy >= -1; dy--) {
        const cy = baseY + dy;
        const below = cy - 1;
        if (cy < 1 || cy >= this.sizeY - 1) continue;
        const floor = this.getGridBlock(gx, below, gz);
        const bodyCell = this.getGridBlock(gx, cy, gz);
        if (this.isGridBlockCollidable(floor) && !this.isGridBlockCollidable(bodyCell)) {
          const topY = below + (floor!.shape === 'HalfBottom' ? 0.5 : 1.0);
          return { x: gx + 0.5, y: topY + r, z: gz + 0.5 };
        }
      }
    }
    return { x: center.x, y: center.y + 0.8 + r, z: center.z };
  }

  private runPulseTick(tickLogs: InteractionLogEntry[], tickFx: FxBurst[]): boolean {
    this._tickCount++;
    let gridChanged = false;

    // Single bottom-up pass over the 24x14x24 grid collecting candidates for all tick stages.
    const gravityCandidates: Array<{ block: EntityBlock; x: number; y: number; z: number }> = [];
    const atmoSources: Array<{
      block?: EntityBlock;
      fb?: EntityBlock;
      gx?: number;
      gy?: number;
      gz?: number;
      x: number;
      y: number;
      z: number;
      emits: string;
    }> = [];
    const emitCells: Array<{ block: EntityBlock; x: number; y: number; z: number; spec: PulseSpec }> = [];
    const selfPulseGrid: Array<{ block: EntityBlock; x: number; y: number; z: number; spec: PulseSpec }> = [];
    const gridAnchors: Array<{ entity: EntityBlock; gx: number; gy: number; gz: number; spec: AnchorSpec }> = [];

    const planeStride = this.sizeX * this.sizeZ;
    for (let y = 0; y < this.sizeY; y++) {
      const yOffset = y * planeStride;
      for (let z = 0; z < this.sizeZ; z++) {
        const rowOffset = yOffset + z * this.sizeX;
        for (let x = 0; x < this.sizeX; x++) {
          const idx = rowOffset + x;
          const block = this.grid[idx];
          if (!block) continue;

          // Check O(1) null support BEFORE cached @Mix_GravityFragile lookup.
          if (y >= 1 && this.grid[idx - planeStride] === null && this.isGravityFragile(block)) {
            gravityCandidates.push({ block, x, y, z });
          }

          const meta = this.getProtoTickMeta(block.protoId);
          if (meta.emitsAtmo) {
            atmoSources.push({
              block,
              gx: x,
              gy: y,
              gz: z,
              x: x + 0.5,
              y: y + 0.5,
              z: z + 0.5,
              emits: meta.emitsAtmo,
            });
          }
          if (meta.emitsPulse) {
            emitCells.push({ block, x, y, z, spec: meta.emitsPulse });
          }
          if (meta.selfPulse) {
            selfPulseGrid.push({ block, x, y, z, spec: meta.selfPulse });
          }
          if (meta.activeAnchor) {
            gridAnchors.push({ entity: block, gx: x, gy: y, gz: z, spec: meta.activeAnchor });
          }
        }
      }
    }

    // 1. GravityFragile shear (cascading bottom-up so unsupported Sand stacks collapse cleanly in 1 tick).
    if (gravityCandidates.length > 0) {
      const shearPulse = this.engine.simplePulse(100, 'Mech_Shear');
      for (let i = 0; i < gravityCandidates.length; i++) {
        const gc = gravityCandidates[i];
        if (this.getGridBlock(gc.x, gc.y, gc.z)?.uid !== gc.block.uid) continue;
        if (this.getGridBlock(gc.x, gc.y - 1, gc.z) !== null) continue;

        const out = this.engine.applyPulse(gc.block, shearPulse, this.getCellAtmo(gc.x, gc.y, gc.z));
        if (out.status !== 'immune') {
          const res = this.applyOutcomeToWorld(
            gc.block,
            out,
            'GravityShear',
            new Set(),
            tickLogs,
            tickFx,
          );
          if (res.gridChanged) gridChanged = true;

          if (this.getGridBlock(gc.x, gc.y, gc.z) === null && gc.y + 1 < this.sizeY) {
            const above = this.getGridBlock(gc.x, gc.y + 1, gc.z);
            if (above && this.isGravityFragile(above)) {
              gravityCandidates.push({ block: above, x: gc.x, y: gc.y + 1, z: gc.z });
            }
          }
        }
      }
    }

    // 2. Live Atmosphere neighbor aura (generic over all blocks & freeBodies with emits_atmo).
    for (const fb of this.freeBodies) {
      const emits = this.getProtoTickMeta(fb.protoId).emitsAtmo;
      if (emits) {
        atmoSources.push({ fb, x: fb.pos.x, y: fb.pos.y, z: fb.pos.z, emits });
      }
    }
    for (const src of atmoSources) {
      if (src.block && this.getGridBlock(src.gx!, src.gy!, src.gz!)?.uid !== src.block.uid) continue;
      if (src.fb && !this.freeBodies.includes(src.fb)) continue;

      const atmoPulse = this.engine.simplePulse(10, src.emits);
      const sx = Math.floor(src.x);
      const sy = Math.floor(src.y);
      const sz = Math.floor(src.z);
      const targets: EntityBlock[] = [];
      const selfBlock = this.getGridBlock(sx, sy, sz);
      if (selfBlock) targets.push(selfBlock);
      for (const d of ORTHO_DIRS) {
        const nb = this.getGridBlock(sx + d.x, sy + d.y, sz + d.z);
        if (nb) targets.push(nb);
      }
      for (const nb of targets) {
        const envAtmo = this.getCellAtmo(nb.pos.x, nb.pos.y, nb.pos.z);
        const out = this.engine.applyPulse(nb, atmoPulse, envAtmo);
        if (out.status !== 'immune') {
          const res = this.applyOutcomeToWorld(
            nb,
            out,
            `Atmo(${src.emits})`,
            new Set(),
            tickLogs,
            tickFx,
            true,
          );
          if (res.gridChanged) gridChanged = true;
        }
      }
      for (const fb of [...this.freeBodies]) {
        if (!this.freeBodies.includes(fb)) continue;
        const dist = Math.hypot(fb.pos.x - src.x, fb.pos.y - src.y, fb.pos.z - src.z);
        if (dist <= 1.25) {
          const out = this.engine.applyPulse(fb, atmoPulse, this.getCellAtmo(fb.pos.x, fb.pos.y, fb.pos.z));
          if (out.status !== 'immune') {
            const res = this.applyOutcomeToWorld(
              fb,
              out,
              `Atmo(${src.emits})`,
              new Set(),
              tickLogs,
              tickFx,
              true,
            );
            if (res.gridChanged) gridChanged = true;
          }
        }
      }
    }

    // 3. Generic neighbor emits_pulse (e.g. Fire heat) without log flood on non-lethal ticks.
    for (const ec of emitCells) {
      if (this.getGridBlock(ec.x, ec.y, ec.z)?.uid !== ec.block.uid) continue;
      const emittedPulse = this.engine.parseSpecPulse(ec.spec);
      for (const d of ORTHO_DIRS) {
        const nx = ec.x + d.x;
        const ny = ec.y + d.y;
        const nz = ec.z + d.z;
        const nb = this.getGridBlock(nx, ny, nz);
        if (!nb) continue;
        const out = this.engine.applyPulse(nb, emittedPulse, this.getCellAtmo(nx, ny, nz));
        if (out.status !== 'immune') {
          const res = this.applyOutcomeToWorld(
            nb,
            out,
            `${ec.block.protoId}(Pulse)`,
            new Set(),
            tickLogs,
            tickFx,
            true,
          );
          if (res.gridChanged) gridChanged = true;
        }
      }

      for (const fb of [...this.freeBodies]) {
        if (!this.freeBodies.includes(fb)) continue;
        const dist = Math.hypot(
          fb.pos.x - (ec.x + 0.5),
          fb.pos.y - (ec.y + 0.5),
          fb.pos.z - (ec.z + 0.5),
        );
        if (dist <= 1.25) {
          const out = this.engine.applyPulse(
            fb,
            emittedPulse,
            this.getCellAtmo(fb.pos.x, fb.pos.y, fb.pos.z),
          );
          if (out.status !== 'immune') {
            const res = this.applyOutcomeToWorld(
              fb,
              out,
              `${ec.block.protoId}(Pulse)`,
              new Set(),
              tickLogs,
              tickFx,
              true,
            );
            if (res.gridChanged) gridChanged = true;
          }
        }
      }
    }

    // 4. Unified formal self_pulse lifetime decay (Fire burnout, ExplosionShock fade, SummonedWisp expiry).
    for (const item of selfPulseGrid) {
      if (this.getGridBlock(item.x, item.y, item.z)?.uid !== item.block.uid) continue;
      const selfPulse = this.engine.parseSpecPulse(item.spec);
      const out = this.engine.applyPulse(item.block, selfPulse, this.getCellAtmo(item.x, item.y, item.z));
      if (out.status !== 'immune') {
        const res = this.applyOutcomeToWorld(
          item.block,
          out,
          'SelfPulse',
          new Set(),
          tickLogs,
          tickFx,
          true,
        );
        if (res.gridChanged) gridChanged = true;
      }
    }
    for (const fb of [...this.freeBodies]) {
      if (!this.freeBodies.includes(fb)) continue;
      const selfSpec = this.getProtoTickMeta(fb.protoId).selfPulse;
      if (!selfSpec) continue;
      const selfPulse = this.engine.parseSpecPulse(selfSpec);
      const out = this.engine.applyPulse(fb, selfPulse, this.getCellAtmo(fb.pos.x, fb.pos.y, fb.pos.z));
      if (out.status !== 'immune') {
        const res = this.applyOutcomeToWorld(
          fb,
          out,
          'SelfPulse',
          new Set(),
          tickLogs,
          tickFx,
          true,
        );
        if (res.gridChanged) gridChanged = true;
      }
    }

    // 5. Concrete entity-bound anchor respawn (e.g. PastureStele respawning Sheep_Live).
    const activeAnchors: Array<{ entity: EntityBlock; spec: AnchorSpec }> = [];
    for (const a of gridAnchors) {
      if (this.getGridBlock(a.gx, a.gy, a.gz)?.uid === a.entity.uid) {
        activeAnchors.push({ entity: a.entity, spec: a.spec });
      }
    }
    for (const fb of this.freeBodies) {
      const spec = this.getProtoTickMeta(fb.protoId).activeAnchor;
      if (spec) {
        activeAnchors.push({ entity: fb, spec });
      }
    }

    const activeAnchorUids = new Set(activeAnchors.map((a) => a.entity.uid));
    for (const uid of this.anchorRespawnTimer.keys()) {
      if (!activeAnchorUids.has(uid)) {
        this.anchorRespawnTimer.delete(uid);
      }
    }

    for (const { entity: anchorEnt, spec } of activeAnchors) {
      const respawnSec = spec.respawn_sec ?? 0;
      const maxCount = spec.max_count ?? 1;
      const occupants = this.countBoundOccupants(anchorEnt.uid, spec.binds);
      if (occupants >= maxCount) {
        this.anchorRespawnTimer.set(anchorEnt.uid, respawnSec);
        continue;
      }
      const nextRemaining = (this.anchorRespawnTimer.get(anchorEnt.uid) ?? respawnSec) - PULSE_TICK_INTERVAL;
      if (nextRemaining > 0) {
        this.anchorRespawnTimer.set(anchorEnt.uid, nextRemaining);
        continue;
      }
      const spawnProto = spec.binds[0];
      const spawnPos = this.findAnchorSpawnSpot(anchorEnt, spawnProto);
      const spawned = this.engine.spawn(spawnProto, spawnPos, 0);
      if (spawnProto === 'IronKnight') {
        spawned.vel = { x: 0, y: 0, z: 0.01 };
        spawned.animState = 'idle';
      } else {
        spawned.vel = { x: 0.35, y: 0, z: 0.25 };
      }
      spawned.homeAnchorUid = anchorEnt.uid;
      spawned.homePos = this.entityCenter(anchorEnt);
      this.freeBodies.push(spawned);
      this.sheepTurnTimer.set(spawned.uid, 1.5);
      this.anchorRespawnTimer.set(anchorEnt.uid, respawnSec);
      this.pushFx(spawnPos, 0x38bdf8, 'craft', tickFx);
      this.pushSystemLog(
        `${anchorEnt.protoId}(复活)`,
        spawnProto,
        'crafted',
        `锚点 #${anchorEnt.uid} 重生`,
        this.getCellAtmo(spawnPos.x, spawnPos.y, spawnPos.z),
        tickLogs,
      );
    }

    return gridChanged;
  }

  stepTick(dt: number): WorldTickEvents {
    const clampedDt = Math.max(0, Math.min(dt, 0.5));
    const tickLogs: InteractionLogEntry[] = [];
    const tickFx: FxBurst[] = [];
    let gridChanged = false;

    if (this.stepKinematics(clampedDt, tickLogs, tickFx)) {
      gridChanged = true;
    }

    this.tickAccum += clampedDt;
    while (this.tickAccum >= PULSE_TICK_INTERVAL) {
      this.tickAccum -= PULSE_TICK_INTERVAL;
      if (this.runPulseTick(tickLogs, tickFx)) {
        gridChanged = true;
      }
    }

    return {
      tick: this._tickCount,
      gridChanged,
      logs: tickLogs,
      fxBursts: tickFx,
    };
  }

  getRecentLogs(limit = 20): readonly InteractionLogEntry[] {
    if (limit <= 0) return [];
    return this.logs.slice(-limit);
  }

  getPendingFx(): FxBurst[] {
    const out = this.pendingFx;
    this.pendingFx = [];
    return out;
  }
}
