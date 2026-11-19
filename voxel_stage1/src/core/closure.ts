/**
 * Formal Closure Verification for RulesConfig.
 * Performs 4 checks:
 * 1. Referential integrity across pulse_bits, prototypes, gates, modifiers, deathrattles, recipes.
 * 2. Full gate -> deathrattle coverage across all concrete prototypes & all Atmo_* tags.
 * 3. Same-pulse zero cycle / self-loop check (ignoring preserve_hp discrete toggles).
 * 4. 3x3 spatial grid convergence simulation (<= 30 ticks).
 */

import type {
  CompoundPulse,
  EntityBlock,
  FormKind,
  PulseCategory,
  PulseSpec,
  RulesConfig,
} from './contracts.ts';
import { FormalEngine, resolveSelfItemProto } from './engine.ts';

export interface ClosureReport {
  missingRefs: string[];
  uncoveredGates: string[];
  pulseCycles: string[];
  gridConverged: boolean;
  gridTicks: number;
  ok: boolean;
}

const CATEGORIES: readonly PulseCategory[] = ['Mech', 'Thermo', 'Magic', 'Atmo'];
const SPECIAL_SPAWN_TOKENS = new Set(['$SPILL_CONTENTS', '$SELF_ITEM', '$CORPSE']);

function tokenizeMask(expr: string): string[] {
  if (!expr) return [];
  return expr
    .split(/[\s|,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function isConcreteProto(protoId: string, rules: RulesConfig): boolean {
  const spec = rules.prototypes[protoId];
  if (!spec) return false;
  return !protoId.startsWith('@') && spec.form !== 'Abstract' && spec.kind !== 'mixin';
}

function checkMaskRefs(
  expr: string,
  context: string,
  rules: RulesConfig,
  missingRefs: string[],
): void {
  for (const tok of tokenizeMask(expr)) {
    if (!rules.pulse_bits[tok]) {
      missingRefs.push(`${context}: unknown pulse bit "${tok}"`);
    }
  }
}

function checkPulseSpecRefs(
  spec: PulseSpec,
  context: string,
  rules: RulesConfig,
  missingRefs: string[],
): void {
  for (const cat of CATEGORIES) {
    const ch = spec.channels[cat];
    if (ch) {
      checkMaskRefs(ch[1], `${context}.channels.${cat}`, rules, missingRefs);
    }
  }
}

function checkReferentialIntegrity(rules: RulesConfig): string[] {
  const missingRefs: string[] = [];

  for (const [bitName, spec] of Object.entries(rules.pulse_bits)) {
    for (const parent of spec.inherits) {
      if (!rules.pulse_bits[parent]) {
        missingRefs.push(`pulse_bits.${bitName}.inherits: unknown bit "${parent}"`);
      }
    }
    // Check inheritance cycles.
    const visiting = new Set<string>();
    let curr: string | undefined = bitName;
    const stack: string[] = [bitName];
    while (stack.length > 0) {
      curr = stack.pop()!;
      if (visiting.has(curr)) {
        missingRefs.push(`pulse_bits.${bitName}: inheritance cycle at "${curr}"`);
        break;
      }
      visiting.add(curr);
      const s = rules.pulse_bits[curr];
      if (s) {
        for (const p of s.inherits) {
          if (rules.pulse_bits[p]) stack.push(p);
        }
      }
    }
  }

  for (const [protoId, spec] of Object.entries(rules.prototypes)) {
    if (spec.parent !== null && !rules.prototypes[spec.parent]) {
      missingRefs.push(`prototypes.${protoId}.parent: unknown prototype "${spec.parent}"`);
    }
    if (spec.mixins) {
      for (const m of spec.mixins) {
        if (!rules.prototypes[m]) {
          missingRefs.push(`prototypes.${protoId}.mixins: unknown prototype "${m}"`);
        }
      }
    }
    if (spec.corpse_base && !rules.prototypes[spec.corpse_base]) {
      missingRefs.push(
        `prototypes.${protoId}.corpse_base: unknown prototype "${spec.corpse_base}"`,
      );
    }
    if (spec.emits_atmo) {
      checkMaskRefs(spec.emits_atmo, `prototypes.${protoId}.emits_atmo`, rules, missingRefs);
    }
    if (spec.emits_pulse) {
      checkPulseSpecRefs(spec.emits_pulse, `prototypes.${protoId}.emits_pulse`, rules, missingRefs);
    }
    if (spec.self_pulse) {
      checkPulseSpecRefs(spec.self_pulse, `prototypes.${protoId}.self_pulse`, rules, missingRefs);
    }
    if (spec.impact_pulse) {
      checkPulseSpecRefs(
        spec.impact_pulse,
        `prototypes.${protoId}.impact_pulse`,
        rules,
        missingRefs,
      );
    }
    if (spec.contact_pulse) {
      checkPulseSpecRefs(
        spec.contact_pulse,
        `prototypes.${protoId}.contact_pulse`,
        rules,
        missingRefs,
      );
    }
    if (spec.recoil) {
      checkMaskRefs(spec.recoil.mask, `prototypes.${protoId}.recoil.mask`, rules, missingRefs);
    }
    if (spec.forwards_masks) {
      for (const fm of spec.forwards_masks) {
        checkMaskRefs(fm, `prototypes.${protoId}.forwards_masks`, rules, missingRefs);
      }
    }
    if (spec.anchor) {
      for (const boundProto of spec.anchor.binds) {
        if (!rules.prototypes[boundProto]) {
          missingRefs.push(
            `prototypes.${protoId}.anchor.binds: unknown prototype "${boundProto}"`,
          );
        }
      }
    }
  }

  rules.channel_gates.forEach((gate, i) => {
    if (!rules.prototypes[gate.target]) {
      missingRefs.push(`channel_gates[${i}].target: unknown prototype "${gate.target}"`);
    }
    checkMaskRefs(gate.req, `channel_gates[${i}].req`, rules, missingRefs);
  });

  rules.atmo_modifiers.forEach((mod, i) => {
    if (!rules.prototypes[mod.target]) {
      missingRefs.push(`atmo_modifiers[${i}].target: unknown prototype "${mod.target}"`);
    }
    checkMaskRefs(mod.atmo, `atmo_modifiers[${i}].atmo`, rules, missingRefs);
  });

  rules.deathrattle_table.forEach((dr, i) => {
    if (!rules.prototypes[dr.target]) {
      missingRefs.push(`deathrattle_table[${i}].target: unknown prototype "${dr.target}"`);
    }
    checkMaskRefs(dr.sub, `deathrattle_table[${i}].sub`, rules, missingRefs);
    for (const sp of dr.spawns) {
      if (!SPECIAL_SPAWN_TOKENS.has(sp) && !rules.prototypes[sp]) {
        missingRefs.push(`deathrattle_table[${i}].spawns: unknown prototype "${sp}"`);
      }
    }
    if (dr.emit_aoe) {
      checkPulseSpecRefs(dr.emit_aoe, `deathrattle_table[${i}].emit_aoe`, rules, missingRefs);
    }
  });

  rules.workbench_recipes.forEach((rec, i) => {
    for (const inp of rec.inputs) {
      if (!rules.prototypes[inp]) {
        missingRefs.push(`workbench_recipes[${i}].inputs: unknown prototype "${inp}"`);
      }
    }
    if (!rules.prototypes[rec.output]) {
      missingRefs.push(`workbench_recipes[${i}].output: unknown prototype "${rec.output}"`);
    }
    checkMaskRefs(rec.trigger_pulse, `workbench_recipes[${i}].trigger_pulse`, rules, missingRefs);
  });

  return missingRefs;
}

function checkGateCoverage(
  rules: RulesConfig,
  engine: FormalEngine,
  concreteProtos: string[],
  atmoCases: number[],
): string[] {
  const uncovered: string[] = [];

  for (const protoId of concreteProtos) {
    const ent = engine.spawn(protoId);
    const chain = engine.lookupChain(ent);

    for (const gate of rules.channel_gates) {
      if (gate.weight <= 0 || !chain.includes(gate.target)) continue;

      const reqMask = engine.parseMask(gate.req);
      const pulse = engine.makePulse(1, { [gate.category]: [1, gate.req] });

      for (const atmo of atmoCases) {
        const scores = engine.evalChannelScores(ent, pulse, atmo);
        if ((scores[gate.category] ?? 0) <= 0) continue;

        const combinedTags = (reqMask | atmo) >>> 0;
        const dr = engine.evalDeathrattle(ent, gate.category, combinedTags);
        if (!dr) {
          const atmoLabel = engine.formatMask(atmo) || 'Dry';
          uncovered.push(
            `${protoId} via ${gate.target}[${gate.category}:${gate.req}] @ ${atmoLabel}`,
          );
        }
      }
    }
  }

  return uncovered;
}

function resolveSpawnNames(
  protoId: string,
  spawns: string[],
  rules: RulesConfig,
  engine: FormalEngine,
): string[] {
  const out: string[] = [];
  for (const tok of spawns) {
    if (tok === '$SPILL_CONTENTS') continue;
    if (tok === '$SELF_ITEM') {
      const resolved = resolveSelfItemProto(protoId, rules);
      if (resolved) {
        out.push(resolved);
      }
    } else if (tok === '$CORPSE') {
      const corpse = engine.getAttr<string | undefined>(protoId, 'corpse_base', undefined);
      if (corpse && rules.prototypes[corpse]) {
        out.push(corpse);
      }
    } else if (isConcreteProto(tok, rules)) {
      out.push(tok);
    }
  }
  return out;
}

function checkSamePulseCycles(
  rules: RulesConfig,
  engine: FormalEngine,
  concreteProtos: string[],
  atmoCases: number[],
): string[] {
  const cycles: string[] = [];
  const seenCycles = new Set<string>();

  const uniquePulses = new Map<string, { label: string; pulse: CompoundPulse }>();

  const registerPulse = (label: string, base: CompoundPulse) => {
    for (const atmo of atmoCases) {
      const effAtmo = (base.atmoMask | atmo) >>> 0;
      const pulse: CompoundPulse = {
        amount: 1000,
        channels: base.channels,
        atmoMask: effAtmo,
      };
      const chKey = CATEGORIES.map((c) =>
        pulse.channels[c] ? `${c}:${pulse.channels[c]![0].toFixed(4)}:${pulse.channels[c]![1]}` : '',
      )
        .filter(Boolean)
        .join(',');
      const key = `${chKey}|atmo:${effAtmo}`;
      if (!uniquePulses.has(key)) {
        const atmoStr = engine.formatMask(effAtmo) || 'Dry';
        uniquePulses.set(key, { label: `${label}@${atmoStr}`, pulse });
      }
    }
  };

  for (const gate of rules.channel_gates) {
    if (gate.weight <= 0) continue;
    registerPulse(
      `${gate.category}:${gate.req}`,
      engine.makePulse(1000, { [gate.category]: [1, gate.req] }),
    );
  }

  for (const [protoId, spec] of Object.entries(rules.prototypes)) {
    if (spec.emits_pulse) {
      registerPulse(`${protoId}.emits_pulse`, engine.parseSpecPulse(spec.emits_pulse));
    }
    if (spec.self_pulse) {
      registerPulse(`${protoId}.self_pulse`, engine.parseSpecPulse(spec.self_pulse));
    }
    if (spec.impact_pulse) {
      registerPulse(`${protoId}.impact_pulse`, engine.parseSpecPulse(spec.impact_pulse));
    }
    if (spec.contact_pulse) {
      registerPulse(`${protoId}.contact_pulse`, engine.parseSpecPulse(spec.contact_pulse));
    }
  }

  for (const dr of rules.deathrattle_table) {
    if (dr.emit_aoe) {
      registerPulse(`${dr.target}.emit_aoe`, engine.parseSpecPulse(dr.emit_aoe));
    }
  }

  for (const { label, pulse } of uniquePulses.values()) {
    const adj = new Map<string, string[]>();

    for (const protoId of concreteProtos) {
      const ent = engine.spawn(protoId, undefined, pulse.atmoMask);
      const scores = engine.evalChannelScores(ent, pulse, pulse.atmoMask);

      let winnerCat: PulseCategory | null = null;
      let bestScore = 0;
      for (const cat of CATEGORIES) {
        const sc = scores[cat] ?? 0;
        if (sc > bestScore) {
          bestScore = sc;
          winnerCat = cat;
        }
      }
      if (!winnerCat) continue;

      const combinedTags = ((pulse.channels[winnerCat]?.[1] ?? 0) | pulse.atmoMask) >>> 0;
      const dr = engine.evalDeathrattle(ent, winnerCat, combinedTags);
      if (!dr || dr.preserve_hp) continue;

      const nextProtos = resolveSpawnNames(protoId, dr.spawns, rules, engine);
      if (nextProtos.length > 0) {
        adj.set(protoId, nextProtos);
      }
    }

    // 3-color DFS cycle check under this fixed pulse.
    const state = new Map<string, number>(); // 0/undef=unvisited, 1=visiting, 2=done
    const stack: string[] = [];

    const dfs = (u: string) => {
      state.set(u, 1);
      stack.push(u);

      for (const v of adj.get(u) ?? []) {
        const st = state.get(v) ?? 0;
        if (st === 1) {
          const idx = stack.indexOf(v);
          const path = [...stack.slice(idx), v].join(' -> ');
          const msg = `${path} [${label}]`;
          if (!seenCycles.has(msg)) {
            seenCycles.add(msg);
            cycles.push(msg);
          }
        } else if (st === 0) {
          dfs(v);
        }
      }

      stack.pop();
      state.set(u, 2);
    };

    for (const protoId of adj.keys()) {
      if ((state.get(protoId) ?? 0) === 0) {
        dfs(protoId);
      }
    }
  }

  return cycles;
}

function runSpatialGridConvergence(
  rules: RulesConfig,
  engine: FormalEngine,
): { gridConverged: boolean; gridTicks: number } {
  const layout: string[][] = [
    ['OakPlank', 'Fire', 'OakLog'],
    ['Leaf', 'Ice', 'Grass'],
    ['Dirt', 'Water', 'Stone'],
  ];

  const grid: Array<Array<EntityBlock | null>> = layout.map((row, z) =>
    row.map((protoId, x) =>
      rules.prototypes[protoId] ? engine.spawn(protoId, { x, y: 0, z }) : null,
    ),
  );

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const maxTicks = 30;
  for (let tick = 1; tick <= maxTicks; tick++) {
    let changed = false;

    // 1. Compute atmosphere mask per cell from self + 4-neighbors.
    const atmoGrid: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        const cell = grid[z][x];
        if (!cell) continue;
        const emitsAtmo = engine.getAttr<string | undefined>(cell.protoId, 'emits_atmo', undefined);
        if (!emitsAtmo) continue;
        const mask = engine.parseMask(emitsAtmo);
        atmoGrid[z][x] = (atmoGrid[z][x] | mask) >>> 0;
        for (const [dx, dz] of dirs) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nx < 3 && nz >= 0 && nz < 3) {
            atmoGrid[nz][nx] = (atmoGrid[nz][nx] | mask) >>> 0;
          }
        }
      }
    }

    // 2. Collect emissions for this tick (snapshot before mutating grid).
    const pulses: Array<{ x: number; z: number; pulse: CompoundPulse }> = [];
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        const cell = grid[z][x];
        if (!cell) continue;

        if (atmoGrid[z][x] !== 0) {
          const atmoStr = engine.formatMask(atmoGrid[z][x]);
          if (atmoStr) {
            pulses.push({ x, z, pulse: engine.simplePulse(10, atmoStr) });
          }
        }

        const emitsSpec = engine.getAttr<PulseSpec | undefined>(
          cell.protoId,
          'emits_pulse',
          undefined,
        );
        if (emitsSpec) {
          const emitted = engine.parseSpecPulse(emitsSpec);
          for (const [dx, dz] of dirs) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx >= 0 && nx < 3 && nz >= 0 && nz < 3) {
              pulses.push({ x: nx, z: nz, pulse: emitted });
            }
          }
        }

        const selfSpec = engine.getAttr<PulseSpec | undefined>(
          cell.protoId,
          'self_pulse',
          undefined,
        );
        if (selfSpec) {
          pulses.push({ x, z, pulse: engine.parseSpecPulse(selfSpec) });
        }
      }
    }

    // 3. Apply collected pulses.
    for (const { x, z, pulse } of pulses) {
      const target = grid[z][x];
      if (!target) continue;
      const outcome = engine.applyPulse(target, pulse, atmoGrid[z][x]);
      if (outcome.status === 'damaged') {
        changed = true;
      } else if (outcome.status === 'deathrattle') {
        changed = true;
        const gridSpawn = outcome.spawns.find((s) => {
          const form = engine.getAttr<FormKind>(s.protoId, 'form', 'FreeBody');
          return form === 'GridStatic' || form === 'GridFluid';
        });
        if (gridSpawn) {
          gridSpawn.pos = { x, y: 0, z };
          grid[z][x] = gridSpawn;
        } else {
          grid[z][x] = null;
        }
      }
    }

    if (!changed) {
      return { gridConverged: true, gridTicks: tick };
    }
  }

  return { gridConverged: false, gridTicks: maxTicks };
}

