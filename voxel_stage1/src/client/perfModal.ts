import {
  normalizePerformanceBudget,
  PERF_PRESETS,
  PERF_PRESET_LABELS,
  type PerformanceBudget,
  type PerfPresetId,
  type RendererPerfStats,
  type ShadingMode,
  type ShadowQuality,
} from '../render/performanceBudget.ts';

export interface PerformanceModalCallbacks {
  getBudget: () => PerformanceBudget;
  getStats: () => RendererPerfStats;
  onChangeBudget: (next: PerformanceBudget) => void;
  onClose: () => void;
}

type ConcretePresetId = Exclude<PerfPresetId, 'custom'>;

interface PresetMeta {
  id: ConcretePresetId;
  domId: string;
  accent: string;
  hint: string;
  buttonLabel: string;
}

const PRESET_METAS: readonly PresetMeta[] = [
  {
    id: 'eco',
    domId: 'perf-preset-eco',
    accent: '#22c55e',
    hint: '关闭阴影与微粒 · 高帧低功耗',
    buttonLabel: '🚀 极速省电',
  },
  {
    id: 'balanced',
    domId: 'perf-preset-balanced',
    accent: '#38bdf8',
    hint: '中等阴影与适度粒子 · 流畅清晰',
    buttonLabel: '⚖️ 均衡推荐',
  },
  {
    id: 'ultra',
    domId: 'perf-preset-ultra',
    accent: '#c084fc',
    hint: '全 PBR 光照与高分阴影 · 极致画质',
    buttonLabel: '✨ 电影画质',
  },
];

const PIXEL_RATIO_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['0.75', '0.75x (省电)'],
  ['1', '1.0x (清晰)'],
  ['1.25', '1.25x (均衡)'],
  ['1.5', '1.5x (锐利)'],
  ['2', '2.0x (原生高分)'],
];

const SHADOW_QUALITY_OPTIONS: ReadonlyArray<readonly [ShadowQuality, string]> = [
  ['off', '关闭'],
  ['low', '低 (512)'],
  ['med', '中 (1024)'],
  ['high', '高 (2048)'],
];

const SHADOW_REFRESH_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['0', '仅世界变化时'],
  ['15', '15 Hz'],
  ['30', '30 Hz'],
  ['60', '60 Hz'],
];

const SHADING_OPTIONS: ReadonlyArray<readonly [ShadingMode, string]> = [
  ['lambert', '高效 Lambert'],
  ['standard', '完整 PBR Standard'],
];

const POINT_LIGHT_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['0', '0 盏 (关闭)'],
  ['2', '2 盏'],
  ['4', '4 盏'],
  ['6', '6 盏'],
];

const MAX_PARTICLES_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['0', '0 (关闭)'],
  ['40', '40'],
  ['96', '96'],
  ['160', '160'],
];

const TARGET_FPS_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['0', '不限 (显示器刷新)'],
  ['60', '60 FPS'],
  ['30', '30 FPS (省电)'],
];

type ToggleKey = 'clouds' | 'ambientParticles' | 'animatedTextures' | 'hudBlur';

interface ToggleBinding {
  key: ToggleKey;
  card: HTMLLabelElement;
  input: HTMLInputElement;
  stateSpan: HTMLSpanElement;
}

export class PerformanceModal {
  private readonly backdrop: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly statusBadge: HTMLSpanElement;
  private readonly callbacks: PerformanceModalCallbacks;

  // Live telemetry value spans (updated directly via .textContent with zero innerHTML rebuilds)
  private readonly fpsValEl: HTMLSpanElement;
  private readonly frameMsValEl: HTMLSpanElement;
  private readonly drawCallsValEl: HTMLSpanElement;
  private readonly trianglesValEl: HTMLSpanElement;
  private readonly particlesValEl: HTMLSpanElement;
  private readonly lightsValEl: HTMLSpanElement;
  private readonly pixelRatioValEl: HTMLSpanElement;

