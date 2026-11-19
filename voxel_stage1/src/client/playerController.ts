import * as THREE from 'three';
import type { Coord3, EntityBlock, IVoxelWorld, RayHit } from '../core/contracts.ts';
import {
  createDefaultBlockSlots,
  createDefaultToolSlots,
  loadLoadout,
  mapResourceToBlockProto,
  saveLoadout,
  type ToolDefinition,
} from './tools.ts';

export type ScrollTargetBar = 'tool' | 'block';

export interface PlayerControllerCallbacks {
  onToolChanged?: (slotIndex: number) => void;
  onBlockSlotChanged?: (slot: number) => void;
  onScrollTargetChanged?: (target: ScrollTargetBar) => void;
  onLoadoutChanged?: () => void;
  onToggleInventory?: () => void;
}

const PLAYER_RADIUS = 0.28;
const PLAYER_HEIGHT = 1.72;
const EYE_HEIGHT = 1.52;
const MOVE_SPEED = 5.4;
const JUMP_SPEED = 6.8;
const GRAVITY = 19.0;
const KEY_LOOK_SPEED = 2.0;
const MOUSE_SENSITIVITY = 0.0022;
const PRIMARY_REPEAT_INTERVAL = 0.24;
const RAYCAST_RANGE = 12.0;
const PICKUP_AREA_RADIUS = 4.5;
const PICKUP_AIM_CLUSTER_RADIUS = 2.5;
const EPS = 1e-4;

export class PlayerController {
  private readonly domElement: HTMLElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly callbacks: PlayerControllerCallbacks;
  private world: IVoxelWorld;

  private readonly keys = new Set<string>();
  private readonly mouseButtons = new Set<number>();
  private readonly pos = new THREE.Vector3(8.5, 4.0, 12.5);
  private readonly vel = new THREE.Vector3(0, 0, 0);
  private readonly lookDirVec = new THREE.Vector3();
  private readonly rayUnprojectVec = new THREE.Vector3();

  private toolSlots: ToolDefinition[];
  private blockSlots: string[];
  public activeToolIndex = 0;
  public activeBlockSlot = 1;
  public scrollTarget: ScrollTargetBar = 'block';
  public paused = false;

  public yaw = 0;
  public pitch = -0.15;
  private onGround = false;
  private currentHit: RayHit | null = null;

  // Free-cursor raycast NDC (-1..1), stays frozen on last canvas hover when moving onto HUD buttons
  private cursorNdcX = 0;
  private cursorNdcY = 0;
  private primaryHoldTimer = 0;

  // Right-button orbit drag tracking
  private rightDragging = false;
  private rightDragMoved = false;
  private rightStartX = 0;
  private rightStartY = 0;
  private lastMouseX = 0;
  private lastMouseY = 0;

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onKeyUpBound: (e: KeyboardEvent) => void;
  private readonly onMouseDownBound: (e: MouseEvent) => void;
  private readonly onMouseMoveBound: (e: MouseEvent) => void;
  private readonly onMouseUpBound: (e: MouseEvent) => void;
  private readonly onWheelBound: (e: WheelEvent) => void;
  private readonly onAuxClickBound: (e: MouseEvent) => void;
  private readonly onContextMenuBound: (e: MouseEvent) => void;
  private readonly onPointerLockChangeBound: () => void;
  private readonly onBlurBound: () => void;

