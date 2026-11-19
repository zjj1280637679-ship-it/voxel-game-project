/**
 * Formal Rule Engine & Monotonic U32 Bitmask Registry.
 * Pure TypeScript / Node & Browser safe (no DOM/WebGL imports).
 */

import type {
  AtmoModifierRule,
  ChannelGateRule,
  CompoundPulse,
  Coord3,
  DeathrattleRule,
  EntityBlock,
  FormKind,
  IFormalEngine,
  PrototypeSpec,
  PulseBitSpec,
  PulseCategory,
  PulseOutcome,
  PulseSpec,
  RulesConfig,
} from './contracts.ts';

const CATEGORIES: readonly PulseCategory[] = ['Mech', 'Thermo', 'Magic', 'Atmo'];

export const SELF_ITEM_FALLBACKS: Record<string, string> = {
  Stone: 'Cobble_Item',
  Glass: 'GlassShard_Item',
  Ice: 'IceShard_Item',
  Grass: 'Dirt_Item',
};

export function resolveSelfItemProto(protoId: string, rules: RulesConfig): string | null {
  const candidate = `${protoId}_Item`;
  if (rules.prototypes[candidate]) return candidate;
  const fallback = SELF_ITEM_FALLBACKS[protoId];
  if (fallback && rules.prototypes[fallback]) return fallback;
  return null;
}

function popcount32(n: number): number {
  let x = n >>> 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export class BitRegistry {
  private readonly specs: Record<string, PulseBitSpec>;
  private readonly monotonicMasks = new Map<string, number>();
  private readonly catAllMasks: Record<PulseCategory, number> = {
    Mech: 0,
    Thermo: 0,
    Magic: 0,
    Atmo: 0,
  };
  private readonly orderedNames: string[];

  constructor(pulseBits: Record<string, PulseBitSpec>) {
    this.specs = pulseBits;
    for (const name of Object.keys(pulseBits)) {
      const mask = this.computeMonotonicMask(name, new Set());
      const cat = pulseBits[name].category;
      this.catAllMasks[cat] = (this.catAllMasks[cat] | mask) >>> 0;
    }
    // Sort by descending popcount (then bit index descending) for minimal readable formatting.
    this.orderedNames = Object.keys(pulseBits).sort((a, b) => {
      const diff =
        popcount32(this.monotonicMasks.get(b)!) - popcount32(this.monotonicMasks.get(a)!);
      return diff !== 0 ? diff : pulseBits[b].bit - pulseBits[a].bit;
    });
  }

  private computeMonotonicMask(name: string, visiting: Set<string>): number {
    const cached = this.monotonicMasks.get(name);
    if (cached !== undefined) return cached;

    const spec = this.specs[name];
    if (!spec) {
      throw new Error(`Unknown pulse bit: ${name}`);
    }
    if (visiting.has(name)) {
      throw new Error(`Cycle detected in pulse_bits inheritance at ${name}`);
    }

    visiting.add(name);
    let mask = (1 << spec.bit) >>> 0;
    for (const parent of spec.inherits) {
      mask = (mask | this.computeMonotonicMask(parent, visiting)) >>> 0;
    }
    visiting.delete(name);
    this.monotonicMasks.set(name, mask);
    return mask;
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.specs, name);
  }

  getMask(name: string): number {
    const mask = this.monotonicMasks.get(name);
    if (mask === undefined) {
      throw new Error(`Unknown pulse bit: ${name}`);
    }
    return mask;
  }

  getCategory(name: string): PulseCategory | undefined {
    return this.specs[name]?.category;
  }

  getCategoryMask(cat: PulseCategory): number {
    return this.catAllMasks[cat];
  }

  tokenize(expr: string | string[]): string[] {
    const parts = Array.isArray(expr) ? expr : [expr];
    const tokens: string[] = [];
    for (const part of parts) {
      if (!part) continue;
      for (const tok of part.split(/[\s|,]+/)) {
        const trimmed = tok.trim();
        if (trimmed.length > 0) {
          tokens.push(trimmed);
        }
      }
    }
    return tokens;
  }

  parseMask(expr: string | string[]): number {
    let mask = 0;
    for (const tok of this.tokenize(expr)) {
      mask = (mask | this.getMask(tok)) >>> 0;
    }
    return mask;
  }

  formatMask(mask: number): string {
    const target = mask >>> 0;
    if (target === 0) return '';

    let covered = 0;
    const labels: string[] = [];
    for (const name of this.orderedNames) {
      const m = this.monotonicMasks.get(name)!;
      if ((target & m) === m && (covered & m) !== m) {
        labels.push(name);
        covered = (covered | m) >>> 0;
        if (covered === target) break;
      }
    }
    return labels.join(' | ');
  }
}

