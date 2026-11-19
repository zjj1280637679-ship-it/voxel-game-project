import * as THREE from 'three';
import type { Coord3, EntityBlock, IVoxelWorld, RayHit } from '../core/contracts.ts';
import { getVisual, type BlockVisual } from './palette.ts';
import { VoxelTextureLibrary, type NamedTextureKey } from './textures.ts';
import { ATMOSPHERE_LABELS, AtmosphereRig, type AtmospherePreset } from './atmosphere.ts';
import { VoxelModelFactory, type AnimatedBlockRig } from './entityModels.ts';
import {
  normalizePerformanceBudget,
  PERF_PRESETS,
  type PerformanceBudget,
  type RendererPerfStats,
} from './performanceBudget.ts';
import {
  createRiggedVoxelInstance,
  disposeIronKnightTemplate,
  getIronKnightTemplate,
  type KnightAnimName,
  type RiggedVoxelInstance,
} from './riggedVoxel.ts';

interface FreeBodyNode {
  group: THREE.Group;
  protoId: string;
  dmgBucket: number;
  baseScale: number;
  animLegs?: [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D];
  orbitNodes?: THREE.Object3D[];
  rigged?: RiggedVoxelInstance;
  facingYaw?: number;
  lastAnimState?: KnightAnimName;
  lastAnimTimer?: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  colorHex: number;
  gravity: number;
  baseScale: number;
  age: number;
  lifetime: number;
}

const NEIGHBOR_DIRS: readonly Coord3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

const MAX_PARTICLES_CAP = 160;
const MAX_FIRE_LIGHTS = 4;
const MAX_STELE_LIGHTS = 2;

export class VoxelRenderer {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;

  private readonly textures: VoxelTextureLibrary;
  private readonly atmosphere: AtmosphereRig;
  private readonly modelFactory: VoxelModelFactory;

  private readonly chunkGroup: THREE.Group;
  private readonly animatedBlockGroup: THREE.Group;
  private readonly freeBodyGroup: THREE.Group;
  private readonly lightGroup: THREE.Group;

  private readonly particleGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
  private readonly particleInstMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly particleInstMesh: THREE.InstancedMesh;

  private readonly highlightBox: THREE.LineSegments;
  private readonly highlightMat: THREE.LineBasicMaterial;
  private readonly highlightFillBox: THREE.Mesh;
  private readonly highlightFillMat: THREE.MeshBasicMaterial;

  private readonly freeBodyNodes = new Map<number, FreeBodyNode>();
  private readonly animatedBlocks: AnimatedBlockRig[] = [];
  private readonly firePositions: Coord3[] = [];
  private readonly stelePositions: Array<Coord3 & { colorHex?: number }> = [];
  private readonly mistPositions: Coord3[] = [];
  private readonly particles: Particle[] = [];

  private readonly allFireLights: THREE.PointLight[] = [];
  private readonly allSteleLights: THREE.PointLight[] = [];
  private activeFireLimit = 1;
  private activeSteleLimit = 1;

  // Shared block & sub-part geometries
  private readonly fullBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly slabBoxGeo = new THREE.BoxGeometry(1, 0.5, 1);
  private readonly waterBoxGeo = new THREE.BoxGeometry(1, 0.88, 1);
  private readonly doorClosedGeo = new THREE.BoxGeometry(1, 1, 0.18);
  private readonly doorOpenGeo = new THREE.BoxGeometry(0.18, 1, 1);
  private readonly crackBoxGeo = new THREE.BoxGeometry(1.006, 1.006, 1.006);
  private readonly unitEdgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  private readonly unitEdgeVerts: Float32Array;

  private readonly saplingStemGeo = new THREE.BoxGeometry(0.16, 0.44, 0.16);
  private readonly saplingCrownLowerGeo = new THREE.BoxGeometry(0.58, 0.34, 0.58);
  private readonly saplingCrownUpperGeo = new THREE.BoxGeometry(0.38, 0.26, 0.38);
  private readonly mushroomStemGeo = new THREE.BoxGeometry(0.24, 0.42, 0.24);
  private readonly mushroomCapGeo = new THREE.BoxGeometry(0.66, 0.3, 0.66);
  private readonly mushroomTopKnollGeo = new THREE.BoxGeometry(0.42, 0.12, 0.42);
  private readonly steleBaseGeo = new THREE.BoxGeometry(0.66, 0.16, 0.66);
  private readonly stelePillarGeo = new THREE.BoxGeometry(0.44, 0.66, 0.44);

  // Material caches
  private readonly chunkMatCache = new Map<string, THREE.Material | THREE.Material[]>();
  private readonly freeBodyMatCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly namedPartMatCache = new Map<string, THREE.Material>();
  private readonly crackMaterials: readonly [
    THREE.MeshBasicMaterial,
    THREE.MeshBasicMaterial,
    THREE.MeshBasicMaterial,
  ];
  private readonly glassEdgeMat = new THREE.LineBasicMaterial({
    color: 0xe0f2fe,
    transparent: true,
    opacity: 0.48,
  });

  // Preallocated scratch vectors/objects (zero per-frame allocations)
  private readonly tmpObj = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly forwardZ = new THREE.Vector3(0, 0, 1);

  private budget: PerformanceBudget;
  private viewportWidth: number;
  private viewportHeight: number;
  private lastDirtyRev = -1;
  private lastWorld: IVoxelWorld | null = null;
  private lastTimeMs = performance.now();
  private ambientSpawnAccum = 0;
  private shadowRefreshAccum = 0;
  private shadowDirty = true;
  private smoothedFrameMs = 16.6;
  private smoothedFps = 60;
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private disposed = false;

