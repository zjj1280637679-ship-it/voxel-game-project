export interface BlockVisual {
  color: number;
  opacity?: number;
  heightScale?: number;
  thinDoor?: 'closed' | 'open';
  emissive?: number;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
}

const VISUALS: Record<string, BlockVisual> = {
  // Soils
  Dirt: { color: 0x7c5338, roughness: 0.90, metalness: 0.0 },
  Grass: { color: 0x52bd45, roughness: 0.86, metalness: 0.0 },

  // Minerals
  Stone: { color: 0x868d98, roughness: 0.86, metalness: 0.04 },
  Obsidian: {
    color: 0x1e162b,
    emissive: 0x4c1d95,
    emissiveIntensity: 0.36,
    roughness: 0.22,
    metalness: 0.14,
  },
  Glass: { color: 0xbfeaff, opacity: 0.42, roughness: 0.15, metalness: 0.05 },
  Sand: { color: 0xead792, roughness: 0.90, metalness: 0.0 },
  IronOre: { color: 0x9b8676, roughness: 0.62, metalness: 0.48 },

  // Wood & Mechanisms
  OakLog: { color: 0x5d3d24, roughness: 0.86, metalness: 0.0 },
  OakPlank: { color: 0xbd8950, roughness: 0.86, metalness: 0.0 },
  OakPlank_Slab: { color: 0xc49158, heightScale: 0.5, roughness: 0.86, metalness: 0.0 },
  OakDoor_Closed: { color: 0x936032, thinDoor: 'closed', roughness: 0.84, metalness: 0.04 },
  OakDoor_Open: { color: 0x936032, thinDoor: 'open', roughness: 0.84, metalness: 0.04 },
  Workbench: {
    color: 0x9a5f2d,
    emissive: 0x1c0f04,
    emissiveIntensity: 0.22,
    roughness: 0.82,
    metalness: 0.04,
  },
  PastureStele: {
    color: 0x5e6e80,
    emissive: 0x0ea5e9,
    emissiveIntensity: 0.75,
    roughness: 0.56,
    metalness: 0.12,
  },
  GuardStele: {
    color: 0x646b75,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.78,
    roughness: 0.44,
    metalness: 0.36,
  },
  MistVeil: {
    color: 0xbae6fd,
    opacity: 0.36,
    emissive: 0x1a82b5,
    emissiveIntensity: 0.65,
    roughness: 0.42,
    metalness: 0.0,
  },
  AirBarrier: { color: 0xe2e8f0, opacity: 0.15, roughness: 0.4, metalness: 0.0 },

  // Plants
  Sapling: { color: 0x62cf4a, roughness: 0.86, metalness: 0.0 },
  Leaf: { color: 0x35943c, opacity: 0.94, roughness: 0.86, metalness: 0.0 },
  Mushroom: { color: 0xdc3c3c, roughness: 0.84, metalness: 0.0 },

  // Fluids & Elements
  Water: {
    color: 0x2c94eb,
    opacity: 0.64,
    heightScale: 0.88,
    roughness: 0.16,
    metalness: 0.08,
  },
  Ice: { color: 0x8de3ff, opacity: 0.78, roughness: 0.18, metalness: 0.06 },
  Fire: {
    color: 0xff701f,
    emissive: 0xff5a0a,
    emissiveIntensity: 1.4,
    opacity: 0.92,
    roughness: 0.4,
    metalness: 0.0,
  },

  // Fauna & Corpses
  Sheep_Live: { color: 0xf7f3e8, roughness: 0.92, metalness: 0.0 },
  UndeadSheep: {
    color: 0x91ab88,
    emissive: 0x224d2b,
    emissiveIntensity: 0.68,
    roughness: 0.88,
    metalness: 0.0,
  },
  Sheep_Corpse: { color: 0xb5a699, roughness: 0.92, metalness: 0.0 },
  IronKnight: { color: 0xb8c4d4, roughness: 0.42, metalness: 0.45 },
  IronKnight_Corpse: { color: 0x7b8594, roughness: 0.58, metalness: 0.32 },

  // Projectiles & Summons
  Arrow_Wood: { color: 0xa47542, roughness: 0.84, metalness: 0.05 },
  HomingOrb_Fire: {
    color: 0xff621a,
    emissive: 0xff3b00,
    emissiveIntensity: 1.45,
    roughness: 0.25,
    metalness: 0.0,
  },
  SummonedWisp: {
    color: 0x61e8ff,
    emissive: 0x2ec4ff,
    emissiveIntensity: 1.25,
    opacity: 0.88,
    roughness: 0.22,
    metalness: 0.0,
  },
  FallingBlock: { color: 0xdfcf7f, roughness: 0.88, metalness: 0.0 },
  ExplosionShock: {
    color: 0xffcb3d,
    emissive: 0xff9900,
    emissiveIntensity: 1.35,
    opacity: 0.76,
    roughness: 0.3,
    metalness: 0.0,
  },

  // Resource Bits
  Sulfur_Bit: {
    color: 0xf0e33c,
    emissive: 0x3a3200,
    emissiveIntensity: 0.32,
    roughness: 0.72,
    metalness: 0.04,
  },
  Charcoal_Bit: { color: 0x27282e, roughness: 0.94, metalness: 0.0 },
  Saltpeter_Bit: { color: 0xe3f1fa, roughness: 0.62, metalness: 0.04 },
  IronIngot_Bit: { color: 0xcfd7e0, roughness: 0.32, metalness: 0.56 },
  OakStick_Bit: { color: 0xa67442, roughness: 0.86, metalness: 0.0 },

  // Dropped Items
  Dirt_Item: { color: 0x7c5338, roughness: 0.90, metalness: 0.0 },
  Obsidian_Item: {
    color: 0x251a36,
    emissive: 0x3b1366,
    emissiveIntensity: 0.32,
    roughness: 0.22,
    metalness: 0.14,
  },
  GlassShard_Item: { color: 0xcceeff, opacity: 0.65, roughness: 0.15, metalness: 0.05 },
  Cobble_Item: { color: 0x727984, roughness: 0.86, metalness: 0.04 },
  IronOre_Item: { color: 0xa68167, roughness: 0.62, metalness: 0.48 },
  Sand_Item: { color: 0xead792, roughness: 0.90, metalness: 0.0 },
  IceShard_Item: { color: 0xa6ecff, opacity: 0.8, roughness: 0.18, metalness: 0.06 },
  OakLog_Item: { color: 0x5d3d24, roughness: 0.86, metalness: 0.0 },
  OakPlank_Item: { color: 0xbd8950, roughness: 0.86, metalness: 0.0 },
  OakPlank_Slab_Item: { color: 0xc49158, roughness: 0.86, metalness: 0.0 },
  OakDoor_Closed_Item: { color: 0x936032, roughness: 0.84, metalness: 0.04 },
  OakDoor_Open_Item: { color: 0x936032, roughness: 0.84, metalness: 0.04 },
  Workbench_Item: { color: 0x9a5f2d, roughness: 0.82, metalness: 0.04 },
  Sapling_Item: { color: 0x62cf4a, roughness: 0.86, metalness: 0.0 },
  Leaf_Item: { color: 0x35943c, roughness: 0.86, metalness: 0.0 },
  Mushroom_Item: { color: 0xdc3c3c, roughness: 0.84, metalness: 0.0 },
  RawMutton_Item: { color: 0xde6a6a, roughness: 0.72, metalness: 0.0 },
  CookedMutton_Item: { color: 0x944828, roughness: 0.78, metalness: 0.0 },
  RottenMeat_Item: { color: 0x6a7d40, roughness: 0.84, metalness: 0.0 },
  MeatScrap_Item: { color: 0xad5858, roughness: 0.76, metalness: 0.0 },
  IntactWool_Item: { color: 0xfaf8f2, roughness: 0.92, metalness: 0.0 },
  TornWool_Item: { color: 0xd4cec3, roughness: 0.92, metalness: 0.0 },
  ChargedWool_Item: {
    color: 0xfff2a6,
    emissive: 0x6b5300,
    emissiveIntensity: 0.55,
    roughness: 0.82,
    metalness: 0.05,
  },
  Bone_Item: { color: 0xece8da, roughness: 0.74, metalness: 0.0 },
  Ash_Item: { color: 0x565b63, roughness: 0.95, metalness: 0.0 },
  Charcoal_Item: { color: 0x24262b, roughness: 0.94, metalness: 0.0 },
  IronIngot_Item: { color: 0xd8e0e8, roughness: 0.30, metalness: 0.58 },
  RottenWood_Item: { color: 0x504930, roughness: 0.92, metalness: 0.0 },
  StuckArrow: { color: 0xa47542, roughness: 0.84, metalness: 0.05 },
  BrokenStick_Item: { color: 0x8f643a, roughness: 0.88, metalness: 0.0 },
  Gunpowder_Pack: {
    color: 0x42464d,
    emissive: 0x3b1010,
    emissiveIntensity: 0.38,
    roughness: 0.86,
    metalness: 0.05,
  },
  IronSword_Item: {
    color: 0xc9ddf5,
    emissive: 0x16243d,
    emissiveIntensity: 0.25,
    roughness: 0.28,
    metalness: 0.60,
  },
};

const DEFAULT_VISUAL: BlockVisual = { color: 0xa0aab8, roughness: 0.86, metalness: 0.0 };

export function getVisual(protoId: string): BlockVisual {
  const direct = VISUALS[protoId];
  if (direct) return direct;

  if (protoId.endsWith('_Item')) {
    const base = protoId.slice(0, -5);
    if (VISUALS[base]) return VISUALS[base];
  }
  return DEFAULT_VISUAL;
}
