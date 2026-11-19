import type { CompoundPulse, IFormalEngine, PulseCategory } from '../core/contracts.ts';

export type ToolKind = 'pulse' | 'projectile';

export interface CustomPulseConfig {
  amount: number;
  mechWeight: number;
  mechExpr: string;
  thermoWeight: number;
  thermoExpr: string;
  magicWeight: number;
  magicExpr: string;
  atmoExpr?: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  tagLabel: string;
  kind: ToolKind;
  accentColor: string;
  protoId?: string;
  customConfig?: CustomPulseConfig;
  buildPulse?: (engine: IFormalEngine) => CompoundPulse;
}

export interface BlockSlotOption {
  protoId: string;
  name: string;
  group: '地形矿石' | '木质机关' | '流体植物' | '生物与隔离料';
  accentColor: string;
}

export function buildPulseFromConfig(engine: IFormalEngine, cfg: CustomPulseConfig): CompoundPulse {
  const channels: Partial<Record<PulseCategory, [number, string]>> = {};
  if (cfg.mechWeight > 0 && cfg.mechExpr) {
    channels.Mech = [cfg.mechWeight, cfg.mechExpr];
  }
  if (cfg.thermoWeight > 0 && cfg.thermoExpr) {
    channels.Thermo = [cfg.thermoWeight, cfg.thermoExpr];
  }
  if (cfg.magicWeight > 0 && cfg.magicExpr) {
    channels.Magic = [cfg.magicWeight, cfg.magicExpr];
  }
  if (Object.keys(channels).length === 0 && cfg.atmoExpr) {
    channels.Atmo = [1, cfg.atmoExpr];
  }
  return engine.makePulse(cfg.amount, channels, cfg.atmoExpr || undefined);
}

export function createCustomTool(name: string, cfg: CustomPulseConfig, id = `custom_${Date.now()}`): ToolDefinition {
  const parts: string[] = [];
  if (cfg.mechWeight > 0 && cfg.mechExpr) parts.push(`M:${cfg.mechWeight.toFixed(1)}`);
  if (cfg.thermoWeight > 0 && cfg.thermoExpr) parts.push(`T:${cfg.thermoWeight.toFixed(1)}`);
  if (cfg.magicWeight > 0 && cfg.magicExpr) parts.push(`G:${cfg.magicWeight.toFixed(1)}`);
  if (parts.length === 0 && cfg.atmoExpr) parts.push(cfg.atmoExpr);
  return {
    id,
    name: name.trim() || '自定义脉冲',
    tagLabel: parts.join('+') || `强度${cfg.amount}`,
    kind: 'pulse',
    accentColor: '#c084fc',
    customConfig: { ...cfg },
    buildPulse: (engine) => buildPulseFromConfig(engine, cfg),
  };
}

export const TOOL_CATALOG: readonly ToolDefinition[] = [
  {
    id: 'wood_pick',
    name: '木镐',
    tagLabel: 'Mech_T1',
    kind: 'pulse',
    accentColor: '#c9975b',
    buildPulse: (engine) => engine.simplePulse(20, 'Mech_T1'),
  },
  {
    id: 'diamond_pick',
    name: '钻镐',
    tagLabel: 'Mech_T3',
    kind: 'pulse',
    accentColor: '#38bdf8',
    buildPulse: (engine) => engine.simplePulse(20, 'Mech_T3'),
  },
  {
    id: 'fire_rod',
    name: '火棒',
    tagLabel: 'Mech0.3+Thermo0.7',
    kind: 'pulse',
    accentColor: '#fb923c',
    buildPulse: (engine) =>
      engine.makePulse(60, {
        Mech: [0.3, 'Mech_T1'],
        Thermo: [0.7, 'Thermo_Heat_T2'],
      }),
  },
  {
    id: 'wrench',
    name: '扳手/手',
    tagLabel: 'Mech_Toggle',
    kind: 'pulse',
    accentColor: '#94a3b8',
    buildPulse: (engine) => engine.simplePulse(1, 'Mech_Toggle'),
  },
  {
    id: 'forge_hammer',
    name: '锻造锤',
    tagLabel: 'Mech_T2|Blunt',
    kind: 'pulse',
    accentColor: '#f59e0b',
    buildPulse: (engine) => engine.simplePulse(25, 'Mech_T2 | Mech_Blunt'),
  },
  {
    id: 'bow',
    name: '猎弓',
    tagLabel: 'Arrow_Wood',
    kind: 'projectile',
    protoId: 'Arrow_Wood',
    accentColor: '#d97706',
  },
  {
    id: 'fireball_staff',
    name: '火球杖',
    tagLabel: 'HomingOrb_Fire',
    kind: 'projectile',
    protoId: 'HomingOrb_Fire',
    accentColor: '#ef4444',
  },
  {
    id: 'wisp_staff',
    name: '火灵召唤',
    tagLabel: 'SummonedWisp',
    kind: 'projectile',
    protoId: 'SummonedWisp',
    accentColor: '#f97316',
  },
  {
    id: 'knife',
    name: '小刀',
    tagLabel: 'Sharp+Gentle',
    kind: 'pulse',
    accentColor: '#e2e8f0',
    buildPulse: (engine) => engine.simplePulse(35, 'Mech_T1 | Mech_Sharp | Mech_Gentle'),
  },
  {
    id: 'vita_staff',
    name: '生机法杖',
    tagLabel: 'Magic_Vita',
    kind: 'pulse',
    accentColor: '#4ade80',
    buildPulse: (engine) => engine.simplePulse(20, 'Magic_Vita'),
  },
  {
    id: 'arcane_wand',
    name: '奥术杖',
    tagLabel: 'Magic_Arcane',
    kind: 'pulse',
    accentColor: '#a855f7',
    buildPulse: (engine) => engine.simplePulse(30, 'Magic_Arcane'),
  },
  {
    id: 'decay_wand',
    name: '腐朽杖',
    tagLabel: 'Magic_Decay',
    kind: 'pulse',
    accentColor: '#84cc16',
    buildPulse: (engine) => engine.simplePulse(30, 'Magic_Decay'),
  },
  {
    id: 'frost_wand',
    name: '寒冰杖',
    tagLabel: 'Thermo_Cold_T1',
    kind: 'pulse',
    accentColor: '#67e8f9',
    buildPulse: (engine) => engine.simplePulse(20, 'Thermo_Cold_T1'),
  },
  {
    id: 'smelter_torch',
    name: '高炉喷枪',
    tagLabel: 'Heat_T3|NoO2',
    kind: 'pulse',
    accentColor: '#fb7185',
    buildPulse: (engine) => engine.simplePulse(95, 'Thermo_Heat_T3 | Atmo_NoO2'),
  },
  {
    id: 'volt_staff',
    name: '雷击杖',
    tagLabel: 'Magic_Volt',
    kind: 'pulse',
    accentColor: '#38bdf8',
    buildPulse: (engine) => engine.simplePulse(35, 'Magic_Volt'),
  },
];

