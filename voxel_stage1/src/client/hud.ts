import type {
  AnchorSpec,
  Coord3,
  IFormalEngine,
  InteractionLogEntry,
  IVoxelWorld,
  OutcomeStatus,
  PulseCategory,
  RayHit,
} from '../core/contracts.ts';
import { getBlockOption, type ToolDefinition } from './tools.ts';
import type { RendererPerfStats } from '../render/performanceBudget.ts';

export interface HudCallbacks {
  onSelectToolSlot: (slotIndex: number) => void;
  onSelectBlockSlot: (slot: number) => void;
  onTriggerTool: () => void;
  onResetWorld: () => void;
  onOpenInventory?: () => void;
  onTogglePointerLock?: () => void;
  onSelectScrollTarget?: (target: 'tool' | 'block') => void;
  onCycleAtmosphere?: () => string;
  onTogglePerfModal?: () => void;
}

export interface HudUpdateState {
  world: IVoxelWorld;
  engine: IFormalEngine;
  hit: RayHit | null;
  toolSlots: readonly ToolDefinition[];
  blockSlots: readonly string[];
  activeToolIndex: number;
  activeBlockSlot: number;
  scrollTarget: 'tool' | 'block';
  pointerLocked: boolean;
  playerPos: Coord3;
  perfStats?: RendererPerfStats;
}

const OBSIDIAN_BG = 'rgba(10, 15, 28, 0.78)';
const OBSIDIAN_BLUR = 'blur(10px)';
const OBSIDIAN_SHADOW =
  'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(2, 6, 23, 0.42)';

const STATUS_COLORS: Record<OutcomeStatus, string> = {
  immune: '#94a3b8',
  damaged: '#fbbf24',
  crafted: '#34d399',
  deathrattle: '#f87171',
};

const STATUS_LABELS: Record<OutcomeStatus, string> = {
  immune: '免疫',
  damaged: '受损',
  crafted: '合成',
  deathrattle: '亡语',
};

interface PillPalette {
  bg: string;
  border: string;
  text: string;
}

const CATEGORY_PILL_STYLES: Record<PulseCategory, PillPalette> = {
  Mech: {
    bg: 'rgba(100, 116, 139, 0.28)',
    border: 'rgba(148, 163, 184, 0.54)',
    text: '#cbd5e1',
  },
  Thermo: {
    bg: 'rgba(249, 115, 22, 0.22)',
    border: 'rgba(251, 146, 60, 0.56)',
    text: '#fdba74',
  },
  Magic: {
    bg: 'rgba(168, 85, 247, 0.22)',
    border: 'rgba(192, 132, 252, 0.56)',
    text: '#d8b4fe',
  },
  Atmo: {
    bg: 'rgba(6, 182, 212, 0.20)',
    border: 'rgba(56, 189, 248, 0.56)',
    text: '#7dd3fc',
  },
};

const NONE_CATEGORY_PILL: PillPalette = {
  bg: 'rgba(51, 65, 85, 0.36)',
  border: 'rgba(100, 116, 139, 0.36)',
  text: '#94a3b8',
};

