import rulesData from '../data/rules.json';
import type { InteractionLogEntry, IVoxelWorld, RayHit, RulesConfig } from './core/contracts.ts';
import { VoxelWorld } from './world/voxelWorld.ts';
import { VoxelRenderer } from './render/voxelRenderer.ts';
import { ATMOSPHERE_LABELS, type AtmospherePreset } from './render/atmosphere.ts';
import {
  loadPerformanceBudget,
  savePerformanceBudget,
  type PerformanceBudget,
  type RendererPerfStats,
} from './render/performanceBudget.ts';
import { PlayerController } from './client/playerController.ts';
import { Hud } from './client/hud.ts';
import { InventoryModal } from './client/inventoryModal.ts';
import { PerformanceModal } from './client/perfModal.ts';

export interface VoxelAppSummary {
  dirtyRev: number;
  tick: number;
  logs: readonly InteractionLogEntry[];
  freeBodies: number;
  activeTool: string;
  activeBlockSlot: number;
  scrollTarget: 'tool' | 'block';
  placeProto: string;
  inventoryOpen: boolean;
  playerPos: { x: number; y: number; z: number };
  target: {
    kind: RayHit['kind'];
    protoId: string;
    hp: number;
    maxHp: number;
    pos: { x: number; y: number; z: number };
  } | null;
}

export interface VoxelAppHandle {
  readonly world: IVoxelWorld;
  readonly controller: PlayerController;
  readonly renderer: VoxelRenderer;
  readonly hud: Hud;
  readonly inventory: InventoryModal;
  readonly perfModal: PerformanceModal;
  getSummary: () => VoxelAppSummary;
  setAtmosphere: (preset: AtmospherePreset) => void;
  getPerfStats: () => RendererPerfStats;
  getPerfBudget: () => PerformanceBudget;
  setPerfBudget: (budget: PerformanceBudget) => void;
}

declare global {
  interface Window {
    __VOXEL_APP__?: VoxelAppHandle;
  }
}