export const DEFAULT_TOOL_SLOT_IDS: readonly string[] = [
  'wood_pick',
  'diamond_pick',
  'fire_rod',
  'wrench',
  'bow',
  'knife',
];

export const BLOCK_CATALOG: readonly BlockSlotOption[] = [
  { protoId: 'Sand', name: '沙子', group: '地形矿石', accentColor: '#e3cf88' },
  { protoId: 'Stone', name: '原石', group: '地形矿石', accentColor: '#94a3b8' },
  { protoId: 'Obsidian', name: '黑曜石', group: '地形矿石', accentColor: '#7c3aed' },
  { protoId: 'Glass', name: '玻璃', group: '地形矿石', accentColor: '#bae6fd' },
  { protoId: 'IronOre', name: '铁矿石', group: '地形矿石', accentColor: '#d97706' },
  { protoId: 'Dirt', name: '泥土', group: '地形矿石', accentColor: '#92400e' },
  { protoId: 'Grass', name: '草方块', group: '地形矿石', accentColor: '#22c55e' },

  { protoId: 'OakPlank', name: '橡木板', group: '木质机关', accentColor: '#b45309' },
  { protoId: 'OakLog', name: '橡木原木', group: '木质机关', accentColor: '#78350f' },
  { protoId: 'OakPlank_Slab', name: '木半砖', group: '木质机关', accentColor: '#d97706' },
  { protoId: 'OakDoor_Closed', name: '橡木门', group: '木质机关', accentColor: '#a16207' },
  { protoId: 'Workbench', name: '隔离工作台', group: '木质机关', accentColor: '#f59e0b' },
  { protoId: 'PastureStele', name: '牧场复活石碑', group: '木质机关', accentColor: '#38bdf8' },
  { protoId: 'GuardStele', name: '骑士守卫石碑', group: '木质机关', accentColor: '#f59e0b' },
  { protoId: 'AirBarrier', name: '隐形空气墙', group: '木质机关', accentColor: '#cbd5e1' },

  { protoId: 'Water', name: '水', group: '流体植物', accentColor: '#3b82f6' },
  { protoId: 'MistVeil', name: '幻雾方块(无碰撞)', group: '流体植物', accentColor: '#7dd3fc' },
  { protoId: 'Ice', name: '冰块', group: '流体植物', accentColor: '#67e8f9' },
  { protoId: 'Fire', name: '火焰', group: '流体植物', accentColor: '#f97316' },
  { protoId: 'Sapling', name: '树苗', group: '流体植物', accentColor: '#4ade80' },
  { protoId: 'Leaf', name: '树叶', group: '流体植物', accentColor: '#16a34a' },
  { protoId: 'Mushroom', name: '蘑菇', group: '流体植物', accentColor: '#f43f5e' },

  { protoId: 'Sheep_Live', name: '活羊', group: '生物与隔离料', accentColor: '#f8fafc' },
  { protoId: 'Sheep_Corpse', name: '羊尸体', group: '生物与隔离料', accentColor: '#fca5a5' },
  { protoId: 'IronKnight', name: '铁甲骑士', group: '生物与隔离料', accentColor: '#94a3b8' },
  { protoId: 'IronKnight_Corpse', name: '阵亡骑士', group: '生物与隔离料', accentColor: '#64748b' },
  { protoId: 'Sulfur_Bit', name: '硫磺小块', group: '生物与隔离料', accentColor: '#fde047' },
  { protoId: 'Charcoal_Bit', name: '木炭小块', group: '生物与隔离料', accentColor: '#64748b' },
  { protoId: 'Saltpeter_Bit', name: '硝石小块', group: '生物与隔离料', accentColor: '#e2e8f0' },
  { protoId: 'IronIngot_Bit', name: '铁锭小块', group: '生物与隔离料', accentColor: '#cbd5e1' },
  { protoId: 'OakStick_Bit', name: '木棍小块', group: '生物与隔离料', accentColor: '#ca8a04' },
];