  constructor(
    domElement: HTMLElement,
    camera: THREE.PerspectiveCamera,
    world: IVoxelWorld,
    callbacks: PlayerControllerCallbacks = {},
  ) {
    this.domElement = domElement;
    this.camera = camera;
    this.world = world;
    this.callbacks = callbacks;

    const loaded = loadLoadout();
    this.toolSlots = loaded.tools;
    this.blockSlots = loaded.blockSlots;

    this.onKeyDownBound = (e) => this.handleKeyDown(e);
    this.onKeyUpBound = (e) => this.handleKeyUp(e);
    this.onMouseDownBound = (e) => this.handleMouseDown(e);
    this.onMouseMoveBound = (e) => this.handleMouseMove(e);
    this.onMouseUpBound = (e) => this.handleMouseUp(e);
    this.onWheelBound = (e) => this.handleWheel(e);
    this.onAuxClickBound = (e) => {
      if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
    };
    this.onContextMenuBound = (e) => e.preventDefault();
    this.onPointerLockChangeBound = () => {
      this.mouseButtons.clear();
      this.rightDragging = false;
      if (this.isPointerLocked) {
        this.cursorNdcX = 0;
        this.cursorNdcY = 0;
      }
    };
    this.onBlurBound = () => {
      this.keys.clear();
      this.mouseButtons.clear();
      this.rightDragging = false;
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('mouseup', this.onMouseUpBound);
    document.addEventListener('pointerlockchange', this.onPointerLockChangeBound);
    this.domElement.addEventListener('mousedown', this.onMouseDownBound);
    this.domElement.addEventListener('wheel', this.onWheelBound, { passive: false });
    this.domElement.addEventListener('auxclick', this.onAuxClickBound);
    this.domElement.addEventListener('contextmenu', this.onContextMenuBound);

    this.resetPosition(world);
    this.syncCamera();
  }

  public get placeProtoId(): string {
    return this.blockSlots[this.activeBlockSlot - 1] ?? 'Sand';
  }

  public get isPointerLocked(): boolean {
    return document.pointerLockElement === this.domElement;
  }

  public getToolSlots(): readonly ToolDefinition[] {
    return this.toolSlots;
  }

  public getBlockSlots(): readonly string[] {
    return this.blockSlots;
  }

  public getActiveTool(): ToolDefinition {
    return this.toolSlots[this.activeToolIndex] ?? this.toolSlots[0];
  }

  public getFeetPos(): Coord3 {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }

  public getEyePos(): Coord3 {
    return { x: this.pos.x, y: this.pos.y + EYE_HEIGHT, z: this.pos.z };
  }

  public getCurrentHit(): RayHit | null {
    return this.currentHit;
  }

  public setWorld(world: IVoxelWorld): void {
    this.world = world;
    this.resetPosition(world);
    this.syncCamera();
  }

  public resetPosition(world: IVoxelWorld = this.world): void {
    const cx = Math.floor(world.sizeX / 2);
    const cz = Math.floor(world.sizeZ / 2);

    const candidates: Array<[number, number]> = [
      [cx, Math.min(world.sizeZ - 2, cz + 5)],
      [cx, Math.max(1, cz - 5)],
      [Math.max(1, cx - 5), cz],
      [Math.min(world.sizeX - 2, cx + 5), cz],
    ];

    for (let r = 1; r <= 6; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const gx = cx + dx;
          const gz = cz + dz;
          if (gx >= 1 && gx < world.sizeX - 1 && gz >= 1 && gz < world.sizeZ - 1) {
            candidates.push([gx, gz]);
          }
        }
      }
    }

    let spawnX = cx + 0.5;
    let spawnY = Math.max(2, world.sizeY - 4);
    let spawnZ = Math.min(world.sizeZ - 1.5, cz + 5.5);

    for (const [gx, gz] of candidates) {
      const groundTop = this.findSafeGroundTop(world, gx, gz);
      if (groundTop !== null) {
        spawnX = gx + 0.5;
        spawnY = groundTop;
        spawnZ = gz + 0.5;
        break;
      }
    }

    this.pos.set(spawnX, spawnY, spawnZ);
    this.vel.set(0, 0, 0);
    this.onGround = true;

    // Aim toward world center showcase
    const targetX = world.sizeX * 0.5;
    const targetY = spawnY + 1.0;
    const targetZ = world.sizeZ * 0.5;
    const dx = targetX - spawnX;
    const dy = targetY - (spawnY + EYE_HEIGHT);
    const dz = targetZ - spawnZ;
    const horiz = Math.hypot(dx, dz);

