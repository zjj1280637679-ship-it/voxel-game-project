import * as THREE from 'three';
import type { PerformanceBudget, ShadowQuality } from './performanceBudget.ts';

export type AtmospherePreset = 'day' | 'sunset' | 'night';

export const ATMOSPHERE_LABELS: Record<AtmospherePreset, string> = {
  day: '☀️ 晴昼',
  sunset: '🌅 黄昏',
  night: '🌙 星夜',
};

interface PresetConfig {
  topColor: number;
  midColor: number;
  horizonColor: number;
  sunOffset: [number, number, number];
  sunColor: number;
  sunLightColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  rimOffset: [number, number, number];
  rimColor: number;
  rimIntensity: number;
  fogColor: number;
  fogDensity: number;
  starStrength: number;
  cloudTint: number;
  cloudEmissiveIntensity: number;
}

interface CloudCluster {
  x: number;
  y: number;
  baseY: number;
  z: number;
  speed: number;
  scale: number;
  bobPhase: number;
}

interface CloudPuff {
  clusterIndex: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

const SHADOW_MAP_SIZES: Record<ShadowQuality, 0 | 512 | 1024 | 2048> = {
  off: 0,
  low: 512,
  med: 1024,
  high: 2048,
};

const SHADOW_BIASES: Record<512 | 1024 | 2048, { bias: number; normalBias: number }> = {
  512: { bias: -0.001, normalBias: 0.05 },
  1024: { bias: -0.0007, normalBias: 0.04 },
  2048: { bias: -0.0005, normalBias: 0.035 },
};

const PRESETS: Record<AtmospherePreset, PresetConfig> = {
  day: {
    topColor: 0x2b6cb0,
    midColor: 0x82c8fa,
    horizonColor: 0xe8f4fc,
    sunOffset: [18, 34, 14],
    sunColor: 0xfff8dc,
    sunLightColor: 0xfff5db,
    sunIntensity: 1.55,
    hemiSky: 0xe6f4ff,
    hemiGround: 0x465e3b,
    hemiIntensity: 0.85,
    rimOffset: [-16, 15, -16],
    rimColor: 0x99ccff,
    rimIntensity: 0.36,
    fogColor: 0xcfe7fa,
    fogDensity: 0.0095,
    starStrength: 0.0,
    cloudTint: 0xffffff,
    cloudEmissiveIntensity: 0.24,
  },
  sunset: {
    topColor: 0x252954,
    midColor: 0xc96953,
    horizonColor: 0xfcd088,
    sunOffset: [26, 11, -16],
    sunColor: 0xffcb78,
    sunLightColor: 0xffae60,
    sunIntensity: 1.65,
    hemiSky: 0xffcaa6,
    hemiGround: 0x3a2b2d,
    hemiIntensity: 0.78,
    rimOffset: [-20, 14, 16],
    rimColor: 0x7b8cff,
    rimIntensity: 0.38,
    fogColor: 0xe8a578,
    fogDensity: 0.0125,
    starStrength: 0.15,
    cloudTint: 0xffcfa3,
    cloudEmissiveIntensity: 0.28,
  },
  night: {
    topColor: 0x060b1c,
    midColor: 0x12203f,
    horizonColor: 0x1d3158,
    sunOffset: [-18, 28, 16],
    sunColor: 0xdce8ff,
    sunLightColor: 0xa3c2ff,
    sunIntensity: 0.55,
    hemiSky: 0x3e5b99,
    hemiGround: 0x161c2e,
    hemiIntensity: 0.50,
    rimOffset: [18, 12, -16],
    rimColor: 0x5c7ec9,
    rimIntensity: 0.32,
    fogColor: 0x121e38,
    fogDensity: 0.0155,
    starStrength: 1.0,
    cloudTint: 0x445880,
    cloudEmissiveIntensity: 0.22,
  },
};

const PRESET_ORDER: readonly AtmospherePreset[] = ['day', 'sunset', 'night'];

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;

