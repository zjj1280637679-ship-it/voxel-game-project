import * as THREE from 'three';

export type SixFaceTextures = [
  THREE.CanvasTexture, // +X (right)
  THREE.CanvasTexture, // -X (left)
  THREE.CanvasTexture, // +Y (top)
  THREE.CanvasTexture, // -Y (bottom)
  THREE.CanvasTexture, // +Z (front)
  THREE.CanvasTexture, // -Z (back)
];

export type NamedTextureKey =
  | 'wool'
  | 'fire'
  | 'mushroom_cap'
  | 'mushroom_stem'
  | 'stele_pillar'
  | 'sapling_stem'
  | 'sapling_crown';

const TEX_SIZE = 16;

function hash2d(x: number, y: number, seed: number): number {
  let h =
    (Math.imul(x + 17, 374761393) ^
      Math.imul(y + 31, 668265263) ^
      Math.imul(seed + 53, 1442695041)) >>>
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  if (x < 0 || x >= TEX_SIZE || y < 0 || y >= TEX_SIZE) return;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  painter: (x: number, y: number) => string | null,
): void {
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const color = painter(x, y);
      if (color !== null) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function paintDirtBase(ctx: CanvasRenderingContext2D, seed: number): void {
  paintGrid(ctx, (x, y) => {
    const r = hash2d(x, y, seed);
    const strata = hash2d(Math.floor(x / 2), y, seed + 7);
    if (r < 0.08) return '#967a63'; // tiny pebble grain
    if (r < 0.16) return '#8d6447'; // warm pebble highlight
    if (r > 0.89) return '#563520'; // dark organic fleck
    if (strata < 0.34) return '#664129';
    if (strata > 0.72) return '#85593c';
    return '#7a5136';
  });
}

export class VoxelTextureLibrary {
  private readonly allTextures: THREE.CanvasTexture[] = [];

  private readonly grassTopTexture: THREE.CanvasTexture;
  private readonly grassSideTexture: THREE.CanvasTexture;
  private readonly dirtTexture: THREE.CanvasTexture;
  private readonly stoneTexture: THREE.CanvasTexture;
  private readonly obsidianTexture: THREE.CanvasTexture;
  private readonly ironOreTexture: THREE.CanvasTexture;
  private readonly sandTexture: THREE.CanvasTexture;
  private readonly glassTexture: THREE.CanvasTexture;
  private readonly oakLogSideTexture: THREE.CanvasTexture;
  private readonly oakLogTopTexture: THREE.CanvasTexture;
  private readonly oakPlankTexture: THREE.CanvasTexture;
  private readonly oakDoorTexture: THREE.CanvasTexture;
  private readonly workbenchTopTexture: THREE.CanvasTexture;
  private readonly workbenchSideTexture: THREE.CanvasTexture;
  private readonly stelePillarTexture: THREE.CanvasTexture;
  private readonly leafTexture: THREE.CanvasTexture;
  private readonly waterTexture: THREE.CanvasTexture;
  private readonly iceTexture: THREE.CanvasTexture;
  private readonly mistTexture: THREE.CanvasTexture;
  private readonly mushroomCapTexture: THREE.CanvasTexture;
  private readonly mushroomStemTexture: THREE.CanvasTexture;
  private readonly saplingStemTexture: THREE.CanvasTexture;
  private readonly saplingCrownTexture: THREE.CanvasTexture;
  private readonly woolTexture: THREE.CanvasTexture;
  private readonly fireTexture: THREE.CanvasTexture;

  private readonly crackTextures: readonly [
    THREE.CanvasTexture,
    THREE.CanvasTexture,
    THREE.CanvasTexture,
  ];

  private readonly grassFaces: SixFaceTextures;
  private readonly oakLogFaces: SixFaceTextures;
  private readonly workbenchFaces: SixFaceTextures;
  private readonly namedMap: Record<NamedTextureKey, THREE.CanvasTexture>;

  private disposed = false;

  constructor() {
    this.grassTopTexture = this.createPixelTexture((ctx) => this.drawGrassTop(ctx));
    this.dirtTexture = this.createPixelTexture((ctx) => paintDirtBase(ctx, 11));
    this.grassSideTexture = this.createPixelTexture((ctx) => this.drawGrassSide(ctx));
    this.stoneTexture = this.createPixelTexture((ctx) => this.drawStone(ctx));
    this.obsidianTexture = this.createPixelTexture((ctx) => this.drawObsidian(ctx));
    this.ironOreTexture = this.createPixelTexture((ctx) => this.drawIronOre(ctx));
    this.sandTexture = this.createPixelTexture((ctx) => this.drawSand(ctx));
    this.glassTexture = this.createPixelTexture((ctx) => this.drawGlass(ctx));
    this.oakLogSideTexture = this.createPixelTexture((ctx) => this.drawOakLogSide(ctx));
    this.oakLogTopTexture = this.createPixelTexture((ctx) => this.drawOakLogTop(ctx));
    this.oakPlankTexture = this.createPixelTexture((ctx) => this.drawOakPlank(ctx));
    this.oakDoorTexture = this.createPixelTexture((ctx) => this.drawOakDoor(ctx));
    this.workbenchTopTexture = this.createPixelTexture((ctx) => this.drawWorkbenchTop(ctx));
    this.workbenchSideTexture = this.createPixelTexture((ctx) => this.drawWorkbenchSide(ctx));
    this.stelePillarTexture = this.createPixelTexture((ctx) => this.drawStelePillar(ctx));
    this.leafTexture = this.createPixelTexture((ctx) => this.drawLeaf(ctx));
    this.waterTexture = this.createPixelTexture((ctx) => this.drawWater(ctx), { repeat: true });
    this.iceTexture = this.createPixelTexture((ctx) => this.drawIce(ctx));
    this.mistTexture = this.createPixelTexture((ctx) => this.drawMist(ctx), { repeat: true });
    this.mushroomCapTexture = this.createPixelTexture((ctx) => this.drawMushroomCap(ctx));
    this.mushroomStemTexture = this.createPixelTexture((ctx) => this.drawMushroomStem(ctx));
    this.saplingStemTexture = this.createPixelTexture((ctx) => this.drawSaplingStem(ctx));
    this.saplingCrownTexture = this.createPixelTexture((ctx) => this.drawSaplingCrown(ctx));
    this.woolTexture = this.createPixelTexture((ctx) => this.drawWool(ctx));
    this.fireTexture = this.createPixelTexture((ctx) => this.drawFire(ctx));

    this.crackTextures = [
      this.createPixelTexture((ctx) => this.drawCrack(ctx, 1)),
      this.createPixelTexture((ctx) => this.drawCrack(ctx, 2)),
      this.createPixelTexture((ctx) => this.drawCrack(ctx, 3)),
    ];

    this.grassFaces = [
      this.grassSideTexture,
      this.grassSideTexture,
      this.grassTopTexture,
      this.dirtTexture,
      this.grassSideTexture,
      this.grassSideTexture,
    ];

    this.oakLogFaces = [
      this.oakLogSideTexture,
      this.oakLogSideTexture,
      this.oakLogTopTexture,
      this.oakLogTopTexture,
      this.oakLogSideTexture,
      this.oakLogSideTexture,
    ];

    this.workbenchFaces = [
      this.workbenchSideTexture,
      this.workbenchSideTexture,
      this.workbenchTopTexture,
      this.oakPlankTexture,
      this.workbenchSideTexture,
      this.workbenchSideTexture,
    ];

    this.namedMap = {
      wool: this.woolTexture,
      fire: this.fireTexture,
      mushroom_cap: this.mushroomCapTexture,
      mushroom_stem: this.mushroomStemTexture,
      stele_pillar: this.stelePillarTexture,
      sapling_stem: this.saplingStemTexture,
      sapling_crown: this.saplingCrownTexture,
    };
  }

  public getBlockFaceTextures(protoId: string): THREE.CanvasTexture | SixFaceTextures | null {
    switch (protoId) {
      case 'Grass':
        return this.grassFaces;
      case 'OakLog':
        return this.oakLogFaces;
      case 'Workbench':
        return this.workbenchFaces;
      case 'Dirt':
        return this.dirtTexture;
      case 'Stone':
        return this.stoneTexture;
      case 'Obsidian':
        return this.obsidianTexture;
      case 'IronOre':
        return this.ironOreTexture;
      case 'Sand':
        return this.sandTexture;
      case 'Glass':
        return this.glassTexture;
      case 'OakPlank':
      case 'OakPlank_Slab':
        return this.oakPlankTexture;
      case 'OakDoor_Closed':
      case 'OakDoor_Open':
        return this.oakDoorTexture;
      case 'Leaf':
        return this.leafTexture;
      case 'Water':
        return this.waterTexture;
      case 'Ice':
        return this.iceTexture;
      case 'MistVeil':
        return this.mistTexture;
      case 'PastureStele':
      case 'GuardStele':
        return this.stelePillarTexture;
      case 'Fire':
        return this.fireTexture;
      case 'Sapling':
        return this.saplingCrownTexture;
      case 'Mushroom':
        return this.mushroomCapTexture;
      default:
        return null;
    }
  }

  public getNamedTexture(name: NamedTextureKey): THREE.CanvasTexture {
    return this.namedMap[name];
  }

  public getCrackTexture(stage: 1 | 2 | 3): THREE.CanvasTexture {
    return this.crackTextures[stage - 1];
  }

  public updateAnimatedTextures(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.waterTexture.offset.x = (this.waterTexture.offset.x + dt * 0.14) % 1;
    this.waterTexture.offset.y = (this.waterTexture.offset.y + dt * 0.08) % 1;
    this.mistTexture.offset.x = (this.mistTexture.offset.x + dt * 0.22) % 1;
    this.mistTexture.offset.y = (this.mistTexture.offset.y - dt * 0.06) % 1;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const tex of this.allTextures) {
      tex.dispose();
    }
  }

  private createPixelTexture(
    painter: (ctx: CanvasRenderingContext2D) => void,
    options?: { repeat?: boolean },
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext('2d')!;
    painter(ctx);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    if (options?.repeat) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    tex.needsUpdate = true;

    this.allTextures.push(tex);
    return tex;
  }

  private drawGrassTop(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const blade = hash2d(x, Math.floor(y / 2), 23);
      const fine = hash2d(x, y, 29);
      if (blade > 0.78 && fine > 0.55) return '#7de359'; // sunlit yellow-green blade tip
      if (fine < 0.24) return '#3e9c35';
      if (blade > 0.58) return '#5fd14d';
      return '#4eb842';
    });

    // Tiny clover / wildflower specks
    const clovers: Array<[number, number, string]> = [
      [3, 4, '#fff7c2'],
      [4, 4, '#34882d'],
      [11, 2, '#e6f99d'],
      [12, 11, '#fff7c2'],
      [12, 12, '#34882d'],
      [6, 13, '#d9f99d'],
    ];
    for (const [cx, cy, col] of clovers) {
      px(ctx, cx, cy, col);
    }
  }

  private drawGrassSide(ctx: CanvasRenderingContext2D): void {
    paintDirtBase(ctx, 19);

    const dripProfile = [4, 5, 4, 3, 4, 5, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4];
    for (let x = 0; x < TEX_SIZE; x++) {
      const depth = dripProfile[x];
      for (let y = 0; y < depth; y++) {
        const r = hash2d(x, y, 37);
        if (y === depth - 1) {
          px(ctx, x, y, '#2e7d26'); // dark underside turf rim
        } else if (y === 0) {
          px(ctx, x, y, r > 0.65 ? '#6be056' : '#52bd45');
        } else {
          px(ctx, x, y, r > 0.5 ? '#52bd45' : '#3f9c34');
        }
      }
      // Subtle contact shadow right underneath grass overhang
      px(ctx, x, depth, '#543420');
    }
  }

  private drawStone(ctx: CanvasRenderingContext2D): void {
    // Base tonal stone noise
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 41);
      if (r < 0.25) return '#7b828e';
      if (r > 0.78) return '#9aa1ac';
      return '#8b929d';
    });

    // Subtle mortar grooves forming staggered cobble courses
    const mortar = '#686f7b';
    const bevelLight = '#a6adb8';
    const bevelShadow = '#717884';

    for (let x = 0; x < TEX_SIZE; x++) {
      px(ctx, x, 5, mortar);
      px(ctx, x, 11, mortar);
      px(ctx, x, 0, bevelLight);
      px(ctx, x, 6, bevelLight);
      px(ctx, x, 12, bevelLight);
      px(ctx, x, 4, bevelShadow);
      px(ctx, x, 10, bevelShadow);
      px(ctx, x, 15, bevelShadow);
    }

    // Staggered vertical block joints
    const joints: Array<[number, number, number]> = [
      [7, 0, 4],
      [15, 0, 4],
      [3, 6, 10],
      [11, 6, 10],
      [6, 12, 15],
      [14, 12, 15],
    ];
    for (const [jx, yStart, yEnd] of joints) {
      for (let y = yStart; y <= yEnd; y++) {
        px(ctx, jx, y, mortar);
        px(ctx, (jx + 1) % TEX_SIZE, y, bevelLight);
        px(ctx, (jx + TEX_SIZE - 1) % TEX_SIZE, y, bevelShadow);
      }
    }
  }

  private drawObsidian(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 53);
      if (r < 0.35) return '#191224';
      if (r > 0.85) return '#2a1e3e';
      return '#221833';
    });

    // Diagonal shimmering amethyst/violet crystal veins
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const diagA = (x + y) % 16;
        const diagB = (x * 2 + y) % 16;
        const r = hash2d(x, y, 59);
        if (diagA === 5 || diagA === 13) {
          if (r > 0.82) {
            px(ctx, x, y, '#e9d5ff'); // crisp pale specular dot
          } else if (r > 0.42) {
            px(ctx, x, y, '#9333ea');
          } else {
            px(ctx, x, y, '#6d28d9');
          }
        } else if (diagA === 6 || diagB === 9) {
          if (r > 0.55) {
            px(ctx, x, y, '#5b21b6');
          }
        }
      }
    }

    // Hand-placed crystalline sparkle facets
    px(ctx, 3, 2, '#f3e8ff');
    px(ctx, 11, 10, '#f3e8ff');
    px(ctx, 7, 14, '#d8b4fe');
    px(ctx, 14, 5, '#d8b4fe');
  }

  private drawIronOre(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 67);
      if (r < 0.25) return '#757c87';
      if (r > 0.8) return '#9198a3';
      return '#828994';
    });

    // Subtle stone cracks for depth
    for (let x = 2; x < 6; x++) px(ctx, x, 7, '#676d78');
    for (let x = 9; x < 14; x++) px(ctx, x, 13, '#676d78');

    const clusters: Array<Array<[number, number, string]>> = [
      // Top-left cluster
      [
        [2, 2, '#e2c29d'],
        [3, 2, '#d49b6a'],
        [4, 2, '#b4b8c2'],
        [2, 3, '#d49b6a'],
        [3, 3, '#dce2ec'],
        [4, 3, '#d49b6a'],
        [3, 4, '#606670'],
        [4, 4, '#606670'],
      ],
      // Top-right cluster
      [
        [10, 3, '#e2c29d'],
        [11, 3, '#dce2ec'],
        [12, 3, '#b4b8c2'],
        [10, 4, '#d49b6a'],
        [11, 4, '#d49b6a'],
        [12, 4, '#b4b8c2'],
        [11, 5, '#606670'],
      ],
      // Mid-center cluster
      [
        [6, 7, '#e2c29d'],
        [7, 7, '#d49b6a'],
        [7, 8, '#dce2ec'],
        [8, 8, '#b4b8c2'],
        [6, 8, '#b4b8c2'],
        [7, 9, '#606670'],
        [8, 9, '#606670'],
      ],
      // Lower-left / right clusters
      [
        [2, 11, '#d49b6a'],
        [3, 11, '#e2c29d'],
        [4, 11, '#b4b8c2'],
        [2, 12, '#b4b8c2'],
        [3, 12, '#dce2ec'],
        [3, 13, '#606670'],
      ],
      [
        [11, 10, '#e2c29d'],
        [12, 10, '#d49b6a'],
        [13, 10, '#b4b8c2'],
        [11, 11, '#dce2ec'],
        [12, 11, '#d49b6a'],
        [12, 12, '#606670'],
      ],
    ];

    for (const cluster of clusters) {
      for (const [cx, cy, col] of cluster) {
        px(ctx, cx, cy, col);
      }
    }
  }

  private drawSand(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const wave = Math.sin(((x + y * 2) / TEX_SIZE) * Math.PI * 2);
      const r = hash2d(x, y, 73);
      if (wave > 0.45) {
        return r > 0.72 ? '#f7eab8' : '#f3e3a6';
      }
      if (wave < -0.42) {
        return r < 0.2 ? '#d2b86d' : '#dfc87e';
      }
      if (r < 0.14) return '#dfc87e';
      if (r > 0.88) return '#f3e3a6';
      return '#ead792';
    });
  }

  private drawGlass(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

    // Subtle inner frost tint
    ctx.fillStyle = 'rgba(190, 236, 255, 0.14)';
    ctx.fillRect(1, 1, 14, 14);

    // Inner thin top-left sheen
    ctx.fillStyle = 'rgba(220, 246, 255, 0.28)';
    ctx.fillRect(1, 1, 14, 1);
    ctx.fillRect(1, 1, 1, 14);

    // Pale icy-cyan border frame
    ctx.fillStyle = 'rgba(190, 236, 255, 0.78)';
    ctx.fillRect(0, 0, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(0, 1, 1, 14);
    ctx.fillRect(15, 1, 1, 14);

    // Corner sparkles
    const corner = 'rgba(240, 252, 255, 0.92)';
    px(ctx, 0, 0, corner);
    px(ctx, 15, 0, corner);
    px(ctx, 0, 15, corner);
    px(ctx, 15, 15, corner);

    // Crisp diagonal pixel specular glint streaks
    const glint = 'rgba(255, 255, 255, 0.85)';
    const glints: Array<[number, number]> = [
      [3, 5],
      [4, 4],
      [5, 3],
      [4, 6],
      [5, 5],
      [10, 12],
      [11, 11],
      [12, 10],
    ];
    for (const [gx, gy] of glints) {
      px(ctx, gx, gy, glint);
    }
  }

  private drawOakLogSide(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const colBias = hash2d(x, 0, 83);
      const bark = hash2d(x, Math.floor(y / 3), 89);
      const fine = hash2d(x, y, 97);

      // Staggered vertical bark grooves
      if ((x % 4 === 1 && bark < 0.72) || (x % 4 === 3 && bark > 0.68)) {
        return fine < 0.4 ? '#3a2212' : '#472c18';
      }
      if (colBias > 0.65 && fine > 0.35) {
        return '#6b472a';
      }
      if (fine < 0.25) return '#472c18';
      if (fine > 0.82) return '#6b472a';
      return '#593a21';
    });
  }

  private drawOakLogTop(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const dist = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const r = hash2d(x, y, 101);

      if (dist >= 7.0) {
        // Outer dark bark rim
        return r < 0.3 ? '#3b2412' : '#4e321b';
      }
      if (dist >= 6.0) {
        return r < 0.4 ? '#5e3c20' : '#734d2b';
      }
      if (dist >= 5.0) {
        // Warm pale sapwood
        return r > 0.75 ? '#d4a872' : '#c79a63';
      }
      if (dist >= 4.0) {
        return r < 0.35 ? '#9c6e3b' : '#a97945';
      }
      if (dist >= 3.0) {
        return r > 0.7 ? '#d0a36c' : '#c79a63';
      }
      if (dist >= 2.0) {
        return r < 0.4 ? '#7c5328' : '#8a5f32';
      }
      if (dist >= 1.0) {
        return r > 0.6 ? '#b3834e' : '#a97945';
      }
      // Center heartwood pith
      return r < 0.5 ? '#754e27' : '#8a5f32';
    });
  }

  private drawOakPlank(ctx: CanvasRenderingContext2D): void {
    const seamRows = new Set([3, 7, 11, 15]);
    const topHighlightRows = new Set([0, 4, 8, 12]);
    const buttJoints = [
      { rowStart: 0, rowEnd: 2, x: 5 },
      { rowStart: 4, rowEnd: 6, x: 12 },
      { rowStart: 8, rowEnd: 10, x: 2 },
      { rowStart: 12, rowEnd: 14, x: 9 },
    ];

    paintGrid(ctx, (x, y) => {
      if (seamRows.has(y)) return '#6b4522';
      const streak = hash2d(Math.floor(x / 3), y, 107);
      const r = hash2d(x, y, 109);
      if (topHighlightRows.has(y)) {
        return r > 0.55 ? '#ce9c62' : '#c28e54';
      }
      if (streak < 0.32 || r < 0.22) return '#ad7a43';
      if (streak > 0.74) return '#c28e54';
      return '#b8844c';
    });

    // Vertical butt-joints + tiny dark iron nail heads at board ends
    for (const joint of buttJoints) {
      const leftNailX = (joint.x + TEX_SIZE - 1) % TEX_SIZE;
      const rightNailX = (joint.x + 1) % TEX_SIZE;
      for (let y = joint.rowStart; y <= joint.rowEnd; y++) {
        px(ctx, joint.x, y, '#6b4522');
      }
      px(ctx, leftNailX, joint.rowStart + 1, '#3f3834');
      px(ctx, rightNailX, joint.rowStart + 1, '#3f3834');
    }
  }

  private drawOakDoor(ctx: CanvasRenderingContext2D): void {
    // Base timber planks
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 113);
      const grain = hash2d(x, Math.floor(y / 3), 127);
      const isOuterBorder = x === 0 || x === 15 || y === 0 || y === 15;
      if (isOuterBorder) return '#6b401b';
      if (x === 1 || x === 14 || y === 1 || y === 7 || y === 8 || y === 14) {
        return grain > 0.55 ? '#9c6635' : '#8c592b';
      }
      return r > 0.55 ? '#855326' : '#78481f';
    });

    // 4-pane upper lattice slits (y=2..6)
    const slitDark = '#29180b';
    const slitTint = '#3d2817';
    for (let y = 2; y <= 6; y++) {
      for (let x = 2; x <= 13; x++) {
        const isLatticeBar = x === 7 || x === 8 || y === 4;
        if (isLatticeBar) {
          px(ctx, x, y, x === 7 || y === 4 ? '#9e6937' : '#7d4d23');
        } else {
          px(ctx, x, y, y === 2 || x === 2 || x === 9 ? slitDark : slitTint);
        }
      }
    }

    // Recessed bottom panel (x=3..12, y=9..13)
    for (let y = 9; y <= 13; y++) {
      for (let x = 3; x <= 12; x++) {
        if (y === 9 || x === 3) {
          px(ctx, x, y, '#543013'); // recessed shadow
        } else if (y === 13 || x === 12) {
          px(ctx, x, y, '#9d6838'); // bottom-right catch light
        } else {
          px(ctx, x, y, (x + y) % 3 === 0 ? '#6e421d' : '#7a4c23');
        }
      }
    }

    // Brass lock / handle highlight on the right edge (x=12..13, y=8..9)
    px(ctx, 12, 8, '#fde047');
    px(ctx, 13, 8, '#eab308');
    px(ctx, 12, 9, '#eab308');
    px(ctx, 13, 9, '#b45309');
  }

  private drawWorkbenchTop(ctx: CanvasRenderingContext2D): void {
    // Warm birch/oak inner table base
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 131);
      if (r < 0.25) return '#a8723d';
      if (r > 0.78) return '#c28b52';
      return '#b57e47';
    });

    // Dark oak outer frame
    for (let i = 0; i < TEX_SIZE; i++) {
      px(ctx, i, 0, '#6e3f1d');
      px(ctx, i, 15, '#6e3f1d');
      px(ctx, 0, i, '#6e3f1d');
      px(ctx, 15, i, '#6e3f1d');
    }

    // Crisp dark-etched 3x3 grid lines separating 4x4 inlaid squares [1..4], [6..9], [11..14]
    for (let i = 1; i <= 14; i++) {
      px(ctx, 5, i, '#472710');
      px(ctx, 10, i, '#472710');
      px(ctx, i, 5, '#472710');
      px(ctx, i, 10, '#472710');
    }

    // Corner oak brackets & brass corner rivets
    const corners: Array<[number, number, number, number]> = [
      [0, 0, 1, 1],
      [15, 0, 14, 1],
      [0, 15, 1, 14],
      [15, 15, 14, 14],
    ];
    for (const [ox, oy, rx, ry] of corners) {
      px(ctx, ox, oy, '#542d12');
      px(ctx, rx, oy, '#6e3f1d');
      px(ctx, ox, ry, '#6e3f1d');
      px(ctx, rx, ry, '#eab308'); // brass corner rivet
    }

    // Faint cyan-gold rune center dots inside the 3x3 squares
    const cellOrigins = [1, 6, 11];
    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        const cx = cellOrigins[gx] + 1;
        const cy = cellOrigins[gy] + 1;
        const isCenterCell = gx === 1 && gy === 1;
        if (isCenterCell) {
          px(ctx, cx, cy, '#38bdf8');
          px(ctx, cx + 1, cy + 1, '#38bdf8');
          px(ctx, cx + 1, cy, '#fde047');
          px(ctx, cx, cy + 1, '#fde047');
        } else {
          px(ctx, cx + 1, cy + 1, '#67e8f9');
          px(ctx, cx, cy + 1, '#d9a441');
        }
      }
    }
  }

  private drawWorkbenchSide(ctx: CanvasRenderingContext2D): void {
    // Recessed oak side panel
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 139);
      if (y <= 2) {
        return y === 2 ? '#593115' : r > 0.5 ? '#7c4822' : '#6e3f1d'; // tabletop overhang
      }
      if (y === 3) return '#472710'; // dark recessed apron shadow
      if (x <= 1 || x >= 14 || y >= 14) {
        return r > 0.6 ? '#7a4722' : '#6e3f1d'; // oak joinery corner posts & bottom rail
      }
      return r < 0.3 ? '#9f6a37' : '#b57e47';
    });

    // Brass rivets on top corners
    px(ctx, 1, 1, '#eab308');
    px(ctx, 14, 1, '#eab308');

    // Painted hanging hammer silhouette (left)
    for (let y = 7; y <= 12; y++) {
      px(ctx, 4, y, '#593215'); // oak handle
    }
    for (let x = 3; x <= 6; x++) {
      px(ctx, x, 5, '#cbd5e1'); // hammer head top highlight
      px(ctx, x, 6, '#64748b'); // hammer head body
    }

    // Painted hanging chisel silhouette (right)
    for (let y = 5; y <= 7; y++) {
      px(ctx, 10, y, '#7c4822'); // wooden grip
      px(ctx, 11, y, '#593215');
    }
    for (let y = 8; y <= 11; y++) {
      px(ctx, 10, y, y === 11 ? '#e2e8f0' : '#94a3b8'); // steel blade
    }
  }

  private drawStelePillar(ctx: CanvasRenderingContext2D): void {
    // Carved slate monolith base
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 149);
      if (x === 0 || y === 0) return '#758599'; // top-left carved bevel
      if (x === 15 || y === 15) return '#3b4654'; // bottom-right shadow
      if (r < 0.32) return '#526071';
      if (r > 0.82) return '#6f8096';
      return '#64748b';
    });

    // Symmetrical glowing cyan rune carvings
    const glowOuter = '#0284c7';
    const runeMid = '#38bdf8';
    const runeCore = '#bae6fd';

    // Vertical side rune pillars (x=3 & x=12)
    for (let y = 2; y <= 13; y++) {
      if (y === 4 || y === 11) continue; // rune segment breaks
      px(ctx, 3, y, runeMid);
      px(ctx, 12, y, runeMid);
    }
    // Rune tick spurs
    for (const ty of [2, 6, 9, 13]) {
      px(ctx, 4, ty, glowOuter);
      px(ctx, 11, ty, glowOuter);
    }

    // Central vertical spine
    for (const sy of [2, 3, 12, 13]) {
      px(ctx, 7, sy, runeMid);
      px(ctx, 8, sy, runeMid);
    }

    // Central diamond emblem (y=4..11)
    const diamondRim: Array<[number, number]> = [
      [7, 4],
      [8, 4],
      [6, 5],
      [9, 5],
      [5, 6],
      [10, 6],
      [4, 7],
      [11, 7],
      [4, 8],
      [11, 8],
      [5, 9],
      [10, 9],
      [6, 10],
      [9, 10],
      [7, 11],
      [8, 11],
    ];
    for (const [dx, dy] of diamondRim) {
      px(ctx, dx, dy, runeMid);
    }

    // Bright rune diamond core
    for (let y = 6; y <= 9; y++) {
      for (let x = 6; x <= 9; x++) {
        const manhattan = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        px(ctx, x, y, manhattan <= 1.2 ? '#e0f2fe' : runeCore);
      }
    }
  }

  private drawLeaf(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const cluster = hash2d(Math.floor(x / 2), Math.floor(y / 2), 157);
      const r = hash2d(x, y, 163);
      if (r < 0.13) return '#17451b'; // crisp airy dark pore
      if (cluster > 0.72 && r > 0.45) return '#56bd59'; // sunlit leaf tip
      if (cluster < 0.28 || r < 0.3) return '#216328';
      if (r > 0.62) return '#3ca346';
      return '#2e8537';
    });
  }

  private drawWater(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const ax = (x / TEX_SIZE) * Math.PI * 2;
      const ay = (y / TEX_SIZE) * Math.PI * 2;
      // Seamless periodic ripple field
      const wave =
        Math.sin(ax + ay * 2) * 0.45 +
        Math.cos(ax * 2 - ay) * 0.35 +
        Math.sin(ax * 3 + ay) * 0.2;
      const shimmer = hash2d(x, y, 173);

      if (wave > 0.62 || (wave > 0.48 && shimmer > 0.78)) {
        return '#8cd4ff'; // bright caustic crest arc
      }
      if (wave > 0.12) {
        return '#44b0ff';
      }
      return wave < -0.55 && shimmer < 0.35 ? '#207fd1' : '#2994e8';
    });
  }

  private drawIce(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const diag = Math.sin(((x + y) / TEX_SIZE) * Math.PI * 2);
      const r = hash2d(x, y, 181);
      if (diag > 0.35 || r > 0.68) return '#aeeeff';
      if (r < 0.15) return '#75d4f7';
      return '#89e0fc';
    });

    // Subtle icy bevel along top-left
    for (let i = 0; i < TEX_SIZE; i++) {
      px(ctx, i, 0, '#d8f6ff');
      px(ctx, 0, i, '#d8f6ff');
    }

    // Crisp white-cyan diagonal crystalline crack lines & frost flecks
    const cracks: Array<[number, number, string]> = [
      [2, 5, '#ffffff'],
      [3, 4, '#ffffff'],
      [4, 3, '#e0faff'],
      [5, 2, '#ffffff'],
      [4, 4, '#e0faff'],
      [5, 5, '#e0faff'],
      [9, 13, '#ffffff'],
      [10, 12, '#ffffff'],
      [11, 11, '#e0faff'],
      [12, 10, '#ffffff'],
      [13, 9, '#e0faff'],
      [11, 12, '#e0faff'],
      [7, 8, '#ffffff'],
      [13, 3, '#f0fcff'],
      [3, 12, '#f0fcff'],
    ];
    for (const [cx, cy, col] of cracks) {
      px(ctx, cx, cy, col);
    }
  }

  private drawMist(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const ax = (x / TEX_SIZE) * Math.PI * 2;
        const ay = (y / TEX_SIZE) * Math.PI * 2;
        // Periodic layered cloud puffs
        const density =
          Math.sin(ax + ay) * 0.4 +
          Math.cos(ax * 2 - ay) * 0.35 +
          Math.sin(ay * 2 + 0.7) * 0.25 +
          (hash2d(x, y, 191) - 0.5) * 0.25;

        if (density > 0.45) {
          px(ctx, x, y, 'rgba(224, 247, 255, 0.65)');
        } else if (density > 0.08) {
          px(ctx, x, y, 'rgba(186, 230, 253, 0.45)');
        } else if (density > -0.22) {
          px(ctx, x, y, 'rgba(186, 230, 253, 0.22)');
        }
      }
    }
  }

  private drawMushroomCap(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 197);
      if (y >= 12 || (r < 0.28 && y >= 6)) return '#b82525';
      if (y <= 3 && r > 0.65) return '#eb5252';
      return '#dc3c3c';
    });

    // Asymmetrical iconic cream-white spots
    const spots: Array<[number, number, string]> = [
      // Spot 1 (top-left)
      [2, 2, '#fff5e6'],
      [3, 2, '#fff5e6'],
      [4, 2, '#f5e4c8'],
      [2, 3, '#fff5e6'],
      [3, 3, '#fff5e6'],
      [4, 3, '#fff5e6'],
      [3, 4, '#f5e4c8'],
      // Spot 2 (mid-right)
      [10, 4, '#fff5e6'],
      [11, 4, '#fff5e6'],
      [12, 4, '#fff5e6'],
      [9, 5, '#f5e4c8'],
      [10, 5, '#fff5e6'],
      [11, 5, '#fff5e6'],
      [12, 5, '#fff5e6'],
      [10, 6, '#fff5e6'],
      [11, 6, '#f5e4c8'],
      // Spot 3 (lower-left)
      [3, 9, '#f5e4c8'],
      [4, 9, '#fff5e6'],
      [5, 9, '#fff5e6'],
      [3, 10, '#fff5e6'],
      [4, 10, '#fff5e6'],
      [5, 10, '#f5e4c8'],
      [4, 11, '#f5e4c8'],
      // Spot 4 (small accent)
      [12, 11, '#fff5e6'],
      [13, 11, '#f5e4c8'],
      [12, 12, '#fff5e6'],
    ];
    for (const [sx, sy, col] of spots) {
      px(ctx, sx, sy, col);
    }
  }

  private drawMushroomStem(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const r = hash2d(x, y, 211);
      if (y <= 1) return '#cdbda0'; // subtle cap shadow under mushroom top
      if (x >= 12 || (x >= 10 && r < 0.45)) return '#dfd0b4';
      if (x <= 5 && r > 0.4) return '#f5ebd8';
      return r > 0.65 ? '#dfd0b4' : '#ede2cc';
    });
  }

  private drawSaplingStem(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const stripe = hash2d(x, Math.floor(y / 3), 223);
      const r = hash2d(x, y, 227);
      if (stripe < 0.35 || r < 0.28) return '#543318';
      if (x <= 5 && r > 0.6) return '#7c512c';
      return '#6b4423';
    });
  }

  private drawSaplingCrown(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const cluster = hash2d(Math.floor(x / 2), Math.floor(y / 2), 233);
      const r = hash2d(x, y, 239);
      if (cluster > 0.72 && r > 0.35) return '#84e66a';
      if (cluster < 0.25 || r < 0.16) return '#378f28';
      if (r < 0.38) return '#4cb038';
      return '#62cf4a';
    });
  }

  private drawWool(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      // Soft diagonal fluff weave (clean high-value off-white for multiplicative tinting)
      const diag = (x + y) % 4;
      const tuft = hash2d(Math.floor(x / 2), Math.floor(y / 2), 241);
      const r = hash2d(x, y, 251);
      if (diag === 0 && r < 0.65) return '#eae4d6';
      if (diag === 2 && tuft > 0.5) return '#fcfaf4';
      if (r < 0.22) return '#eae4d6';
      return '#f7f4eb';
    });
  }

  private drawFire(ctx: CanvasRenderingContext2D): void {
    paintGrid(ctx, (x, y) => {
      const ny = y / (TEX_SIZE - 1); // 0 at tip, 1 at base
      const dx = Math.abs(x - 7.5) / 7.5;
      const flicker = Math.sin((x * 1.4 + y * 0.55) * 1.2) * 0.16 + (hash2d(x, y, 257) - 0.5) * 0.18;
      // Intensity peaks at bottom-center and tapers into flame tongues upward
      const heat = ny * 1.05 - dx * 0.45 + flicker;

      if (heat > 0.72) return '#fffbe6'; // hot white-gold core
      if (heat > 0.44) return '#ffd23f'; // bright golden flame
      if (heat > 0.14) return '#ff7b1a'; // vivid orange body
      if (heat > -0.15) return '#e03c00'; // flame tips
      return '#a82400'; // deep ember glow background
    });

    // Crisp floating ember sparks near upper flame tips
    px(ctx, 4, 2, '#ffd23f');
    px(ctx, 11, 1, '#ffd23f');
    px(ctx, 8, 2, '#ff9c2a');
  }

  private drawCrack(ctx: CanvasRenderingContext2D, stage: 1 | 2 | 3): void {
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

    const primary = '#0f172a';
    const secondary = '#1e293b';

    // Stage 1: light hairline fractures
    const stage1Pixels: Array<[number, number, string]> = [
      [7, 7, primary],
      [8, 7, primary],
      [8, 8, primary],
      [9, 8, secondary],
      [6, 6, primary],
      [5, 6, secondary],
      [5, 5, secondary],
      [8, 9, primary],
      [9, 10, secondary],
      [10, 10, secondary],
      [10, 11, secondary],
      [7, 6, secondary],
      [7, 5, secondary],
    ];

    // Stage 2: branching medium web
    const stage2Pixels: Array<[number, number, string]> = [
      [4, 4, primary],
      [3, 3, primary],
      [2, 3, secondary],
      [2, 2, secondary],
      [4, 7, secondary],
      [3, 8, primary],
      [2, 8, secondary],
      [1, 9, secondary],
      [9, 6, primary],
      [10, 5, primary],
      [11, 5, secondary],
      [12, 4, primary],
      [13, 3, secondary],
      [11, 11, primary],
      [12, 12, primary],
      [13, 12, secondary],
      [14, 13, secondary],
      [7, 9, primary],
      [6, 10, primary],
      [6, 11, secondary],
      [5, 12, secondary],
      [5, 13, secondary],
      [8, 4, primary],
      [8, 3, secondary],
      [9, 2, secondary],
    ];

    // Stage 3: critical dense shatter network
    const stage3Pixels: Array<[number, number, string]> = [
      // Stress darkening around central impact
      [6, 7, 'rgba(15, 23, 42, 0.45)'],
      [7, 8, 'rgba(15, 23, 42, 0.45)'],
      [8, 6, 'rgba(15, 23, 42, 0.45)'],
      [9, 7, 'rgba(15, 23, 42, 0.45)'],
      [6, 8, 'rgba(15, 23, 42, 0.45)'],
      [9, 9, 'rgba(15, 23, 42, 0.45)'],
      // Thickened core & aggressive corner fractures
      [1, 1, primary],
      [2, 1, secondary],
      [1, 2, secondary],
      [0, 10, secondary],
      [1, 10, primary],
      [4, 14, primary],
      [3, 15, secondary],
      [14, 2, primary],
      [15, 2, secondary],
      [10, 1, secondary],
      [10, 0, secondary],
      [11, 8, primary],
      [12, 8, primary],
      [13, 7, secondary],
      [14, 7, secondary],
      [15, 6, secondary],
      [11, 9, secondary],
      [12, 10, primary],
      [14, 14, primary],
      [15, 14, secondary],
      [8, 12, primary],
      [8, 13, primary],
      [9, 14, secondary],
      [9, 15, secondary],
      [3, 5, primary],
      [2, 5, secondary],
      [1, 6, secondary],
      [0, 6, secondary],
      [5, 3, primary],
      [5, 2, secondary],
      [4, 1, secondary],
      [4, 0, secondary],
      [12, 14, secondary],
      [11, 14, secondary],
    ];

    for (const [cx, cy, col] of stage1Pixels) px(ctx, cx, cy, col);
    if (stage >= 2) {
      for (const [cx, cy, col] of stage2Pixels) px(ctx, cx, cy, col);
    }
    if (stage >= 3) {
      for (const [cx, cy, col] of stage3Pixels) px(ctx, cx, cy, col);
    }
  }
}
