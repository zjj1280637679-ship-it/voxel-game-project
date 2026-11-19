/**
 * Frozen Module Contracts for Stage 1 Formal Voxel Prototype.
 * Do not introduce any DOM / WebGL / Three.js imports in src/core/ or src/world/.
 */

export type PulseCategory = 'Mech' | 'Thermo' | 'Magic' | 'Atmo';
export type FormKind = 'Abstract' | 'GridStatic' | 'GridFluid' | 'FreeBody';

export interface Coord3 {
  x: number;
  y: number;
  z: number;
}

export interface PulseBitSpec {
  bit: number;
  category: PulseCategory;
  inherits: string[];
}

export interface PulseSpec {
  amount: number;
  channels: Partial<Record<PulseCategory, [number, string]>>;
}

export interface AnchorSpec {
  binds: string[];
  radius: number;
  respawn_sec?: number;
  max_count?: number;
}

export interface PrototypeSpec {
  parent: string | null;
  form?: FormKind;
  hp?: number;
  hp_scale?: number;
  kind?: string;
  shape?: string;
  ai?: string;
  isolates?: boolean;
  visible?: boolean;
  collidable?: boolean;
  interactable?: boolean;
  mixins?: string[];
  corpse_base?: string;
  emits_atmo?: string;
  emits_pulse?: PulseSpec;
  self_pulse?: PulseSpec;
  impact_pulse?: PulseSpec;
  contact_pulse?: PulseSpec;
  recoil?: { amount: number; mask: string };
  forwards_masks?: string[];
  anchor?: AnchorSpec;
}

export interface ChannelGateRule {
  target: string;
  category: PulseCategory;
  req: string;
  weight: number;
}

export interface AtmoModifierRule {
  target: string;
  atmo: string;
  category: PulseCategory;
  mult: number;
}

export interface DeathrattleRule {
  target: string;
  category: PulseCategory;
  sub: string;
  spawns: string[];
  preserve_hp?: boolean;
  emit_aoe?: PulseSpec;
}

export interface WorkbenchRecipeSpec {
  inputs: string[];
  trigger_pulse: string;
  output: string;
}

export interface RulesConfig {
  pulse_bits: Record<string, PulseBitSpec>;
  prototypes: Record<string, PrototypeSpec>;
  channel_gates: ChannelGateRule[];
  atmo_modifiers: AtmoModifierRule[];
  deathrattle_table: DeathrattleRule[];
  workbench_recipes: WorkbenchRecipeSpec[];
}

export interface CompoundPulse {
  amount: number;
  /** Map of category -> [normalizedShare, u32Mask] */
  channels: Partial<Record<PulseCategory, [number, number]>>;
  atmoMask: number;
}

export type EntityAnimState = 'idle' | 'walk' | 'block' | 'slash' | 'salute' | 'death';

export interface EntityBlock {
  uid: number;
  protoId: string;
  hp: number;
  maxHp: number;
  form: FormKind;
  pos: Coord3;
  vel?: Coord3;
  cellAtmo: number;
  chamber: EntityBlock[];
  shape?: string;
  payloadProtoId?: string;
  homeAnchorUid?: number;
  homePos?: Coord3;
  animState?: EntityAnimState;
  animTimer?: number;
}

export type OutcomeStatus = 'immune' | 'damaged' | 'crafted' | 'deathrattle';

export interface PulseOutcome {
  targetBefore: string;
  effAtmo: number;
  channelScores: Partial<Record<PulseCategory, number>>;
  winnerCat: PulseCategory | null;
  damage: number;
  status: OutcomeStatus;
  spawns: EntityBlock[];
  spilled: EntityBlock[];
  aoePulse?: CompoundPulse;
}

export interface RayHit {
  kind: 'grid' | 'free';
  entity: EntityBlock;
  pos: Coord3;
  normal: Coord3;
  distance: number;
}

export interface InteractionLogEntry {
  tick: number;
  action: string;
  target: string;
  scoresSummary: string;
  winnerCat: PulseCategory | null;
  atmoText: string;
  status: OutcomeStatus;
  resultText: string;
}

export interface WorldTickEvents {
  tick: number;
  gridChanged: boolean;
  logs: InteractionLogEntry[];
  fxBursts: Array<{ pos: Coord3; colorHex: number; kind: 'hit' | 'deathrattle' | 'craft' | 'aoe' }>;
}

export interface IFormalEngine {
  readonly rules: RulesConfig;
  parseMask(expr: string | string[]): number;
  formatMask(mask: number): string;
  makePulse(
    amount: number,
    channels: Partial<Record<PulseCategory, [number, string]>>,
    atmo?: string,
  ): CompoundPulse;
  simplePulse(amount: number, expr: string): CompoundPulse;
  parseSpecPulse(spec: PulseSpec): CompoundPulse;
  getAttr<T = unknown>(protoId: string, key: string, fallback?: T): T;
  lookupChain(entity: EntityBlock): string[];
  spawn(protoId: string, pos?: Coord3, cellAtmo?: number, hpOverride?: number): EntityBlock;
  evalChannelScores(
    entity: EntityBlock,
    pulse: CompoundPulse,
    effAtmo: number,
  ): Partial<Record<PulseCategory, number>>;
  evalDeathrattle(
    entity: EntityBlock,
    winnerCat: PulseCategory,
    combinedTags: number,
  ): DeathrattleRule | null;
  applyPulse(entity: EntityBlock, pulse: CompoundPulse, envAtmo?: number): PulseOutcome;
  collide(attacker: EntityBlock, target: EntityBlock, envAtmo?: number): [PulseOutcome, PulseOutcome];
}

export interface IVoxelWorld {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly engine: IFormalEngine;
  readonly tickCount: number;
  getDirtyRevision(): number;
  getGridBlock(x: number, y: number, z: number): EntityBlock | null;
  getFreeBodies(): readonly EntityBlock[];
  getCellAtmo(x: number, y: number, z: number): number;
  raycast(origin: Coord3, dir: Coord3, maxDist?: number): RayHit | null;
  interactAt(hit: RayHit, pulse: CompoundPulse, label?: string): InteractionLogEntry;
  shootProjectile(protoId: string, origin: Coord3, dir: Coord3, speed?: number): EntityBlock;
  placeBlock(pos: Coord3, protoId: string): EntityBlock | null;
  consumeFreeBody(uid: number): EntityBlock | null;
  consumeFreeBodies(uids: readonly number[]): EntityBlock[];
  workbenchInsert(wbUid: number, itemProtoId: string): boolean;
  workbenchClear(wbUid: number): void;
  stepTick(dt: number): WorldTickEvents;
  getRecentLogs(limit?: number): readonly InteractionLogEntry[];
  getPendingFx(): Array<{ pos: Coord3; colorHex: number; kind: 'hit' | 'deathrattle' | 'craft' | 'aoe' }>;
}