  constructor(container: HTMLElement, initialBudget?: PerformanceBudget) {
    this.budget = initialBudget
      ? normalizePerformanceBudget(initialBudget)
      : { ...PERF_PRESETS.balanced };

    this.viewportWidth = container.clientWidth || window.innerWidth;
    this.viewportHeight = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.budget.maxPixelRatio));
    this.renderer.setSize(this.viewportWidth, this.viewportHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = this.budget.shadowQuality !== 'off';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    const aspect = this.viewportWidth / Math.max(1, this.viewportHeight);
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 160);
    this.camera.rotation.order = 'YXZ';

    this.unitEdgeVerts = (
      this.unitEdgeGeo.getAttribute('position') as THREE.BufferAttribute
    ).array as Float32Array;

    this.textures = new VoxelTextureLibrary();
    this.atmosphere = new AtmosphereRig(this.scene, 24, 24);
    this.atmosphere.applyBudget(this.budget);
    this.modelFactory = new VoxelModelFactory(this.textures);

    this.chunkGroup = new THREE.Group();
    this.animatedBlockGroup = new THREE.Group();
    this.freeBodyGroup = new THREE.Group();
    this.lightGroup = new THREE.Group();

    // Single GPU InstancedMesh for ALL ambient & burst particles
    this.particleInstMesh = new THREE.InstancedMesh(
      this.particleGeo,
      this.particleInstMat,
      MAX_PARTICLES_CAP,
    );
    this.particleInstMesh.frustumCulled = false;
    this.particleInstMesh.castShadow = false;
    this.particleInstMesh.receiveShadow = false;
    this.particleInstMesh.count = 0;
    this.particleInstMesh.visible = false;
    // Initialize instanceColor attribute cleanly from frame 0 to avoid runtime shader recompilation.
    const initColor = new THREE.Color(0xffffff);
    for (let i = 0; i < MAX_PARTICLES_CAP; i++) {
      this.particleInstMesh.setColorAt(i, initColor);
    }
    if (this.particleInstMesh.instanceColor) {
      this.particleInstMesh.instanceColor.needsUpdate = true;
    }

    this.scene.add(
      this.chunkGroup,
      this.animatedBlockGroup,
      this.freeBodyGroup,
      this.particleInstMesh,
      this.lightGroup,
    );

    // Precreate dynamic point light pool; attach only up to budget.maxPointLights
    for (let i = 0; i < MAX_FIRE_LIGHTS; i++) {
      this.allFireLights.push(new THREE.PointLight(0xff7a29, 0, 8.5, 1.8));
    }
    for (let i = 0; i < MAX_STELE_LIGHTS; i++) {
      this.allSteleLights.push(new THREE.PointLight(0x38bdf8, 0, 7.5, 1.8));
    }
    this.syncLightPoolMembership();

    // 3-stage procedural damage crack overlay materials (unlit for fast overlay blending)
    this.crackMaterials = ([1, 2, 3] as const).map(
      (stage) =>
        new THREE.MeshBasicMaterial({
          map: this.textures.getCrackTexture(stage),
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
    ) as unknown as readonly [
      THREE.MeshBasicMaterial,
      THREE.MeshBasicMaterial,
      THREE.MeshBasicMaterial,
    ];

    this.highlightMat = new THREE.LineBasicMaterial({ color: 0xf8fafc, depthTest: true });
    this.highlightBox = new THREE.LineSegments(this.unitEdgeGeo, this.highlightMat);
    this.highlightBox.visible = false;
    this.highlightBox.renderOrder = 10;

    this.highlightFillMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
    });
    this.highlightFillBox = new THREE.Mesh(this.fullBoxGeo, this.highlightFillMat);
    this.highlightFillBox.visible = false;
    this.highlightFillBox.renderOrder = 9;

    this.scene.add(this.highlightFillBox, this.highlightBox);
  }

  public get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  public getBudget(): PerformanceBudget {
    return { ...this.budget };
  }

  public applyBudget(nextBudget: PerformanceBudget): void {
    if (this.disposed) return;

    const prev = this.budget;
    const next = normalizePerformanceBudget(nextBudget);
    this.budget = next;

    // 1. Pixel ratio
    const targetPr = Math.min(window.devicePixelRatio || 1, next.maxPixelRatio);
    if (Math.abs(targetPr - this.renderer.getPixelRatio()) > 1e-3) {
      this.renderer.setPixelRatio(targetPr);
      this.renderer.setSize(this.viewportWidth, this.viewportHeight);
    }

    // 2. Chunk shading pipeline switch (Lambert vs PBR Standard)
    if (prev.shading !== next.shading) {
      this.disposeChunkMaterialCaches();
      this.lastDirtyRev = -1;
      for (const node of this.freeBodyNodes.values()) {
        node.rigged?.setShading(next.shading);
      }
    }

    // 3. Atmosphere & shadow quality
    const shadowCfgChanged = this.atmosphere.applyBudget(next);
    this.renderer.shadowMap.enabled = next.shadowQuality !== 'off';
    if (shadowCfgChanged) {
      this.shadowDirty = true;
    }

    // 4. PointLight pool budget
    if (prev.maxPointLights !== next.maxPointLights) {
      this.syncLightPoolMembership();
      this.bindLightPositions();
    }

    // 5. Particle cap trim
    if (this.particles.length > next.maxParticles) {
      this.particles.length = next.maxParticles;
      this.syncParticleInstances();
    }
  }

  public getPerfStats(): RendererPerfStats {
    const activeLights =
      Math.min(this.firePositions.length, this.activeFireLimit) +
      Math.min(this.stelePositions.length, this.activeSteleLimit);
    return {
      fps: Math.round(this.smoothedFps),
      frameMs: Math.round(this.smoothedFrameMs * 10) / 10,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      activeParticles: this.particles.length,
      activeLights,
      pixelRatio: Math.round(this.renderer.getPixelRatio() * 100) / 100,
    };
  }

  public setAtmosphere(preset: AtmospherePreset): void {
    this.atmosphere.setPreset(preset);
    this.shadowDirty = true;
  }

  public getAtmosphere(): AtmospherePreset {
    return this.atmosphere.getPreset();
  }

  public cycleAtmosphere(): AtmospherePreset {
    const next = this.atmosphere.cyclePreset();
    this.shadowDirty = true;
    return next;
  }

  public getAtmosphereLabel(): string {
    return ATMOSPHERE_LABELS[this.atmosphere.getPreset()];
  }

  public resize(width: number, height: number): void {
    if (this.disposed) return;
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.camera.aspect = this.viewportWidth / this.viewportHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.viewportWidth, this.viewportHeight);
  }

  public reset(): void {
    this.lastDirtyRev = -1;
    this.lastWorld = null;
    for (const node of this.freeBodyNodes.values()) {
      node.rigged?.dispose();
      this.freeBodyGroup.remove(node.group);
    }
    this.freeBodyNodes.clear();

    this.particles.length = 0;
    this.particleInstMesh.count = 0;
    this.particleInstMesh.visible = false;

    this.clearChunkGroup();
    this.clearAnimatedBlocks();
    this.shadowDirty = true;
  }

  public render(
    world: IVoxelWorld,
    camera: THREE.PerspectiveCamera,
    currentHit: RayHit | null,
  ): void {
    if (this.disposed) return;

    const nowMs = performance.now();
    const rawDtMs = Math.max(1, nowMs - this.lastTimeMs);
    const dt = Math.min(0.1, rawDtMs / 1000);
    this.lastTimeMs = nowMs;
    const timeSec = nowMs / 1000;

    // Smooth rolling FPS & frame time telemetry
    const instMs = Math.min(200, rawDtMs);
    this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + instMs * 0.1;
    const instFps = 1000 / Math.max(1, instMs);
    this.smoothedFps = this.smoothedFps * 0.9 + Math.min(240, instFps) * 0.1;

    if (this.budget.animatedTextures) {
      this.textures.updateAnimatedTextures(dt);
    }
    this.atmosphere.update(dt, timeSec, camera.position);

    const dirtyRev = world.getDirtyRevision();
    if (world !== this.lastWorld || dirtyRev !== this.lastDirtyRev) {
      this.rebuildChunks(world);
      this.lastWorld = world;
      this.lastDirtyRev = dirtyRev;
      this.shadowDirty = true;
    }

    this.updateAnimatedScene(timeSec);
    this.syncFreeBodies(world, dt, timeSec);
    this.updateHighlight(currentHit, timeSec);
    this.consumePendingFx(world);
    if (this.budget.ambientParticles && this.budget.maxParticles > 0) {
      this.emitAmbientParticles(dt);
    }
    this.updateParticles(dt);

    // Throttled shadow map refresh
    if (this.renderer.shadowMap.enabled) {
      if (this.budget.shadowRefreshHz > 0) {
        this.shadowRefreshAccum += dt;
        if (this.shadowRefreshAccum >= 1 / this.budget.shadowRefreshHz) {
          this.shadowRefreshAccum = 0;
          this.shadowDirty = true;
        }
      }
      if (this.shadowDirty) {
        this.renderer.shadowMap.needsUpdate = true;
        this.shadowDirty = false;
      } else {
        this.renderer.shadowMap.needsUpdate = false;
      }
    }

    this.renderer.render(this.scene, camera);
    this.lastDrawCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;
  }

  private syncLightPoolMembership(): void {
    this.lightGroup.clear();
    const budget = this.budget.maxPointLights;
    if (budget <= 0) {
      this.activeFireLimit = 0;
      this.activeSteleLimit = 0;
    } else if (budget <= 2) {
      this.activeFireLimit = 1;
      this.activeSteleLimit = 1;
    } else if (budget <= 4) {
      this.activeFireLimit = 3;
      this.activeSteleLimit = 1;
    } else {
      this.activeFireLimit = MAX_FIRE_LIGHTS;
      this.activeSteleLimit = MAX_STELE_LIGHTS;
    }

    for (let i = 0; i < this.activeFireLimit; i++) {
      this.lightGroup.add(this.allFireLights[i]);
    }
    for (let i = 0; i < this.activeSteleLimit; i++) {
      this.lightGroup.add(this.allSteleLights[i]);
    }
  }

  private bindLightPositions(): void {
    for (let i = 0; i < this.activeFireLimit; i++) {
      const pos = this.firePositions[i];
      const light = this.allFireLights[i];
      if (pos) {
        light.position.set(pos.x, pos.y + 0.25, pos.z);
        light.intensity = 2.6;
      } else {
        light.intensity = 0;
      }
    }
    for (let i = 0; i < this.activeSteleLimit; i++) {
      const pos = this.stelePositions[i];
      const light = this.allSteleLights[i];
      if (pos) {
        light.color.setHex(pos.colorHex ?? 0x38bdf8);
        light.position.set(pos.x, pos.y + 0.2, pos.z);
        light.intensity = 2.0;
      } else {
        light.intensity = 0;
      }
    }
  }

  private createBlockMaterial(
    protoId: string,
    damageBucket: number,
    mapTex: THREE.CanvasTexture | undefined,
    vis: BlockVisual,
    useStandard: boolean,
  ): THREE.Material {
    const darkFactor = damageBucket > 0 ? Math.max(0.45, 1 - damageBucket * 0.14) : 1.0;
    const isTransparent = vis.opacity !== undefined && vis.opacity < 1;
    const color = mapTex ? new THREE.Color(0xffffff) : new THREE.Color(vis.color);
    if (damageBucket > 0) {
      color.multiplyScalar(darkFactor);
    }
    const hasEmissive = vis.emissive !== undefined && vis.emissive !== 0;

    if (useStandard) {
      const mat = new THREE.MeshStandardMaterial({
        color,
        map: mapTex ?? null,
        emissive: vis.emissive ?? 0x000000,
        emissiveIntensity: hasEmissive ? (vis.emissiveIntensity ?? 0.5) : 0,
        roughness: vis.roughness ?? 0.86,
        metalness: vis.metalness ?? 0.04,
        transparent: isTransparent,
        opacity: vis.opacity ?? 1,
        depthWrite: !isTransparent,
      });
      if (
        hasEmissive &&
        mapTex &&
        (protoId === 'Obsidian' || protoId === 'PastureStele' || protoId === 'GuardStele')
      ) {
        mat.emissiveMap = mapTex;
        mat.emissiveIntensity = protoId === 'Obsidian' ? 0.55 : 0.72;
      }
      return mat;
    }

    const mat = new THREE.MeshLambertMaterial({
      color,
      map: mapTex ?? null,
      emissive: vis.emissive ?? 0x000000,
      emissiveIntensity: hasEmissive ? (vis.emissiveIntensity ?? 0.5) : 0,
      transparent: isTransparent,
      opacity: vis.opacity ?? 1,
      depthWrite: !isTransparent,
    });
    if (
      hasEmissive &&
      mapTex &&
      (protoId === 'Obsidian' || protoId === 'PastureStele' || protoId === 'GuardStele')
    ) {
      mat.emissiveMap = mapTex;
      mat.emissiveIntensity = protoId === 'Obsidian' ? 0.55 : 0.72;
    }
    return mat;
  }

  private getChunkMaterial(
    protoId: string,
    damageBucket: number,
  ): THREE.Material | THREE.Material[] {
    const key = `${protoId}::${damageBucket}`;
    const cached = this.chunkMatCache.get(key);
    if (cached) return cached;

    const vis = getVisual(protoId);
    const faceTex = this.textures.getBlockFaceTextures(protoId);
    const useStandard = this.budget.shading === 'standard';
    const created = Array.isArray(faceTex)
      ? faceTex.map((tex) => this.createBlockMaterial(protoId, damageBucket, tex, vis, useStandard))
      : this.createBlockMaterial(protoId, damageBucket, faceTex ?? undefined, vis, useStandard);

    this.chunkMatCache.set(key, created);
    return created;
  }

  private getSingleChunkMaterial(protoId: string, damageBucket: number): THREE.Material {
    const matOrArr = this.getChunkMaterial(protoId, damageBucket);
    return Array.isArray(matOrArr) ? matOrArr[2] : matOrArr;
  }

  private getFreeBodyStandardMaterial(
    protoId: string,
    damageBucket: number,
  ): THREE.MeshStandardMaterial {
    const key = `${protoId}::${damageBucket}`;
    const cached = this.freeBodyMatCache.get(key);
    if (cached) return cached;

    const vis = getVisual(protoId);
    const faceTex = this.textures.getBlockFaceTextures(protoId);
    const mapTex = Array.isArray(faceTex) ? faceTex[2] : faceTex ?? undefined;
    const mat = this.createBlockMaterial(
      protoId,
      damageBucket,
      mapTex,
      vis,
      true,
    ) as THREE.MeshStandardMaterial;
    this.freeBodyMatCache.set(key, mat);
    return mat;
  }

  private getNamedPartMaterial(
    texKey: NamedTextureKey,
    damageBucket: number,
    options?: { roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number },
  ): THREE.Material {
    const cacheKey = `${texKey}::${damageBucket}::${(options?.emissive ?? 0).toString(16)}`;
    const cached = this.namedPartMatCache.get(cacheKey);
    if (cached) return cached;

    const darkFactor = damageBucket > 0 ? Math.max(0.45, 1 - damageBucket * 0.14) : 1.0;
    const color = new THREE.Color(0xffffff).multiplyScalar(darkFactor);
    const mapTex = this.textures.getNamedTexture(texKey);
    const mat =
      this.budget.shading === 'standard'
        ? new THREE.MeshStandardMaterial({
            color,
            map: mapTex,
            roughness: options?.roughness ?? 0.85,
            metalness: options?.metalness ?? 0.02,
            emissive: options?.emissive ?? 0x000000,
            emissiveIntensity: options?.emissiveIntensity ?? 0,
            ...(options?.emissive ? { emissiveMap: mapTex } : {}),
          })
        : new THREE.MeshLambertMaterial({
            color,
            map: mapTex,
            emissive: options?.emissive ?? 0x000000,
            emissiveIntensity: options?.emissiveIntensity ?? 0,
            ...(options?.emissive ? { emissiveMap: mapTex } : {}),
          });

    this.namedPartMatCache.set(cacheKey, mat);
    return mat;
  }

  private disposeChunkMaterialCaches(): void {
    for (const matOrArr of this.chunkMatCache.values()) {
      if (Array.isArray(matOrArr)) {
        for (const m of matOrArr) m.dispose();
      } else {
        matOrArr.dispose();
      }
    }
    this.chunkMatCache.clear();

    for (const mat of this.namedPartMatCache.values()) {
      mat.dispose();
    }
    this.namedPartMatCache.clear();
  }

  private isOpaqueFullBlock(block: EntityBlock | null, world: IVoxelWorld): boolean {
    if (!block || block.form !== 'GridStatic') return false;
    if (!world.engine.getAttr<boolean>(block.protoId, 'visible', true)) return false;
    if (!world.engine.getAttr<boolean>(block.protoId, 'collidable', true)) return false;
    if (block.protoId === 'PastureStele' || block.protoId === 'GuardStele') return false;
    const vis = getVisual(block.protoId);
    if (vis.opacity !== undefined && vis.opacity < 1) return false;
    if (vis.heightScale !== undefined && vis.heightScale < 1) return false;
    if (vis.thinDoor !== undefined) return false;
    if (block.protoId === 'Sapling' || block.protoId === 'Fire' || block.protoId === 'Mushroom') {
      return false;
    }
    return true;
  }

  private clearChunkGroup(): void {
    for (const child of [...this.chunkGroup.children]) {
      this.chunkGroup.remove(child);
      if (child instanceof THREE.InstancedMesh) {
        child.dispose();
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
      }
    }
  }

  private clearAnimatedBlocks(): void {
    for (const rig of this.animatedBlocks) {
      this.animatedBlockGroup.remove(rig.group);
    }
    this.animatedBlocks.length = 0;
    this.firePositions.length = 0;
    this.stelePositions.length = 0;
    this.mistPositions.length = 0;
    for (const l of this.allFireLights) l.intensity = 0;
    for (const l of this.allSteleLights) l.intensity = 0;
  }

  private rebuildChunks(world: IVoxelWorld): void {
    this.clearChunkGroup();
    this.clearAnimatedBlocks();

    const buckets = new Map<
      string,
      {
        geo: THREE.BufferGeometry;
        mat: THREE.Material | THREE.Material[];
        castShadow: boolean;
        matrices: THREE.Matrix4[];
      }
    >();
    const crackMatrices: [THREE.Matrix4[], THREE.Matrix4[], THREE.Matrix4[]] = [[], [], []];
    const glassPositions: Coord3[] = [];
    const dummy = this.tmpObj;

    const pushInstance = (
      bucketKey: string,
      geo: THREE.BufferGeometry,
      mat: THREE.Material | THREE.Material[],
      castShadow: boolean,
      pos: Coord3,
    ) => {
      let entry = buckets.get(bucketKey);
      if (!entry) {
        entry = { geo, mat, castShadow, matrices: [] };
        buckets.set(bucketKey, entry);
      }
      dummy.position.set(pos.x, pos.y, pos.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      entry.matrices.push(dummy.matrix.clone());
    };

    for (let x = 0; x < world.sizeX; x++) {
      for (let y = 0; y < world.sizeY; y++) {
        for (let z = 0; z < world.sizeZ; z++) {
          const block = world.getGridBlock(x, y, z);
          if (!block) continue;
          if (!world.engine.getAttr<boolean>(block.protoId, 'visible', true)) continue;

          // Visible-block culling for fully enclosed opaque solid blocks
          if (this.isOpaqueFullBlock(block, world)) {
            let occluded = true;
            for (const d of NEIGHBOR_DIRS) {
              const nx = x + d.x;
              const ny = y + d.y;
              const nz = z + d.z;
              if (
                nx < 0 ||
                nx >= world.sizeX ||
                ny < 0 ||
                ny >= world.sizeY ||
                nz < 0 ||
                nz >= world.sizeZ
              ) {
                occluded = false;
                break;
              }
              const nb = world.getGridBlock(nx, ny, nz);
              if (!this.isOpaqueFullBlock(nb, world)) {
                occluded = false;
                break;
              }
            }
            if (occluded) continue;
          }

          const dmgRatio = block.maxHp > 0 ? Math.max(0, 1 - block.hp / block.maxHp) : 0;
          const dmgBucket = dmgRatio <= 0.02 ? 0 : Math.min(3, Math.ceil(dmgRatio * 3));
          const mat = this.getChunkMaterial(block.protoId, dmgBucket);
          const vis = getVisual(block.protoId);
          const isTransparent = vis.opacity !== undefined && vis.opacity < 1;
          const phase = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) * 0.0001;

          if (block.protoId === 'PastureStele' || block.protoId === 'GuardStele') {
            const isGuardStele = block.protoId === 'GuardStele';
            const baseMat = this.getSingleChunkMaterial('Stone', dmgBucket);
            const pillarMat = this.getNamedPartMaterial('stele_pillar', dmgBucket, {
              roughness: isGuardStele ? 0.5 : 0.56,
              metalness: isGuardStele ? 0.25 : 0.14,
              emissive: isGuardStele ? 0xf59e0b : 0x0ea5e9,
              emissiveIntensity: isGuardStele ? 0.72 : 0.68,
            });
            pushInstance(`stele_base::${dmgBucket}`, this.steleBaseGeo, baseMat, true, {
              x: x + 0.5,
              y: y + 0.08,
              z: z + 0.5,
            });
            pushInstance(
              `${isGuardStele ? 'stele_guard_pillar' : 'stele_pillar'}::${dmgBucket}`,
              this.stelePillarGeo,
              pillarMat,
              true,
              {
                x: x + 0.5,
                y: y + 0.49,
                z: z + 0.5,
              },
            );
            const gemRig = this.modelFactory.buildAnimatedBlock(
              isGuardStele ? 'stele_gem_gold' : 'stele_gem',
              { x, y, z },
              phase,
            );
            this.animatedBlocks.push(gemRig);
            this.animatedBlockGroup.add(gemRig.group);
            this.stelePositions.push({
              x: x + 0.5,
              y: y + 1.05,
              z: z + 0.5,
              colorHex: isGuardStele ? 0xfbbf24 : 0x38bdf8,
            });
          } else if (block.protoId === 'Fire') {
            const fireRig = this.modelFactory.buildAnimatedBlock('fire', { x, y, z }, phase);
            this.animatedBlocks.push(fireRig);
            this.animatedBlockGroup.add(fireRig.group);
            this.firePositions.push({ x: x + 0.5, y: y + 0.55, z: z + 0.5 });
          } else if (block.protoId === 'MistVeil') {
            const mistRig = this.modelFactory.buildAnimatedBlock('mist', { x, y, z }, phase);
            this.animatedBlocks.push(mistRig);
            this.animatedBlockGroup.add(mistRig.group);
            this.mistPositions.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5 });
          } else if (block.protoId === 'Sapling') {
            const stemMat = this.getNamedPartMaterial('sapling_stem', dmgBucket, { roughness: 0.9 });
            const crownMat = this.getNamedPartMaterial('sapling_crown', dmgBucket, { roughness: 0.84 });
            pushInstance(`sapling_stem::${dmgBucket}`, this.saplingStemGeo, stemMat, true, {
              x: x + 0.5,
              y: y + 0.22,
              z: z + 0.5,
            });
            pushInstance(`sapling_crown_lo::${dmgBucket}`, this.saplingCrownLowerGeo, crownMat, true, {
              x: x + 0.5,
              y: y + 0.56,
              z: z + 0.5,
            });
            pushInstance(`sapling_crown_hi::${dmgBucket}`, this.saplingCrownUpperGeo, crownMat, true, {
              x: x + 0.5,
              y: y + 0.84,
              z: z + 0.5,
            });
          } else if (block.protoId === 'Mushroom') {
            const stemMat = this.getNamedPartMaterial('mushroom_stem', dmgBucket, { roughness: 0.88 });
            const capMat = this.getNamedPartMaterial('mushroom_cap', dmgBucket, { roughness: 0.78 });
            pushInstance(`mush_stem::${dmgBucket}`, this.mushroomStemGeo, stemMat, true, {
              x: x + 0.5,
              y: y + 0.21,
              z: z + 0.5,
            });
            pushInstance(`mush_cap::${dmgBucket}`, this.mushroomCapGeo, capMat, true, {
              x: x + 0.5,
              y: y + 0.52,
              z: z + 0.5,
            });
            pushInstance(`mush_knoll::${dmgBucket}`, this.mushroomTopKnollGeo, capMat, true, {
              x: x + 0.5,
              y: y + 0.71,
              z: z + 0.5,
            });
          } else if (vis.thinDoor === 'closed') {
            pushInstance(`door_closed::${dmgBucket}`, this.doorClosedGeo, mat, !isTransparent, {
              x: x + 0.5,
              y: y + 0.5,
              z: z + 0.5,
            });
          } else if (vis.thinDoor === 'open') {
            pushInstance(`door_open::${dmgBucket}`, this.doorOpenGeo, mat, !isTransparent, {
              x: x + 0.12,
              y: y + 0.5,
              z: z + 0.5,
            });
          } else if (vis.heightScale !== undefined && vis.heightScale < 1) {
            const h = vis.heightScale;
            const geo = h <= 0.55 ? this.slabBoxGeo : this.waterBoxGeo;
            pushInstance(`half_${block.protoId}::${dmgBucket}`, geo, mat, !isTransparent, {
              x: x + 0.5,
              y: y + h * 0.5,
              z: z + 0.5,
            });
          } else {
            pushInstance(`${block.protoId}::${dmgBucket}`, this.fullBoxGeo, mat, !isTransparent, {
              x: x + 0.5,
              y: y + 0.5,
              z: z + 0.5,
            });
            if (block.protoId === 'Glass') {
              glassPositions.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5 });
            }
          }

          if (dmgBucket > 0) {
            if (vis.thinDoor === 'closed') {
              dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
              dummy.scale.set(1, 1, 0.19);
            } else if (vis.thinDoor === 'open') {
              dummy.position.set(x + 0.12, y + 0.5, z + 0.5);
              dummy.scale.set(0.19, 1, 1);
            } else {
              const h = vis.heightScale ?? 1;
              dummy.position.set(x + 0.5, y + h * 0.5, z + 0.5);
              dummy.scale.set(1, h, 1);
            }
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            crackMatrices[dmgBucket - 1].push(dummy.matrix.clone());
          }
        }
      }
    }

    for (const entry of buckets.values()) {
      if (entry.matrices.length === 0) continue;
      const inst = new THREE.InstancedMesh(entry.geo, entry.mat, entry.matrices.length);
      inst.castShadow = entry.castShadow;
      inst.receiveShadow = true;
      for (let i = 0; i < entry.matrices.length; i++) {
        inst.setMatrixAt(i, entry.matrices[i]);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.chunkGroup.add(inst);
    }

    for (let stageIdx = 0; stageIdx < 3; stageIdx++) {
      const matrices = crackMatrices[stageIdx];
      if (matrices.length === 0) continue;
      const crackInst = new THREE.InstancedMesh(
        this.crackBoxGeo,
        this.crackMaterials[stageIdx],
        matrices.length,
      );
      crackInst.castShadow = false;
      crackInst.receiveShadow = false;
      for (let i = 0; i < matrices.length; i++) {
        crackInst.setMatrixAt(i, matrices[i]);
      }
      crackInst.instanceMatrix.needsUpdate = true;
      crackInst.computeBoundingSphere();
      this.chunkGroup.add(crackInst);
    }

    // Merge all Glass edges into ONE LineSegments draw call
    if (glassPositions.length > 0) {
      const stride = this.unitEdgeVerts.length;
      const mergedPositions = new Float32Array(glassPositions.length * stride);
      for (let gi = 0; gi < glassPositions.length; gi++) {
        const gp = glassPositions[gi];
        const baseOffset = gi * stride;
        for (let vi = 0; vi < stride; vi += 3) {
          mergedPositions[baseOffset + vi] = this.unitEdgeVerts[vi] * 0.996 + gp.x;
          mergedPositions[baseOffset + vi + 1] = this.unitEdgeVerts[vi + 1] * 0.996 + gp.y;
          mergedPositions[baseOffset + vi + 2] = this.unitEdgeVerts[vi + 2] * 0.996 + gp.z;
        }
      }
      const mergedGeo = new THREE.BufferGeometry();
      mergedGeo.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
      mergedGeo.computeBoundingSphere();
      const lines = new THREE.LineSegments(mergedGeo, this.glassEdgeMat);
      this.chunkGroup.add(lines);
    }

    this.bindLightPositions();
  }

  private updateAnimatedScene(timeSec: number): void {
    for (const rig of this.animatedBlocks) {
      this.modelFactory.updateAnimatedBlock(rig, timeSec);
    }

    if (this.activeFireLimit === 0 && this.activeSteleLimit === 0) return;
    const nightBoost = this.atmosphere.getPreset() === 'night' ? 1.45 : 1.0;

    for (let i = 0; i < this.firePositions.length && i < this.activeFireLimit; i++) {
      const flicker =
        2.35 +
        Math.sin(timeSec * 14.5 + i * 2.1) * 0.45 +
        Math.cos(timeSec * 23.0 + i * 3.7) * 0.25;
      this.allFireLights[i].intensity = flicker * nightBoost;
    }
    for (let i = 0; i < this.stelePositions.length && i < this.activeSteleLimit; i++) {
      const pulse = 1.85 + Math.sin(timeSec * 2.6 + i * 1.7) * 0.45;
      this.allSteleLights[i].intensity = pulse * nightBoost;
    }
  }

  private buildFreeBodyNode(body: EntityBlock, dmgBucket: number): FreeBodyNode {
    if (body.protoId === 'IronKnight' || body.protoId === 'IronKnight_Corpse') {
      const isCorpse = body.protoId === 'IronKnight_Corpse';
      const initialAnim: KnightAnimName = isCorpse ? 'death' : (body.animState ?? 'idle');
      const rigged = createRiggedVoxelInstance(getIronKnightTemplate(), {
        scale: 0.055,
        yOffset: isCorpse ? -0.55 : -0.65,
        shading: this.budget.shading,
        initialAnim,
        tint: isCorpse ? 0.78 : Math.max(0.5, 1 - dmgBucket * 0.12),
      });
      const facingYaw =
        body.vel && (Math.abs(body.vel.x) > 1e-4 || Math.abs(body.vel.z) > 1e-4)
          ? Math.atan2(body.vel.x, body.vel.z)
          : 0;
      rigged.group.position.set(body.pos.x, body.pos.y, body.pos.z);
      rigged.group.rotation.y = facingYaw;
      this.freeBodyGroup.add(rigged.group);
      return {
        group: rigged.group,
        protoId: body.protoId,
        dmgBucket,
        baseScale: 1,
        rigged,
        facingYaw,
        lastAnimState: initialAnim,
        lastAnimTimer: body.animTimer ?? 0,
      };
    }

    const primaryMat = this.getFreeBodyStandardMaterial(body.protoId, dmgBucket);
    const built = this.modelFactory.buildFreeBodyModel(body, primaryMat, (id, bucket) =>
      this.getFreeBodyStandardMaterial(id, bucket),
    );
    built.group.position.set(body.pos.x, body.pos.y, body.pos.z);
    this.freeBodyGroup.add(built.group);
    return {
      group: built.group,
      protoId: body.protoId,
      dmgBucket,
      baseScale: built.baseScale,
      animLegs: built.animLegs,
      orbitNodes: built.orbitNodes,
    };
  }

  private syncFreeBodies(world: IVoxelWorld, dt: number, timeSec: number): void {
    const bodies = world.getFreeBodies();
    const activeIds = new Set<number>();
    const blend = Math.min(1, dt * 18);

    for (const body of bodies) {
      if (!world.engine.getAttr<boolean>(body.protoId, 'visible', true)) continue;
      activeIds.add(body.uid);
      const dmgRatio = body.maxHp > 0 ? Math.max(0, 1 - body.hp / body.maxHp) : 0;
      const dmgBucket = dmgRatio <= 0.02 ? 0 : Math.min(3, Math.ceil(dmgRatio * 3));
      let node = this.freeBodyNodes.get(body.uid);
      if (!node || node.protoId !== body.protoId || (!node.rigged && node.dmgBucket !== dmgBucket)) {
        if (node) {
          node.rigged?.dispose();
          this.freeBodyGroup.remove(node.group);
        }
        node = this.buildFreeBodyNode(body, dmgBucket);
        this.freeBodyNodes.set(body.uid, node);
      }

      this.tmpVecA.set(body.pos.x, body.pos.y, body.pos.z);
      const isItem =
        body.protoId.endsWith('_Item') ||
        body.protoId.endsWith('_Bit') ||
        body.protoId === 'StuckArrow' ||
        body.protoId === 'Gunpowder_Pack';

      if (node.rigged) {
        if (node.dmgBucket !== dmgBucket) {
          node.dmgBucket = dmgBucket;
          node.rigged.setTint(
            body.protoId === 'IronKnight_Corpse' ? 0.78 : Math.max(0.5, 1 - dmgBucket * 0.12),
          );
        }

        const horizSpeed = body.vel ? Math.hypot(body.vel.x, body.vel.z) : 0;
        let targetAnim: KnightAnimName;
        if (body.protoId === 'IronKnight_Corpse') {
          targetAnim = 'death';
        } else if (body.animTimer && body.animTimer > 0 && body.animState) {
          targetAnim = body.animState;
        } else if (horizSpeed > 0.04) {
          targetAnim = 'walk';
        } else {
          targetAnim = 'idle';
        }

        const nextAnimTimer = body.animTimer ?? 0;
        const restart =
          targetAnim !== node.lastAnimState ||
          (nextAnimTimer > (node.lastAnimTimer ?? 0) + 0.05 &&
            (targetAnim === 'slash' || targetAnim === 'block' || targetAnim === 'salute'));

        node.rigged.setAnimation(targetAnim, restart);
        node.lastAnimState = targetAnim;
        node.lastAnimTimer = nextAnimTimer;

        if (body.vel && body.protoId !== 'IronKnight_Corpse' && horizSpeed > 0.005) {
          const targetYaw = Math.atan2(body.vel.x, body.vel.z);
          const curYaw = node.facingYaw ?? targetYaw;
          const diff = ((targetYaw - curYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          const nextYaw = curYaw + diff * Math.min(1, dt * 10);
          node.facingYaw = nextYaw;
          node.group.rotation.y = nextYaw;
        }

        node.rigged.update(dt);
      } else if (isItem && body.protoId !== 'StuckArrow') {
        this.tmpVecA.y += Math.sin(timeSec * 3.0 + body.uid) * 0.08;
        node.group.rotation.y = timeSec * 1.8 + body.uid * 0.7;
      } else if (body.protoId === 'Arrow_Wood' && body.vel) {
        const speedSq = body.vel.x * body.vel.x + body.vel.y * body.vel.y + body.vel.z * body.vel.z;
        if (speedSq > 0.001) {
          this.tmpVecB.set(body.vel.x, body.vel.y, body.vel.z).normalize();
          node.group.quaternion.setFromUnitVectors(this.forwardZ, this.tmpVecB);
        }
      } else if (
        (body.protoId === 'Sheep_Live' || body.protoId === 'UndeadSheep') &&
        body.vel
      ) {
        const horizSpeed = Math.hypot(body.vel.x, body.vel.z);
        if (horizSpeed > 0.04) {
          node.group.rotation.y = Math.atan2(body.vel.x, body.vel.z);
          if (node.animLegs) {
            const swing = Math.sin(timeSec * 9.5 + body.uid) * Math.min(0.55, horizSpeed * 0.85);
            node.animLegs[0].rotation.x = swing;
            node.animLegs[1].rotation.x = -swing;
            node.animLegs[2].rotation.x = -swing;
            node.animLegs[3].rotation.x = swing;
          }
        } else if (node.animLegs) {
          const damp = Math.max(0, 1 - dt * 10);
          for (const leg of node.animLegs) {
            leg.rotation.x *= damp;
          }
        }
      } else if (
        body.protoId === 'HomingOrb_Fire' ||
        body.protoId === 'SummonedWisp' ||
        body.protoId === 'ExplosionShock'
      ) {
        const pulse = node.baseScale * (1 + Math.sin(timeSec * 8 + body.uid) * 0.14);
        node.group.scale.setScalar(pulse);
        if (node.orbitNodes) {
          for (let idx = 0; idx < node.orbitNodes.length; idx++) {
            const orb = node.orbitNodes[idx];
            const angle = timeSec * 4.5 + idx * Math.PI + body.uid;
            orb.position.set(
              Math.cos(angle) * 0.42,
              Math.sin(timeSec * 3.2 + idx * 1.5) * 0.16,
              Math.sin(angle) * 0.42,
            );
          }
        }
      }

      if (node.group.position.distanceToSquared(this.tmpVecA) > 6.0) {
        node.group.position.copy(this.tmpVecA);
      } else {
        node.group.position.lerp(this.tmpVecA, blend);
      }
    }

    for (const [uid, node] of this.freeBodyNodes.entries()) {
      if (!activeIds.has(uid)) {
        node.rigged?.dispose();
        this.freeBodyGroup.remove(node.group);
        this.freeBodyNodes.delete(uid);
      }
    }
  }

  private updateHighlight(hit: RayHit | null, timeSec: number): void {
    if (!hit) {
      this.highlightBox.visible = false;
      this.highlightFillBox.visible = false;
      return;
    }

    this.highlightBox.visible = true;
    this.highlightFillBox.visible = true;
    const ent = hit.entity;
    const vis = getVisual(ent.protoId);

    const accentColor =
      ent.protoId === 'AirBarrier' || ent.protoId === 'PastureStele' || ent.protoId === 'MistVeil'
        ? 0x7dd3fc
        : ent.protoId === 'GuardStele' ||
            ent.protoId === 'IronKnight' ||
            ent.protoId === 'IronKnight_Corpse'
          ? 0xfbbf24
          : ent.protoId === 'Workbench'
            ? 0xfcd34d
            : ent.protoId === 'Fire'
              ? 0xfdba74
              : 0xf8fafc;
    this.highlightMat.color.setHex(accentColor);
    this.highlightFillMat.color.setHex(accentColor);
    this.highlightFillMat.opacity = 0.08 + Math.sin(timeSec * 5.0) * 0.025;

    if (hit.kind === 'grid') {
      if (vis.thinDoor === 'closed') {
        this.highlightBox.position.set(ent.pos.x + 0.5, ent.pos.y + 0.5, ent.pos.z + 0.5);
        this.highlightBox.scale.set(1.02, 1.02, 0.22);
      } else if (vis.thinDoor === 'open') {
        this.highlightBox.position.set(ent.pos.x + 0.12, ent.pos.y + 0.5, ent.pos.z + 0.5);
        this.highlightBox.scale.set(0.22, 1.02, 1.02);
      } else {
        const h = vis.heightScale ?? 1;
        this.highlightBox.position.set(ent.pos.x + 0.5, ent.pos.y + h * 0.5, ent.pos.z + 0.5);
        this.highlightBox.scale.set(1.02, h + 0.02, 1.02);
      }
    } else {
      if (ent.protoId === 'IronKnight') {
        this.highlightBox.position.set(ent.pos.x, ent.pos.y - 0.65 + 1.04, ent.pos.z);
        this.highlightBox.scale.set(1.06, 2.08, 1.06);
      } else if (ent.protoId === 'IronKnight_Corpse') {
        this.highlightBox.position.set(ent.pos.x, ent.pos.y - 0.30, ent.pos.z);
        this.highlightBox.scale.set(1.15, 0.55, 1.45);
      } else {
        const isLarge =
          ent.protoId === 'Sheep_Live' ||
          ent.protoId === 'UndeadSheep' ||
          ent.protoId === 'Sheep_Corpse';
        const s = isLarge ? 0.94 : 0.48;
        this.highlightBox.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
        this.highlightBox.scale.set(s, s, s);
      }
    }

    this.highlightFillBox.position.copy(this.highlightBox.position);
    this.highlightFillBox.scale.copy(this.highlightBox.scale).multiplyScalar(0.995);
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    baseScale: number,
    lifetime: number,
    gravity: number,
  ): void {
    const limit = Math.min(MAX_PARTICLES_CAP, this.budget.maxParticles);
    if (this.particles.length >= limit) return;
    this.particles.push({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      colorHex,
      gravity,
      baseScale,
      age: 0,
      lifetime,
    });
  }

  private emitAmbientParticles(dt: number): void {
    this.ambientSpawnAccum += dt;
    if (this.ambientSpawnAccum < 0.08) return;
    this.ambientSpawnAccum = 0;

    for (const fp of this.firePositions) {
      if (Math.random() < 0.65) {
        this.spawnParticle(
          fp.x + (Math.random() - 0.5) * 0.36,
          fp.y + (Math.random() - 0.2) * 0.2,
          fp.z + (Math.random() - 0.5) * 0.36,
          (Math.random() - 0.5) * 0.35,
          1.0 + Math.random() * 0.9,
          (Math.random() - 0.5) * 0.35,
          Math.random() < 0.7 ? 0xff9f2e : 0x475569,
          0.75,
          0.7 + Math.random() * 0.5,
          -0.25,
        );
      }
    }

    for (const sp of this.stelePositions) {
      if (Math.random() < 0.5) {
        this.spawnParticle(
          sp.x + (Math.random() - 0.5) * 0.5,
          sp.y - 0.35 + Math.random() * 0.3,
          sp.z + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.2,
          0.65 + Math.random() * 0.45,
          (Math.random() - 0.5) * 0.2,
          sp.colorHex ?? 0x38bdf8,
          0.65,
          0.9 + Math.random() * 0.5,
          0,
        );
      }
    }

    for (const mp of this.mistPositions) {
      if (Math.random() < 0.35) {
        this.spawnParticle(
          mp.x + (Math.random() - 0.5) * 0.7,
          mp.y + (Math.random() - 0.5) * 0.5,
          mp.z + (Math.random() - 0.5) * 0.7,
          0.18 + Math.random() * 0.16,
          (Math.random() - 0.5) * 0.12,
          (Math.random() - 0.5) * 0.15,
          0xbae6fd,
          0.8,
          1.1 + Math.random() * 0.6,
          0,
        );
      }
    }
  }

  private consumePendingFx(world: IVoxelWorld): void {
    const bursts = world.getPendingFx();
    if (bursts.length === 0 || this.budget.maxParticles <= 0) return;

    for (const b of bursts) {
      const count = b.kind === 'aoe' ? 22 : b.kind === 'deathrattle' ? 14 : b.kind === 'craft' ? 14 : 8;
      const speedScale = b.kind === 'aoe' ? 5.5 : 3.2;

      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.85;
        const speed = (0.4 + Math.random() * 0.8) * speedScale;
        this.spawnParticle(
          b.pos.x,
          b.pos.y,
          b.pos.z,
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.cos(phi) * speed + 1.2,
          Math.sin(phi) * Math.sin(theta) * speed,
          b.colorHex,
          1.0,
          0.35 + Math.random() * 0.3,
          9.5,
        );
      }
    }
  }

  private syncParticleInstances(): void {
    const count = Math.min(MAX_PARTICLES_CAP, this.particles.length);
    if (count === 0) {
      this.particleInstMesh.count = 0;
      this.particleInstMesh.visible = false;
      return;
    }

    this.particleInstMesh.visible = true;
    this.particleInstMesh.count = count;

    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      const t = Math.max(0.05, 1 - p.age / p.lifetime) * p.baseScale;
      this.tmpObj.position.set(p.x, p.y, p.z);
      this.tmpObj.rotation.set(0, 0, 0);
      this.tmpObj.scale.setScalar(t);
      this.tmpObj.updateMatrix();
      this.particleInstMesh.setMatrixAt(i, this.tmpObj.matrix);
      this.tmpColor.setHex(p.colorHex);
      this.particleInstMesh.setColorAt(i, this.tmpColor);
    }

    this.particleInstMesh.instanceMatrix.needsUpdate = true;
    if (this.particleInstMesh.instanceColor) {
      this.particleInstMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateParticles(dt: number): void {
    let len = this.particles.length;
    for (let i = len - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.lifetime) {
        this.particles[i] = this.particles[len - 1];
        this.particles.pop();
        len--;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    this.syncParticleInstances();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    disposeIronKnightTemplate();

    this.fullBoxGeo.dispose();
    this.slabBoxGeo.dispose();
    this.waterBoxGeo.dispose();
    this.doorClosedGeo.dispose();
    this.doorOpenGeo.dispose();
    this.crackBoxGeo.dispose();
    this.unitEdgeGeo.dispose();
    this.saplingStemGeo.dispose();
    this.saplingCrownLowerGeo.dispose();
    this.saplingCrownUpperGeo.dispose();
    this.mushroomStemGeo.dispose();
    this.mushroomCapGeo.dispose();
    this.mushroomTopKnollGeo.dispose();
    this.steleBaseGeo.dispose();
    this.stelePillarGeo.dispose();
    this.particleGeo.dispose();

    this.disposeChunkMaterialCaches();
    for (const mat of this.freeBodyMatCache.values()) {
      mat.dispose();
    }
    this.freeBodyMatCache.clear();

    for (const mat of this.crackMaterials) {
      mat.dispose();
    }
    this.particleInstMat.dispose();
    this.particleInstMesh.dispose();
    this.glassEdgeMat.dispose();
    this.highlightMat.dispose();
    this.highlightFillMat.dispose();

    this.modelFactory.dispose();
    this.atmosphere.dispose();
    this.textures.dispose();

    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
