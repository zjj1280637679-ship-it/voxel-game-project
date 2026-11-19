import * as THREE from 'three';
import type { Coord3, EntityBlock } from '../core/contracts.ts';
import { getVisual } from './palette.ts';
import type { VoxelTextureLibrary } from './textures.ts';

export interface BuiltFreeBodyModel {
  group: THREE.Group;
  baseScale: number;
  animLegs?: [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D];
  orbitNodes?: THREE.Object3D[];
}

export interface AnimatedBlockRig {
  kind: 'fire' | 'stele_gem' | 'stele_gem_gold' | 'mist';
  group: THREE.Group;
  anchorPos: Coord3;
  phase: number;
}

type AnimatedRigState =
  | {
      kind: 'fire';
      outerA: THREE.Mesh;
      outerB: THREE.Mesh;
      inner: THREE.Mesh;
      ember: THREE.Mesh;
    }
  | {
      kind: 'stele_gem';
      crystal: THREE.Mesh;
      halo: THREE.Mesh;
    }
  | {
      kind: 'stele_gem_gold';
      crystal: THREE.Mesh;
      halo: THREE.Mesh;
    }
  | {
      kind: 'mist';
      lower: THREE.Mesh;
      upper: THREE.Mesh;
    };

const BLOCK_ITEM_BASES = new Set<string>([
  'Dirt',
  'Obsidian',
  'Sand',
  'IronOre',
  'OakLog',
  'OakPlank',
  'OakPlank_Slab',
  'OakDoor_Closed',
  'OakDoor_Open',
  'Workbench',
  'PastureStele',
  'GuardStele',
  'Sapling',
  'Leaf',
  'Mushroom',
]);

export class VoxelModelFactory {
  private readonly textures: VoxelTextureLibrary;

  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly accentMats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly haloMats = new Map<string, THREE.MeshBasicMaterial>();
  private readonly animStates = new WeakMap<THREE.Group, AnimatedRigState>();

  // Sheep geometries
  private readonly sheepBodyGeo: THREE.BoxGeometry;
  private readonly sheepSaddleGeo: THREE.BoxGeometry;
  private readonly sheepNeckTuftGeo: THREE.BoxGeometry;
  private readonly sheepTailGeo: THREE.BoxGeometry;
  private readonly sheepCrownTuftGeo: THREE.BoxGeometry;
  private readonly sheepHeadGeo: THREE.BoxGeometry;
  private readonly sheepSnoutGeo: THREE.BoxGeometry;
  private readonly sheepEarGeo: THREE.BoxGeometry;
  private readonly sheepEyeGeo: THREE.BoxGeometry;
  private readonly sheepGlintGeo: THREE.BoxGeometry;
  private readonly sheepLegGeo: THREE.BoxGeometry;
  private readonly sheepHoofGeo: THREE.BoxGeometry;

  // Arrow geometries
  private readonly arrowShaftGeo: THREE.BoxGeometry;
  private readonly arrowCollarGeo: THREE.BoxGeometry;
  private readonly arrowTipGeo: THREE.ConeGeometry;
  private readonly arrowFletchGeo: THREE.BoxGeometry;

  // Orb & shock geometries
  private readonly orbCoreGeo: THREE.OctahedronGeometry;
  private readonly orbInnerGeo: THREE.IcosahedronGeometry;
  private readonly orbHaloGeo: THREE.SphereGeometry;
  private readonly orbSparkGeo: THREE.BoxGeometry;

  // Falling block & items
  private readonly fallingBlockGeo: THREE.BoxGeometry;
  private readonly itemCubeGeo: THREE.BoxGeometry;
  private readonly bitCubeGeo: THREE.BoxGeometry;
  private readonly dropShadowGeo: THREE.PlaneGeometry;

  // Iron sword geometries
  private readonly swordPommelGeo: THREE.BoxGeometry;
  private readonly swordHiltGeo: THREE.BoxGeometry;
  private readonly swordGuardGeo: THREE.BoxGeometry;
  private readonly swordBladeGeo: THREE.BoxGeometry;
  private readonly swordTipGeo: THREE.ConeGeometry;

  // Gunpowder pack geometries
  private readonly packBodyGeo: THREE.BoxGeometry;
  private readonly packNeckGeo: THREE.BoxGeometry;
  private readonly packRibbonGeo: THREE.BoxGeometry;
  private readonly packFuseGeo: THREE.BoxGeometry;

