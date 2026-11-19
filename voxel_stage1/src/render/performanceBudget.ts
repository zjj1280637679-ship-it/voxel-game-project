/**
 * Performance Budget types, presets, validation, and persistence.
 * Pure TypeScript (no Three.js or DOM imports) for both Node tests and browser runtime.
 */

export type PerfPresetId = 'eco' | 'balanced' | 'ultra' | 'custom';
export type ShadowQuality = 'off' | 'low' | 'med' | 'high';
export type ShadingMode = 'lambert' | 'standard';

export interface PerformanceBudget {
  preset: PerfPresetId;
  /** Cap devicePixelRatio (0.75 | 1.0 | 1.25 | 1.5 | 2.0) */
  maxPixelRatio: number;
  /** Shadow map resolution: off=0, low=512, med=1024, high=2048 */
  shadowQuality: ShadowQuality;
  /** Shadow map refresh rate in Hz (0 = only on chunk/atmosphere dirty, 15, 30, 60) */
  shadowRefreshHz: number;
  /** Chunk material pipeline: lightweight Lambert vs full PBR Standard */
  shading: ShadingMode;
  /** Active dynamic PointLight budget (0 | 2 | 4 | 6) */
  maxPointLights: number;
  /** Max pooled particles rendered via single InstancedMesh (0 | 40 | 96 | 160) */
  maxParticles: number;
  /** Enable drifting clouds */
  clouds: boolean;
  /** Enable ambient fire/stele/mist particles */
  ambientParticles: boolean;
  /** Enable animated Water/Mist UV scrolling */
  animatedTextures: boolean;
  /** Enable HUD backdrop-filter glass blur (expensive over WebGL on iGPUs) */
  hudBlur: boolean;
  /** Frame rate cap in FPS (0 = uncapped, 30, 60) */
  targetFps: number;
}

export interface RendererPerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  activeParticles: number;
  activeLights: number;
  pixelRatio: number;
}

export const PERF_PRESETS: Record<Exclude<PerfPresetId, 'custom'>, PerformanceBudget> = {
  eco: {
    preset: 'eco',
    maxPixelRatio: 1.0,
    shadowQuality: 'off',
    shadowRefreshHz: 0,
    shading: 'lambert',
    maxPointLights: 0,
    maxParticles: 40,
    clouds: false,
    ambientParticles: false,
    animatedTextures: true,
    hudBlur: false,
    targetFps: 60,
  },
  balanced: {
    preset: 'balanced',
    maxPixelRatio: 1.25,
    shadowQuality: 'med',
    shadowRefreshHz: 20,
    shading: 'lambert',
    maxPointLights: 2,
    maxParticles: 96,
    clouds: true,
    ambientParticles: true,
    animatedTextures: true,
    hudBlur: true,
    targetFps: 60,
  },
  ultra: {
    preset: 'ultra',
    maxPixelRatio: 2.0,
    shadowQuality: 'high',
    shadowRefreshHz: 30,
    shading: 'standard',
    maxPointLights: 6,
    maxParticles: 160,
    clouds: true,
    ambientParticles: true,
    animatedTextures: true,
    hudBlur: true,
    targetFps: 0,
  },
};

export const PERF_PRESET_LABELS: Record<PerfPresetId, string> = {
  eco: '🚀 极速省电',
  balanced: '⚖️ 均衡',
  ultra: '✨ 电影画质',
  custom: '🎛️ 自定义',
};

const PERF_BUDGET_STORAGE_KEY = 'voxel_stage1_perf_budget_v1';
const PRESET_IDS: readonly Exclude<PerfPresetId, 'custom'>[] = ['eco', 'balanced', 'ultra'];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getLocalStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function'
    ) {
      return storage;
    }
  } catch {
    // Ignore storage access errors in restricted/headless environments.
  }
  return null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function isValidShadowQuality(value: unknown): value is ShadowQuality {
  return value === 'off' || value === 'low' || value === 'med' || value === 'high';
}

