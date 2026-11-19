import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import type { RulesConfig } from '../src/core/contracts.ts';
import { BitRegistry, FormalEngine } from '../src/core/engine.ts';
import { verifyClosure } from '../src/core/closure.ts';
import { VoxelWorld } from '../src/world/voxelWorld.ts';
import { createCustomTool, getToolCatalogItem, mapResourceToBlockProto } from '../src/client/tools.ts';
import {
  normalizePerformanceBudget,
  PERF_PRESETS,
  loadPerformanceBudget,
} from '../src/render/performanceBudget.ts';

const rulesPath = new URL('../data/rules.json', import.meta.url);
const rules = JSON.parse(readFileSync(rulesPath, 'utf-8')) as RulesConfig;

test('closure verification passes cleanly on data/rules.json', () => {
  const report = verifyClosure(rules);
  assert.deepEqual(report.missingRefs, []);
  assert.deepEqual(report.uncoveredGates, []);
  assert.deepEqual(report.pulseCycles, []);
  assert.equal(report.gridConverged, true);
  assert.ok(report.gridTicks > 0 && report.gridTicks <= 30);
  assert.equal(report.ok, true);
});

test('closure verification detects broken refs, uncovered gates, and same-pulse cycles', () => {
  const brokenRefRules = structuredClone(rules);
  brokenRefRules.channel_gates.push({
    target: 'NonExistentProto',
    category: 'Mech',
    req: 'Mech_T1',
    weight: 1.0,
  });
  const refReport = verifyClosure(brokenRefRules);
  assert.equal(refReport.ok, false);
  assert.ok(refReport.missingRefs.length > 0);

  const uncoveredRules = structuredClone(rules);
  uncoveredRules.deathrattle_table = uncoveredRules.deathrattle_table.filter(
    (d) => !(d.target === 'Ice' && d.category === 'Mech'),
  );
  const gateReport = verifyClosure(uncoveredRules);
  assert.equal(gateReport.ok, false);
  assert.ok(gateReport.uncoveredGates.some((g) => g.startsWith('Ice ')));

  const cyclicRules = structuredClone(rules);
  cyclicRules.deathrattle_table = cyclicRules.deathrattle_table.map((d) =>
    d.target === 'Ice' && d.category === 'Thermo' ? { ...d, spawns: ['Water'] } : d,
  );
  // Make Water freeze back into Ice under Thermo_Heat_T1 by opening a Thermo_Heat_T1 gate -> cycle.
  cyclicRules.channel_gates.push({
    target: 'Water',
    category: 'Thermo',
    req: 'Thermo_Heat_T1',
    weight: 1.0,
  });
  cyclicRules.deathrattle_table.push({
    target: 'Water',
    category: 'Thermo',
    sub: 'Thermo_Heat_T1',
    spawns: ['Ice'],
  });
  const cycleReport = verifyClosure(cyclicRules);
  assert.equal(cycleReport.ok, false);
  assert.ok(cycleReport.pulseCycles.length > 0);
});

test('BitRegistry & FormalEngine core semantics (monotonic masks, makePulse, simplePulse, lookupChain)', () => {
  const reg = new BitRegistry(rules.pulse_bits);
  const t3 = reg.parseMask('Mech_T3');
  const t1 = reg.parseMask('Mech_T1');
  assert.equal((t3 & t1) >>> 0, t1);
  assert.equal(reg.formatMask(t3), 'Mech_T3');

  const engine = new FormalEngine(rules);

  // makePulse auto-normalizes raw weights.
  const torch = engine.makePulse(10, {
    Mech: [3, 'Mech_T1'],
    Thermo: [7, 'Thermo_Heat_T2'],
  });
  assert.ok(Math.abs(torch.channels.Mech![0] - 0.3) < 1e-6);
  assert.ok(Math.abs(torch.channels.Thermo![0] - 0.7) < 1e-6);

  // simplePulse pure Atmo becomes Atmo channel; mixed tags keep Atmo in atmoMask.
  const pureWet = engine.simplePulse(10, 'Atmo_Wet');
  assert.ok(pureWet.channels.Atmo);
  assert.equal(pureWet.channels.Atmo![0], 1);

  const mixed = engine.simplePulse(10, 'Thermo_Heat_T2 | Atmo_NoO2');
  assert.ok(mixed.channels.Thermo);
  assert.equal(mixed.channels.Atmo, undefined);
  assert.equal(mixed.atmoMask, engine.parseMask('Atmo_NoO2'));

  // lookupChain order: concrete -> direct mixins -> ancestors -> ancestor mixins.
  const door = engine.spawn('OakDoor_Closed');
  assert.deepEqual(engine.lookupChain(door), [
    'OakDoor_Closed',
    '@Mix_Toggleable',
    'OakPlank',
    '@Mat_Wood',
    '@Form_GridStatic',
    'EntityRoot',
  ]);
});