  // Animated grid block geometries
  private readonly fireOuterGeo: THREE.OctahedronGeometry;
  private readonly fireInnerGeo: THREE.OctahedronGeometry;
  private readonly fireEmberGeo: THREE.BoxGeometry;
  private readonly steleCrystalGeo: THREE.OctahedronGeometry;
  private readonly steleHaloGeo: THREE.TorusGeometry;
  private readonly mistLayerGeo: THREE.BoxGeometry;

  // Shared materials for common accents & animated blocks
  private readonly featherMat: THREE.MeshStandardMaterial;
  private readonly dropShadowMat: THREE.MeshBasicMaterial;
  private readonly fireOuterMat: THREE.MeshStandardMaterial;
  private readonly fireInnerMat: THREE.MeshStandardMaterial;
  private readonly fireEmberMat: THREE.MeshBasicMaterial;
  private readonly steleCrystalMat: THREE.MeshStandardMaterial;
  private readonly steleHaloMat: THREE.MeshBasicMaterial;
  private readonly steleGoldCrystalMat: THREE.MeshStandardMaterial;
  private readonly steleGoldHaloMat: THREE.MeshBasicMaterial;
  private readonly mistLowerMat: THREE.MeshStandardMaterial;
  private readonly mistUpperMat: THREE.MeshStandardMaterial;

  private disposed = false;