  private readonly presetButtons = new Map<ConcretePresetId, HTMLButtonElement>();
  private readonly pixelRatioSelect: HTMLSelectElement;
  private readonly shadowQualitySelect: HTMLSelectElement;
  private readonly shadowRefreshSelect: HTMLSelectElement;
  private readonly shadingSelect: HTMLSelectElement;
  private readonly maxPointLightsSelect: HTMLSelectElement;
  private readonly maxParticlesSelect: HTMLSelectElement;
  private readonly targetFpsSelect: HTMLSelectElement;
  private readonly toggleBindings: ToggleBinding[] = [];

  private visible = false;

  constructor(container: HTMLElement, callbacks: PerformanceModalCallbacks) {
    this.callbacks = callbacks;

    this.backdrop = document.createElement('div');
    this.backdrop.id = 'perf-modal-backdrop';
    this.backdrop.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 65',
      'display: none',
      'align-items: center',
      'justify-content: center',
      'background: rgba(6, 10, 18, 0.72)',
      'backdrop-filter: blur(8px)',
      'pointer-events: auto',
      'padding: 16px',
      'font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    ].join(';');

    this.backdrop.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.target === this.backdrop) {
        this.close();
      }
    });
    this.backdrop.addEventListener('click', (e) => e.stopPropagation());
    this.backdrop.addEventListener('wheel', (e) => e.stopPropagation());
    this.backdrop.addEventListener('keydown', (e) => e.stopPropagation());

    this.panel = document.createElement('div');
    this.panel.id = 'perf-modal';
    this.panel.tabIndex = -1;
    this.panel.style.cssText = [
      'width: 820px',
      'max-width: 96vw',
      'max-height: 90vh',
      'overflow-y: auto',
      'border-radius: 14px',
      'background: rgba(15, 23, 42, 0.96)',
      'border: 1px solid rgba(148, 163, 184, 0.35)',
      'box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
      'padding: 16px 18px',
      'color: #f1f5f9',
      'display: flex',
      'flex-direction: column',
      'gap: 14px',
      'outline: none',
    ].join(';');

    this.panel.addEventListener('mousedown', (e) => e.stopPropagation());
    this.panel.addEventListener('mouseup', (e) => e.stopPropagation());
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    this.panel.addEventListener('wheel', (e) => e.stopPropagation());
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      e.stopPropagation();
    });

    // Header
    const header = document.createElement('div');
    header.style.cssText = [
      'display: flex',
      'justify-content: space-between',
      'align-items: center',
      'flex-wrap: wrap',
      'gap: 12px',
      'border-bottom: 1px solid rgba(148, 163, 184, 0.2)',
      'padding-bottom: 10px',
    ].join(';');

    const titleWrap = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.textContent = '渲染性能预算与效率监测 (Performance Budget)';
    titleEl.style.cssText = 'font-size: 16px; font-weight: 800; color: #f8fafc;';
    const subEl = document.createElement('div');
    subEl.textContent = '实时观测渲染开销 · 一键切换效率档位或精细调节管线预算';
    subEl.style.cssText = 'font-size: 12px; color: #94a3b8; margin-top: 2px;';
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(subEl);

    const headerActions = document.createElement('div');
    headerActions.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    this.statusBadge = document.createElement('span');
    this.statusBadge.id = 'perf-preset-status';
    this.statusBadge.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'padding: 4px 10px',
      'border-radius: 999px',
      'font-size: 11px',
      'font-weight: 700',
      'border: 1px solid rgba(148, 163, 184, 0.35)',
      'background: rgba(30, 41, 59, 0.85)',
      'color: #e2e8f0',
    ].join(';');
    headerActions.appendChild(this.statusBadge);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕ 关闭 (ESC)';
    closeBtn.style.cssText = [
      'padding: 6px 11px',
      'border-radius: 7px',
      'border: 1px solid rgba(255, 255, 255, 0.2)',
      'background: #2563eb',
      'color: #ffffff',
      'font-size: 12px',
      'font-weight: 600',
      'cursor: pointer',
    ].join(';');
    closeBtn.addEventListener('click', () => this.close());
    headerActions.appendChild(closeBtn);

    header.appendChild(titleWrap);
    header.appendChild(headerActions);
    this.panel.appendChild(header);

    // Live Telemetry Strip
    const telemetrySection = document.createElement('div');
    telemetrySection.style.cssText = [
      'display: grid',
      'grid-template-columns: repeat(7, minmax(0, 1fr))',
      'gap: 8px',
      'padding: 10px',
      'border-radius: 10px',
      'background: rgba(30, 41, 59, 0.45)',
      'border: 1px solid rgba(148, 163, 184, 0.2)',
    ].join(';');

    this.fpsValEl = this.createTelemetryCard(telemetrySection, 'FPS', '--');
    this.frameMsValEl = this.createTelemetryCard(telemetrySection, '帧耗时 (ms)', '--');
    this.drawCallsValEl = this.createTelemetryCard(telemetrySection, 'DrawCalls', '--');
    this.trianglesValEl = this.createTelemetryCard(telemetrySection, '三角面', '--');
    this.particlesValEl = this.createTelemetryCard(telemetrySection, '粒子数', '--');
    this.lightsValEl = this.createTelemetryCard(telemetrySection, '动态光源', '--');
    this.pixelRatioValEl = this.createTelemetryCard(telemetrySection, '像素倍率', '--');
    this.panel.appendChild(telemetrySection);

    // Preset Section
    const presetSection = document.createElement('div');
    presetSection.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'gap: 8px',
      'padding: 12px',
      'border-radius: 10px',
      'background: rgba(30, 41, 59, 0.45)',
      'border: 1px solid rgba(148, 163, 184, 0.18)',
    ].join(';');

    const presetHeader = document.createElement('div');
    presetHeader.textContent = '一键性能档位 (Presets)';
    presetHeader.style.cssText = 'font-size: 13px; font-weight: 700; color: #93c5fd;';
    presetSection.appendChild(presetHeader);

    const presetGrid = document.createElement('div');
    presetGrid.style.cssText = 'display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;';

    for (const meta of PRESET_METAS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = meta.domId;
      btn.style.cssText = [
        'display: flex',
        'flex-direction: column',
        'align-items: flex-start',
        'gap: 3px',
        'padding: 9px 11px',
        'border-radius: 9px',
        'border: 1px solid rgba(148, 163, 184, 0.28)',
        'background: rgba(15, 23, 42, 0.78)',
        'color: #f8fafc',
        'cursor: pointer',
        'text-align: left',
        'transition: border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease',
      ].join(';');

      const labelEl = document.createElement('div');
      labelEl.textContent = meta.buttonLabel;
      labelEl.style.cssText = `font-size: 13px; font-weight: 800; color: ${meta.accent};`;

      const hintEl = document.createElement('div');
      hintEl.textContent = meta.hint;
      hintEl.style.cssText = 'font-size: 11px; color: #94a3b8;';

      btn.appendChild(labelEl);
      btn.appendChild(hintEl);
      btn.addEventListener('click', () => {
        btn.blur();
        this.callbacks.onChangeBudget({ ...PERF_PRESETS[meta.id] });
        this.render();
      });

      this.presetButtons.set(meta.id, btn);
      presetGrid.appendChild(btn);
    }

    presetSection.appendChild(presetGrid);
    this.panel.appendChild(presetSection);

    // Granular Controls Section
    const controlsBox = document.createElement('div');
    controlsBox.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'gap: 12px',
      'padding: 12px',
      'border-radius: 10px',
      'background: rgba(30, 41, 59, 0.45)',
      'border: 1px solid rgba(148, 163, 184, 0.18)',
    ].join(';');

    const controlsTitle = document.createElement('div');
    controlsTitle.textContent = '精细预算调节 (任意调整后切换为自定义模式)';
    controlsTitle.style.cssText = 'font-size: 13px; font-weight: 700; color: #86efac;';
    controlsBox.appendChild(controlsTitle);

    const selectGrid = document.createElement('div');
    selectGrid.style.cssText = 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px;';

    this.pixelRatioSelect = this.createSelectField(
      selectGrid,
      'perf-select-pixel-ratio',
      '渲染分辨率倍率',
      PIXEL_RATIO_OPTIONS,
      (val) => this.applyPatch({ maxPixelRatio: Number(val) }),
    );
    this.shadowQualitySelect = this.createSelectField(
      selectGrid,
      'perf-select-shadow-quality',
      '阴影贴图质量',
      SHADOW_QUALITY_OPTIONS,
      (val) => this.applyPatch({ shadowQuality: val as ShadowQuality }),
    );
    this.shadowRefreshSelect = this.createSelectField(
      selectGrid,
      'perf-select-shadow-refresh',
      '阴影刷新频率',
      SHADOW_REFRESH_OPTIONS,
      (val) => this.applyPatch({ shadowRefreshHz: Number(val) }),
    );
    this.shadingSelect = this.createSelectField(
      selectGrid,
      'perf-select-shading',
      '方块着色管线',
      SHADING_OPTIONS,
      (val) => this.applyPatch({ shading: val as ShadingMode }),
    );
    this.maxPointLightsSelect = this.createSelectField(
      selectGrid,
      'perf-select-point-lights',
      '动态点光源预算',
      POINT_LIGHT_OPTIONS,
      (val) => this.applyPatch({ maxPointLights: Number(val) }),
    );
    this.maxParticlesSelect = this.createSelectField(
      selectGrid,
      'perf-select-max-particles',
      '最大粒子池',
      MAX_PARTICLES_OPTIONS,
      (val) => this.applyPatch({ maxParticles: Number(val) }),
    );
    this.targetFpsSelect = this.createSelectField(
      selectGrid,
      'perf-select-target-fps',
      '帧率上限',
      TARGET_FPS_OPTIONS,
      (val) => this.applyPatch({ targetFps: Number(val) }),
    );

    controlsBox.appendChild(selectGrid);

    const toggleGrid = document.createElement('div');
    toggleGrid.style.cssText = 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;';

    this.createToggleField(toggleGrid, 'clouds', '体积云层', 'Sky Clouds');
    this.createToggleField(toggleGrid, 'ambientParticles', '环境微粒', 'Ambient Dust & Spores');
    this.createToggleField(toggleGrid, 'animatedTextures', '水/雾流动纹理', 'Animated UV Flow');
    this.createToggleField(toggleGrid, 'hudBlur', 'HUD 磨砂模糊', 'Backdrop Blur');

    controlsBox.appendChild(toggleGrid);
    this.panel.appendChild(controlsBox);

    this.backdrop.appendChild(this.panel);
    container.appendChild(this.backdrop);
  }

  public get isOpen(): boolean {
    return this.visible;
  }

  public open(): void {
    this.visible = true;
    this.backdrop.style.display = 'flex';
    this.render();
    this.updateLiveStats(this.callbacks.getStats());
    this.panel.focus({ preventScroll: true });
  }

  public close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.blur();
    this.backdrop.style.display = 'none';
    this.callbacks.onClose();
  }

  public toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  public render(): void {
    const budget = this.callbacks.getBudget();
    this.backdrop.style.backdropFilter = budget.hudBlur ? 'blur(8px)' : 'none';

    // Update status badge
    if (budget.preset === 'custom') {
      this.statusBadge.textContent = PERF_PRESET_LABELS.custom ?? '🎛️ 自定义';
      this.statusBadge.style.background = 'rgba(168, 85, 247, 0.2)';
      this.statusBadge.style.borderColor = 'rgba(192, 132, 252, 0.55)';
      this.statusBadge.style.color = '#e9d5ff';
    } else {
      const meta = PRESET_METAS.find((m) => m.id === budget.preset);
      this.statusBadge.textContent =
        PERF_PRESET_LABELS[budget.preset] ?? meta?.buttonLabel ?? budget.preset;
      const accent = meta?.accent ?? '#38bdf8';
      this.statusBadge.style.background = `${accent}26`;
      this.statusBadge.style.borderColor = `${accent}99`;
      this.statusBadge.style.color = '#f8fafc';
    }

    // Update preset button highlights
    for (const meta of PRESET_METAS) {
      const btn = this.presetButtons.get(meta.id);
      if (!btn) continue;
      const active = budget.preset === meta.id;
      btn.style.border = active
        ? `1.5px solid ${meta.accent}`
        : '1px solid rgba(148, 163, 184, 0.24)';
      btn.style.background = active
        ? `linear-gradient(180deg, ${meta.accent}24, rgba(15, 23, 42, 0.92))`
        : 'rgba(15, 23, 42, 0.78)';
      btn.style.boxShadow = active
        ? `0 0 14px ${meta.accent}38, inset 0 1px 0 rgba(255, 255, 255, 0.14)`
        : 'none';
    }

    // Sync select controls
    this.syncNumericSelect(this.pixelRatioSelect, budget.maxPixelRatio, (v) => `${v}x`);
    this.shadowQualitySelect.value = budget.shadowQuality;
    this.syncNumericSelect(this.shadowRefreshSelect, budget.shadowRefreshHz, (v) => `${v} Hz`);
    this.shadingSelect.value = budget.shading;
    this.syncNumericSelect(this.maxPointLightsSelect, budget.maxPointLights, (v) => `${v} 盏`);
    this.syncNumericSelect(this.maxParticlesSelect, budget.maxParticles, (v) => `${v}`);
    this.syncNumericSelect(this.targetFpsSelect, budget.targetFps, (v) => `${v} FPS`);

    // Sync 4 boolean toggle cards
    for (const binding of this.toggleBindings) {
      const enabled = budget[binding.key];
      binding.input.checked = enabled;
      binding.stateSpan.textContent = enabled ? '开启' : '关闭';
      binding.stateSpan.style.color = enabled ? '#4ade80' : '#94a3b8';
      binding.card.style.borderColor = enabled
        ? 'rgba(56, 189, 248, 0.5)'
        : 'rgba(148, 163, 184, 0.22)';
      binding.card.style.background = enabled
        ? 'rgba(15, 23, 42, 0.92)'
        : 'rgba(15, 23, 42, 0.62)';
    }
  }

  public updateLiveStats(stats: RendererPerfStats): void {
    const hasSample = stats.fps > 0 || stats.frameMs > 0;
    const roundedFps = Math.max(0, Math.round(stats.fps));
    const fpsText = hasSample ? String(roundedFps) : '--';
    this.setSpanText(this.fpsValEl, fpsText);
    if (!hasSample) {
      this.fpsValEl.style.color = '#e2e8f0';
    } else if (roundedFps >= 50) {
      this.fpsValEl.style.color = '#4ade80';
    } else if (roundedFps >= 30) {
      this.fpsValEl.style.color = '#fbbf24';
    } else {
      this.fpsValEl.style.color = '#f87171';
    }

    this.setSpanText(this.frameMsValEl, hasSample ? stats.frameMs.toFixed(1) : '--');
    this.setSpanText(this.drawCallsValEl, String(Math.round(stats.drawCalls)));
    this.setSpanText(this.trianglesValEl, String(Math.round(stats.triangles)));
    this.setSpanText(this.particlesValEl, String(Math.round(stats.activeParticles)));
    this.setSpanText(this.lightsValEl, String(Math.round(stats.activeLights)));
    this.setSpanText(this.pixelRatioValEl, `${stats.pixelRatio.toFixed(2)}x`);
  }

  public dispose(): void {
    this.backdrop.remove();
  }

  private applyPatch(patch: Partial<PerformanceBudget>): void {
    const next = normalizePerformanceBudget({
      ...this.callbacks.getBudget(),
      ...patch,
      preset: 'custom',
    });
    this.callbacks.onChangeBudget(next);
    this.render();
  }

  private setSpanText(span: HTMLSpanElement, text: string): void {
    if (span.textContent !== text) {
      span.textContent = text;
    }
  }

  private syncNumericSelect(
    select: HTMLSelectElement,
    targetValue: number,
    formatTransient: (v: number) => string,
  ): void {
    const transientAttr = 'data-transient-opt';
    let matchedOpt: HTMLOptionElement | null = null;
    for (const opt of Array.from(select.options)) {
      if (opt.hasAttribute(transientAttr)) {
        opt.remove();
        continue;
      }
      if (Math.abs(Number(opt.value) - targetValue) < 1e-4) {
        matchedOpt = opt;
      }
    }

    if (!matchedOpt) {
      const opt = document.createElement('option');
      opt.value = String(targetValue);
      opt.textContent = formatTransient(targetValue);
      opt.setAttribute(transientAttr, '1');
      select.appendChild(opt);
      matchedOpt = opt;
    }

    if (select.value !== matchedOpt.value) {
      select.value = matchedOpt.value;
    }
  }

  private createTelemetryCard(
    parent: HTMLElement,
    label: string,
    initialValue: string,
  ): HTMLSpanElement {
    const card = document.createElement('div');
    card.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'justify-content: center',
      'gap: 3px',
      'padding: 7px 6px',
      'border-radius: 8px',
      'background: rgba(15, 23, 42, 0.85)',
      'border: 1px solid rgba(148, 163, 184, 0.18)',
      'min-width: 0',
    ].join(';');

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size: 10px; color: #94a3b8; white-space: nowrap;';

    const valEl = document.createElement('span');
    valEl.textContent = initialValue;
    valEl.style.cssText = [
      'font-size: 14px',
      'font-weight: 800',
      'color: #f8fafc',
      'font-variant-numeric: tabular-nums',
      'white-space: nowrap',
    ].join(';');

    card.appendChild(labelEl);
    card.appendChild(valEl);
    parent.appendChild(card);
    return valEl;
  }

  private createSelectField(
    parent: HTMLElement,
    domId: string,
    label: string,
    options: ReadonlyArray<readonly [string, string]>,
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const row = document.createElement('label');
    row.htmlFor = domId;
    row.style.cssText = [
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'gap: 10px',
      'padding: 7px 10px',
      'border-radius: 8px',
      'background: rgba(15, 23, 42, 0.72)',
      'border: 1px solid rgba(148, 163, 184, 0.2)',
    ].join(';');

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size: 12px; font-weight: 600; color: #cbd5e1; white-space: nowrap;';

    const sel = document.createElement('select');
    sel.id = domId;
    sel.style.cssText = [
      'min-width: 148px',
      'padding: 4px 8px',
      'border-radius: 6px',
      'border: 1px solid rgba(148, 163, 184, 0.35)',
      'background: #0f172a',
      'color: #f8fafc',
      'font-size: 12px',
      'cursor: pointer',
    ].join(';');

    for (const [val, text] of options) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      sel.appendChild(opt);
    }

    sel.addEventListener('change', () => onChange(sel.value));
    row.appendChild(lbl);
    row.appendChild(sel);
    parent.appendChild(row);
    return sel;
  }

  private createToggleField(
    parent: HTMLElement,
    key: ToggleKey,
    label: string,
    subtitle: string,
  ): void {
    const card = document.createElement('label');
    card.htmlFor = `perf-toggle-${key}`;
    card.style.cssText = [
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'gap: 10px',
      'padding: 8px 11px',
      'border-radius: 8px',
      'border: 1px solid rgba(148, 163, 184, 0.22)',
      'background: rgba(15, 23, 42, 0.72)',
      'cursor: pointer',
      'transition: border-color 0.14s ease, background 0.14s ease',
    ].join(';');

    const textWrap = document.createElement('div');
    textWrap.style.cssText = 'display: flex; flex-direction: column; gap: 1px;';

    const mainLabel = document.createElement('span');
    mainLabel.textContent = label;
    mainLabel.style.cssText = 'font-size: 12px; font-weight: 700; color: #e2e8f0;';

    const subLabel = document.createElement('span');
    subLabel.textContent = subtitle;
    subLabel.style.cssText = 'font-size: 10px; color: #94a3b8;';

    textWrap.appendChild(mainLabel);
    textWrap.appendChild(subLabel);

    const rightWrap = document.createElement('div');
    rightWrap.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const stateSpan = document.createElement('span');
    stateSpan.style.cssText = 'font-size: 11px; font-weight: 700;';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `perf-toggle-${key}`;
    input.style.cssText = 'width: 16px; height: 16px; accent-color: #38bdf8; cursor: pointer;';
    input.addEventListener('change', () => {
      this.applyPatch({ [key]: input.checked });
    });

    rightWrap.appendChild(stateSpan);
    rightWrap.appendChild(input);

    card.appendChild(textWrap);
    card.appendChild(rightWrap);
    parent.appendChild(card);

    this.toggleBindings.push({ key, card, input, stateSpan });
  }
}