test('VoxelWorld: Wood pickaxe vs Obsidian is immune; Diamond pickaxe breaks into Obsidian_Item', () => {
  const world = new VoxelWorld(rules);
  const hit = world.raycast({ x: 7.5, y: 2.5, z: 15 }, { x: 0, y: 0, z: -1 }, 10);
  assert.ok(hit);
  assert.equal(hit.entity.protoId, 'Obsidian');

  const woodPick = world.engine.simplePulse(10, 'Mech_T1');
  const logImmune = world.interactAt(hit, woodPick, 'WoodPick');
  assert.equal(logImmune.status, 'immune');
  assert.equal(world.getGridBlock(7, 2, 12)?.protoId, 'Obsidian');

  const diamondPick = world.engine.simplePulse(40, 'Mech_T3');
  const logBreak = world.interactAt(hit, diamondPick, 'DiamondPick');
  assert.equal(logBreak.status, 'deathrattle');
  assert.equal(logBreak.winnerCat, 'Mech');
  assert.equal(world.getGridBlock(7, 2, 12), null);
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'Obsidian_Item'));
});

test('VoxelWorld: Torch club destroys dry OakPlank via Thermo vs wet OakPlank near Water via Mech', () => {
  const world = new VoxelWorld(rules);
  const torchClub = world.engine.makePulse(15, {
    Mech: [0.3, 'Mech_T1'],
    Thermo: [0.7, 'Thermo_Heat_T2'],
  });

  // Dry OakPlank at (14, 2, 13) -> Thermo wins.
  const dryHit = world.raycast({ x: 14.5, y: 2.5, z: 14.2 }, { x: 0, y: 0, z: -1 }, 5);
  assert.ok(dryHit);
  assert.equal(dryHit.entity.protoId, 'OakPlank');
  assert.equal(world.getCellAtmo(14, 2, 13), 0);

  let dryLog = world.interactAt(dryHit, torchClub, 'TorchDry');
  while (dryLog.status === 'damaged') {
    dryLog = world.interactAt(dryHit, torchClub, 'TorchDry');
  }
  assert.equal(dryLog.status, 'deathrattle');
  assert.equal(dryLog.winnerCat, 'Thermo');
  assert.equal(world.getGridBlock(14, 2, 13)?.protoId, 'Fire');
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'Ash_Item'));

  // Wet OakPlank at (16, 2, 14) above Water (16, 1, 14) -> Atmo_Wet suppresses Thermo -> Mech wins.
  const wetHit = world.raycast({ x: 16.5, y: 2.5, z: 16.5 }, { x: 0, y: 0, z: -1 }, 6);
  assert.ok(wetHit);
  assert.equal(wetHit.entity.protoId, 'OakPlank');
  assert.equal(world.getCellAtmo(16, 2, 14), world.engine.parseMask('Atmo_Wet'));

  let wetLog = world.interactAt(wetHit, torchClub, 'TorchWet');
  while (wetLog.status === 'damaged') {
    wetLog = world.interactAt(wetHit, torchClub, 'TorchWet');
  }
  assert.equal(wetLog.status, 'deathrattle');
  assert.equal(wetLog.winnerCat, 'Mech');
  assert.equal(world.getGridBlock(16, 2, 14), null);
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'OakPlank_Item'));
});

test('VoxelWorld: OakDoor_Closed damaged by axe then toggled preserves partial HP', () => {
  const world = new VoxelWorld(rules);
  const doorHit = world.raycast({ x: 12.5, y: 2.5, z: 16 }, { x: 0, y: 0, z: -1 }, 10);
  assert.ok(doorHit);
  assert.equal(doorHit.entity.protoId, 'OakDoor_Closed');
  assert.equal(doorHit.entity.maxHp, 32);

  // Axe deals 10 * 2.5 = 25 dmg -> 7 HP remaining.
  const axePulse = world.engine.simplePulse(10, 'Mech_T1 | Mech_Sharp');
  const dmgLog = world.interactAt(doorHit, axePulse, 'AxeHit');
  assert.equal(dmgLog.status, 'damaged');
  assert.equal(doorHit.entity.hp, 7);

  // Toggle preserves partial HP = 7 into OakDoor_Open.
  const togglePulse = world.engine.simplePulse(1, 'Mech_Toggle');
  const toggleLog = world.interactAt(doorHit, togglePulse, 'ToggleOpen');
  assert.equal(toggleLog.status, 'deathrattle');
  const opened = world.getGridBlock(12, 2, 11);
  assert.ok(opened);
  assert.equal(opened.protoId, 'OakDoor_Open');
  assert.equal(opened.hp, 7);
  assert.equal(opened.maxHp, 32);

  // Open doorway lets center ray pass through to cabin back wall (12, 2, 8).
  const throughHit = world.raycast({ x: 12.5, y: 2.5, z: 16 }, { x: 0, y: 0, z: -1 }, 10);
  assert.ok(throughHit);
  assert.equal(throughHit.entity.protoId, 'OakPlank');
  assert.equal(throughHit.entity.pos.z, 8);

  // Aim at the swung OakDoor_Open panel (x in [12.03, 12.21]) and toggle back preserving 7 HP.
  const doorHit2 = world.raycast({ x: 12.12, y: 2.5, z: 16 }, { x: 0, y: 0, z: -1 }, 10);
  assert.ok(doorHit2);
  assert.equal(doorHit2.entity.protoId, 'OakDoor_Open');
  world.interactAt(doorHit2, togglePulse, 'ToggleClose');
  const closedAgain = world.getGridBlock(12, 2, 11);
  assert.ok(closedAgain);
  assert.equal(closedAgain.protoId, 'OakDoor_Closed');
  assert.equal(closedAgain.hp, 7);
});