    if (horiz > 0.25) {
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = THREE.MathUtils.clamp(Math.atan2(dy, horiz), -1.1, 1.1);
    } else {
      this.yaw = 0;
      this.pitch = -0.15;
    }
  }

  private findSafeGroundTop(world: IVoxelWorld, gx: number, gz: number): number | null {
    for (let y = world.sizeY - 3; y >= 0; y--) {
      const floor = world.getGridBlock(gx, y, gz);
      if (!floor || !this.isSolidForPlayer(floor)) continue;

      const above1 = world.getGridBlock(gx, y + 1, gz);
      const above2 = world.getGridBlock(gx, y + 2, gz);
      const clear1 = !above1 || (!this.isSolidForPlayer(above1) && above1.protoId !== 'Water' && above1.protoId !== 'Fire');
      const clear2 = !above2 || (!this.isSolidForPlayer(above2) && above2.protoId !== 'Water' && above2.protoId !== 'Fire');
      if (clear1 && clear2) {
        return y + this.getBlockHeight(floor);
      }
    }
    return null;
  }

  public selectBlockSlot(slot: number): void {
    const clamped = Math.max(1, Math.min(this.blockSlots.length, Math.floor(slot)));
    if (this.activeBlockSlot !== clamped) {
      this.activeBlockSlot = clamped;
      this.callbacks.onBlockSlotChanged?.(clamped);
    }
  }

  public selectToolSlot(idx: number): void {
    const count = this.toolSlots.length;
    const clamped = ((Math.floor(idx) % count) + count) % count;
    if (this.activeToolIndex !== clamped) {
      this.activeToolIndex = clamped;
      this.callbacks.onToolChanged?.(clamped);
    }
  }

  public cycleToolSlot(dir = 1): void {
    this.selectToolSlot(this.activeToolIndex + dir);
  }

  public setToolSlotDefinition(idx: number, tool: ToolDefinition): void {
    if (idx < 0 || idx >= this.toolSlots.length) return;
    this.toolSlots[idx] = tool;
    saveLoadout(this.toolSlots, this.blockSlots);
    this.callbacks.onLoadoutChanged?.();
  }

  public setBlockSlotDefinition(idx: number, protoId: string): void {
    if (idx < 0 || idx >= this.blockSlots.length) return;
    this.blockSlots[idx] = protoId;
    saveLoadout(this.toolSlots, this.blockSlots);
    this.callbacks.onLoadoutChanged?.();
  }

  public resetSlotDefinitions(): void {
    this.toolSlots = createDefaultToolSlots();
    this.blockSlots = createDefaultBlockSlots();
    saveLoadout(this.toolSlots, this.blockSlots);
    this.callbacks.onLoadoutChanged?.();
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.mouseButtons.clear();
      this.rightDragging = false;
      if (this.isPointerLocked) {
        document.exitPointerLock?.();
      }
    }
  }

  public togglePointerLock(): void {
    if (this.paused) return;
    if (this.isPointerLocked) {
      document.exitPointerLock?.();
      return;
    }
    try {
      const maybePromise = this.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    } catch {
      // Ignore if pointer lock is blocked in embedded contexts
    }
  }

  public toggleScrollTarget(): ScrollTargetBar {
    this.scrollTarget = this.scrollTarget === 'block' ? 'tool' : 'block';
    this.callbacks.onScrollTargetChanged?.(this.scrollTarget);
    return this.scrollTarget;
  }

  public setScrollTarget(target: ScrollTargetBar): void {
    if (this.scrollTarget !== target) {
      this.scrollTarget = target;
      this.callbacks.onScrollTargetChanged?.(target);
    }
  }

  public absorbBlockProto(protoId: string): void {
    const existingIdx = this.blockSlots.indexOf(protoId);
    if (existingIdx !== -1) {
      this.selectBlockSlot(existingIdx + 1);
      return;
    }
    this.setBlockSlotDefinition(this.activeBlockSlot - 1, protoId);
  }

  private isCollectibleDrop(fb: EntityBlock): boolean {
    if (!this.world.engine.getAttr<boolean>(fb.protoId, 'interactable', true)) {
      return false;
    }
    if (mapResourceToBlockProto(fb.protoId) !== null) {
      return true;
    }
    const chain = this.world.engine.lookupChain(fb);
    return chain.includes('@Mat_Item') || chain.includes('@Mat_ResourceBit');
  }

  /** E key: one-key small-area resource vacuum around player & aimed cluster, or copy aimed block. */
  public pickupTargetedOrNearby(): boolean {
    const hit = this.performRaycast();
    this.currentHit = hit;

    const bodyCenter: Coord3 = {
      x: this.pos.x,
      y: this.pos.y + 0.85,
      z: this.pos.z,
    };

    const candidates: Array<{
      fb: EntityBlock;
      isDirectHit: boolean;
      distToBody: number;
    }> = [];

    for (const fb of this.world.getFreeBodies()) {
      if (!this.isCollectibleDrop(fb)) continue;

      const isDirectHit = hit !== null && hit.kind === 'free' && hit.entity.uid === fb.uid;
      const distToBody = Math.hypot(
        fb.pos.x - bodyCenter.x,
        fb.pos.y - bodyCenter.y,
        fb.pos.z - bodyCenter.z,
      );
      const distToHitPos = hit
        ? Math.hypot(fb.pos.x - hit.pos.x, fb.pos.y - hit.pos.y, fb.pos.z - hit.pos.z)
        : Infinity;

      if (
        isDirectHit ||
        distToBody <= PICKUP_AREA_RADIUS ||
        distToHitPos <= PICKUP_AIM_CLUSTER_RADIUS
      ) {
        candidates.push({ fb, isDirectHit, distToBody });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (a.isDirectHit !== b.isDirectHit) return a.isDirectHit ? -1 : 1;
        return a.distToBody - b.distToBody;
      });

      this.world.consumeFreeBodies(candidates.map((c) => c.fb.uid));
      for (const { fb } of candidates) {
        const mapped = mapResourceToBlockProto(fb.protoId);
        if (mapped) {
          this.absorbBlockProto(mapped);
          break;
        }
      }
      return true;
    }

    if (hit && hit.kind === 'grid') {
      this.absorbBlockProto(hit.entity.protoId);
      return true;
    }
    return false;
  }

  public update(dt: number): RayHit | null {
    const safeDt = Math.min(0.05, Math.max(0.001, dt));

    if (this.paused) {
      this.syncCamera();
      return this.currentHit;
    }

    // Hold-left-click repeat tool activation
    if (this.mouseButtons.has(0)) {
      this.primaryHoldTimer -= safeDt;
      if (this.primaryHoldTimer <= 0) {
        this.primaryHoldTimer = PRIMARY_REPEAT_INTERVAL;
        this.triggerPrimary();
      }
    }

    // Keyboard look fallback (no pointer lock required)
    if (this.keys.has('ArrowLeft')) this.yaw += KEY_LOOK_SPEED * safeDt;
    if (this.keys.has('ArrowRight')) this.yaw -= KEY_LOOK_SPEED * safeDt;
    if (this.keys.has('ArrowUp')) this.pitch += KEY_LOOK_SPEED * 0.8 * safeDt;
    if (this.keys.has('ArrowDown')) this.pitch -= KEY_LOOK_SPEED * 0.8 * safeDt;
    this.clampPitch();

    // Movement on XZ plane (WASD + Space)
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let moveForward = 0;
    let moveRight = 0;
    if (this.keys.has('KeyW')) moveForward += 1;
    if (this.keys.has('KeyS')) moveForward -= 1;
    if (this.keys.has('KeyD')) moveRight += 1;
    if (this.keys.has('KeyA')) moveRight -= 1;

    let wishX = forwardX * moveForward + rightX * moveRight;
    let wishZ = forwardZ * moveForward + rightZ * moveRight;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0) {
      wishX = (wishX / wishLen) * MOVE_SPEED;
      wishZ = (wishZ / wishLen) * MOVE_SPEED;
    }

    if (this.keys.has('Space') && this.onGround) {
      this.vel.y = JUMP_SPEED;
      this.onGround = false;
    }

    this.vel.y -= GRAVITY * safeDt;

    // Axis-separated AABB collision with wall sliding
    this.moveAxisX(wishX * safeDt);
    this.moveAxisZ(wishZ * safeDt);
    this.moveAxisY(this.vel.y * safeDt);

    // Clamp to world boundaries
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, PLAYER_RADIUS + 0.05, this.world.sizeX - PLAYER_RADIUS - 0.05);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, PLAYER_RADIUS + 0.05, this.world.sizeZ - PLAYER_RADIUS - 0.05);
    if (this.pos.y < 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }

    this.syncCamera();
    this.currentHit = this.performRaycast();
    return this.currentHit;
  }

  private getAimDirection(): Coord3 {
    if (this.isPointerLocked) {
      this.camera.getWorldDirection(this.lookDirVec);
      return { x: this.lookDirVec.x, y: this.lookDirVec.y, z: this.lookDirVec.z };
    }
    this.camera.updateMatrixWorld();
    this.rayUnprojectVec
      .set(this.cursorNdcX, this.cursorNdcY, 0.5)
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize();
    return { x: this.rayUnprojectVec.x, y: this.rayUnprojectVec.y, z: this.rayUnprojectVec.z };
  }

  public triggerPrimary(): void {
    const dir = this.getAimDirection();
    const hit = this.performRaycast();
    this.currentHit = hit;

    // Auto-absorb loose resource items/bits when left-clicked directly
    if (hit && hit.kind === 'free') {
      const mapped = mapResourceToBlockProto(hit.entity.protoId);
      if (mapped) {
        this.world.consumeFreeBody(hit.entity.uid);
        this.absorbBlockProto(mapped);
        return;
      }
    }

    const tool = this.getActiveTool();

    if (tool.kind === 'projectile') {
      const origin = this.getEyePos();
      const spawnOrigin: Coord3 = {
        x: origin.x + dir.x * 0.65,
        y: origin.y + dir.y * 0.65,
        z: origin.z + dir.z * 0.65,
      };
      this.world.shootProjectile(tool.protoId ?? 'Arrow_Wood', spawnOrigin, dir, 18);
      return;
    }

    if (hit && tool.buildPulse) {
      const beforeUids = new Set(this.world.getFreeBodies().map((fb) => fb.uid));
      const pulse = tool.buildPulse(this.world.engine);
      const log = this.world.interactAt(hit, pulse, tool.name);

      if (log.status === 'deathrattle' || log.status === 'crafted') {
        for (const fb of [...this.world.getFreeBodies()]) {
          if (beforeUids.has(fb.uid)) continue;
          const mapped = mapResourceToBlockProto(fb.protoId);
          if (mapped) {
            this.world.consumeFreeBody(fb.uid);
            this.absorbBlockProto(mapped);
          }
        }
      }
    }
  }

  public triggerSecondaryPlace(): void {
    const hit = this.performRaycast();
    this.currentHit = hit;
    if (!hit) return;

    const protoToPlace = this.placeProtoId;
    if (hit.entity.protoId === 'Workbench' && protoToPlace.endsWith('_Bit')) {
      this.world.workbenchInsert(hit.entity.uid, protoToPlace);
      return;
    }

    this.tryPlaceBlock(hit, protoToPlace);
  }

  private tryPlaceBlock(hit: RayHit | null, protoId: string): void {
    if (!hit) return;

    let placePos: Coord3;
    if (hit.kind === 'grid') {
      placePos = {
        x: Math.round(hit.entity.pos.x + hit.normal.x),
        y: Math.round(hit.entity.pos.y + hit.normal.y),
        z: Math.round(hit.entity.pos.z + hit.normal.z),
      };
    } else {
      placePos = {
        x: Math.floor(hit.pos.x + hit.normal.x * 0.6),
        y: Math.floor(hit.pos.y + hit.normal.y * 0.6),
        z: Math.floor(hit.pos.z + hit.normal.z * 0.6),
      };
    }

    if (
      placePos.x < 0 ||
      placePos.x >= this.world.sizeX ||
      placePos.y < 0 ||
      placePos.y >= this.world.sizeY ||
      placePos.z < 0 ||
      placePos.z >= this.world.sizeZ
    ) {
      return;
    }

    // Prevent placing a collidable GridStatic block directly inside the player's own AABB
    const form = this.world.engine.getAttr<string>(protoId, 'form', 'FreeBody');
    const isCollidable = this.world.engine.getAttr<boolean>(
      protoId,
      'collidable',
      form === 'GridStatic',
    );
    if (
      form === 'GridStatic' &&
      isCollidable &&
      this.overlapsPlayer(placePos.x, placePos.y, placePos.z, 1.0)
    ) {
      return;
    }

    this.world.placeBlock(placePos, protoId);
  }

  private performRaycast(): RayHit | null {
    return this.world.raycast(this.getEyePos(), this.getAimDirection(), RAYCAST_RANGE);
  }

  private syncCamera(): void {
    this.camera.position.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private clampPitch(): void {
    const limit = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  private isSolidForPlayer(block: EntityBlock | null): boolean {
    if (!block) return false;
    return this.world.engine.getAttr<boolean>(
      block.protoId,
      'collidable',
      block.form === 'GridStatic',
    );
  }

  private getBlockHeight(block: EntityBlock): number {
    return block.protoId === 'OakPlank_Slab' ? 0.5 : 1.0;
  }

  private overlapsPlayer(bx: number, by: number, bz: number, blockHeight: number): boolean {
    const minX = this.pos.x - PLAYER_RADIUS;
    const maxX = this.pos.x + PLAYER_RADIUS;
    const minY = this.pos.y;
    const maxY = this.pos.y + PLAYER_HEIGHT;
    const minZ = this.pos.z - PLAYER_RADIUS;
    const maxZ = this.pos.z + PLAYER_RADIUS;

    return (
      maxX > bx + EPS &&
      minX < bx + 1 - EPS &&
      maxY > by + EPS &&
      minY < by + blockHeight - EPS &&
      maxZ > bz + EPS &&
      minZ < bz + 1 - EPS
    );
  }

  private collectOverlappingBlocks(): Array<{ x: number; y: number; z: number; height: number }> {
    const hits: Array<{ x: number; y: number; z: number; height: number }> = [];
    const minX = Math.floor(this.pos.x - PLAYER_RADIUS + EPS);
    const maxX = Math.floor(this.pos.x + PLAYER_RADIUS - EPS);
    const minY = Math.floor(this.pos.y + EPS);
    const maxY = Math.floor(this.pos.y + PLAYER_HEIGHT - EPS);
    const minZ = Math.floor(this.pos.z - PLAYER_RADIUS + EPS);
    const maxZ = Math.floor(this.pos.z + PLAYER_RADIUS - EPS);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const block = this.world.getGridBlock(x, y, z);
          if (!this.isSolidForPlayer(block)) continue;
          const h = this.getBlockHeight(block!);
          if (this.overlapsPlayer(x, y, z, h)) {
            hits.push({ x, y, z, height: h });
          }
        }
      }
    }
    return hits;
  }

  private moveAxisX(dx: number): void {
    if (dx === 0) return;
    this.pos.x += dx;
    const overlaps = this.collectOverlappingBlocks();
    for (const b of overlaps) {
      if (dx > 0) {
        this.pos.x = Math.min(this.pos.x, b.x - PLAYER_RADIUS - EPS);
      } else {
        this.pos.x = Math.max(this.pos.x, b.x + 1 + PLAYER_RADIUS + EPS);
      }
    }
  }

  private moveAxisZ(dz: number): void {
    if (dz === 0) return;
    this.pos.z += dz;
    const overlaps = this.collectOverlappingBlocks();
    for (const b of overlaps) {
      if (dz > 0) {
        this.pos.z = Math.min(this.pos.z, b.z - PLAYER_RADIUS - EPS);
      } else {
        this.pos.z = Math.max(this.pos.z, b.z + 1 + PLAYER_RADIUS + EPS);
      }
    }
  }

  private moveAxisY(dy: number): void {
    this.pos.y += dy;
    const overlaps = this.collectOverlappingBlocks();
    if (overlaps.length === 0) {
      this.onGround = false;
      return;
    }

    if (dy <= 0) {
      let maxTop = -Infinity;
      for (const b of overlaps) {
        maxTop = Math.max(maxTop, b.y + b.height);
      }
      if (maxTop > -Infinity) {
        this.pos.y = maxTop;
        this.vel.y = 0;
        this.onGround = true;
      }
    } else {
      let minBottom = Infinity;
      for (const b of overlaps) {
        minBottom = Math.min(minBottom, b.y);
      }
      if (minBottom < Infinity) {
        this.pos.y = minBottom - PLAYER_HEIGHT - EPS;
        this.vel.y = 0;
      }
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
      if (e.code === 'Escape' && this.paused) {
        this.callbacks.onToggleInventory?.();
      }
      return;
    }

    if (e.code === 'KeyQ' && !e.repeat) {
      e.preventDefault();
      this.callbacks.onToggleInventory?.();
      return;
    }

    if (e.code === 'Escape' && this.paused && !e.repeat) {
      e.preventDefault();
      this.callbacks.onToggleInventory?.();
      return;
    }

    if (this.paused) return;

    this.keys.add(e.code);

    if (e.code >= 'Digit1' && e.code <= 'Digit8') {
      const slot = Number(e.code.slice(5));
      if (e.shiftKey && slot <= this.toolSlots.length) {
        this.selectToolSlot(slot - 1);
      } else {
        this.selectBlockSlot(slot);
      }
      return;
    }

    if (e.code === 'KeyE' && !e.repeat) {
      e.preventDefault();
      this.pickupTargetedOrNearby();
      return;
    }

    if (e.code === 'KeyF' && !e.repeat) {
      this.triggerPrimary();
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  private updateCursorNdc(e: MouseEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.cursorNdcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.cursorNdcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handleMouseDown(e: MouseEvent): void {
    if (this.paused) return;
    if (e.button === 1) {
      e.preventDefault();
      this.toggleScrollTarget();
      return;
    }
    this.mouseButtons.add(e.button);

    if (this.isPointerLocked) {
      if (e.button === 0) {
        this.primaryHoldTimer = PRIMARY_REPEAT_INTERVAL;
        this.triggerPrimary();
      } else if (e.button === 2) {
        this.triggerSecondaryPlace();
      }
      return;
    }

    this.updateCursorNdc(e);

    if (e.button === 0) {
      this.primaryHoldTimer = PRIMARY_REPEAT_INTERVAL;
      this.triggerPrimary();
    } else if (e.button === 2) {
      this.rightDragging = true;
      this.rightDragMoved = false;
      this.rightStartX = e.clientX;
      this.rightStartY = e.clientY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.paused) return;
    if (this.isPointerLocked) {
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      this.clampPitch();
      return;
    }

    if (this.rightDragging) {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      if (Math.hypot(e.clientX - this.rightStartX, e.clientY - this.rightStartY) > 4) {
        this.rightDragMoved = true;
      }
      this.yaw -= dx * MOUSE_SENSITIVITY * 1.4;
      this.pitch -= dy * MOUSE_SENSITIVITY * 1.4;
      this.clampPitch();
      return;
    }

    if (e.target === this.domElement) {
      this.updateCursorNdc(e);
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    this.mouseButtons.delete(e.button);

    if (this.paused || this.isPointerLocked) return;

    if (e.button === 2) {
      const wasPureClick = this.rightDragging && !this.rightDragMoved && e.target === this.domElement;
      this.rightDragging = false;
      if (wasPureClick) {
        this.updateCursorNdc(e);
        this.triggerSecondaryPlace();
      }
    }
  }

  private handleWheel(e: WheelEvent): void {
    if (this.paused) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    if (this.scrollTarget === 'tool') {
      this.cycleToolSlot(dir);
      return;
    }
    const count = this.blockSlots.length;
    const nextSlot = ((this.activeBlockSlot - 1 + dir + count) % count) + 1;
    this.selectBlockSlot(nextSlot);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    window.removeEventListener('mousemove', this.onMouseMoveBound);
    window.removeEventListener('mouseup', this.onMouseUpBound);
    document.removeEventListener('pointerlockchange', this.onPointerLockChangeBound);
    this.domElement.removeEventListener('mousedown', this.onMouseDownBound);
    this.domElement.removeEventListener('wheel', this.onWheelBound);
    this.domElement.removeEventListener('auxclick', this.onAuxClickBound);
    this.domElement.removeEventListener('contextmenu', this.onContextMenuBound);
  }
}