export function verifyClosure(rules: RulesConfig): ClosureReport {
  const missingRefs = checkReferentialIntegrity(rules);
  if (missingRefs.length > 0) {
    return {
      missingRefs,
      uncoveredGates: [],
      pulseCycles: [],
      gridConverged: false,
      gridTicks: 0,
      ok: false,
    };
  }

  const engine = new FormalEngine(rules);
  const concreteProtos = Object.keys(rules.prototypes).filter((id) => isConcreteProto(id, rules));
  const atmoCases = [
    0,
    ...Object.entries(rules.pulse_bits)
      .filter(([, spec]) => spec.category === 'Atmo')
      .map(([name]) => engine.parseMask(name)),
  ];

  const uncoveredGates = checkGateCoverage(rules, engine, concreteProtos, atmoCases);
  const pulseCycles = checkSamePulseCycles(rules, engine, concreteProtos, atmoCases);
  const { gridConverged, gridTicks } = runSpatialGridConvergence(rules, engine);

  const ok =
    missingRefs.length === 0 &&
    uncoveredGates.length === 0 &&
    pulseCycles.length === 0 &&
    gridConverged;

  return {
    missingRefs,
    uncoveredGates,
    pulseCycles,
    gridConverged,
    gridTicks,
    ok,
  };
}