test('VoxelWorld: Shooting Arrow_Wood breaks Glass and hits Stone behind it -> BrokenStick_Item', () => {
  const world = new VoxelWorld(rules);
  assert.equal(world.getGridBlock(8, 3, 12)?.protoId, 'Glass');
  assert.equal(world.getGridBlock(8, 3, 10)?.protoId, 'Stone');

  const arrow = world.shootProjectile('Arrow_Wood', { x: 8.5, y: 3.5, z: 16 }, { x: 0, y: 0, z: -1 }, 18);

  for (let i = 0; i < 40; i++) {
    world.stepTick(0.025);
  }

  // Glass shattered into GlassShard_Item.
  assert.equal(world.getGridBlock(8, 3, 12), null);
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'GlassShard_Item'));

  // Stone behind it took 10 dmg and snapped Arrow_Wood into BrokenStick_Item.
  const stone = world.getGridBlock(8, 3, 10);
  assert.ok(stone);
  assert.equal(stone.hp, 90);
  assert.equal(world.getFreeBodies().includes(arrow), false);
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'BrokenStick_Item'));
});

test('VoxelWorld: Workbench #1 crafts Gunpowder_Pack; Workbench #2 spills & detonates on fire break', () => {
  const world = new VoxelWorld(rules);

  // Workbench #1 at (13, 2, 14) -> craft Gunpowder_Pack via Mech_Toggle.
  const wb1Hit = world.raycast({ x: 13.5, y: 2.5, z: 17 }, { x: 0, y: 0, z: -1 }, 8);
  assert.ok(wb1Hit);
  assert.equal(wb1Hit.entity.protoId, 'Workbench');
  assert.equal(wb1Hit.entity.pos.x, 13);
  assert.equal(wb1Hit.entity.pos.z, 14);

  const craftLog = world.interactAt(wb1Hit, world.engine.simplePulse(1, 'Mech_Toggle'), 'Craft');
  assert.equal(craftLog.status, 'crafted');
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'Gunpowder_Pack'));
  assert.equal(wb1Hit.entity.chamber.length, 0);

  // Workbench #2 at (14, 2, 15) -> destroyed by Thermo spills & detonates volatile bits.
  const wb2Hit = world.raycast({ x: 14.5, y: 2.5, z: 17 }, { x: 0, y: 0, z: -1 }, 8);
  assert.ok(wb2Hit);
  assert.equal(wb2Hit.entity.protoId, 'Workbench');
  assert.equal(wb2Hit.entity.pos.x, 14);
  assert.equal(wb2Hit.entity.pos.z, 15);

  const breakLog = world.interactAt(
    wb2Hit,
    world.engine.simplePulse(100, 'Thermo_Heat_T2'),
    'BurnWB2',
  );
  assert.equal(breakLog.status, 'deathrattle');
  assert.equal(breakLog.winnerCat, 'Thermo');
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'ExplosionShock'));
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'Ash_Item'));
  assert.equal(world.getGridBlock(14, 2, 15)?.protoId, 'Fire');
});

test('VoxelWorld: Sapling grows into OakLog + Leaf via Magic_Vita', () => {
  const world = new VoxelWorld(rules);
  const saplingHit = world.raycast({ x: 11.5, y: 2.5, z: 17 }, { x: 0, y: 0, z: -1 }, 6);
  assert.ok(saplingHit);
  assert.equal(saplingHit.entity.protoId, 'Sapling');

  const growLog = world.interactAt(
    saplingHit,
    world.engine.simplePulse(20, 'Magic_Vita'),
    'GrowSapling',
  );
  assert.equal(growLog.status, 'deathrattle');
  assert.equal(growLog.winnerCat, 'Magic');
  assert.equal(world.getGridBlock(11, 2, 15)?.protoId, 'OakLog');
  assert.equal(world.getGridBlock(11, 3, 15)?.protoId, 'Leaf');
});

test('VoxelWorld: Sand stack collapses as FallingBlock when OakPlank support is destroyed', () => {
  const world = new VoxelWorld(rules);
  const supportHit = world.raycast({ x: 9.5, y: 3.5, z: 16 }, { x: 0, y: 0, z: -1 }, 6);
  assert.ok(supportHit);
  assert.equal(supportHit.entity.protoId, 'OakPlank');

  world.interactAt(supportHit, world.engine.simplePulse(50, 'Mech_T1 | Mech_Sharp'), 'BreakSupport');
  assert.equal(world.getGridBlock(9, 3, 14), null);

  // Pulse tick triggers Sand Mech_Shear -> FallingBlock, then gravity settles onto y=2 and y=3.
  for (let i = 0; i < 20; i++) {
    world.stepTick(0.1);
  }
  assert.equal(world.getGridBlock(9, 2, 14)?.protoId, 'Sand');
  assert.equal(world.getGridBlock(9, 3, 14)?.protoId, 'Sand');
  assert.equal(world.getGridBlock(9, 4, 14), null);
  assert.equal(world.getGridBlock(9, 5, 14), null);
});