  void main() {
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uTopColor;
  uniform vec3 uMidColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uStarStrength;
  uniform float uTime;

  varying vec3 vWorldDir;

  float hash31(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yxz + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yxz + 19.19);
    return fract(vec3(p.x * p.y, p.y * p.z, p.z * p.x));
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    vec3 sunDir = normalize(uSunDir);

    float h = clamp(dir.y, -0.2, 1.0);
    vec3 sky;
    if (h >= 0.0) {
      float tMid = smoothstep(0.0, 0.26, h);
      float tTop = smoothstep(0.18, 0.85, h);
      sky = mix(uHorizonColor, uMidColor, tMid);
      sky = mix(sky, uTopColor, tTop);
    } else {
      float tAbyss = clamp(-h / 0.2, 0.0, 1.0);
      sky = mix(uHorizonColor, uHorizonColor * 0.42, tAbyss);
    }

    float sunDot = dot(dir, sunDir);
    float sunPos = max(sunDot, 0.0);
    float disc = smoothstep(0.9965, 0.9992, sunDot);
    float halo = pow(sunPos, 18.0);
    float wideGlow = pow(sunPos, 4.0);

    sky += uSunColor * (halo * 0.55 + wideGlow * 0.16);
    sky = mix(sky, uSunColor * 1.35 + vec3(0.12), disc);

    if (uStarStrength > 0.01 && dir.y > 0.01) {
      float horizonFade = smoothstep(0.01, 0.26, dir.y);
      float starMask = 0.0;

      vec3 p1 = dir * 92.0;
      vec3 c1 = floor(p1);
      vec3 f1 = fract(p1) - 0.5;
      float r1 = hash31(c1);
      if (r1 > 0.968) {
        vec3 j1 = (hash33(c1 + 7.13) - 0.5) * 0.42;
        float d1 = length(f1 - j1);
        float spark = smoothstep(0.20, 0.03, d1);
        float twinkle = 0.65 + 0.35 * sin(uTime * (1.8 + r1 * 2.5) + r1 * 62.8318);
        starMask += spark * twinkle;
      }

      vec3 p2 = dir * 150.0;
      vec3 c2 = floor(p2);
      vec3 f2 = fract(p2) - 0.5;
      float r2 = hash31(c2 + 31.7);
      if (r2 > 0.962) {
        vec3 j2 = (hash33(c2 + 13.9) - 0.5) * 0.44;
        float d2 = length(f2 - j2);
        float spark2 = smoothstep(0.18, 0.03, d2) * 0.6;
        float twinkle2 = 0.60 + 0.40 * sin(uTime * (2.3 + r2 * 3.1) + r2 * 45.0);
        starMask += spark2 * twinkle2;
      }

      vec3 starTint = mix(vec3(0.82, 0.90, 1.0), vec3(1.0, 0.95, 0.85), fract(r1 * 17.3));
      sky += starTint * starMask * horizonFade * uStarStrength * (1.0 - disc);
    }

    gl_FragColor = vec4(sky, 1.0);
    #include <colorspace_fragment>
  }
`;

export class AtmosphereRig {
  public readonly sunLight: THREE.DirectionalLight;

  private readonly scene: THREE.Scene;
  private readonly worldSizeX: number;
  private readonly worldSizeZ: number;
  private readonly centerX: number;
  private readonly centerZ: number;

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly fog: THREE.FogExp2;

  private readonly skyGeo: THREE.SphereGeometry;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly skyMesh: THREE.Mesh;

  private readonly cloudGeo: THREE.BoxGeometry;
  private readonly cloudMat: THREE.MeshLambertMaterial;
  private readonly cloudInstMesh: THREE.InstancedMesh;
  private readonly clouds: CloudCluster[] = [];
  private readonly cloudPuffs: CloudPuff[] = [];

  private readonly unitBoxGeo: THREE.BoxGeometry;
  private readonly skirtGroup = new THREE.Group();
  private readonly ownedInstancedMeshes: THREE.InstancedMesh[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];

  private readonly tmpDummy = new THREE.Object3D();
  private readonly tmpSunPos = new THREE.Vector3();
  private readonly tmpSunDir = new THREE.Vector3();

  private currentShadowSize = 2048;
  private currentPreset: AtmospherePreset = 'day';
  private disposed = false;

  constructor(scene: THREE.Scene, worldSizeX = 24, worldSizeZ = 24) {
    this.scene = scene;
    this.worldSizeX = worldSizeX;
    this.worldSizeZ = worldSizeZ;
    this.centerX = worldSizeX * 0.5;
    this.centerZ = worldSizeZ * 0.5;

    // Primary shadow-casting directional light
    this.sunLight = new THREE.DirectionalLight(0xfff4d6, 1.55);
    this.sunLight.target.position.set(this.centerX, 2, this.centerZ);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -22;
    this.sunLight.shadow.camera.right = 22;
    this.sunLight.shadow.camera.top = 22;
    this.sunLight.shadow.camera.bottom = -22;
    this.sunLight.shadow.camera.near = 4;
    this.sunLight.shadow.camera.far = 88;
    this.sunLight.shadow.camera.updateProjectionMatrix();
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.035;
    this.scene.add(this.sunLight, this.sunLight.target);

    // Sky-to-ground bounce hemisphere light
    this.hemiLight = new THREE.HemisphereLight(0xe6f4ff, 0x465e3b, 0.85);
    this.scene.add(this.hemiLight);

    // Cool backlit rim light for shadowed silhouette separation (no shadow)
    this.rimLight = new THREE.DirectionalLight(0x99ccff, 0.36);
    this.rimLight.castShadow = false;
    this.rimLight.target.position.set(this.centerX, 2, this.centerZ);
    this.scene.add(this.rimLight, this.rimLight.target);

    // Exponential atmospheric fog
    this.fog = new THREE.FogExp2(0xcfe7fa, 0.0095);
    this.scene.fog = this.fog;

    // Sky dome
    this.skyGeo = new THREE.SphereGeometry(118, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTopColor: { value: new THREE.Color(0x2b6cb0) },
        uMidColor: { value: new THREE.Color(0x82c8fa) },
        uHorizonColor: { value: new THREE.Color(0xe8f4fc) },
        uSunDir: { value: new THREE.Vector3(18, 32, 14).normalize() },
        uSunColor: { value: new THREE.Color(0xfff8dc) },
        uStarStrength: { value: 0.0 },
        uTime: { value: 0.0 },
      },
    });
    this.skyMesh = new THREE.Mesh(this.skyGeo, this.skyMat);
    this.skyMesh.position.set(this.centerX, 4, this.centerZ);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -10;
    this.scene.add(this.skyMesh);
    this.ownedGeometries.push(this.skyGeo);
    this.ownedMaterials.push(this.skyMat);

    // Stylized drifting voxel cloud layer (batched into 1 InstancedMesh)
    this.cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    this.cloudMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.24,
      transparent: true,
      opacity: 0.85,
      depthWrite: true,
    });
    this.ownedGeometries.push(this.cloudGeo);
    this.ownedMaterials.push(this.cloudMat);
    this.cloudInstMesh = this.buildClouds();
    this.ownedInstancedMeshes.push(this.cloudInstMesh);
    this.syncCloudMatrices();
    this.scene.add(this.cloudInstMesh);

    // Floating island cliff underside skirt (3 tiered InstancedMeshes sharing 1 unit box)
    this.unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.ownedGeometries.push(this.unitBoxGeo);
    this.buildIslandSkirt();
    this.scene.add(this.skirtGroup);

    this.setPreset('day');
  }

  /**
   * Applies cloud visibility and directional shadow map quality from a PerformanceBudget.
   * Returns true if shadow configuration (castShadow or mapSize) changed.
   */
  public applyBudget(budget: PerformanceBudget): boolean {
    if (this.disposed) return false;

    this.cloudInstMesh.visible = budget.clouds;

    const targetSize = SHADOW_MAP_SIZES[budget.shadowQuality];
    const prevCastShadow = this.sunLight.castShadow;
    const prevShadowSize = this.currentShadowSize;

    if (targetSize === 0) {
      this.sunLight.castShadow = false;
      return prevCastShadow !== false;
    }

    this.sunLight.castShadow = true;
    const biasCfg = SHADOW_BIASES[targetSize];
    this.sunLight.shadow.bias = biasCfg.bias;
    this.sunLight.shadow.normalBias = biasCfg.normalBias;

    if (targetSize !== this.currentShadowSize) {
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
      this.sunLight.shadow.mapSize.set(targetSize, targetSize);
      this.currentShadowSize = targetSize;
    }

    return !prevCastShadow || prevShadowSize !== targetSize;
  }

  public setPreset(preset: AtmospherePreset): void {
    if (this.disposed) return;

    this.currentPreset = preset;
    const cfg = PRESETS[preset];

    this.skyMat.uniforms.uTopColor.value.setHex(cfg.topColor);
    this.skyMat.uniforms.uMidColor.value.setHex(cfg.midColor);
    this.skyMat.uniforms.uHorizonColor.value.setHex(cfg.horizonColor);
    this.skyMat.uniforms.uSunColor.value.setHex(cfg.sunColor);
    this.skyMat.uniforms.uStarStrength.value = cfg.starStrength;

    this.tmpSunPos.set(
      this.centerX + cfg.sunOffset[0],
      cfg.sunOffset[1],
      this.centerZ + cfg.sunOffset[2],
    );
    this.sunLight.position.copy(this.tmpSunPos);
    this.sunLight.color.setHex(cfg.sunLightColor);
    this.sunLight.intensity = cfg.sunIntensity;

    this.tmpSunDir.copy(this.tmpSunPos).sub(this.sunLight.target.position).normalize();
    this.skyMat.uniforms.uSunDir.value.copy(this.tmpSunDir);

    this.hemiLight.color.setHex(cfg.hemiSky);
    this.hemiLight.groundColor.setHex(cfg.hemiGround);
    this.hemiLight.intensity = cfg.hemiIntensity;

    this.rimLight.position.set(
      this.centerX + cfg.rimOffset[0],
      cfg.rimOffset[1],
      this.centerZ + cfg.rimOffset[2],
    );
    this.rimLight.color.setHex(cfg.rimColor);
    this.rimLight.intensity = cfg.rimIntensity;

    this.fog.color.setHex(cfg.fogColor);
    this.fog.density = cfg.fogDensity;
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(cfg.horizonColor);
    } else {
      this.scene.background = new THREE.Color(cfg.horizonColor);
    }

    this.cloudMat.color.setHex(cfg.cloudTint);
    this.cloudMat.emissive.setHex(cfg.cloudTint);
    this.cloudMat.emissiveIntensity = cfg.cloudEmissiveIntensity;
  }

  public getPreset(): AtmospherePreset {
    return this.currentPreset;
  }

  public cyclePreset(): AtmospherePreset {
    const idx = PRESET_ORDER.indexOf(this.currentPreset);
    const next = PRESET_ORDER[(idx + 1) % PRESET_ORDER.length];
    this.setPreset(next);
    return next;
  }

  public update(dt: number, timeSec: number, cameraPos: THREE.Vector3): void {
    if (this.disposed) return;

    this.skyMat.uniforms.uTime.value = timeSec;
    this.skyMesh.position.copy(cameraPos);

    if (!this.cloudInstMesh.visible) return;

    const minX = -18;
    const maxX = this.worldSizeX + 18;
    const spanX = maxX - minX;

    for (let i = 0; i < this.clouds.length; i++) {
      const cloud = this.clouds[i];
      let nextX = cloud.x + cloud.speed * dt;
      if (nextX > maxX) {
        nextX = minX + ((nextX - minX) % spanX);
      }
      cloud.x = nextX;
      cloud.y = cloud.baseY + Math.sin(timeSec * 0.45 + cloud.bobPhase) * 0.14;
    }

    this.syncCloudMatrices();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.scene.remove(
      this.skyMesh,
      this.cloudInstMesh,
      this.skirtGroup,
      this.sunLight,
      this.sunLight.target,
      this.hemiLight,
      this.rimLight,
      this.rimLight.target,
    );
    this.scene.fog = null;

    this.sunLight.dispose();
    this.hemiLight.dispose();
    this.rimLight.dispose();
    this.skirtGroup.clear();

    for (const inst of this.ownedInstancedMeshes) {
      inst.dispose();
    }
    this.ownedInstancedMeshes.length = 0;

    for (const geo of this.ownedGeometries) {
      geo.dispose();
    }
    this.ownedGeometries.length = 0;

    for (const mat of this.ownedMaterials) {
      mat.dispose();
    }
    this.ownedMaterials.length = 0;
    this.clouds.length = 0;
    this.cloudPuffs.length = 0;
  }

  private syncCloudMatrices(): void {
    const dummy = this.tmpDummy;
    for (let i = 0; i < this.cloudPuffs.length; i++) {
      const puff = this.cloudPuffs[i];
      const cluster = this.clouds[puff.clusterIndex];
      const s = cluster.scale;
      dummy.position.set(
        cluster.x + puff.offsetX * s,
        cluster.y + puff.offsetY * s,
        cluster.z + puff.offsetZ * s,
      );
      dummy.scale.set(puff.scaleX * s, puff.scaleY * s, puff.scaleZ * s);
      dummy.updateMatrix();
      this.cloudInstMesh.setMatrixAt(i, dummy.matrix);
    }
    this.cloudInstMesh.instanceMatrix.needsUpdate = true;
  }

  private buildClouds(): THREE.InstancedMesh {
    // 10 deterministic multi-box puffy cloud clusters across [-18, worldSizeX + 18]
    const specs: ReadonlyArray<{
      xNorm: number;
      y: number;
      zNorm: number;
      speed: number;
      scale: number;
      puffs: ReadonlyArray<readonly [number, number, number, number, number, number]>;
    }> = [
      {
        xNorm: 0.08,
        y: 19.2,
        zNorm: 0.14,
        speed: 0.46,
        scale: 1.05,
        puffs: [
          [0, 0, 0, 4.4, 0.85, 2.8],
          [-0.4, 0.72, 0.1, 2.6, 0.7, 1.9],
          [1.6, 0.48, -0.3, 1.8, 0.65, 1.6],
        ],
      },
      {
        xNorm: 0.27,
        y: 20.6,
        zNorm: 0.78,
        speed: 0.54,
        scale: 1.15,
        puffs: [
          [0, 0, 0, 5.2, 0.9, 3.2],
          [0.3, 0.78, -0.1, 3.1, 0.78, 2.1],
          [-1.8, 0.45, 0.4, 2.0, 0.62, 1.8],
        ],
      },
      {
        xNorm: 0.45,
        y: 18.8,
        zNorm: 0.36,
        speed: 0.41,
        scale: 0.95,
        puffs: [
          [0, 0, 0, 3.8, 0.8, 2.5],
          [0.2, 0.68, 0, 2.2, 0.64, 1.6],
        ],
      },
      {
        xNorm: 0.63,
        y: 21.1,
        zNorm: 0.08,
        speed: 0.58,
        scale: 1.1,
        puffs: [
          [0, 0, 0, 4.8, 0.9, 3.0],
          [-0.6, 0.74, 0.2, 2.7, 0.7, 2.0],
          [1.4, 0.56, -0.2, 2.0, 0.6, 1.7],
        ],
      },
      {
        xNorm: 0.82,
        y: 19.7,
        zNorm: 0.62,
        speed: 0.49,
        scale: 1.0,
        puffs: [
          [0, 0, 0, 4.2, 0.82, 2.7],
          [0.5, 0.66, 0.1, 2.4, 0.65, 1.8],
          [-1.3, 0.42, -0.2, 1.7, 0.55, 1.5],
        ],
      },
      {
        xNorm: 0.16,
        y: 21.4,
        zNorm: 0.48,
        speed: 0.62,
        scale: 1.2,
        puffs: [
          [0, 0, 0, 5.4, 0.95, 3.4],
          [-0.2, 0.84, 0, 3.2, 0.8, 2.2],
          [1.9, 0.48, 0.3, 2.1, 0.65, 1.9],
        ],
      },
      {
        xNorm: 0.53,
        y: 20.1,
        zNorm: 0.91,
        speed: 0.44,
        scale: 0.92,
        puffs: [
          [0, 0, 0, 3.6, 0.78, 2.4],
          [-0.3, 0.64, -0.1, 2.1, 0.6, 1.5],
        ],
      },
      {
        xNorm: 0.74,
        y: 18.6,
        zNorm: 0.26,
        speed: 0.51,
        scale: 1.02,
        puffs: [
          [0, 0, 0, 4.0, 0.82, 2.6],
          [0.7, 0.66, 0.2, 2.3, 0.64, 1.7],
          [-1.2, 0.45, -0.2, 1.6, 0.52, 1.4],
        ],
      },
      {
        xNorm: 0.94,
        y: 20.9,
        zNorm: 0.84,
        speed: 0.56,
        scale: 1.08,
        puffs: [
          [0, 0, 0, 4.6, 0.88, 2.9],
          [-0.4, 0.72, 0, 2.7, 0.72, 1.9],
        ],
      },
      {
        xNorm: 0.36,
        y: 19.4,
        zNorm: 0.56,
        speed: 0.47,
        scale: 0.96,
        puffs: [
          [0, 0, 0, 4.1, 0.82, 2.5],
          [0.2, 0.68, -0.1, 2.5, 0.66, 1.7],
          [-1.4, 0.40, 0.2, 1.6, 0.55, 1.5],
        ],
      },
    ];

    const minX = -18;
    const spanX = this.worldSizeX + 36;
    const minZ = -18;
    const spanZ = this.worldSizeZ + 36;

    let totalPuffs = 0;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const x = minX + spec.xNorm * spanX;
      const z = minZ + spec.zNorm * spanZ;

      this.clouds.push({
        x,
        y: spec.y,
        baseY: spec.y,
        z,
        speed: spec.speed,
        scale: spec.scale,
        bobPhase: i * 1.15,
      });

      for (const [px, py, pz, sx, sy, sz] of spec.puffs) {
        this.cloudPuffs.push({
          clusterIndex: i,
          offsetX: px,
          offsetY: py,
          offsetZ: pz,
          scaleX: sx,
          scaleY: sy,
          scaleZ: sz,
        });
        totalPuffs++;
      }
    }

    const instMesh = new THREE.InstancedMesh(this.cloudGeo, this.cloudMat, totalPuffs);
    instMesh.castShadow = false;
    instMesh.receiveShadow = false;
    instMesh.frustumCulled = false;
    instMesh.renderOrder = -5;
    instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return instMesh;
  }

  private buildIslandSkirt(): void {
    const upperMat = new THREE.MeshStandardMaterial({
      color: 0x4b3b34,
      roughness: 0.94,
      metalness: 0.03,
    });
    const midMat = new THREE.MeshStandardMaterial({
      color: 0x393338,
      roughness: 0.94,
      metalness: 0.04,
    });
    const deepMat = new THREE.MeshStandardMaterial({
      color: 0x26252c,
      roughness: 0.95,
      metalness: 0.05,
    });
    this.ownedMaterials.push(upperMat, midMat, deepMat);

    type SkirtTier = 'upper' | 'mid' | 'deep';
    interface SkirtBox {
      w: number;
      h: number;
      d: number;
      x: number;
      y: number;
      z: number;
    }

    const tierBoxes: Record<SkirtTier, SkirtBox[]> = {
      upper: [],
      mid: [],
      deep: [],
    };

    const addBox = (
      tier: SkirtTier,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
    ): void => {
      tierBoxes[tier].push({ w, h, d, x, y, z });
    };

    const cx = this.centerX;
    const cz = this.centerZ;
    const w1 = Math.max(4, this.worldSizeX - 0.4);
    const d1 = Math.max(4, this.worldSizeZ - 0.4);
    const w2 = Math.max(4, this.worldSizeX - 4.4);
    const d2 = Math.max(4, this.worldSizeZ - 4.4);
    const w3 = Math.max(4, this.worldSizeX - 11.0);
    const d3 = Math.max(4, this.worldSizeZ - 11.0);

    // Three tapered bedrock layers cleanly beneath y = 0
    addBox('upper', w1, 0.85, d1, cx, -0.435, cz);
    addBox('mid', w2, 1.1, d2, cx, -1.38, cz);
    addBox('deep', w3, 1.4, d3, cx, -2.58, cz);

    // Corner stepped cliff shoulders and hanging basalt columns
    const hx = this.worldSizeX * 0.5;
    const hz = this.worldSizeZ * 0.5;
    const cornerSigns: ReadonlyArray<readonly [number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [sx, sz] of cornerSigns) {
      addBox('mid', 2.4, 1.65, 2.4, cx + sx * (hx - 1.8), -1.42, cz + sz * (hz - 1.8));
      addBox('deep', 1.25, 2.25, 1.25, cx + sx * (hx - 2.3), -2.55, cz + sz * (hz - 2.3));
    }

    // Mid-edge hanging basalt ribs
    const ribX = Math.max(2, hx - 2.3);
    const ribZ = Math.max(2, hz - 2.3);
    addBox('deep', 1.4, 1.6, 1.5, cx - ribX, -2.1, cz + 3.2);
    addBox('deep', 1.4, 1.8, 1.5, cx + ribX, -2.2, cz - 3.0);
    addBox('deep', 1.5, 1.7, 1.4, cx - 2.8, -2.15, cz - ribZ);
    addBox('deep', 1.5, 1.65, 1.4, cx + 3.4, -2.1, cz + ribZ);

    // Central deep underside spire tips
    addBox('deep', 4.2, 1.25, 3.8, cx + 1.1, -3.72, cz - 0.8);
    addBox('deep', 2.6, 1.1, 2.4, cx - 1.5, -3.6, cz + 1.4);

    const buildTierMesh = (boxes: readonly SkirtBox[], mat: THREE.Material): void => {
      const inst = new THREE.InstancedMesh(this.unitBoxGeo, mat, boxes.length);
      inst.receiveShadow = true;
      inst.castShadow = false;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        this.tmpDummy.position.set(b.x, b.y, b.z);
        this.tmpDummy.scale.set(b.w, b.h, b.d);
        this.tmpDummy.updateMatrix();
        inst.setMatrixAt(i, this.tmpDummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.skirtGroup.add(inst);
      this.ownedInstancedMeshes.push(inst);
    };

    buildTierMesh(tierBoxes.upper, upperMat);
    buildTierMesh(tierBoxes.mid, midMat);
    buildTierMesh(tierBoxes.deep, deepMat);
  }
}