interface CompiledGate {
  rule: ChannelGateRule;
  reqMask: number;
  reqBits: number;
}

interface CompiledAtmoMod {
  rule: AtmoModifierRule;
  atmoMask: number;
}

interface CompiledDeathrattle {
  rule: DeathrattleRule;
  subMask: number;
  subBits: number;
}

export class FormalEngine implements IFormalEngine {
  readonly rules: RulesConfig;
  readonly registry: BitRegistry;

  private nextUid = 1;
  private readonly chainCache = new Map<string, string[]>();
  private readonly gatesByTargetCat = new Map<string, CompiledGate[]>();
  private readonly modsByTargetCat = new Map<string, CompiledAtmoMod[]>();
  private readonly drByTargetCat = new Map<string, CompiledDeathrattle[]>();

  constructor(rules: RulesConfig) {
    this.rules = rules;
    this.registry = new BitRegistry(rules.pulse_bits);

    for (const rule of rules.channel_gates) {
      const key = `${rule.target}::${rule.category}`;
      let list = this.gatesByTargetCat.get(key);
      if (!list) {
        list = [];
        this.gatesByTargetCat.set(key, list);
      }
      const reqMask = this.registry.parseMask(rule.req);
      list.push({ rule, reqMask, reqBits: popcount32(reqMask) });
    }

    for (const rule of rules.atmo_modifiers) {
      const key = `${rule.target}::${rule.category}`;
      let list = this.modsByTargetCat.get(key);
      if (!list) {
        list = [];
        this.modsByTargetCat.set(key, list);
      }
      list.push({ rule, atmoMask: this.registry.parseMask(rule.atmo) });
    }

    for (const rule of rules.deathrattle_table) {
      const key = `${rule.target}::${rule.category}`;
      let list = this.drByTargetCat.get(key);
      if (!list) {
        list = [];
        this.drByTargetCat.set(key, list);
      }
      const subMask = this.registry.parseMask(rule.sub);
      list.push({ rule, subMask, subBits: popcount32(subMask) });
    }
  }

  parseMask(expr: string | string[]): number {
    return this.registry.parseMask(expr);
  }

  formatMask(mask: number): string {
    return this.registry.formatMask(mask);
  }

  makePulse(
    amount: number,
    channels: Partial<Record<PulseCategory, [number, string]>>,
    atmo?: string,
  ): CompoundPulse {
    let totalWeight = 0;
    for (const cat of CATEGORIES) {
      const entry = channels[cat];
      if (entry && entry[0] > 0) {
        totalWeight += entry[0];
      }
    }

    const normalized: Partial<Record<PulseCategory, [number, number]>> = {};
    if (totalWeight > 0) {
      for (const cat of CATEGORIES) {
        const entry = channels[cat];
        if (entry && entry[0] > 0) {
          normalized[cat] = [entry[0] / totalWeight, this.parseMask(entry[1])];
        }
      }
    }

    return {
      amount,
      channels: normalized,
      atmoMask: atmo ? this.parseMask(atmo) : 0,
    };
  }

  simplePulse(amount: number, expr: string): CompoundPulse {
    const tokens = this.registry.tokenize(expr);
    const byCat: Partial<Record<PulseCategory, string[]>> = {};

    for (const tok of tokens) {
      // Validate unknown bits early via getMask.
      this.registry.getMask(tok);
      const cat = this.registry.getCategory(tok);
      if (!cat) continue;
      let list = byCat[cat];
      if (!list) {
        list = [];
        byCat[cat] = list;
      }
      list.push(tok);
    }

    const nonAtmoCats = (['Mech', 'Thermo', 'Magic'] as const).filter(
      (c) => byCat[c] && byCat[c]!.length > 0,
    );
    const atmoExpr = byCat.Atmo?.join(' | ');

    if (nonAtmoCats.length > 0) {
      const rawChannels: Partial<Record<PulseCategory, [number, string]>> = {};
      for (const cat of nonAtmoCats) {
        rawChannels[cat] = [1, byCat[cat]!.join(' | ')];
      }
      return this.makePulse(amount, rawChannels, atmoExpr);
    }

    if (atmoExpr) {
      return this.makePulse(amount, { Atmo: [1, atmoExpr] }, atmoExpr);
    }

    return { amount, channels: {}, atmoMask: 0 };
  }