function isValidShadingMode(value: unknown): value is ShadingMode {
  return value === 'lambert' || value === 'standard';
}

function matchesPreset(a: PerformanceBudget, b: PerformanceBudget): boolean {
  return (
    a.maxPixelRatio === b.maxPixelRatio &&
    a.shadowQuality === b.shadowQuality &&
    a.shadowRefreshHz === b.shadowRefreshHz &&
    a.shading === b.shading &&
    a.maxPointLights === b.maxPointLights &&
    a.maxParticles === b.maxParticles &&
    a.clouds === b.clouds &&
    a.ambientParticles === b.ambientParticles &&
    a.animatedTextures === b.animatedTextures &&
    a.hudBlur === b.hudBlur &&
    a.targetFps === b.targetFps
  );
}

export function normalizePerformanceBudget(
  partial: Partial<PerformanceBudget>,
): PerformanceBudget {
  const input: Partial<PerformanceBudget> =
    partial && typeof partial === 'object' ? partial : {};

  const basePreset: Exclude<PerfPresetId, 'custom'> =
    input.preset === 'eco' || input.preset === 'balanced' || input.preset === 'ultra'
      ? input.preset
      : 'balanced';
  const base = PERF_PRESETS[basePreset];

  const clampedRatio = clampNumber(input.maxPixelRatio, 0.5, 2.0, base.maxPixelRatio);
  const maxPixelRatio = Math.round(clampedRatio * 100) / 100;

  const shadowQuality: ShadowQuality = isValidShadowQuality(input.shadowQuality)
    ? input.shadowQuality
    : base.shadowQuality;

  const shadowRefreshHz = clampNumber(input.shadowRefreshHz, 0, 60, base.shadowRefreshHz);

  const shading: ShadingMode = isValidShadingMode(input.shading)
    ? input.shading
    : base.shading;

  const maxPointLights = Math.round(
    clampNumber(input.maxPointLights, 0, 6, base.maxPointLights),
  );

  const maxParticles = Math.round(
    clampNumber(input.maxParticles, 0, 160, base.maxParticles),
  );

  const clouds = typeof input.clouds === 'boolean' ? input.clouds : base.clouds;
  const ambientParticles =
    typeof input.ambientParticles === 'boolean'
      ? input.ambientParticles
      : base.ambientParticles;
  const animatedTextures =
    typeof input.animatedTextures === 'boolean'
      ? input.animatedTextures
      : base.animatedTextures;
  const hudBlur = typeof input.hudBlur === 'boolean' ? input.hudBlur : base.hudBlur;

  const targetFps = Math.round(clampNumber(input.targetFps, 0, 240, base.targetFps));

  const normalized: PerformanceBudget = {
    preset: 'custom',
    maxPixelRatio,
    shadowQuality,
    shadowRefreshHz,
    shading,
    maxPointLights,
    maxParticles,
    clouds,
    ambientParticles,
    animatedTextures,
    hudBlur,
    targetFps,
  };

  for (const id of PRESET_IDS) {
    if (matchesPreset(normalized, PERF_PRESETS[id])) {
      normalized.preset = id;
      break;
    }
  }

  return normalized;
}

export function loadPerformanceBudget(): PerformanceBudget {
  const storage = getLocalStorage();
  if (!storage) {
    return { ...PERF_PRESETS.balanced };
  }
  try {
    const raw = storage.getItem(PERF_BUDGET_STORAGE_KEY);
    if (!raw) {
      return { ...PERF_PRESETS.balanced };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...PERF_PRESETS.balanced };
    }
    return normalizePerformanceBudget(parsed as Partial<PerformanceBudget>);
  } catch {
    return { ...PERF_PRESETS.balanced };
  }
}

export function savePerformanceBudget(budget: PerformanceBudget): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    const normalized = normalizePerformanceBudget(budget);
    storage.setItem(PERF_BUDGET_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore quota or serialization errors.
  }
}