test('Custom inventory tools & FreeBody placement + Forge Hammer crafting', () => {
  const world = new VoxelWorld(rules);
  const placedSheep = world.placeBlock({ x: 6, y: 2, z: 18 }, 'Sheep_Live');
  assert.ok(placedSheep);
  assert.equal(placedSheep.form, 'FreeBody');

  // Custom pulse from Inventory modal builder: roast placed sheep via dominant Thermo
  const customTool = createCustomTool('魔导焰镐', {
    amount: 45,
    mechWeight: 0.2,
    mechExpr: 'Mech_T1',
    thermoWeight: 0.8,
    thermoExpr: 'Thermo_Heat_T2',
    magicWeight: 0,
    magicExpr: 'Magic_Vita',
  });
  const pulse = customTool.buildPulse!(world.engine);
  const out = world.engine.applyPulse(placedSheep, pulse);
  assert.equal(out.status, 'deathrattle');
  assert.equal(out.winnerCat, 'Thermo');
  assert.equal(out.spawns[0].protoId, 'CookedMutton_Item');

  // Place Workbench & insert bits -> forge IronSword_Item with forge_hammer tool preset
  const wb = world.placeBlock({ x: 5, y: 2, z: 18 }, 'Workbench');
  assert.ok(wb);
  assert.equal(world.workbenchInsert(wb.uid, 'IronIngot_Bit'), true);
  assert.equal(world.workbenchInsert(wb.uid, 'IronIngot_Bit'), true);
  assert.equal(world.workbenchInsert(wb.uid, 'OakStick_Bit'), true);

  const hammer = getToolCatalogItem('forge_hammer');
  const wbHit = world.raycast({ x: 5.5, y: 2.5, z: 20 }, { x: 0, y: 0, z: -1 }, 6);
  assert.ok(wbHit);
  const craftLog = world.interactAt(wbHit, hammer.buildPulse!(world.engine), hammer.name);
  assert.equal(craftLog.status, 'crafted');
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'IronSword_Item'));

  // Auto-absorb mapping + consumeFreeBody picks up dropped blocks cleanly
  const obsidianItem = world.placeBlock({ x: 4, y: 2, z: 18 }, 'Obsidian_Item');
  assert.ok(obsidianItem);
  assert.equal(mapResourceToBlockProto(obsidianItem.protoId), 'Obsidian');
  assert.equal(mapResourceToBlockProto('Ash_Item'), null);
  const consumed = world.consumeFreeBody(obsidianItem.uid);
  assert.equal(consumed?.uid, obsidianItem.uid);
  assert.equal(world.getFreeBodies().some((fb) => fb.uid === obsidianItem.uid), false);
});

test('#1 & #2: Live non-sticky Atmo field + highest reqBits gate specificity', () => {
  const world = new VoxelWorld(rules);

  // Wet OakPlank at (16, 2, 14) sits above Water (16, 1, 14); breaking it spawns OakPlank_Item with cellAtmo = 0.
  const wetHit = world.raycast({ x: 16.5, y: 2.5, z: 16.5 }, { x: 0, y: 0, z: -1 }, 6);
  assert.ok(wetHit);
  const axe = world.engine.simplePulse(60, 'Mech_T1 | Mech_Sharp');
  const brk = world.interactAt(wetHit, axe, 'AxeWet');
  assert.equal(brk.status, 'deathrattle');
  const dropped = world.getFreeBodies().find((fb) => fb.protoId === 'OakPlank_Item');
  assert.ok(dropped);
  assert.equal(dropped.cellAtmo, 0);

  // Removing Water immediately clears live Atmo_Wet at (16, 2, 14).
  const waterHit = world.raycast({ x: 16.5, y: 1.5, z: 14.5 }, { x: 0, y: 0, z: 1 }, 6);
  assert.ok(waterHit);
  assert.equal(world.getGridBlock(16, 1, 14)?.protoId, 'Water');
  world.interactAt(waterHit, world.engine.simplePulse(20, 'Thermo_Heat_T2'), 'BoilWater');
  world.interactAt({ kind: 'grid', entity: world.getGridBlock(16, 1, 13)!, pos: { x: 16.5, y: 1.5, z: 13.5 }, normal: { x: 0, y: 1, z: 0 }, distance: 1 }, world.engine.simplePulse(20, 'Thermo_Heat_T2'), 'BoilWaterN');
  world.interactAt({ kind: 'grid', entity: world.getGridBlock(16, 1, 15)!, pos: { x: 16.5, y: 1.5, z: 15.5 }, normal: { x: 0, y: 1, z: 0 }, distance: 1 }, world.engine.simplePulse(20, 'Thermo_Heat_T2'), 'BoilWaterS');
  assert.equal(world.getCellAtmo(16, 2, 14), 0);

  // #2 Specificity: specific 2-bit immunity gate (weight 0) overrides generic 1-bit gate (weight 1) on same node.
  const specRules = structuredClone(rules);
  specRules.channel_gates.unshift(
    { target: 'Stone', category: 'Mech', req: 'Mech_T1 | Mech_Sharp', weight: 0.0 },
    { target: 'Stone', category: 'Mech', req: 'Mech_T1', weight: 1.0 },
  );
  const specEngine = new FormalEngine(specRules);
  const stone = specEngine.spawn('Stone');
  assert.equal(specEngine.evalChannelScores(stone, specEngine.simplePulse(10, 'Mech_T1 | Mech_Sharp'), 0).Mech, 0);
  assert.equal(specEngine.evalChannelScores(stone, specEngine.simplePulse(10, 'Mech_T1'), 0).Mech, 10);
});