  parseSpecPulse(spec: PulseSpec): CompoundPulse {
    return this.makePulse(spec.amount, spec.channels);
  }

  private getLookupChainByProto(protoId: string): string[] {
    const cached = this.chainCache.get(protoId);
    if (cached) return cached;

    const chain: string[] = [];
    const seen = new Set<string>();
    const addUnique = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id);
        chain.push(id);
      }
    };

    const rootSpec = this.rules.prototypes[protoId];
    addUnique(protoId);
    if (rootSpec?.mixins) {
      for (const m of rootSpec.mixins) {
        addUnique(m);
      }
    }

    const ancestorMixins: string[] = [];
    let curr = rootSpec?.parent ?? null;
    const visitedParents = new Set<string>([protoId]);
    while (curr && !visitedParents.has(curr)) {
      visitedParents.add(curr);
      addUnique(curr);
      const spec = this.rules.prototypes[curr];
      if (spec?.mixins) {
        for (const m of spec.mixins) {
          ancestorMixins.push(m);
        }
      }
      curr = spec?.parent ?? null;
    }

    for (const m of ancestorMixins) {
      addUnique(m);
    }

    this.chainCache.set(protoId, chain);
    return chain;
  }

  lookupChain(entity: EntityBlock): string[] {
    return [...this.getLookupChainByProto(entity.protoId)];
  }

  getAttr<T = unknown>(protoId: string, key: string, fallback?: T): T {
    for (const target of this.getLookupChainByProto(protoId)) {
      const spec = this.rules.prototypes[target] as unknown as Record<string, unknown> | undefined;
      if (spec && spec[key] !== undefined) {
        return spec[key] as T;
      }
    }
    return fallback as T;
  }

  private computeMaxHp(protoId: string): number {
    let scale = 1;
    let curr: string | null = protoId;
    const visited = new Set<string>();

    while (curr && !visited.has(curr)) {
      visited.add(curr);
      const spec: PrototypeSpec | undefined = this.rules.prototypes[curr];
      if (!spec) break;
      if (spec.hp !== undefined) {
        return Math.max(1, Math.round(spec.hp * scale));
      }
      if (spec.hp_scale !== undefined) {
        scale *= spec.hp_scale;
      }
      curr = spec.parent ?? null;
    }

    return Math.max(1, Math.round(100 * scale));
  }

  spawn(protoId: string, pos?: Coord3, cellAtmo = 0, hpOverride?: number): EntityBlock {
    const maxHp = this.computeMaxHp(protoId);
    const hp = hpOverride !== undefined ? Math.min(maxHp, Math.max(0, hpOverride)) : maxHp;
    const form = this.getAttr<FormKind>(protoId, 'form', 'FreeBody');
    const shape = this.getAttr<string | undefined>(protoId, 'shape', undefined);

    return {
      uid: this.nextUid++,
      protoId,
      hp,
      maxHp,
      form,
      pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : { x: 0, y: 0, z: 0 },
      cellAtmo: cellAtmo >>> 0,
      chamber: [],
      ...(shape !== undefined ? { shape } : {}),
    };
  }

  evalChannelScores(
    entity: EntityBlock,
    pulse: CompoundPulse,
    effAtmo: number,
  ): Partial<Record<PulseCategory, number>> {
    const scores: Partial<Record<PulseCategory, number>> = {};
    const chain = this.getLookupChainByProto(entity.protoId);
    const atmo = effAtmo >>> 0;

    for (const cat of CATEGORIES) {
      const ch = pulse.channels[cat];
      if (!ch) continue;
      const [share, rawMask] = ch;
      const pulseMask = rawMask >>> 0;

      // Weak threshold gate: stop at the first ancestor/mixin with >=1 matching gate.
      // Within that node, prefer highest bit-specificity (reqBits), breaking ties by weight.
      let gateWeight = 0;
      for (const target of chain) {
        const gates = this.gatesByTargetCat.get(`${target}::${cat}`);
        if (!gates) continue;
        let bestGate: CompiledGate | null = null;
        for (const g of gates) {
          if ((pulseMask & g.reqMask) === g.reqMask) {
            if (
              !bestGate ||
              g.reqBits > bestGate.reqBits ||
              (g.reqBits === bestGate.reqBits && g.rule.weight > bestGate.rule.weight)
            ) {
              bestGate = g;
            }
          }
        }
        if (bestGate) {
          gateWeight = bestGate.rule.weight;
          break;
        }
      }

      if (gateWeight <= 0) {
        scores[cat] = 0;
        continue;
      }

      // Apply atmo_modifiers (most-specific target per atmo bitmask).
      let atmoMult = 1.0;
      const appliedAtmoMasks = new Set<number>();
      for (const target of chain) {
        const mods = this.modsByTargetCat.get(`${target}::${cat}`);
        if (!mods) continue;
        for (const m of mods) {
          if ((atmo & m.atmoMask) === m.atmoMask && !appliedAtmoMasks.has(m.atmoMask)) {
            appliedAtmoMasks.add(m.atmoMask);
            atmoMult *= m.rule.mult;
          }
        }
      }

      scores[cat] = pulse.amount * share * gateWeight * atmoMult;
    }

    return scores;
  }

  evalDeathrattle(
    entity: EntityBlock,
    winnerCat: PulseCategory,
    combinedTags: number,
  ): DeathrattleRule | null {
    const tags = combinedTags >>> 0;
    const chain = this.getLookupChainByProto(entity.protoId);

    for (const target of chain) {
      const rules = this.drByTargetCat.get(`${target}::${winnerCat}`);
      if (!rules) continue;
      let best: CompiledDeathrattle | null = null;
      for (const entry of rules) {
        if ((tags & entry.subMask) === entry.subMask) {
          if (!best || entry.subBits > best.subBits) {
            best = entry;
          }
        }
      }
      if (best) {
        return best.rule;
      }
    }

    return null;
  }

  private tryWorkbenchCraft(
    entity: EntityBlock,
    pulse: CompoundPulse,
    effAtmo: number,
  ): PulseOutcome | null {
    const forwards = this.getAttr<string[] | undefined>(entity.protoId, 'forwards_masks', undefined);
    if (!forwards || forwards.length === 0) return null;

    let allPulseTags = 0;
    for (const cat of CATEGORIES) {
      const ch = pulse.channels[cat];
      if (ch) {
        allPulseTags = (allPulseTags | ch[1]) >>> 0;
      }
    }
    if (allPulseTags === 0) return null;

    const forwardedByBlock = forwards.some((expr) => {
      const fm = this.parseMask(expr);
      return fm !== 0 && (allPulseTags & fm) === fm;
    });
    if (!forwardedByBlock) return null;

    for (const recipe of this.rules.workbench_recipes) {
      const triggerMask = this.parseMask(recipe.trigger_pulse);
      if ((allPulseTags & triggerMask) !== triggerMask) continue;

      const matchedIndices: number[] = [];
      const used = new Set<number>();
      let allPresent = true;
      for (const reqProto of recipe.inputs) {
        const idx = entity.chamber.findIndex(
          (item, i) => !used.has(i) && item.protoId === reqProto,
        );
        if (idx === -1) {
          allPresent = false;
          break;
        }
        used.add(idx);
        matchedIndices.push(idx);
      }

      if (!allPresent) continue;

      // Consume exact matched inputs from chamber.
      matchedIndices.sort((a, b) => b - a);
      for (const idx of matchedIndices) {
        entity.chamber.splice(idx, 1);
      }

      const crafted = this.spawn(recipe.output, entity.pos, 0);
      return {
        targetBefore: entity.protoId,
        effAtmo,
        channelScores: {},
        winnerCat: null,
        damage: 0,
        status: 'crafted',
        spawns: [crafted],
        spilled: [],
      };
    }

    return null;
  }

  private resolveSelfItemProto(protoId: string): string | null {
    return resolveSelfItemProto(protoId, this.rules);
  }

  applyPulse(entity: EntityBlock, pulse: CompoundPulse, envAtmo = 0): PulseOutcome {
    const targetBefore = entity.protoId;
    const effAtmo = (entity.cellAtmo | envAtmo | pulse.atmoMask) >>> 0;

    // 1. Workbench crafting intercept.
    const craftOutcome = this.tryWorkbenchCraft(entity, pulse, effAtmo);
    if (craftOutcome) {
      return craftOutcome;
    }

    // 2. Weighted channel scores.
    const channelScores = this.evalChannelScores(entity, pulse, effAtmo);

    let damage = 0;
    let winnerCat: PulseCategory | null = null;
    let bestScore = 0;
    for (const cat of CATEGORIES) {
      const score = channelScores[cat];
      if (score !== undefined && score > 0) {
        damage += score;
        if (score > bestScore) {
          bestScore = score;
          winnerCat = cat;
        }
      }
    }

    if (damage <= 0 || winnerCat === null) {
      return {
        targetBefore,
        effAtmo,
        channelScores,
        winnerCat: null,
        damage: 0,
        status: 'immune',
        spawns: [],
        spilled: [],
      };
    }

    const hpBefore = entity.hp;
    entity.hp = Math.max(0, entity.hp - damage);

    if (entity.hp > 0) {
      return {
        targetBefore,
        effAtmo,
        channelScores,
        winnerCat,
        damage,
        status: 'damaged',
        spawns: [],
        spilled: [],
      };
    }

    // 3. Deathrattle resolution.
    const winnerMask = pulse.channels[winnerCat]?.[1] ?? 0;
    const combinedTags = (winnerMask | effAtmo) >>> 0;
    const rule = this.evalDeathrattle(entity, winnerCat, combinedTags);

    const spawns: EntityBlock[] = [];
    const spilled: EntityBlock[] = [];

    if (rule) {
      for (const token of rule.spawns) {
        if (token === '$SPILL_CONTENTS') {
          for (const item of entity.chamber) {
            item.pos = { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z };
            item.cellAtmo = 0;
            spilled.push(item);
          }
          entity.chamber = [];
        } else if (token === '$SELF_ITEM') {
          const itemProto = this.resolveSelfItemProto(entity.protoId);
          if (itemProto) {
            spawns.push(this.spawn(itemProto, entity.pos, 0));
          }
        } else if (token === '$CORPSE') {
          const corpseProto = this.getAttr<string | undefined>(
            entity.protoId,
            'corpse_base',
            undefined,
          );
          if (corpseProto && this.rules.prototypes[corpseProto]) {
            spawns.push(this.spawn(corpseProto, entity.pos, 0));
          }
        } else if (this.rules.prototypes[token]) {
          const hpOverride = rule.preserve_hp ? hpBefore : undefined;
          const spawned = this.spawn(token, entity.pos, 0, hpOverride);
          if (token === 'FallingBlock') {
            spawned.payloadProtoId = entity.protoId;
          }
          spawns.push(spawned);
        }
      }
    }

    const aoePulse = rule?.emit_aoe ? this.parseSpecPulse(rule.emit_aoe) : undefined;

    return {
      targetBefore,
      effAtmo,
      channelScores,
      winnerCat,
      damage,
      status: 'deathrattle',
      spawns,
      spilled,
      ...(aoePulse ? { aoePulse } : {}),
    };
  }

  /**
   * Resolves a physical collision between `attacker` and `target`.
   * @returns Tuple `[attackerOutcome, targetOutcome]` matching parameter order.
   */
  collide(
    attacker: EntityBlock,
    target: EntityBlock,
    envAtmo = 0,
  ): [PulseOutcome, PulseOutcome] {
    const strikeSpec =
      this.getAttr<PulseSpec | undefined>(attacker.protoId, 'impact_pulse', undefined) ??
      this.getAttr<PulseSpec | undefined>(attacker.protoId, 'contact_pulse', undefined);
    const strikePulse = strikeSpec ? this.parseSpecPulse(strikeSpec) : this.simplePulse(0, '');

    const recoilSpec = this.getAttr<{ amount: number; mask: string } | undefined>(
      target.protoId,
      'recoil',
      undefined,
    );
    const recoilPulse =
      recoilSpec && recoilSpec.amount > 0
        ? this.simplePulse(recoilSpec.amount, recoilSpec.mask)
        : this.simplePulse(0, '');

    const targetOutcome = this.applyPulse(target, strikePulse, envAtmo);
    const attackerOutcome = this.applyPulse(attacker, recoilPulse, envAtmo);
    return [attackerOutcome, targetOutcome];
  }
}