  constructor(textures: VoxelTextureLibrary) {
    this.textures = textures;

    // Sheep parts
    this.sheepBodyGeo = this.trackGeo(new THREE.BoxGeometry(0.56, 0.44, 0.78));
    this.sheepSaddleGeo = this.trackGeo(new THREE.BoxGeometry(0.44, 0.1, 0.56));
    this.sheepNeckTuftGeo = this.trackGeo(new THREE.BoxGeometry(0.38, 0.28, 0.14));
    this.sheepTailGeo = this.trackGeo(new THREE.BoxGeometry(0.18, 0.16, 0.14));
    this.sheepCrownTuftGeo = this.trackGeo(new THREE.BoxGeometry(0.28, 0.07, 0.24));
    this.sheepHeadGeo = this.trackGeo(new THREE.BoxGeometry(0.32, 0.3, 0.32));
    this.sheepSnoutGeo = this.trackGeo(new THREE.BoxGeometry(0.22, 0.15, 0.1));
    this.sheepEarGeo = this.trackGeo(new THREE.BoxGeometry(0.11, 0.14, 0.07));
    this.sheepEyeGeo = this.trackGeo(new THREE.BoxGeometry(0.055, 0.055, 0.03));
    this.sheepGlintGeo = this.trackGeo(new THREE.BoxGeometry(0.03, 0.05, 0.025));
    this.sheepLegGeo = this.trackGeo(new THREE.BoxGeometry(0.13, 0.28, 0.13));
    this.sheepHoofGeo = this.trackGeo(new THREE.BoxGeometry(0.135, 0.07, 0.135));

    // Arrow parts (bake cone orientation so tip points straight along +Z)
    this.arrowShaftGeo = this.trackGeo(new THREE.BoxGeometry(0.06, 0.06, 0.7));
    this.arrowCollarGeo = this.trackGeo(new THREE.BoxGeometry(0.09, 0.09, 0.04));
    this.arrowTipGeo = this.trackGeo(new THREE.ConeGeometry(0.08, 0.16, 4));
    this.arrowTipGeo.rotateX(Math.PI * 0.5);
    this.arrowTipGeo.rotateZ(Math.PI * 0.25);
    this.arrowFletchGeo = this.trackGeo(new THREE.BoxGeometry(0.16, 0.012, 0.18));

    // Orbs
    this.orbCoreGeo = this.trackGeo(new THREE.OctahedronGeometry(0.24, 0));
    this.orbInnerGeo = this.trackGeo(new THREE.IcosahedronGeometry(0.14, 0));
    this.orbHaloGeo = this.trackGeo(new THREE.SphereGeometry(0.38, 12, 10));
    this.orbSparkGeo = this.trackGeo(new THREE.BoxGeometry(0.085, 0.085, 0.085));

    // Falling block & drops
    this.fallingBlockGeo = this.trackGeo(new THREE.BoxGeometry(0.94, 0.94, 0.94));
    this.itemCubeGeo = this.trackGeo(new THREE.BoxGeometry(0.32, 0.32, 0.32));
    this.bitCubeGeo = this.trackGeo(new THREE.BoxGeometry(0.28, 0.28, 0.28));
    this.dropShadowGeo = this.trackGeo(new THREE.PlaneGeometry(0.36, 0.36));
    this.dropShadowGeo.rotateX(-Math.PI * 0.5);

    // Iron sword
    this.swordPommelGeo = this.trackGeo(new THREE.BoxGeometry(0.1, 0.07, 0.07));
    this.swordHiltGeo = this.trackGeo(new THREE.BoxGeometry(0.06, 0.16, 0.06));
    this.swordGuardGeo = this.trackGeo(new THREE.BoxGeometry(0.24, 0.06, 0.09));
    this.swordBladeGeo = this.trackGeo(new THREE.BoxGeometry(0.11, 0.36, 0.045));
    this.swordTipGeo = this.trackGeo(new THREE.ConeGeometry(0.068, 0.11, 4));
    this.swordTipGeo.rotateY(Math.PI * 0.25);

    // Gunpowder pack
    this.packBodyGeo = this.trackGeo(new THREE.BoxGeometry(0.32, 0.28, 0.28));
    this.packNeckGeo = this.trackGeo(new THREE.BoxGeometry(0.16, 0.09, 0.14));
    this.packRibbonGeo = this.trackGeo(new THREE.BoxGeometry(0.34, 0.075, 0.3));
    this.packFuseGeo = this.trackGeo(new THREE.BoxGeometry(0.05, 0.08, 0.05));

    // Animated grid blocks
    this.fireOuterGeo = this.trackGeo(new THREE.OctahedronGeometry(0.3, 0));
    this.fireInnerGeo = this.trackGeo(new THREE.OctahedronGeometry(0.17, 0));
    this.fireEmberGeo = this.trackGeo(new THREE.BoxGeometry(0.075, 0.075, 0.075));
    this.steleCrystalGeo = this.trackGeo(new THREE.OctahedronGeometry(0.2, 0));
    this.steleHaloGeo = this.trackGeo(new THREE.TorusGeometry(0.32, 0.022, 8, 24));
    this.mistLayerGeo = this.trackGeo(new THREE.BoxGeometry(0.96, 0.42, 0.96));

    // Shared accent materials
    this.featherMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.72,
        metalness: 0.02,
      }),
    );
    this.dropShadowMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x090d16,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      }),
    );
    const fireTex = this.textures.getNamedTexture('fire');
    this.fireOuterMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xff6a1a,
        emissiveMap: fireTex,
        emissiveIntensity: 1.15,
        map: fireTex,
        transparent: true,
        opacity: 0.92,
        roughness: 0.55,
      }),
    );
    this.fireInnerMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfff3a8,
        emissive: 0xffc83d,
        emissiveIntensity: 1.5,
        roughness: 0.4,
      }),
    );
    this.fireEmberMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
      }),
    );
    this.steleCrystalMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0ea5e9,
        emissiveIntensity: 1.2,
        roughness: 0.18,
        metalness: 0.35,
      }),
    );
    this.steleHaloMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }),
    );
    this.steleGoldCrystalMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.25,
        roughness: 0.18,
        metalness: 0.42,
      }),
    );
    this.steleGoldHaloMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xfde68a,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      }),
    );
    this.mistLowerMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xbae6fd,
        emissive: 0x0c4a6e,
        emissiveIntensity: 0.42,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        roughness: 1.0,
      }),
    );
    this.mistUpperMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0x0284c7,
        emissiveIntensity: 0.32,
        transparent: true,
        opacity: 0.19,
        depthWrite: false,
        roughness: 1.0,
      }),
    );
  }

  public buildFreeBodyModel(
    body: EntityBlock,
    primaryMat: THREE.MeshStandardMaterial,
    getMat: (protoId: string, dmgBucket: number) => THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[],
  ): BuiltFreeBodyModel {
    const id = body.protoId;

    if (id === 'Sheep_Live' || id === 'UndeadSheep' || id === 'Sheep_Corpse') {
      return this.buildSheepModel(id, primaryMat);
    }
    if (id === 'Arrow_Wood') {
      return this.buildArrowModel(primaryMat);
    }
    if (id === 'StuckArrow') {
      return this.buildStuckArrowModel(primaryMat);
    }
    if (id === 'HomingOrb_Fire' || id === 'SummonedWisp' || id === 'ExplosionShock') {
      return this.buildOrbModel(id, primaryMat);
    }
    if (id === 'FallingBlock') {
      return this.buildFallingBlockModel(body, primaryMat, getMat);
    }
    if (id === 'IronSword_Item') {
      return this.buildIronSwordModel();
    }
    if (id === 'Gunpowder_Pack') {
      return this.buildGunpowderPackModel();
    }

    return this.buildDropItemModel(id, primaryMat, getMat);
  }

  public buildAnimatedBlock(kind: AnimatedBlockRig['kind'], pos: Coord3, phase: number): AnimatedBlockRig {
    const group = new THREE.Group();
    group.position.set(pos.x + 0.5, pos.y, pos.z + 0.5);

    if (kind === 'fire') {
      const outerA = new THREE.Mesh(this.fireOuterGeo, this.fireOuterMat);
      outerA.position.set(0, 0.36, 0);
      outerA.scale.set(0.85, 1.35, 0.85);

      const outerB = new THREE.Mesh(this.fireOuterGeo, this.fireOuterMat);
      outerB.position.set(0, 0.34, 0);
      outerB.rotation.y = Math.PI * 0.25;
      outerB.scale.set(0.85, 1.28, 0.85);

      const inner = new THREE.Mesh(this.fireInnerGeo, this.fireInnerMat);
      inner.position.set(0, 0.28, 0);
      inner.scale.set(0.75, 1.4, 0.75);

      const ember = new THREE.Mesh(this.fireEmberGeo, this.fireEmberMat);
      ember.position.set(0, 0.65, 0);

      group.add(outerA, outerB, inner, ember);
      this.animStates.set(group, { kind: 'fire', outerA, outerB, inner, ember });
    } else if (kind === 'stele_gem' || kind === 'stele_gem_gold') {
      const crystalMat = kind === 'stele_gem_gold' ? this.steleGoldCrystalMat : this.steleCrystalMat;
      const haloMat = kind === 'stele_gem_gold' ? this.steleGoldHaloMat : this.steleHaloMat;

      const crystal = new THREE.Mesh(this.steleCrystalGeo, crystalMat);
      crystal.position.set(0, 1.05, 0);
      crystal.scale.set(0.9, 1.25, 0.9);
      crystal.castShadow = true;

      const halo = new THREE.Mesh(this.steleHaloGeo, haloMat);
      halo.position.set(0, 1.05, 0);
      halo.rotation.x = Math.PI * 0.38;

      group.add(crystal, halo);
      this.animStates.set(group, { kind, crystal, halo });
    } else {
      const lower = new THREE.Mesh(this.mistLayerGeo, this.mistLowerMat);
      lower.position.set(0, 0.35, 0);

      const upper = new THREE.Mesh(this.mistLayerGeo, this.mistUpperMat);
      upper.position.set(0, 0.68, 0);
      upper.scale.set(0.92, 0.82, 0.92);

      group.add(lower, upper);
      this.animStates.set(group, { kind: 'mist', lower, upper });
    }

    return {
      kind,
      group,
      anchorPos: { x: pos.x, y: pos.y, z: pos.z },
      phase,
    };
  }

  public updateAnimatedBlock(rig: AnimatedBlockRig, timeSec: number): void {
    const state = this.animStates.get(rig.group);
    if (!state) return;

    if (state.kind === 'fire') {
      const f1 = Math.sin(timeSec * 11 + rig.phase);
      const f2 = Math.cos(timeSec * 17 + rig.phase);

      state.outerA.scale.set(0.85 + f2 * 0.08, 1.35 + f1 * 0.22, 0.85 - f2 * 0.08);
      state.outerA.rotation.y = f2 * 0.18;
      state.outerA.rotation.z = f1 * 0.08;
      state.outerA.position.y = 0.36 + f1 * 0.035;

      state.outerB.scale.set(0.85 - f1 * 0.08, 1.28 + f2 * 0.24, 0.85 + f1 * 0.08);
      state.outerB.rotation.y = Math.PI * 0.25 + f1 * 0.2;
      state.outerB.rotation.x = f2 * 0.08;
      state.outerB.position.y = 0.34 + f2 * 0.035;

      state.inner.scale.set(0.75 + f1 * 0.06, 1.42 - f2 * 0.24, 0.75 + f1 * 0.06);
      state.inner.position.y = 0.28 + f2 * 0.04;

      const emberT = ((timeSec * 0.85 + rig.phase * 0.17) % 1 + 1) % 1;
      state.ember.position.set(
        Math.sin(timeSec * 5 + rig.phase) * 0.1,
        0.48 + emberT * 0.48,
        Math.cos(timeSec * 4.3 + rig.phase) * 0.1,
      );
      const emberScale = Math.max(0.15, 1.0 - emberT * 0.85);
      state.ember.scale.setScalar(emberScale);
    } else if (state.kind === 'stele_gem' || state.kind === 'stele_gem_gold') {
      const bob = Math.sin(timeSec * 2.4 + rig.phase) * 0.07;
      state.crystal.position.y = 1.05 + bob;
      state.crystal.rotation.y = timeSec * 1.6 + rig.phase;

      state.halo.position.y = 1.05 + bob;
      state.halo.rotation.z = -timeSec * 1.15 - rig.phase;
      state.halo.rotation.y = -timeSec * 0.85 + rig.phase * 0.5;
    } else {
      const sway1 = Math.sin(timeSec * 1.15 + rig.phase);
      const sway2 = Math.cos(timeSec * 0.95 + rig.phase * 1.3);

      state.lower.position.set(sway1 * 0.04, 0.35 + sway2 * 0.035, sway2 * 0.04);
      state.lower.scale.set(1.0 + sway1 * 0.035, 1.0 + sway2 * 0.06, 1.0 - sway1 * 0.035);

      state.upper.position.set(-sway2 * 0.045, 0.68 - sway1 * 0.035, sway1 * 0.045);
      state.upper.rotation.y = sway1 * 0.08;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const geo of this.ownedGeometries) {
      geo.dispose();
    }
    this.ownedGeometries.length = 0;

    for (const mat of this.ownedMaterials) {
      mat.dispose();
    }
    this.ownedMaterials.length = 0;

    this.accentMats.clear();
    this.haloMats.clear();
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.ownedGeometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.ownedMaterials.push(mat);
    return mat;
  }

  private getAccentMat(
    key: string,
    color: number,
    options?: {
      emissive?: number;
      emissiveIntensity?: number;
      roughness?: number;
      metalness?: number;
    },
  ): THREE.MeshStandardMaterial {
    let mat = this.accentMats.get(key);
    if (!mat) {
      mat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color,
          emissive: options?.emissive ?? 0x000000,
          emissiveIntensity: options?.emissiveIntensity ?? 1.0,
          roughness: options?.roughness ?? 0.85,
          metalness: options?.metalness ?? 0.05,
        }),
      );
      this.accentMats.set(key, mat);
    }
    return mat;
  }

  private getWoolMaterial(primaryMat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const key = `wool::${primaryMat.color.getHexString()}::${primaryMat.emissive.getHexString()}`;
    let mat = this.accentMats.get(key);
    if (!mat) {
      mat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: primaryMat.color.clone(),
          emissive: primaryMat.emissive.clone(),
          emissiveIntensity: primaryMat.emissiveIntensity,
          map: this.textures.getNamedTexture('wool'),
          roughness: 0.92,
          metalness: 0.02,
        }),
      );
      this.accentMats.set(key, mat);
    }
    return mat;
  }

  private getHaloMaterial(colorHex: number, opacity = 0.34): THREE.MeshBasicMaterial {
    const key = `${colorHex}::${Math.round(opacity * 255)}`;
    let mat = this.haloMats.get(key);
    if (!mat) {
      mat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.haloMats.set(key, mat);
    }
    return mat;
  }

  private buildSheepModel(
    protoId: 'Sheep_Live' | 'UndeadSheep' | 'Sheep_Corpse',
    primaryMat: THREE.MeshStandardMaterial,
  ): BuiltFreeBodyModel {
    const group = new THREE.Group();
    const woolMat = this.getWoolMaterial(primaryMat);

    const isUndead = protoId === 'UndeadSheep';
    const isCorpse = protoId === 'Sheep_Corpse';

    const skinMat = isUndead
      ? this.getAccentMat('sheep_skin_undead', 0x5c6e58, { emissive: 0x0e1d12, roughness: 0.9 })
      : isCorpse
        ? this.getAccentMat('sheep_skin_corpse', 0xa6998f, { roughness: 0.92 })
        : this.getAccentMat('sheep_skin_live', 0xdcc0a4, { roughness: 0.88 });

    const snoutMat = isUndead
      ? this.getAccentMat('sheep_snout_undead', 0x374235, { roughness: 0.9 })
      : isCorpse
        ? this.getAccentMat('sheep_snout_corpse', 0x6f635c, { roughness: 0.92 })
        : this.getAccentMat('sheep_snout_live', 0xa8826b, { roughness: 0.88 });

    const hoofMat = isUndead
      ? this.getAccentMat('sheep_hoof_undead', 0x262d26, { roughness: 0.88 })
      : this.getAccentMat('sheep_hoof_dark', 0x3b332e, { roughness: 0.85 });

    const eyeMat = isUndead
      ? this.getAccentMat('sheep_eye_undead', 0x4ade80, {
          emissive: 0x4ade80,
          emissiveIntensity: 1.4,
          roughness: 0.3,
        })
      : isCorpse
        ? this.getAccentMat('sheep_eye_corpse', 0x3f3f46, { roughness: 0.8 })
        : this.getAccentMat('sheep_eye_live', 0x111827, { roughness: 0.35 });

    const addSolid = (mesh: THREE.Mesh, parent: THREE.Object3D = group): THREE.Mesh => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Wool body + upper saddle tuft + chest neck tuft + tail puff
    const bodyMesh = addSolid(new THREE.Mesh(this.sheepBodyGeo, woolMat));
    bodyMesh.position.set(0, 0.08, 0);

    const saddleMesh = addSolid(new THREE.Mesh(this.sheepSaddleGeo, woolMat));
    saddleMesh.position.set(0, 0.32, -0.02);

    const neckTuft = addSolid(new THREE.Mesh(this.sheepNeckTuftGeo, woolMat));
    neckTuft.position.set(0, 0.1, 0.36);

    const tailMesh = addSolid(new THREE.Mesh(this.sheepTailGeo, woolMat));
    tailMesh.position.set(0, 0.13, -0.42);
    tailMesh.rotation.x = -0.25;

    // Sculpted head, crown tuft, snout, floppy ears & crisp eye pixels
    const headMesh = addSolid(new THREE.Mesh(this.sheepHeadGeo, skinMat));
    headMesh.position.set(0, 0.2, 0.46);

    const crownTuft = addSolid(new THREE.Mesh(this.sheepCrownTuftGeo, woolMat));
    crownTuft.position.set(0, 0.365, 0.44);

    const snoutMesh = addSolid(new THREE.Mesh(this.sheepSnoutGeo, snoutMat));
    snoutMesh.position.set(0, 0.135, 0.63);

    const earL = addSolid(new THREE.Mesh(this.sheepEarGeo, snoutMat));
    earL.position.set(-0.2, 0.22, 0.44);
    earL.rotation.z = 0.42;

    const earR = addSolid(new THREE.Mesh(this.sheepEarGeo, snoutMat));
    earR.position.set(0.2, 0.22, 0.44);
    earR.rotation.z = -0.42;

    const eyeL = new THREE.Mesh(this.sheepEyeGeo, eyeMat);
    eyeL.position.set(-0.085, 0.24, 0.625);
    const eyeR = new THREE.Mesh(this.sheepEyeGeo, eyeMat);
    eyeR.position.set(0.085, 0.24, 0.625);
    group.add(eyeL, eyeR);

    if (!isUndead && !isCorpse) {
      const scleraMat = this.getAccentMat('sheep_sclera', 0xf8fafc, { roughness: 0.4 });
      const glintL = new THREE.Mesh(this.sheepGlintGeo, scleraMat);
      glintL.position.set(-0.122, 0.24, 0.622);
      const glintR = new THREE.Mesh(this.sheepGlintGeo, scleraMat);
      glintR.position.set(0.122, 0.24, 0.622);
      group.add(glintL, glintR);
    }

    // 4 articulated legs pivoted near the top hip joint (y = -0.10)
    const buildHipLeg = (hx: number, hz: number): THREE.Group => {
      const hip = new THREE.Group();
      hip.position.set(hx, -0.1, hz);

      const leg = addSolid(new THREE.Mesh(this.sheepLegGeo, skinMat), hip);
      leg.position.set(0, -0.14, 0);

      const hoof = addSolid(new THREE.Mesh(this.sheepHoofGeo, hoofMat), hip);
      hoof.position.set(0, -0.305, 0);

      group.add(hip);
      return hip;
    };

    const fl = buildHipLeg(-0.17, 0.23);
    const fr = buildHipLeg(0.17, 0.23);
    const bl = buildHipLeg(-0.17, -0.23);
    const br = buildHipLeg(0.17, -0.23);

    if (isCorpse) {
      group.rotation.z = Math.PI * 0.45;
    }

    return {
      group,
      baseScale: 1,
      animLegs: [fl, fr, bl, br],
    };
  }

  private buildArrowModel(primaryMat: THREE.MeshStandardMaterial): BuiltFreeBodyModel {
    const group = new THREE.Group();

    const shaft = new THREE.Mesh(this.arrowShaftGeo, primaryMat);
    shaft.castShadow = true;

    const tipMat = this.getAccentMat('arrow_tip_iron', 0x94a3b8, {
      roughness: 0.35,
      metalness: 0.65,
    });
    const collar = new THREE.Mesh(this.arrowCollarGeo, tipMat);
    collar.position.set(0, 0, 0.31);
    collar.castShadow = true;

    const tip = new THREE.Mesh(this.arrowTipGeo, tipMat);
    tip.position.set(0, 0, 0.4);
    tip.castShadow = true;

    const vaneA = new THREE.Mesh(this.arrowFletchGeo, this.featherMat);
    vaneA.position.set(0, 0, -0.28);
    vaneA.rotation.z = Math.PI * 0.25;

    const vaneB = new THREE.Mesh(this.arrowFletchGeo, this.featherMat);
    vaneB.position.set(0, 0, -0.28);
    vaneB.rotation.z = -Math.PI * 0.25;

    group.add(shaft, collar, tip, vaneA, vaneB);
    return { group, baseScale: 1 };
  }

  private buildStuckArrowModel(primaryMat: THREE.MeshStandardMaterial): BuiltFreeBodyModel {
    const group = new THREE.Group();
    const arrow = this.buildArrowModel(primaryMat).group;
    arrow.scale.setScalar(0.76);
    arrow.rotation.set(0.38, 0.2, 0.16);
    group.add(arrow);

    const shadowQuad = new THREE.Mesh(this.dropShadowGeo, this.dropShadowMat);
    shadowQuad.position.set(0, -0.21, 0);
    group.add(shadowQuad);

    return { group, baseScale: 1 };
  }

  private buildOrbModel(
    protoId: 'HomingOrb_Fire' | 'SummonedWisp' | 'ExplosionShock',
    primaryMat: THREE.MeshStandardMaterial,
  ): BuiltFreeBodyModel {
    const group = new THREE.Group();
    const vis = getVisual(protoId);
    const glowHex = vis.emissive ?? vis.color;

    const core = new THREE.Mesh(this.orbCoreGeo, primaryMat);
    group.add(core);

    if (protoId !== 'ExplosionShock') {
      const innerColor = protoId === 'HomingOrb_Fire' ? 0xfff3a8 : 0xe0f7ff;
      const innerMat = this.getAccentMat(`orb_inner_${protoId}`, innerColor, {
        emissive: glowHex,
        emissiveIntensity: 1.6,
        roughness: 0.2,
      });
      const inner = new THREE.Mesh(this.orbInnerGeo, innerMat);
      group.add(inner);
    }

    const haloMat = this.getHaloMaterial(glowHex, protoId === 'ExplosionShock' ? 0.42 : 0.34);
    const halo = new THREE.Mesh(this.orbHaloGeo, haloMat);
    group.add(halo);

    const sparkColor = protoId === 'SummonedWisp' ? 0xe0f7ff : 0xffe484;
    const sparkMat = this.getAccentMat(`orb_spark_${protoId}`, sparkColor, {
      emissive: glowHex,
      emissiveIntensity: 1.45,
      roughness: 0.25,
    });
    const sparkA = new THREE.Mesh(this.orbSparkGeo, sparkMat);
    sparkA.position.set(0.42, 0.04, 0);
    const sparkB = new THREE.Mesh(this.orbSparkGeo, sparkMat);
    sparkB.position.set(-0.42, -0.04, 0);
    group.add(sparkA, sparkB);

    return {
      group,
      baseScale: 1,
      orbitNodes: [sparkA, sparkB],
    };
  }

  private buildFallingBlockModel(
    body: EntityBlock,
    primaryMat: THREE.MeshStandardMaterial,
    getMat: (protoId: string, dmgBucket: number) => THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[],
  ): BuiltFreeBodyModel {
    const group = new THREE.Group();
    const mat = body.payloadProtoId ? getMat(body.payloadProtoId, 0) : primaryMat;
    const mesh = new THREE.Mesh(this.fallingBlockGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return { group, baseScale: 1 };
  }

  private buildIronSwordModel(): BuiltFreeBodyModel {
    const group = new THREE.Group();
    const swordPivot = new THREE.Group();
    swordPivot.position.set(0, 0.03, 0);
    swordPivot.rotation.z = -Math.PI * 0.22;

    const pommelMat = this.getAccentMat('sword_pommel', 0x475569, {
      roughness: 0.35,
      metalness: 0.75,
    });
    const gripMat = this.getAccentMat('sword_grip', 0x6b4423, {
      roughness: 0.85,
      metalness: 0.05,
    });
    const guardMat = this.getAccentMat('sword_guard', 0x64748b, {
      roughness: 0.32,
      metalness: 0.78,
    });
    const bladeMat = this.getAccentMat('sword_blade', 0xdbeafe, {
      emissive: 0x1e293b,
      emissiveIntensity: 0.65,
      roughness: 0.18,
      metalness: 0.85,
    });

    const addPart = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, y, 0);
      m.castShadow = true;
      swordPivot.add(m);
    };

    addPart(this.swordPommelGeo, pommelMat, -0.25);
    addPart(this.swordHiltGeo, gripMat, -0.15);
    addPart(this.swordGuardGeo, guardMat, -0.05);
    addPart(this.swordBladeGeo, bladeMat, 0.155);
    addPart(this.swordTipGeo, bladeMat, 0.39);

    group.add(swordPivot);

    const shadowQuad = new THREE.Mesh(this.dropShadowGeo, this.dropShadowMat);
    shadowQuad.position.set(0, -0.21, 0);
    group.add(shadowQuad);

    return { group, baseScale: 1 };
  }

  private buildGunpowderPackModel(): BuiltFreeBodyModel {
    const group = new THREE.Group();

    const sackMat = this.getAccentMat('gunpowder_sack', 0x33373d, { roughness: 0.92 });
    const neckMat = this.getAccentMat('gunpowder_neck', 0x474c54, { roughness: 0.9 });
    const ribbonMat = this.getAccentMat('gunpowder_ribbon', 0xdc2626, {
      emissive: 0x450a0a,
      roughness: 0.6,
    });
    const fuseMat = this.getAccentMat('gunpowder_fuse', 0xfbbf24, {
      emissive: 0xf59e0b,
      emissiveIntensity: 1.2,
      roughness: 0.4,
    });

    const sack = new THREE.Mesh(this.packBodyGeo, sackMat);
    sack.position.set(0, 0.01, 0);
    sack.castShadow = true;
    sack.receiveShadow = true;

    const neck = new THREE.Mesh(this.packNeckGeo, neckMat);
    neck.position.set(0, 0.18, 0);
    neck.castShadow = true;

    const ribbon = new THREE.Mesh(this.packRibbonGeo, ribbonMat);
    ribbon.position.set(0, 0.02, 0);
    ribbon.castShadow = true;

    const fuse = new THREE.Mesh(this.packFuseGeo, fuseMat);
    fuse.position.set(0.03, 0.25, 0.02);
    fuse.rotation.z = -0.25;

    const shadowQuad = new THREE.Mesh(this.dropShadowGeo, this.dropShadowMat);
    shadowQuad.position.set(0, -0.21, 0);

    group.add(sack, neck, ribbon, fuse, shadowQuad);
    return { group, baseScale: 1 };
  }

  private buildDropItemModel(
    protoId: string,
    primaryMat: THREE.MeshStandardMaterial,
    getMat: (protoId: string, dmgBucket: number) => THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[],
  ): BuiltFreeBodyModel {
    const group = new THREE.Group();
    const isBit = protoId.endsWith('_Bit');
    const geo = isBit ? this.bitCubeGeo : this.itemCubeGeo;

    let mat: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] = primaryMat;
    if (protoId.endsWith('_Item')) {
      const baseProto = protoId.slice(0, -5);
      if (BLOCK_ITEM_BASES.has(baseProto)) {
        mat = getMat(baseProto, 0);
      }
    }

    const cube = new THREE.Mesh(geo, mat);
    cube.castShadow = true;
    cube.receiveShadow = true;
    group.add(cube);

    const shadowQuad = new THREE.Mesh(this.dropShadowGeo, this.dropShadowMat);
    shadowQuad.position.set(0, -0.21, 0);
    group.add(shadowQuad);

    return { group, baseScale: 1 };
  }
}