export const DEFAULT_BLOCK_SLOTS: readonly string[] = [
  'Sand',
  'OakPlank',
  'Water',
  'Ice',
  'Fire',
  'Sapling',
  'Obsidian',
  'Workbench',
];

export function getToolCatalogItem(id: string): ToolDefinition {
  return TOOL_CATALOG.find((t) => t.id === id) ?? TOOL_CATALOG[0];
}

export function getBlockOption(protoId: string): BlockSlotOption {
  return (
    BLOCK_CATALOG.find((b) => b.protoId === protoId) ?? {
      protoId,
      name: protoId,
      group: '地形矿石',
      accentColor: '#94a3b8',
    }
  );
}

const RESOURCE_TO_BLOCK_MAP: Record<string, string> = {
  Obsidian_Item: 'Obsidian',
  Cobble_Item: 'Stone',
  GlassShard_Item: 'Glass',
  Sand_Item: 'Sand',
  Dirt_Item: 'Dirt',
  IronOre_Item: 'IronOre',
  IceShard_Item: 'Ice',
  OakLog_Item: 'OakLog',
  OakPlank_Item: 'OakPlank',
  OakPlank_Slab_Item: 'OakPlank_Slab',
  OakDoor_Closed_Item: 'OakDoor_Closed',
  OakDoor_Open_Item: 'OakDoor_Closed',
  Workbench_Item: 'Workbench',
  PastureStele_Item: 'PastureStele',
  GuardStele_Item: 'GuardStele',
  AirBarrier_Item: 'AirBarrier',
  MistVeil_Item: 'MistVeil',
  Sapling_Item: 'Sapling',
  Leaf_Item: 'Leaf',
  Mushroom_Item: 'Mushroom',
  Charcoal_Item: 'Charcoal_Bit',
  IronIngot_Item: 'IronIngot_Bit',
  Sulfur_Bit: 'Sulfur_Bit',
  Charcoal_Bit: 'Charcoal_Bit',
  Saltpeter_Bit: 'Saltpeter_Bit',
  IronIngot_Bit: 'IronIngot_Bit',
  OakStick_Bit: 'OakStick_Bit',
  BrokenStick_Item: 'OakStick_Bit',
};

/** Maps dropped resource items or bits to their corresponding placeable block/bit prototype. */
export function mapResourceToBlockProto(protoId: string): string | null {
  return RESOURCE_TO_BLOCK_MAP[protoId] ?? null;
}

export function createDefaultToolSlots(): ToolDefinition[] {
  return DEFAULT_TOOL_SLOT_IDS.map((id) => getToolCatalogItem(id));
}

export function createDefaultBlockSlots(): string[] {
  return [...DEFAULT_BLOCK_SLOTS];
}

const STORAGE_KEY = 'voxel_stage1_slots_v1';

export interface SavedSlotLoadout {
  toolDefs: Array<{ kind: 'preset'; id: string } | { kind: 'custom'; id: string; name: string; config: CustomPulseConfig }>;
  blockSlots: string[];
}

export function saveLoadout(tools: readonly ToolDefinition[], blockSlots: readonly string[]): void {
  try {
    const payload: SavedSlotLoadout = {
      toolDefs: tools.map((t) =>
        t.customConfig
          ? { kind: 'custom', id: t.id, name: t.name, config: t.customConfig }
          : { kind: 'preset', id: t.id },
      ),
      blockSlots: [...blockSlots],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function loadLoadout(): { tools: ToolDefinition[]; blockSlots: string[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { tools: createDefaultToolSlots(), blockSlots: createDefaultBlockSlots() };
    }
    const parsed = JSON.parse(raw) as Partial<SavedSlotLoadout>;
    const tools =
      Array.isArray(parsed.toolDefs) && parsed.toolDefs.length === DEFAULT_TOOL_SLOT_IDS.length
        ? parsed.toolDefs.map((entry) =>
            entry.kind === 'custom'
              ? createCustomTool(entry.name, entry.config, entry.id)
              : getToolCatalogItem(entry.id),
          )
        : createDefaultToolSlots();
    const blockSlots =
      Array.isArray(parsed.blockSlots) && parsed.blockSlots.length === 8
        ? parsed.blockSlots.map((id) => String(id))
        : createDefaultBlockSlots();
    return { tools, blockSlots };
  } catch {
    return { tools: createDefaultToolSlots(), blockSlots: createDefaultBlockSlots() };
  }
}