test('#3 & #4 & #5: Entity-bound PastureStele anchor, terrain kinematics, self_pulse decay, and damage dirtyRevision', () => {
  const world = new VoxelWorld(rules);

  // #5 Damaging a grid block bumps dirtyRevision.
  const stoneHit = world.raycast({ x: 7.5, y: 2.5, z: 11.2 }, { x: 0, y: 0, z: -1 }, 4);
  assert.ok(stoneHit);
  assert.equal(stoneHit.entity.protoId, 'Stone');
  const revBefore = world.getDirtyRevision();
  const dmg = world.interactAt(stoneHit, world.engine.simplePulse(10, 'Mech_T2'), 'ChipStone');
  assert.equal(dmg.status, 'damaged');
  assert.ok(world.getDirtyRevision() > revBefore);

  // #3 Free Sheep placed far away stays local under gravity rather than teleporting to (10, 15).
  const freeSheep = world.placeBlock({ x: 4, y: 4, z: 19 }, 'Sheep_Live');
  assert.ok(freeSheep);
  assert.equal(freeSheep.homeAnchorUid, undefined);
  for (let i = 0; i < 40; i++) {
    world.stepTick(0.05);
  }
  assert.ok(freeSheep.pos.x < 8.5, `Expected free sheep to stay near x=4.5, got ${freeSheep.pos.x}`);
  assert.ok(freeSheep.pos.z > 15.5, `Expected free sheep near z=19.5, got ${freeSheep.pos.z}`);
  assert.ok(Math.abs(freeSheep.pos.y - 2.45) < 0.05, `Expected gravity land at y=2.45, got ${freeSheep.pos.y}`);

  // Kill initial Sheep bound to PastureStele -> respawns after ~8s via entity anchor.
  const stele = world.getGridBlock(10, 2, 16);
  assert.ok(stele);
  assert.equal(stele.protoId, 'PastureStele');
  const initialSheep = world.getFreeBodies().find((fb) => fb.homeAnchorUid === stele.uid);
  assert.ok(initialSheep);
  world.interactAt(
    { kind: 'free', entity: initialSheep, pos: initialSheep.pos, normal: { x: 0, y: 1, z: 0 }, distance: 1 },
    world.engine.simplePulse(100, 'Thermo_Heat_T2'),
    'RoastSheep',
  );
  assert.equal(world.getFreeBodies().some((fb) => fb.homeAnchorUid === stele.uid), false);
  for (let i = 0; i < 90; i++) {
    world.stepTick(0.1);
  }
  const respawned = world.getFreeBodies().find((fb) => fb.homeAnchorUid === stele.uid && fb.protoId === 'Sheep_Live');
  assert.ok(respawned, 'PastureStele should respawn its bound Sheep_Live');

  // #4 Formal self_pulse destroys ExplosionShock and Fire within their lifetimes.
  const wb2Hit = world.raycast({ x: 14.5, y: 2.5, z: 17 }, { x: 0, y: 0, z: -1 }, 8);
  assert.ok(wb2Hit);
  world.interactAt(wb2Hit, world.engine.simplePulse(100, 'Thermo_Heat_T2'), 'BurnWB2');
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'ExplosionShock'));
  for (let i = 0; i < 6; i++) {
    world.stepTick(0.1);
  }
  assert.equal(world.getFreeBodies().some((fb) => fb.protoId === 'ExplosionShock'), false);

  const fire = world.placeBlock({ x: 3, y: 2, z: 3 }, 'Fire');
  assert.ok(fire);
  for (let i = 0; i < 55; i++) {
    world.stepTick(0.1);
  }
  assert.equal(world.getGridBlock(3, 2, 3), null);
});