function bootstrap(): void {
  const container = document.getElementById('app') ?? document.body;
  const rules = rulesData as unknown as RulesConfig;

  let world: IVoxelWorld = new VoxelWorld(rules);
  let currentHit: RayHit | null = null;

  const initialBudget = loadPerformanceBudget();
  const renderer = new VoxelRenderer(container, initialBudget);

  let inventory: InventoryModal;
  let perfModal: PerformanceModal;

  const controller = new PlayerController(renderer.domElement, renderer.camera, world, {
    onToggleInventory: () => {
      if (perfModal.isOpen) {
        perfModal.close();
      }
      if (inventory.isOpen) {
        inventory.close();
      } else {
        controller.setPaused(true);
        inventory.open();
      }
    },
    onLoadoutChanged: () => {
      if (inventory.isOpen) inventory.render();
    },
  });

  inventory = new InventoryModal(container, {
    getToolSlots: () => controller.getToolSlots(),
    getBlockSlots: () => controller.getBlockSlots(),
    getActiveToolIndex: () => controller.activeToolIndex,
    getActiveBlockSlot: () => controller.activeBlockSlot,
    onAssignToolSlot: (idx, tool) => controller.setToolSlotDefinition(idx, tool),
    onAssignBlockSlot: (idx, protoId) => controller.setBlockSlotDefinition(idx, protoId),
    onSelectToolSlot: (idx) => controller.selectToolSlot(idx),
    onSelectBlockSlot: (slot) => controller.selectBlockSlot(slot),
    onResetDefaults: () => controller.resetSlotDefinitions(),
    onClose: () => {
      if (!perfModal.isOpen) controller.setPaused(false);
    },
  });

  const resetWorld = (): void => {
    world = new VoxelWorld(rules);
    currentHit = null;
    renderer.reset();
    controller.setWorld(world);
  };

  const hud = new Hud(container, {
    onSelectToolSlot: (idx) => controller.selectToolSlot(idx),
    onSelectBlockSlot: (slot) => controller.selectBlockSlot(slot),
    onTriggerTool: () => controller.triggerPrimary(),
    onResetWorld: resetWorld,
    onOpenInventory: () => {
      if (perfModal.isOpen) perfModal.close();
      controller.setPaused(true);
      inventory.open();
    },
    onTogglePerfModal: () => {
      if (perfModal.isOpen) {
        perfModal.close();
      } else {
        if (inventory.isOpen) inventory.close();
        controller.setPaused(true);
        perfModal.open();
      }
    },
    onTogglePointerLock: () => controller.togglePointerLock(),
    onSelectScrollTarget: (target) => controller.setScrollTarget(target),
    onCycleAtmosphere: () => {
      const next = renderer.cycleAtmosphere();
      return ATMOSPHERE_LABELS[next];
    },
  });
  hud.setBlurEnabled(initialBudget.hudBlur);

  const applyBudget = (next: PerformanceBudget): void => {
    savePerformanceBudget(next);
    const saved = loadPerformanceBudget();
    renderer.applyBudget(saved);
    hud.setBlurEnabled(saved.hudBlur);
  };

  perfModal = new PerformanceModal(container, {
    getBudget: () => renderer.getBudget(),
    getStats: () => renderer.getPerfStats(),
    onChangeBudget: applyBudget,
    onClose: () => {
      if (!inventory.isOpen) controller.setPaused(false);
    },
  });

  const handleEscapePerf = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && perfModal.isOpen && !e.repeat) {
      e.preventDefault();
      perfModal.close();
    }
  };
  window.addEventListener('keydown', handleEscapePerf);

  const handleResize = (): void => {
    renderer.resize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
    );
  };
  window.addEventListener('resize', handleResize);

  const appHandle: VoxelAppHandle = {
    get world() {
      return world;
    },
    controller,
    renderer,
    hud,
    inventory,
    perfModal,
    setAtmosphere: (preset: AtmospherePreset) => renderer.setAtmosphere(preset),
    getPerfStats: () => renderer.getPerfStats(),
    getPerfBudget: () => renderer.getBudget(),
    setPerfBudget: applyBudget,
    getSummary: () => ({
      dirtyRev: world.getDirtyRevision(),
      tick: world.tickCount,
      logs: world.getRecentLogs(10),
      freeBodies: world.getFreeBodies().length,
      activeTool: controller.getActiveTool().id,
      activeBlockSlot: controller.activeBlockSlot,
      scrollTarget: controller.scrollTarget,
      placeProto: controller.placeProtoId,
      inventoryOpen: inventory.isOpen,
      playerPos: controller.getFeetPos(),
      target: currentHit
        ? {
            kind: currentHit.kind,
            protoId: currentHit.entity.protoId,
            hp: currentHit.entity.hp,
            maxHp: currentHit.entity.maxHp,
            pos: currentHit.pos,
          }
        : null,
    }),
  };
  window.__VOXEL_APP__ = appHandle;

  let lastRenderMs = performance.now();
  let lastSimMs = lastRenderMs;
  let lastPerfModalSyncMs = 0;
  let rafId = 0;

  const frame = (nowMs: number): void => {
    const budget = renderer.getBudget();
    if (budget.targetFps > 0 && nowMs - lastRenderMs < 1000 / budget.targetFps - 1) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    lastRenderMs = nowMs;

    const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastSimMs) / 1000));
    lastSimMs = nowMs;

    if (!inventory.isOpen && !perfModal.isOpen) {
      world.stepTick(dt);
    }
    currentHit = controller.update(dt);
    renderer.render(world, renderer.camera, currentHit);
    const stats = renderer.getPerfStats();
    hud.update({
      world,
      engine: world.engine,
      hit: currentHit,
      toolSlots: controller.getToolSlots(),
      blockSlots: controller.getBlockSlots(),
      activeToolIndex: controller.activeToolIndex,
      activeBlockSlot: controller.activeBlockSlot,
      scrollTarget: controller.scrollTarget,
      pointerLocked: controller.isPointerLocked,
      playerPos: controller.getFeetPos(),
      perfStats: stats,
    });

    if (perfModal.isOpen && nowMs - lastPerfModalSyncMs >= 250) {
      lastPerfModalSyncMs = nowMs;
      perfModal.updateLiveStats(stats);
    }

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('keydown', handleEscapePerf);
    controller.dispose();
    inventory.dispose();
    perfModal.dispose();
    hud.dispose();
    renderer.dispose();
  });
}

bootstrap();