const ATMO_BUTTON_THEMES: Array<{ match: string; bg: string; border: string; glow: string }> = [
  {
    match: '黄昏',
    bg: '#c2410c',
    border: 'rgba(251, 146, 60, 0.68)',
    glow: '0 0 10px rgba(194, 65, 12, 0.46)',
  },
  {
    match: '星夜',
    bg: '#4338ca',
    border: 'rgba(165, 180, 252, 0.64)',
    glow: '0 0 10px rgba(67, 56, 202, 0.46)',
  },
  {
    match: '晴昼',
    bg: '#0369a1',
    border: 'rgba(251, 191, 36, 0.58)',
    glow: '0 0 10px rgba(3, 105, 161, 0.44)',
  },
];

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly targetPanel: HTMLDivElement;
  private readonly topRightPanel: HTMLDivElement;
  private readonly logPanel: HTMLDivElement;
  private readonly glassPanels: readonly HTMLDivElement[];
  private readonly loopStatusBadge: HTMLSpanElement;
  private readonly perfBtn: HTMLButtonElement | null = null;
  private readonly lockModeBtn: HTMLButtonElement | null = null;
  private readonly logList: HTMLDivElement;
  private readonly toolRow: HTMLDivElement;
  private readonly blockRow: HTMLDivElement;
  private readonly callbacks: HudCallbacks;

  private lastTargetSignature = '';
  private lastLogSignature = '';
  private lastToolBarSignature = '';
  private lastBlockBarSignature = '';
  private lastPointerLocked: boolean | null = null;
  private lastTelemetryUpdateMs = 0;
  private telemetryInitialized = false;
  private blurEnabled: boolean | null = null;

  constructor(container: HTMLElement, callbacks: HudCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position: fixed',
      'inset: 0',
      'pointer-events: none',
      'z-index: 20',
      'user-select: none',
      'font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      'color: #eef2ff',
    ].join(';');

    // Center crosshair (double-click to enter FPS pointer lock; non-blocking when locked)
    this.crosshair = document.createElement('div');
    this.crosshair.id = 'hud-crosshair';
    this.crosshair.textContent = '+';
    this.crosshair.title = '双击准星锁定 FPS 视角 (ESC 解锁)';
    this.crosshair.style.cssText = [
      'position: absolute',
      'left: 50%',
      'top: 50%',
      'transform: translate(-50%, -50%)',
      'width: 26px',
      'height: 26px',
      'border-radius: 50%',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'font-size: 20px',
      'font-weight: 400',
      'line-height: 1',
      'color: rgba(255, 255, 255, 0.55)',
      'border: 1px solid rgba(148, 163, 184, 0.35)',
      'background: rgba(15, 23, 42, 0.18)',
      'text-shadow: 0 0 4px rgba(0, 0, 0, 0.9)',
      'pointer-events: auto',
      'cursor: pointer',
      'transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease',
    ].join(';');

    this.crosshair.addEventListener('mouseenter', () => {
      if (this.crosshair.style.pointerEvents !== 'none') {
        this.crosshair.style.borderColor = '#38bdf8';
        this.crosshair.style.background = 'rgba(56, 189, 248, 0.16)';
        this.crosshair.style.color = '#ffffff';
      }
    });
    this.crosshair.addEventListener('mouseleave', () => {
      if (this.crosshair.style.pointerEvents !== 'none') {
        this.crosshair.style.borderColor = 'rgba(148, 163, 184, 0.35)';
        this.crosshair.style.background = 'rgba(15, 23, 42, 0.18)';
        this.crosshair.style.color = 'rgba(255, 255, 255, 0.55)';
      }
    });
    this.crosshair.addEventListener('mousedown', (e) => e.stopPropagation());
    this.crosshair.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      callbacks.onTogglePointerLock?.();
    });
    this.root.appendChild(this.crosshair);

    // Top bar
    const topBar = document.createElement('div');
    topBar.style.cssText = [
      'position: absolute',
      'top: 12px',
      'left: 12px',
      'right: 12px',
      'display: flex',
      'justify-content: space-between',
      'align-items: flex-start',
      'gap: 12px',
    ].join(';');

    this.targetPanel = document.createElement('div');
    this.targetPanel.id = 'hud-target-readout';
    this.targetPanel.style.cssText = this.buildObsidianPanelCss([
      'flex: 0 1 310px',
      'min-width: 190px',
      'max-width: 340px',
      'padding: 10px 14px',
      'border-radius: 12px',
      'border: 1px solid rgba(148, 163, 184, 0.24)',
      'font-size: 13px',
      'line-height: 1.45',
    ]);
    topBar.appendChild(this.targetPanel);

    const topRight = document.createElement('div');
    this.topRightPanel = topRight;
    topRight.style.cssText = this.buildObsidianPanelCss([
      'flex: 0 1 500px',
      'max-width: 60%',
      'padding: 9px 12px',
      'border-radius: 12px',
      'border: 1px solid rgba(148, 163, 184, 0.22)',
      'font-size: 12px',
      'color: #cbd5e1',
      'display: flex',
      'flex-direction: column',
      'align-items: flex-end',
      'gap: 6px',
    ]);

    const badgeRow = document.createElement('div');
    badgeRow.style.cssText =
      'display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end;';

    this.loopStatusBadge = document.createElement('span');
    this.loopStatusBadge.id = 'hud-loop-status';
    this.loopStatusBadge.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'gap: 6px',
      'padding: 2px 9px',
      'border-radius: 999px',
      'background: rgba(34, 197, 94, 0.14)',
      'border: 1px solid rgba(74, 222, 128, 0.42)',
      'color: #86efac',
      'font-weight: 600',
      'font-size: 11px',
      'font-variant-numeric: tabular-nums',
      'box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    ].join(';');
    this.loopStatusBadge.textContent = '[闭环状态: 初始化]';
    badgeRow.appendChild(this.loopStatusBadge);

    if (callbacks.onCycleAtmosphere) {
      const cycleAtmo = callbacks.onCycleAtmosphere;
      const atmoBtn = this.makeActionButton('☀️ 晴昼', '#0369a1', () => {
        const nextLabel = cycleAtmo();
        atmoBtn.textContent = nextLabel;
        this.applyAtmoButtonAccent(atmoBtn, nextLabel);
      });
      atmoBtn.id = 'hud-atmo-btn';
      atmoBtn.title = '切换天色与环境光预设 (晴昼 / 黄昏 / 星夜)';
      atmoBtn.style.pointerEvents = 'auto';
      this.applyAtmoButtonAccent(atmoBtn, '☀️ 晴昼');
      badgeRow.appendChild(atmoBtn);
    }

    if (callbacks.onTogglePerfModal) {
      this.perfBtn = this.makeActionButton('⚡ -- FPS', '#0f766e', () => {
        callbacks.onTogglePerfModal?.();
      });
      this.perfBtn.id = 'hud-perf-btn';
      this.perfBtn.title = '打开渲染性能预算与实时效率面板';
      this.perfBtn.style.pointerEvents = 'auto';
      this.perfBtn.style.borderColor = 'rgba(74, 222, 128, 0.55)';
      this.perfBtn.style.minWidth = '86px';
      this.perfBtn.style.textAlign = 'center';
      this.perfBtn.style.fontVariantNumeric = 'tabular-nums';
      badgeRow.appendChild(this.perfBtn);
    }

    if (callbacks.onTogglePointerLock) {
      this.lockModeBtn = this.makeActionButton('🎯 锁鼠 FPS', '#1e40af', () => {
        callbacks.onTogglePointerLock?.();
      });
      this.lockModeBtn.id = 'hud-lock-btn';
      this.lockModeBtn.style.pointerEvents = 'auto';
      badgeRow.appendChild(this.lockModeBtn);
    }
    topRight.appendChild(badgeRow);

    const helpLine = document.createElement('div');
    helpLine.style.cssText =
      'opacity: 0.86; font-size: 11px; text-align: right; line-height: 1.4; color: #cbd5e1;';
    helpLine.textContent =
      'WASD 移动 · Space 跳跃 · E 范围收取 · Q 背包 | 左键: 用工具(自动吸取) | 右键: 放方块 & 拖拽转向 | 滚轮短按: 切选中条 | 双击准星锁鼠';
    topRight.appendChild(helpLine);
    topBar.appendChild(topRight);
    this.root.appendChild(topBar);

    // Bottom-center: Two-tier hotbar (Top = Tool Slots for Left-click, Bottom = Block Slots 1-8 for Right-click)
    const hotbarWrap = document.createElement('div');
    hotbarWrap.style.cssText = [
      'position: absolute',
      'left: 50%',
      'bottom: 10px',
      'transform: translateX(-50%)',
      'max-width: calc(100vw - 24px)',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'gap: 5px',
      'pointer-events: auto',
    ].join(';');

    this.toolRow = document.createElement('div');
    this.toolRow.id = 'hud-tool-bar';
    this.toolRow.style.cssText = this.buildObsidianPanelCss([
      'display: flex',
      'align-items: center',
      'gap: 5px',
      'padding: 7px 10px',
      'max-width: 100%',
      'box-sizing: border-box',
      'overflow-x: auto',
      'scrollbar-width: none',
      'border-radius: 12px',
      'border: 1px solid rgba(96, 165, 250, 0.28)',
      'transition: border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
    ]);

    this.blockRow = document.createElement('div');
    this.blockRow.id = 'hud-block-bar';
    this.blockRow.style.cssText = this.buildObsidianPanelCss([
      'display: flex',
      'align-items: center',
      'gap: 5px',
      'padding: 7px 10px',
      'max-width: 100%',
      'box-sizing: border-box',
      'overflow-x: auto',
      'scrollbar-width: none',
      'border-radius: 12px',
      'border: 1px solid rgba(74, 222, 128, 0.28)',
      'transition: border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
    ]);

    hotbarWrap.appendChild(this.toolRow);
    hotbarWrap.appendChild(this.blockRow);
    this.root.appendChild(hotbarWrap);

    // Bottom-right: Live Formal Inference Log + quick actions
    const logPanel = document.createElement('div');
    this.logPanel = logPanel;
    logPanel.style.cssText = this.buildObsidianPanelCss([
      'position: absolute',
      'right: 12px',
      'bottom: 132px',
      'width: 480px',
      'max-width: calc(100vw - 24px)',
      'padding: 10px 12px',
      'border-radius: 12px',
      'border: 1px solid rgba(148, 163, 184, 0.24)',
      'display: flex',
      'flex-direction: column',
      'gap: 8px',
    ]);

    const logHeader = document.createElement('div');
    logHeader.style.cssText = [
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'flex-wrap: wrap',
      'gap: 8px',
      'font-size: 12px',
      'font-weight: 700',
      'color: #93c5fd',
    ].join(';');

    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'Live Formal Inference Log (形式化推演日志)';
    logHeader.appendChild(titleSpan);

    const btnBar = document.createElement('div');
    btnBar.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; pointer-events: auto;';

    const triggerBtn = this.makeActionButton('⚡ 触发工具 (F)', '#2563eb', () => {
      callbacks.onTriggerTool();
    });
    triggerBtn.id = 'hud-trigger-btn';
    btnBar.appendChild(triggerBtn);

    if (callbacks.onOpenInventory) {
      const invBtn = this.makeActionButton('🎒 背包定义 (Q)', '#7c3aed', () => {
        callbacks.onOpenInventory?.();
      });
      invBtn.id = 'hud-inventory-btn';
      btnBar.appendChild(invBtn);
    }

    const resetBtn = this.makeActionButton('↻ 重置世界', '#475569', () => {
      callbacks.onResetWorld();
    });
    resetBtn.id = 'hud-reset-btn';
    btnBar.appendChild(resetBtn);

    logHeader.appendChild(btnBar);
    logPanel.appendChild(logHeader);

    this.logList = document.createElement('div');
    this.logList.id = 'hud-inference-logs';
    this.logList.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'gap: 4px',
      'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      'font-size: 11px',
      'line-height: 1.35',
      'max-height: 168px',
      'overflow-y: auto',
    ].join(';');
    logPanel.appendChild(this.logList);

    this.root.appendChild(logPanel);
    this.glassPanels = [
      this.targetPanel,
      this.topRightPanel,
      this.toolRow,
      this.blockRow,
      this.logPanel,
    ];
    container.appendChild(this.root);
  }

  private buildObsidianPanelCss(extraRules: string[]): string {
    return [
      `background: ${OBSIDIAN_BG}`,
      `backdrop-filter: ${OBSIDIAN_BLUR}`,
      `box-shadow: ${OBSIDIAN_SHADOW}`,
      ...extraRules,
    ].join(';');
  }

  private applyAtmoButtonAccent(btn: HTMLButtonElement, label: string): void {
    const theme =
      ATMO_BUTTON_THEMES.find((entry) => label.includes(entry.match)) ??
      ATMO_BUTTON_THEMES[ATMO_BUTTON_THEMES.length - 1];
    btn.style.background = theme.bg;
    btn.style.borderColor = theme.border;
    btn.style.boxShadow = `${theme.glow}, inset 0 1px 0 rgba(255, 255, 255, 0.18)`;
  }

  private makeActionButton(label: string, bgColor: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = [
      'padding: 4px 9px',
      'border-radius: 7px',
      'border: 1px solid rgba(255, 255, 255, 0.18)',
      `background: ${bgColor}`,
      'box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 2px 6px rgba(2, 6, 23, 0.35)',
      'color: #ffffff',
      'font-size: 11px',
      'font-weight: 600',
      'cursor: pointer',
      'white-space: nowrap',
      'transition: filter 0.12s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
    ].join(';');
    btn.addEventListener('mouseenter', () => {
      btn.style.filter = 'brightness(1.12)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.filter = '';
    });
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.blur();
      onClick();
    });
    return btn;
  }

  public setBlurEnabled(enabled: boolean): void {
    if (this.blurEnabled === enabled) return;
    this.blurEnabled = enabled;
    const filter = enabled ? 'blur(8px)' : 'none';
    const bg = enabled ? 'rgba(10, 15, 28, 0.78)' : 'rgba(10, 15, 28, 0.91)';
    for (const panel of this.glassPanels) {
      panel.style.backdropFilter = filter;
      panel.style.background = bg;
    }
  }

  public update(state: HudUpdateState): void {
    this.updateTargetPanel(state);
    this.updateToolBar(state.toolSlots, state.activeToolIndex, state.scrollTarget === 'tool');
    this.updateBlockBar(state.blockSlots, state.activeBlockSlot, state.scrollTarget === 'block');
    this.updateLogs(state.world.getRecentLogs(6));

    const pointerLockChanged = this.lastPointerLocked !== state.pointerLocked;
    if (pointerLockChanged) {
      this.lastPointerLocked = state.pointerLocked;
      if (state.pointerLocked) {
        this.crosshair.style.pointerEvents = 'none';
        this.crosshair.style.border = 'none';
        this.crosshair.style.background = 'transparent';
        this.crosshair.style.color = 'rgba(255, 255, 255, 0.92)';
        this.crosshair.style.cursor = 'default';
      } else {
        this.crosshair.style.pointerEvents = 'auto';
        this.crosshair.style.border = '1px solid rgba(148, 163, 184, 0.35)';
        this.crosshair.style.background = 'rgba(15, 23, 42, 0.18)';
        this.crosshair.style.color = 'rgba(255, 255, 255, 0.55)';
        this.crosshair.style.cursor = 'pointer';
      }

      if (this.lockModeBtn) {
        this.lockModeBtn.textContent = state.pointerLocked ? '🖱️ 退出锁鼠 (ESC)' : '🎯 锁鼠 FPS';
        this.lockModeBtn.style.background = state.pointerLocked ? '#0f766e' : '#1e40af';
      }
    }

    const nowMs = performance.now();
    if (
      !this.telemetryInitialized ||
      pointerLockChanged ||
      nowMs - this.lastTelemetryUpdateMs >= 250
    ) {
      this.telemetryInitialized = true;
      this.lastTelemetryUpdateMs = nowMs;

      const modeText = state.pointerLocked ? 'FPS锁鼠' : '自由光标';
      const freeCount = state.world.getFreeBodies().length;
      const nextLoopText =
        `[闭环状态: 活跃] Tick ${state.world.tickCount} | 实体 ${freeCount} | 修订 ${state.world.getDirtyRevision()} | ${modeText}`;
      if (this.loopStatusBadge.textContent !== nextLoopText) {
        this.loopStatusBadge.textContent = nextLoopText;
      }

      this.updatePerfButton(state.perfStats);
    }
  }

  private updatePerfButton(stats?: RendererPerfStats): void {
    if (!this.perfBtn) return;
    if (!stats || (stats.fps <= 0 && stats.frameMs <= 0)) {
      if (this.perfBtn.textContent !== '⚡ -- FPS') {
        this.perfBtn.textContent = '⚡ -- FPS';
      }
      this.perfBtn.style.background = '#0f766e';
      this.perfBtn.style.borderColor = 'rgba(74, 222, 128, 0.55)';
      return;
    }

    const fps = Math.max(0, Math.round(stats.fps));
    const label = `⚡ ${fps} FPS`;
    if (this.perfBtn.textContent !== label) {
      this.perfBtn.textContent = label;
    }

    if (fps >= 50) {
      this.perfBtn.style.background = '#0f766e';
      this.perfBtn.style.borderColor = '#4ade80';
    } else if (fps >= 30) {
      this.perfBtn.style.background = '#b45309';
      this.perfBtn.style.borderColor = 'rgba(251, 191, 36, 0.7)';
    } else {
      this.perfBtn.style.background = '#b91c1c';
      this.perfBtn.style.borderColor = 'rgba(248, 113, 113, 0.72)';
    }
  }

  private applyHotbarFocusStyle(
    row: HTMLDivElement,
    wheelFocused: boolean,
    focusColor: string,
    focusGlow: string,
  ): void {
    row.style.border = wheelFocused
      ? `1.5px solid ${focusColor}`
      : '1px solid rgba(148, 163, 184, 0.22)';
    row.style.boxShadow = wheelFocused ? `${focusGlow}, ${OBSIDIAN_SHADOW}` : OBSIDIAN_SHADOW;
    row.style.opacity = wheelFocused ? '1' : '0.86';
  }

  private makeHotbarPrefixButton(
    label: string,
    wheelFocused: boolean,
    accentHex: string,
    accentBgRgba: string,
    accentBorderRgba: string,
    target: 'tool' | 'block',
  ): HTMLButtonElement {
    const prefix = document.createElement('button');
    prefix.type = 'button';
    prefix.textContent = label;
    prefix.title = `点击切换滚轮控制到此${target === 'tool' ? '工具' : '方块'}栏 (或短按滑轮中键)`;
    prefix.style.cssText = [
      'flex-shrink: 0',
      'font-size: 10px',
      `color: ${wheelFocused ? accentHex : '#94a3b8'}`,
      'font-weight: 800',
      'padding: 3px 7px',
      'border-radius: 7px',
      `border: 1px solid ${wheelFocused ? accentBorderRgba : 'rgba(148, 163, 184, 0.14)'}`,
      `background: ${wheelFocused ? accentBgRgba : 'rgba(15, 23, 42, 0.45)'}`,
      'cursor: pointer',
      'white-space: nowrap',
      'transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease',
    ].join(';');
    prefix.addEventListener('mousedown', (e) => e.stopPropagation());
    prefix.addEventListener('click', (e) => {
      e.stopPropagation();
      prefix.blur();
      this.callbacks.onSelectScrollTarget?.(target);
    });
    return prefix;
  }

  private getSlotStyleRules(
    selected: boolean,
    accentColor: string,
    extraRules: string[],
  ): string {
    return [
      'flex-shrink: 0',
      'border-radius: 8px',
      `border: 1px solid ${selected ? accentColor : 'rgba(148, 163, 184, 0.22)'}`,
      `background: ${
        selected
          ? `radial-gradient(circle at 50% 0%, ${accentColor}2b, rgba(30, 41, 59, 0.95) 78%)`
          : 'rgba(15, 23, 42, 0.64)'
      }`,
      `transform: ${selected ? 'translateY(-2px)' : 'translateY(0)'}`,
      `box-shadow: ${
        selected
          ? `0 0 0 1px ${accentColor}80, 0 4px 12px ${accentColor}44, inset 0 1px 0 rgba(255, 255, 255, 0.16)`
          : 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
      }`,
      'color: #f8fafc',
      'cursor: pointer',
      'transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease',
      ...extraRules,
    ].join(';');
  }

  private updateToolBar(toolSlots: readonly ToolDefinition[], activeToolIndex: number, wheelFocused: boolean): void {
    const sig = `${wheelFocused ? 1 : 0}|${activeToolIndex}|${toolSlots.map((t) => `${t.id}:${t.name}:${t.tagLabel}`).join(',')}`;
    if (sig === this.lastToolBarSignature) return;
    this.lastToolBarSignature = sig;

    this.applyHotbarFocusStyle(this.toolRow, wheelFocused, '#38bdf8', '0 0 16px rgba(56, 189, 248, 0.36)');
    this.toolRow.innerHTML = '';

    this.toolRow.appendChild(
      this.makeHotbarPrefixButton(
        wheelFocused ? '🎯 滚轮▶左键工具' : '左键工具',
        wheelFocused,
        '#38bdf8',
        'rgba(56, 189, 248, 0.16)',
        'rgba(56, 189, 248, 0.5)',
        'tool',
      ),
    );

    toolSlots.forEach((tool, idx) => {
      const selected = idx === activeToolIndex;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = this.getSlotStyleRules(selected, tool.accentColor, [
        'display: flex',
        'align-items: center',
        'gap: 4px',
        'padding: 4px 8px',
        'max-width: 104px',
        'font-size: 11px',
        'white-space: nowrap',
      ]);
      btn.innerHTML =
        `<span style="color:${tool.accentColor};font-weight:800;flex-shrink:0;">T${idx + 1}</span>` +
        `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:${selected ? '700' : '500'};">${this.escapeHtml(tool.name)}</span>`;
      btn.title = `${tool.name} (${tool.tagLabel})`;
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.blur();
        this.callbacks.onSelectToolSlot(idx);
      });
      this.toolRow.appendChild(btn);
    });
  }

  private updateBlockBar(blockSlots: readonly string[], activeBlockSlot: number, wheelFocused: boolean): void {
    const sig = `${wheelFocused ? 1 : 0}|${activeBlockSlot}|${blockSlots.join(',')}`;
    if (sig === this.lastBlockBarSignature) return;
    this.lastBlockBarSignature = sig;

    this.applyHotbarFocusStyle(this.blockRow, wheelFocused, '#4ade80', '0 0 16px rgba(74, 222, 128, 0.34)');
    this.blockRow.innerHTML = '';

    this.blockRow.appendChild(
      this.makeHotbarPrefixButton(
        wheelFocused ? '🎯 滚轮▶右键方块' : '右键方块',
        wheelFocused,
        '#4ade80',
        'rgba(74, 222, 128, 0.16)',
        'rgba(74, 222, 128, 0.5)',
        'block',
      ),
    );

    blockSlots.forEach((protoId, idx) => {
      const slotNum = idx + 1;
      const opt = getBlockOption(protoId);
      const selected = slotNum === activeBlockSlot;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = `${opt.name} (${opt.protoId})`;
      btn.style.cssText = this.getSlotStyleRules(selected, opt.accentColor, [
        'display: flex',
        'flex-direction: column',
        'align-items: center',
        'min-width: 56px',
        'max-width: 80px',
        'padding: 4px 6px',
      ]);
      btn.innerHTML = `
        <div style="display:flex;align-items:center;gap:3px;max-width:100%;font-size:11px;font-weight:${selected ? '700' : '600'};white-space:nowrap;">
          <span style="color:${opt.accentColor};font-weight:800;font-size:10px;flex-shrink:0;">${slotNum}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;max-width:58px;">${this.escapeHtml(opt.name)}</span>
        </div>
        <span style="font-size:9px;color:${selected ? '#cbd5e1' : '#94a3b8'};max-width:68px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(opt.protoId)}</span>
      `;
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.blur();
        this.callbacks.onSelectBlockSlot(slotNum);
      });
      this.blockRow.appendChild(btn);
    });
  }

  private renderPillBadge(text: string, palette: PillPalette, extraCss = ''): string {
    return `<span style="display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;line-height:1.4;white-space:nowrap;background:${palette.bg};border:1px solid ${palette.border};color:${palette.text};${extraCss}">${this.escapeHtml(text)}</span>`;
  }

  private updateTargetPanel(state: HudUpdateState): void {
    const { hit, world, engine, playerPos } = state;
    if (!hit) {
      const sig = `none|${playerPos.x.toFixed(1)},${playerPos.y.toFixed(1)},${playerPos.z.toFixed(1)}`;
      if (sig === this.lastTargetSignature) return;
      this.lastTargetSignature = sig;
      this.targetPanel.innerHTML = `
        <div style="font-weight:700; color:#94a3b8;">未瞄准目标</div>
        <div style="font-size:11px; color:#94a3b8; margin-top:3px;">
          位置: (${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)}) | 移动光标对准方块、羊或工作台
        </div>
      `;
      return;
    }

    const ent = hit.entity;
    const cellAtmoMask =
      (world.getCellAtmo(Math.floor(ent.pos.x), Math.floor(ent.pos.y), Math.floor(ent.pos.z)) |
        ent.cellAtmo) >>>
      0;
    const chamberSig = ent.chamber.map((c) => c.protoId).join(',');
    const sig = [
      hit.kind,
      ent.uid,
      ent.protoId,
      ent.hp.toFixed(1),
      ent.maxHp,
      hit.distance.toFixed(1),
      cellAtmoMask,
      ent.homeAnchorUid ?? '',
      chamberSig,
      hit.pos.x.toFixed(1),
      hit.pos.y.toFixed(1),
      hit.pos.z.toFixed(1),
    ].join('|');
    if (sig === this.lastTargetSignature) return;
    this.lastTargetSignature = sig;

    const hpRatio = ent.maxHp > 0 ? Math.max(0, Math.min(1, ent.hp / ent.maxHp)) : 0;
    const hpPct = Math.round(hpRatio * 100);
    const barColor = hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#f59e0b' : '#ef4444';
    const barGlow = hpPct > 0 ? `box-shadow: 0 0 10px ${barColor}aa;` : '';

    const atmoText = engine.formatMask(cellAtmoMask) || '无 (Normal)';
    const isVisible = engine.getAttr<boolean>(ent.protoId, 'visible', true);
    const isCollidable = engine.getAttr<boolean>(
      ent.protoId,
      'collidable',
      ent.form === 'GridStatic',
    );
    const isInteractable = engine.getAttr<boolean>(ent.protoId, 'interactable', true);

    const formBadge = this.renderPillBadge(
      `${hit.kind === 'grid' ? 'Grid' : 'FreeBody'} #${ent.uid}`,
      hit.kind === 'grid'
        ? { bg: 'rgba(56, 189, 248, 0.16)', border: 'rgba(56, 189, 248, 0.42)', text: '#7dd3fc' }
        : { bg: 'rgba(168, 85, 247, 0.18)', border: 'rgba(192, 132, 252, 0.44)', text: '#d8b4fe' },
      'font-size:11px;',
    );

    const traitBadges = [
      this.renderPillBadge(
        isVisible ? '可见' : '隐形',
        isVisible
          ? { bg: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.34)', text: '#cbd5e1' }
          : { bg: 'rgba(167, 139, 250, 0.18)', border: 'rgba(167, 139, 250, 0.44)', text: '#ddd6fe' },
      ),
      this.renderPillBadge(
        isCollidable ? '碰撞' : '穿行',
        isCollidable
          ? { bg: 'rgba(56, 189, 248, 0.14)', border: 'rgba(56, 189, 248, 0.34)', text: '#bae6fd' }
          : { bg: 'rgba(45, 212, 191, 0.16)', border: 'rgba(45, 212, 191, 0.38)', text: '#99f6e4' },
      ),
      this.renderPillBadge(
        isInteractable ? '可交互' : '不可交互',
        isInteractable
          ? { bg: 'rgba(74, 222, 128, 0.14)', border: 'rgba(74, 222, 128, 0.36)', text: '#bbf7d0' }
          : { bg: 'rgba(100, 116, 139, 0.18)', border: 'rgba(100, 116, 139, 0.34)', text: '#94a3b8' },
      ),
    ].join('');

    const anchorSpec = engine.getAttr<AnchorSpec | undefined>(ent.protoId, 'anchor', undefined);
    let anchorHtml = '';
    if (anchorSpec) {
      anchorHtml = `<div style="font-size:11px; color:#7dd3fc; margin-top:3px;">实体锚点: 绑定 ${this.escapeHtml(anchorSpec.binds.join(','))} · 半径 ${anchorSpec.radius}m${anchorSpec.respawn_sec ? ` · 复活 ${anchorSpec.respawn_sec}s` : ''}</div>`;
    } else if (ent.homeAnchorUid !== undefined) {
      anchorHtml = `<div style="font-size:11px; color:#7dd3fc; margin-top:3px;">绑定锚点: #${ent.homeAnchorUid}</div>`;
    }

    let chamberHtml = '';
    if (ent.protoId === 'Workbench' || ent.chamber.length > 0) {
      const items =
        ent.chamber.length > 0
          ? ent.chamber
              .map(
                (c) =>
                  `<span style="padding:1px 6px;border-radius:999px;background:rgba(251,191,36,0.18);border:1px solid rgba(251,191,36,0.42);color:#fde68a;">${this.escapeHtml(c.protoId)}</span>`,
              )
              .join(' ')
          : '<span style="color:#94a3b8;">(空腔室 - 右键放入小资源后用扳手/锤触发)</span>';
      chamberHtml = `
        <div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(148,163,184,0.2);">
          <div style="font-size:11px; color:#fcd34d; margin-bottom:3px;">工作台腔室 (${ent.chamber.length}):</div>
          <div style="display:flex; flex-wrap:wrap; gap:4px; font-size:11px;">${items}</div>
        </div>
      `;
    }

    this.targetPanel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <span style="font-weight:700; font-size:15px; color:#f8fafc; letter-spacing:0.01em;">${this.escapeHtml(ent.protoId)}</span>
        ${formBadge}
      </div>
      <div style="margin-top:6px;">
        <div style="display:flex; justify-content:space-between; font-size:12px;">
          <span style="color:#e2e8f0;">HP: ${ent.hp.toFixed(1)} / ${ent.maxHp}</span>
          <span style="color:#94a3b8;">距离 ${hit.distance.toFixed(1)}m</span>
        </div>
        <div style="height:6px; border-radius:999px; background:rgba(15,23,42,0.88); border:1px solid rgba(148,163,184,0.16); margin-top:4px; overflow:hidden;">
          <div style="width:${hpPct}%; height:100%; border-radius:999px; background:${barColor}; ${barGlow}"></div>
        </div>
      </div>
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-top:6px;">
        ${traitBadges}
      </div>
      <div style="margin-top:5px; font-size:11px; color:#cbd5e1;">
        实时气场: <span style="color:#7dd3fc;">${this.escapeHtml(atmoText)}</span>
      </div>
      ${anchorHtml}
      <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
        坐标: (${hit.pos.x.toFixed(1)}, ${hit.pos.y.toFixed(1)}, ${hit.pos.z.toFixed(1)})
      </div>
      ${chamberHtml}
    `;
  }

  private updateLogs(logs: readonly InteractionLogEntry[]): void {
    const slice = logs.slice(-6);
    const sig = slice
      .map((l) => `${l.tick}:${l.action}:${l.target}:${l.status}:${l.winnerCat ?? ''}:${l.resultText}`)
      .join('|');
    if (sig === this.lastLogSignature) return;
    this.lastLogSignature = sig;

    if (slice.length === 0) {
      this.logList.innerHTML =
        '<div style="color:#cbd5e1; padding:4px 0;">暂无推演记录 — 左键用工具 / 右键放方块 查看形式化推导链</div>';
      return;
    }

    this.logList.innerHTML = slice
      .map((entry) => {
        const badgeColor = STATUS_COLORS[entry.status];
        const statusLabel = STATUS_LABELS[entry.status];
        const catPalette = entry.winnerCat ? CATEGORY_PILL_STYLES[entry.winnerCat] : NONE_CATEGORY_PILL;
        const winnerPill = this.renderPillBadge(
          entry.winnerCat ?? 'None',
          catPalette,
          'margin-right:5px;padding:0px 6px;font-weight:700;vertical-align:baseline;',
        );
        const atmo = entry.atmoText || 'None';
        const line = `[${entry.action}] -> ${entry.target} | 得分(${entry.scoresSummary}) | 气场=${atmo} -> ${entry.resultText}`;
        return `
          <div style="padding:4px 7px; border-radius:6px; background:rgba(15,23,42,0.62); border:1px solid rgba(148,163,184,0.12); border-left:3px solid ${badgeColor};">
            <span style="color:${badgeColor}; font-weight:700; margin-right:4px;">[${statusLabel}]</span>${winnerPill}<span style="color:#e2e8f0;">${this.escapeHtml(line)}</span>
          </div>
        `;
      })
      .join('');
    this.logList.scrollTop = this.logList.scrollHeight;
  }

  private escapeHtml(str: string): string {
    return str
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  public dispose(): void {
    this.root.remove();
  }
}