test('#6 & #7 & #8 & #9: Orthogonal traits, thin-door arrow pass-through, inherited mixin & clean logging', () => {
  const world = new VoxelWorld(rules);

  // #6 Open door lets Arrow_Wood pass straight through to hit cabin back wall (12, 2, 8).
  const doorHit = world.raycast({ x: 12.5, y: 2.5, z: 16 }, { x: 0, y: 0, z: -1 }, 10);
  assert.ok(doorHit);
  world.interactAt(doorHit, world.engine.simplePulse(1, 'Mech_Toggle'), 'OpenDoor');
  const openDoor = world.getGridBlock(12, 2, 11);
  assert.equal(openDoor?.protoId, 'OakDoor_Open');
  const doorHpBefore = openDoor!.hp;
  const backWallBefore = world.getGridBlock(12, 2, 8)!.hp;

  world.shootProjectile('Arrow_Wood', { x: 12.5, y: 2.5, z: 15 }, { x: 0, y: 0, z: -1 }, 18);
  for (let i = 0; i < 30; i++) {
    world.stepTick(0.025);
  }
  assert.equal(world.getGridBlock(12, 2, 11)?.hp, doorHpBefore);
  assert.ok(world.getGridBlock(12, 2, 8)!.hp < backWallBefore);

  // #6 Orthogonal MistVeil (visible+non-collidable+interactable) & AirBarrier (invisible+collidable+interactable).
  assert.equal(world.getGridBlock(16, 3, 13)?.protoId, 'MistVeil');
  assert.equal(world.engine.getAttr('MistVeil', 'collidable'), false);
  assert.equal(world.engine.getAttr('MistVeil', 'visible'), true);
  assert.equal(world.getCellAtmo(16, 4, 13), world.engine.parseMask('Atmo_Wet'));

  const barrier = world.placeBlock({ x: 4, y: 2, z: 5 }, 'AirBarrier');
  assert.ok(barrier);
  assert.equal(world.engine.getAttr('AirBarrier', 'visible'), false);
  assert.equal(world.engine.getAttr('AirBarrier', 'collidable'), true);
  const barrierHit = world.raycast({ x: 4.5, y: 2.5, z: 8 }, { x: 0, y: 0, z: -1 }, 6);
  assert.equal(barrierHit?.entity.protoId, 'AirBarrier');

  // #7 Inherited @Mix_GravityFragile works even if child defines its own mixins.
  const inhRules = structuredClone(rules);
  inhRules.prototypes['MagicSand'] = { parent: 'Sand', mixins: ['@Mix_Toggleable'] };
  inhRules.prototypes['MagicSand_Item'] = { parent: '@Mat_Item' };
  const inhWorld = new VoxelWorld(inhRules);
  inhWorld.placeBlock({ x: 4, y: 4, z: 4 }, 'MagicSand');
  for (let i = 0; i < 20; i++) {
    inhWorld.stepTick(0.1);
  }
  assert.equal(inhWorld.getGridBlock(4, 4, 4), null);
  assert.equal(inhWorld.getGridBlock(4, 2, 4)?.protoId, 'MagicSand');

  // #8 & #9 Ambient Fire ticks don't flood logs; workbenchInsert & consumeFreeBody record clean logs.
  world.placeBlock({ x: 20, y: 2, z: 20 }, 'OakLog');
  world.placeBlock({ x: 21, y: 2, z: 20 }, 'Fire');
  for (let i = 0; i < 5; i++) {
    world.stepTick(0.1);
  }
  assert.equal(
    world.getRecentLogs(50).some((l) => l.action.includes('(Pulse)') && l.status === 'damaged'),
    false,
  );

  const wb = world.placeBlock({ x: 2, y: 2, z: 20 }, 'Workbench');
  assert.ok(wb);
  assert.equal(world.workbenchInsert(wb.uid, 'Sulfur_Bit'), true);
  const item = world.placeBlock({ x: 2, y: 2, z: 22 }, 'Dirt_Item');
  assert.ok(item);
  world.consumeFreeBody(item.uid);
  const logs = world.getRecentLogs(10);
  assert.ok(logs.some((l) => l.action === '装填工作台'));
  assert.ok(logs.some((l) => l.action === '拾取吸纳'));
});

test('PerformanceBudget presets, normalization clamping, and auto-preset detection', () => {
  const def = loadPerformanceBudget();
  assert.equal(def.preset, 'balanced');
  assert.equal(def.shading, 'lambert');

  const ultra = normalizePerformanceBudget({ ...PERF_PRESETS.ultra });
  assert.equal(ultra.preset, 'ultra');
  assert.equal(ultra.shadowQuality, 'high');
  assert.equal(ultra.shading, 'standard');

  const custom = normalizePerformanceBudget({
    ...PERF_PRESETS.balanced,
    maxPixelRatio: 5.0,
    maxPointLights: 99,
    maxParticles: -10,
    shadowRefreshHz: 120,
    targetFps: 500,
    clouds: false,
  });
  assert.equal(custom.preset, 'custom');
  assert.equal(custom.maxPixelRatio, 2.0);
  assert.equal(custom.maxPointLights, 6);
  assert.equal(custom.maxParticles, 0);
  assert.equal(custom.shadowRefreshHz, 60);
  assert.equal(custom.targetFps, 240);
  assert.equal(custom.clouds, false);

  const restoredEco = normalizePerformanceBudget({ ...PERF_PRESETS.eco, preset: 'custom' });
  assert.equal(restoredEco.preset, 'eco');
});

test('IronKnight & GuardStele: Stage 1 spawn, tall hitbox, block/salute/slash/death animStates, recoil & resurrection', () => {
  const world = new VoxelWorld(rules);

  // 1. Stage 1 island spawns GuardStele at (16, 2, 7) and IronKnight bound to it.
  const guardStele = world.getGridBlock(16, 2, 7);
  assert.ok(guardStele);
  assert.equal(guardStele.protoId, 'GuardStele');

  const knight = world.getFreeBodies().find((fb) => fb.protoId === 'IronKnight');
  assert.ok(knight);
  assert.equal(knight.hp, 120);
  assert.equal(knight.homeAnchorUid, guardStele.uid);
  assert.equal(knight.animState, 'idle');

  // Tall humanoid raycast hits IronKnight at upper chest / helmet height (y = 3.9).
  const headHit = world.raycast({ x: knight.pos.x, y: 3.9, z: 12 }, { x: 0, y: 0, z: -1 }, 8);
  assert.ok(headHit);
  assert.equal(headHit.kind, 'free');
  assert.equal(headHit.entity.uid, knight.uid);

  // 2. Mech_T1 (Wood Pickaxe) -> immune + block animState, planted feet during animTimer.
  const woodPick = world.engine.simplePulse(20, 'Mech_T1');
  const blockLog = world.interactAt(headHit, woodPick, 'WoodPickKnight');
  assert.equal(blockLog.status, 'immune');
  assert.equal(knight.hp, 120);
  assert.equal(knight.animState, 'block');
  assert.equal(knight.animTimer, 0.95);

  const posBeforeFreeze = { ...knight.pos };
  for (let i = 0; i < 4; i++) world.stepTick(0.1);
  assert.equal(knight.animState, 'block');
  assert.equal(knight.pos.x, posBeforeFreeze.x);
  assert.equal(knight.pos.z, posBeforeFreeze.z);
  for (let i = 0; i < 6; i++) world.stepTick(0.1);
  assert.equal(knight.animTimer, 0);
  assert.equal(knight.animState, 'idle');

  // 3. Mech_Toggle (Wrench) -> immune + salute animState.
  const chestHit = world.raycast({ x: knight.pos.x, y: 3.4, z: 12 }, { x: 0, y: 0, z: -1 }, 8);
  assert.ok(chestHit);
  assert.equal(chestHit.entity.uid, knight.uid);
  const saluteLog = world.interactAt(chestHit, world.engine.simplePulse(1, 'Mech_Toggle'), 'WrenchKnight');
  assert.equal(saluteLog.status, 'immune');
  assert.equal(knight.hp, 120);
  assert.equal(knight.animState, 'salute');
  assert.equal(knight.animTimer, 1.6);

  for (let i = 0; i < 17; i++) world.stepTick(0.1);
  assert.equal(knight.animTimer, 0);
  assert.equal(knight.animState, 'idle');

  // 4. Arrow_Wood shot at knight's upper chest (y = 3.4) and helmet height (y = 3.75) hits via tall volume -> 0 dmg, block, snaps to BrokenStick_Item.
  const arrow = world.shootProjectile(
    'Arrow_Wood',
    { x: knight.pos.x, y: 3.4, z: knight.pos.z + 4.0 },
    { x: 0, y: 0, z: -1 },
    18,
  );
  for (let i = 0; i < 20; i++) world.stepTick(0.025);
  assert.equal(knight.hp, 120);
  assert.equal(knight.animState, 'block');
  assert.equal(world.getFreeBodies().includes(arrow), false);
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'BrokenStick_Item'));

  const highArrow = world.shootProjectile(
    'Arrow_Wood',
    { x: knight.pos.x, y: 3.75, z: knight.pos.z + 4.0 },
    { x: 0, y: 0, z: -1 },
    18,
  );
  for (let i = 0; i < 20; i++) world.stepTick(0.025);
  assert.equal(knight.hp, 120);
  assert.equal(knight.animState, 'block');
  assert.equal(world.getFreeBodies().includes(highArrow), false);

  // 5. Mech_T3 (Diamond Pickaxe) damages IronKnight -> slash animState, killing drops IronKnight_Corpse (death) + IronSword_Item.
  const diamondHit = world.raycast({ x: knight.pos.x, y: 3.2, z: knight.pos.z + 3.0 }, { x: 0, y: 0, z: -1 }, 6);
  assert.ok(diamondHit);
  assert.equal(diamondHit.entity.uid, knight.uid);
  const slashLog = world.interactAt(diamondHit, world.engine.simplePulse(40, 'Mech_T3'), 'DiamondKnight1');
  assert.equal(slashLog.status, 'damaged');
  assert.equal(knight.hp, 80);
  assert.equal(knight.animState, 'slash');
  assert.equal(knight.animTimer, 0.85);

  const killLog = world.interactAt(diamondHit, world.engine.simplePulse(100, 'Mech_T3'), 'DiamondKnightKill');
  assert.equal(killLog.status, 'deathrattle');
  assert.equal(killLog.winnerCat, 'Mech');
  assert.equal(world.getFreeBodies().includes(knight), false);

  const corpse = world.getFreeBodies().find((fb) => fb.protoId === 'IronKnight_Corpse');
  assert.ok(corpse);
  assert.equal(corpse.animState, 'death');
  assert.equal(corpse.hp, 40);
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'IronSword_Item'));

  // 6. Magic_Arcane on IronKnight_Corpse resurrects IronKnight!
  const resLog = world.interactAt(
    { kind: 'free', entity: corpse, pos: corpse.pos, normal: { x: 0, y: 1, z: 0 }, distance: 1 },
    world.engine.simplePulse(45, 'Magic_Arcane'),
    'ResurrectKnight',
  );
  assert.equal(resLog.status, 'deathrattle');
  assert.equal(resLog.winnerCat, 'Magic');
  assert.equal(world.getFreeBodies().includes(corpse), false);

  const resurrected = world.getFreeBodies().find((fb) => fb.protoId === 'IronKnight');
  assert.ok(resurrected);
  assert.equal(resurrected.hp, 120);
  assert.equal(resurrected.animState, 'idle');
  assert.equal(resurrected.homeAnchorUid, guardStele.uid);
});

test('IronKnight & GuardStele: Magic_Volt x Atmo_Wet 4.4x, Thermo_Heat_T3 melt, and 12s GuardStele respawn', () => {
  const world = new VoxelWorld(rules);

  // 7. Magic_Volt in Atmo_Wet applies 2.2 * 2.0 = 4.4x multiplier and drops IronIngot_Item + Bone_Item.
  const water = world.placeBlock({ x: 3, y: 2, z: 4 }, 'Water');
  assert.ok(water);
  const wetKnight = world.placeBlock({ x: 4, y: 2, z: 4 }, 'IronKnight');
  assert.ok(wetKnight);
  assert.equal(wetKnight.pos.y, 2.65);

  const wetAtmo = world.getCellAtmo(wetKnight.pos.x, wetKnight.pos.y, wetKnight.pos.z);
  const atmoWetBit = world.engine.parseMask('Atmo_Wet');
  assert.equal((wetAtmo & atmoWetBit) !== 0, true);

  const voltPulse10 = world.engine.simplePulse(10, 'Magic_Volt');
  const voltScores = world.engine.evalChannelScores(wetKnight, voltPulse10, wetAtmo);
  assert.ok(Math.abs((voltScores.Magic ?? 0) - 44) < 1e-6);

  const voltKill = world.interactAt(
    { kind: 'free', entity: wetKnight, pos: wetKnight.pos, normal: { x: 0, y: 1, z: 0 }, distance: 1 },
    world.engine.simplePulse(40, 'Magic_Volt'),
    'VoltKillKnight',
  );
  assert.equal(voltKill.status, 'deathrattle');
  assert.equal(voltKill.winnerCat, 'Magic');
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'IronIngot_Item'));
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'Bone_Item'));

  // 8. Thermo_Heat_T3 melts IronKnight into IronIngot_Item + Ash_Item.
  const meltKnight = world.placeBlock({ x: 20, y: 2, z: 4 }, 'IronKnight');
  assert.ok(meltKnight);
  const meltLog = world.interactAt(
    { kind: 'free', entity: meltKnight, pos: meltKnight.pos, normal: { x: 0, y: 1, z: 0 }, distance: 1 },
    world.engine.simplePulse(100, 'Thermo_Heat_T3'),
    'MeltKnight',
  );
  assert.equal(meltLog.status, 'deathrattle');
  assert.equal(meltLog.winnerCat, 'Thermo');
  assert.ok(world.getFreeBodies().filter((fb) => fb.protoId === 'IronIngot_Item').length >= 3);
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'Ash_Item'));

  // 9. GuardStele respawns IronKnight after 12s (125 ticks of 0.1s).
  const guardStele = world.getGridBlock(16, 2, 7);
  assert.ok(guardStele);
  const initialKnight = world.getFreeBodies().find((fb) => fb.homeAnchorUid === guardStele.uid);
  assert.ok(initialKnight);

  world.interactAt(
    { kind: 'free', entity: initialKnight, pos: initialKnight.pos, normal: { x: 0, y: 1, z: 0 }, distance: 1 },
    world.engine.simplePulse(100, 'Thermo_Heat_T3'),
    'MeltAnchorKnight',
  );
  assert.equal(world.getFreeBodies().some((fb) => fb.homeAnchorUid === guardStele.uid), false);

  for (let i = 0; i < 125; i++) {
    world.stepTick(0.1);
  }
  const respawnedKnight = world.getFreeBodies().find(
    (fb) => fb.homeAnchorUid === guardStele.uid && fb.protoId === 'IronKnight',
  );
  assert.ok(respawnedKnight, 'GuardStele should respawn its bound IronKnight after 12s');
  assert.equal(respawnedKnight.hp, 120);
  assert.equal(respawnedKnight.animState, 'idle');

  // Guard AI patrolling transitions and breaking GuardStele -> GuardStele_Item.
  const seenAnimStates = new Set<string>();
  for (let i = 0; i < 50; i++) {
    world.stepTick(0.1);
    if (respawnedKnight.animState) seenAnimStates.add(respawnedKnight.animState);
  }
  assert.ok(seenAnimStates.has('walk') || seenAnimStates.has('idle'));
  const steleDist = Math.hypot(respawnedKnight.pos.x - 16.5, respawnedKnight.pos.z - 7.5);
  assert.ok(steleDist <= 3.5, `Patrolling IronKnight should stay near GuardStele, got dist=${steleDist}`);

  const steleBreak = world.interactAt(
    { kind: 'grid', entity: guardStele, pos: { x: 16.5, y: 2.5, z: 7.5 }, normal: { x: 0, y: 1, z: 0 }, distance: 1 },
    world.engine.simplePulse(100, 'Mech_T3'),
    'BreakGuardStele',
  );
  assert.equal(steleBreak.status, 'deathrattle');
  assert.equal(world.getGridBlock(16, 2, 7), null);
  assert.ok(world.getFreeBodies().some((fb) => fb.protoId === 'GuardStele_Item'));
});

test('consumeFreeBodies batch area pickup removes drops and logs summary cleanly', () => {
  const world = new VoxelWorld(rules);
  const obsidian = world.placeBlock({ x: 3, y: 2, z: 18 }, 'Obsidian_Item');
  const ash = world.placeBlock({ x: 4, y: 2, z: 18 }, 'Ash_Item');
  const sword = world.placeBlock({ x: 5, y: 2, z: 18 }, 'IronSword_Item');
  const sulfur = world.placeBlock({ x: 6, y: 2, z: 18 }, 'Sulfur_Bit');
  assert.ok(obsidian && ash && sword && sulfur);

  // Drain any prior FX before asserting batch burst count.
  world.getPendingFx();

  const removed = world.consumeFreeBodies([obsidian.uid, ash.uid, sword.uid, sulfur.uid, 999999]);
  assert.equal(removed.length, 4);
  for (const ent of [obsidian, ash, sword, sulfur]) {
    assert.equal(world.getFreeBodies().some((fb) => fb.uid === ent.uid), false);
  }

  const fx = world.getPendingFx();
  assert.equal(fx.length, 4);

  const lastLog = world.getRecentLogs(1)[0];
  assert.equal(lastLog?.action, '范围收取');
  assert.equal(lastLog?.target, '4 项资源');
  assert.ok(lastLog?.resultText.includes('Obsidian_Item×1'));
  assert.ok(lastLog?.resultText.includes('Sulfur_Bit×1'));
  assert.equal(mapResourceToBlockProto('Ash_Item'), null);
});
