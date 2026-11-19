# 微体素资产外包生产流程与技术规范（两阶段生图 → 照图建模 + 动作集）

> 适用引擎：`d:\新建文件夹 (2)\voxel_stage1`（1-DrawCall `THREE.SkinnedMesh` + 分骨 2D 贪心网格管线）  
> 现有标准参考图：
> - **干净生图用多视图参考**：`docs/references/iron_knight_multiview_clean.png`（发给**生图模型**对齐画风与五视图排版）
> - **工程标注用多视图参考**：`docs/references/iron_knight_multiview_annotated.png`（发给**代码/建模 AI**对齐坐标系、尺寸比例、骨骼轴心与色板规范）

---

## 一、标准三步流水线

```text
[Step 1: 生图模型]
  输入：附带 iron_knight_multiview_clean.png + 「Stage 1 提示词」
  产出：目标资产的 5 视图标准概念设定图（正/左/背/右 + 3/4 立体）
          │
          ▼  (人工淘汰粘连/切边/透视变形的废图)
[Step 2: 代码 / 建模 AI]
  输入：附带 Step 1 设定图 + iron_knight_multiview_annotated.png + 「Stage 2 提示词」
  产出：严格符合契约的 <id>.json（含 meta / palette / parts / rig / voxels / animations）
          │
          ▼
[Step 3: 本地脚本一键校验 + 生成五视图质检图]
  命令：python scripts/render_multiview_ref.py data/models/<id>.json
  验收：8 项格式校验全绿 + 人工/AI 对比五视图质检 PNG 与原设定图一致 → 接入引擎 1 DrawCall 运行
```

---

## 二、Stage 1：生图模型提示词模板（名称槽在最顶部）

> **操作方法**：把 `docs/references/iron_knight_multiview_clean.png` 作为图片参考（Style / Layout Reference）一起上传给支持垫图的生图模型（推荐 `16:9` 或 `21:9` 横版宽图，例如 2K 分辨率），只改顶部填写槽即可。

```text
================ 【生图填写槽（每次只需改这里）】 ================
【资产名称】：<例如：灰烬炉会 · 重装喷火兵>
【资产类别】：<A=人形兵种 | B=异形野怪 | C=四相炮台或功能锚碑 | D=模块战舰骨架>
【所属思潮与阵营色】：<例如：灰烬炉会·Thermo，主徽色赤红/熔橙，暗部暗炭红>
【主体材质与配色】：<例如：熏黑厚重精钢甲 + 黄铜压力管 + 猩红耐火裙甲与披风 + 橙亮燃料核心>
【外观造型与关键细节】：<例如：厚实双肩散热护甲、封闭式防毒面罩与亮橙护目镜、背后双联火焰燃料罐、右手持短粗重型喷火枪、左手持带观测窗的重型防火盾>
【比例与参考基准】：<参照附图铁甲骑士（约 38 体素高、1:1.9 头身方块比例，A-Pose 四肢与躯干留出清晰缝隙）>
==================================================================

请严格参照附带参考图的【纯平光棚拍多视图排版与 MagicaVoxel 像素体素风格】，生成上面【资产名称】的五视图体素角色/物体设计设定图（Character/Prop Voxel Turnaround Sheet）：

【必须严格执行的画面与构图要求】
1. 版面布局：宽幅横图（16:9 或 21:9），由左到右等距、等高、水平一字排开 5 个视角：
   - 第 1 列：正视图（FRONT，角色正面朝向镜头）
   - 第 2 列：左侧视图（LEFT，侧面轮廓清晰）
   - 第 3 列：背视图（BACK，背部披风/背包/引擎结构清晰）
   - 第 4 列：右侧视图（RIGHT，武器或工具侧轮廓清晰）
   - 第 5 列：3/4 立体等轴视角（3/4 VIEW，展示立体层次与轻微地面投影）
2. 正交严格对齐（Orthographic Consistency）：
   - 前 4 个正交视图必须完全零透视（Orthographic view），双脚/底座严格踩在同一条浅灰色水平基线上。
   - 头顶、肩线、腰带、膝盖高度、武器与背饰位置在四个正交视图之间严格水平对齐。
   - 四肢采取自然舒展的微张站姿（A-pose / idle），手臂、武器、盾牌与躯干之间保留清晰可见的像素空隙，不要互相穿模粘连，方便后续分骨骼切块。
3. 风格与背景控制：
   - 纯正的方块/微体素审美（Crisp blocky voxel aesthetic, MagicaVoxel studio render, flat matte shading with subtle voxel ambient occlusion, sharp edges）。
   - 背景必须是均一纯净的极浅灰白棚拍背景（solid uniform pale gray #F1F5F9），禁止出现场景草地、星空、边框线、复杂装饰或任何文字水印/标注。
4. 配色约束：
   - 整套外观只使用 8~14 种分明纯色色块构成（大面加明暗 2~3 阶体素倒角色阶，禁止光滑渐变动漫贴图或高频噪点纹理）。

Negative Constraints (严格避免):
smooth high-poly 3D mesh, perspective distortion in ortho views, cropped head/feet/weapons, overlapping poses across columns, muddy dark shadows, photorealistic textures, extra limbs, gibberish text, watermarks, busy background.
```

### Stage 1 抽卡质检清单（发现下面任意一项直接重抽或微调重跑）
- [ ] **前后左右能对上号**：左视图里的盾/背包是否和正视图同一边？背视图里的披风/燃料罐尺寸有没有突然消失或放大？
- [ ] **关节与体素清晰**：手臂和躯干之间是否有明显空隙（不要糊成一块），色块数量克制在十来种纯色内？
- [ ] **完整不裁切**：头饰、剑尖、船艏、底座全部留在画幅内且脚底齐平？

---

## 三、Stage 2：照图建模 + 动作集代工提示词模板（名称槽在最顶部）

> **操作方法**：把 Stage 1 选定的一张【目标多视图设定图】，连同我们的工程尺度图 `docs/references/iron_knight_multiview_annotated.png`，一起发给擅长写脚本的代码模型（Python / Node.js），只改顶部填写槽即可。

```text
================ 【建模与动作填写槽（每次只需改这里）】 ================
【资产名称（中文 / 英文ID）】：<例如：灰烬炉会·重装喷火兵 / ash_pyromancer>
【资产类别（A/B/C/D）】：<A=人形兵种 | B=异形野怪 | C=四相炮台或功能锚碑 | D=模块战舰骨架>
【所属思潮与阵营色】：<例如：灰烬炉会·Thermo，主徽色 #C22B1E，暗部色 #7A1812>
【目标尺寸与缩放】：<例如：高 36~38 体素 · 宽 20~24 · 深 14~18，体素约 2500~3800，recommendedScale = 0.055>
【照图重点细节补充】：<例如：严格照我附带的多视图设定图搭建：正视图头盔、面罩护目镜与胸甲徽记、背视图双联橙红燃料罐与管道、右侧长喷火枪管、左侧防爆盾结构比例必须四向自洽>
【本次必做动作集】：<例如：idle, walk, attack, block, death（可选补 salute / spin）>
==================================================================

请严格参照我附带的两张参考图，编写脚本（Python 或 Node.js）程序化生成上述 3D 分骨骼微体素模型与完整动作集，并导出严格符合下述规范的**单个纯净 JSON 文件**：
- 附图 1（目标多视图设定图）：用于精确量取本资产的前/左/背/右四向轮廓比例、像素级结构对齐与主色板配色。
- 附图 2（iron_knight_multiview_annotated.png）：用于对齐引擎的右手坐标方向、骨骼父子与 pivot 全局坐标规范及色阶明暗层次。

### 一、坐标系与建模铁律（违反任意一条都无法导入引擎）
1. 右手系 Y-Up：
   - +Z 为正前方（脸部、胸甲、武器指向、炮口、战舰船头必须朝 +Z）。
   - +Y 为正上方，所有体素中最低一层的整数 y 坐标必须严格等于 0（minY === 0，引擎加载时会自动 +0.5 使脚底/底座精确落于 y = 0）。
   - +X 为角色左手侧 / 船体左舷，-X 为角色右手侧 / 船体右舷；模型沿 X 轴大致居中于 x ≈ 0。
2. 色板规范：
   - 每个模型 8~18 色，每种主材质必须做 2~3 阶明暗色阶（高光 / 主色 / 阴影），最暗色不低于 #121418。
   - 披风、旗帜、盾面、涂装等可随国家换色的颜色，必须在 palette 中标注 "role": "faction_primary"（主徽色）或 "role": "faction_secondary"（暗部色）；发光核心/晶石标为 "emissive"；其余标为 "base"。
3. 骨骼与关节封口：
   - 引擎会按骨骼独立做隐藏面剔除与 2D 贪心合并，相邻骨骼的连接处（如肩窝、胯部、脖子、炮塔底座与炮耳）请保持各部位实体闭合，不要故意掏空切口，旋转时才不会露空心。

### 二、各类资产尺寸、缩放与标准骨骼命名
- A 类（人形/类人单位，recommendedScale = 0.055，1世界米 ≈ 18.2体素）：
  * 普通步兵高 32~36，重甲骑士高 36~40（约2.1m），Boss高 46~54；体素预算 1,500~4,500。
  * 强烈建议沿用 14 根标准骨骼名（可省略 cape，或把武器挂在 rightForearm 下的 sword/weapon 骨上）：
    ["hips","torso","cape","head","leftUpperArm","leftForearm","shield","rightUpperArm","rightForearm","sword","leftThigh","leftShin","rightThigh","rightShin"]
- B 类（异形野怪/元素体/机兵，recommendedScale = 0.055）：
  * 骨骼数 4~14 根（根骨命名 root 或 hips，parent: null）；体素预算 800~3,500。
- C 类（四相炮台 / 功能锚碑，recommendedScale = 0.0625，严格 16 微体素 = 1.0m）：
  * 单格设施宽深 16×16（x∈[-8,7], z∈[-8,7]），高 24~36；大型设施 32×32×32；体素预算 1,200~4,500。
  * 炮台标准 3 骨：["base","turretYaw","barrelPitch"]（turretYaw 绕Y转，barrelPitch 绕X俯仰且炮口朝+Z）。
  * 锚碑标准 2 骨：["pedestal","crystal"]。
- D 类（模块化战舰骨架，recommendedScale = 0.125，严格 8 微体素 = 1.0m）：
  * 轻艇约 48×32×88、护卫舰约 64×40×120、战列舰约 88×48×168；体素预算 4,000~12,000。
  * 标准骨骼：["hull","rudder","core"]（可加 "sail","propellerL","propellerR"）。
  * 甲板上方必须留出完全平坦的整数米建造区，并在 meta.deckGridBounds 填好 [minX, maxX, deckY, minZ, maxZ]（单位：世界米整数）。

### 三、动作集规范（纯数据关键帧轨道，禁止写死函数）
请在 JSON 顶层增加 "animations" 对象，每个动作名对应一个动画片段：
- duration: 单周期时长（秒，如 idle=2.4, walk=1.0, attack=0.85, death=1.2）。
- loop: 布尔值（待机/行走/航行/悬浮为 true；攻击/格挡/开火/阵亡/断电为 false）。
- holdEnd: 布尔值（true 表示播完后定格在最后一帧；death / block / disabled / destroyed 必须为 true）。
- tracks: 以骨骼名为 key 的关键帧数组，每帧为：
  { "t": 0.0~1.0归一化时间, "rot": [rx, ry, rz], "pos": [dx, dy, dz] }
  * t 严格升序，建议含 t=0 与 t=1（loop=true 的循环动作首尾帧姿态必须一致，无缝衔接）。
  * rot 为弧度制欧拉角 [rx, ry, rz]（Three.js 默认 XYZ 顺序）；不需要移动位置可省略 pos。
  * pos 为相对该骨骼静息 basePos 的【微体素增量偏移 [dx, dy, dz]】（例如倒地 hips.pos=[0,-10.0,-6.0]，炮管后坐 barrelPitch.pos=[0,0,-1.8]），禁止填绝对坐标！

各类资产最低必做动作清单：
- A 类人形：idle(循环) / walk(循环) / attack(单次) / block(单次holdEnd) / death(单次倒地holdEnd)
- B 类野怪：idle(循环) / walk(循环) / attack(单次) / death(单次holdEnd)
- C 类炮台：idle(微巡视循环) / fire(开火后坐单次) / disabled(断电低头垂管holdEnd)
- C 类锚碑：idle(晶石悬浮旋转循环) / disabled(断电坠落静止holdEnd)
- D 类战舰：idle(云海微晃循环) / sail(推进器/核心旋转+帆摆循环) / destroyed(倾斜解体holdEnd)

### 四、标准 JSON 结构模板
{
  "meta": {
    "id": "ash_pyromancer",
    "name": "重装喷火兵",
    "category": "humanoid",
    "recommendedScale": 0.055,
    "deckGridBounds": null
  },
  "palette": [
    { "id": "steel_l", "hex": "#D0D6DC", "name": "亮钢", "role": "base" },
    { "id": "faction_1", "hex": "#C22B1E", "name": "阵营主色", "role": "faction_primary" },
    { "id": "faction_2", "hex": "#7A1812", "name": "阵营暗色", "role": "faction_secondary" }
  ],
  "parts": ["hips", "torso", "head"],
  "rig": {
    "hips":  { "parent": null,    "pivot": [-0.5, 13.0, -0.5] },
    "torso": { "parent": "hips",  "pivot": [-0.5, 14.0, -0.5] },
    "head":  { "parent": "torso", "pivot": [-0.5, 26.5, -0.5] }
  },
  "voxels": [
    [0, 15, 2, 0, 1]
  ],
  "animations": {
    "idle": {
      "duration": 2.4,
      "loop": true,
      "holdEnd": false,
      "tracks": {
        "hips":  [ { "t": 0, "pos": [0, 0, 0] }, { "t": 0.5, "pos": [0, 0.2, 0] }, { "t": 1, "pos": [0, 0, 0] } ],
        "torso": [ { "t": 0, "rot": [0.03, 0, 0] }, { "t": 0.5, "rot": [0.06, 0, 0] }, { "t": 1, "rot": [0.03, 0, 0] } ]
      }
    },
    "death": {
      "duration": 1.2,
      "loop": false,
      "holdEnd": true,
      "tracks": {
        "hips": [
          { "t": 0, "rot": [0, 0, 0], "pos": [0, 0, 0] },
          { "t": 0.35, "rot": [-0.22, 0, 0], "pos": [0, -0.8, 0] },
          { "t": 1, "rot": [-1.57, 0, 0], "pos": [0, -10.0, -6.0] }
        ]
      }
    }
  }
}

### 五、交付前必须用脚本自检 8 项并打印校验报告
1. 所有 voxels 的 x,y,z 均为整数且 minY === 0；
2. 同 partIdx 内重复坐标数 === 0；
3. 所有 matIdx 与 partIdx 均未越界，且无空骨骼；
4. parts 与 rig 键集合完全一致、存在 root(parent=null)、父骨严格排在子骨前、无环；
5. pivot 与 voxels 均为全局静息坐标（未做相对偏移）；
6. animations 中所有 track 骨名均存在于 parts 中，t ∈ [0,1] 且严格升序，rot/pos 均为长度 3 的有限数字；
7. 所有 loop === true 的动作首尾帧（t=0 与 t=1）姿态一致；
8. 打印总微体素数、包围盒 [minX..maxX, minY..maxY, minZ..maxZ]、各骨骼体素数与包含动作列表。
```

---

## 四、Stage 3：本地一键校验与出图质检

拿到外包 AI 生成的 `<id>.json` 放到 `data/models/<id>.json` 后，在 `d:\新建文件夹 (2)\voxel_stage1` 下运行：

```powershell
python scripts/render_multiview_ref.py data/models/<id>.json
```

脚本会自动完成全部格式/骨骼/动画轨道校验，并在 `docs/references/` 下渲染出 `<id>_multiview_clean.png` 与 `<id>_multiview_annotated.png`。对照 Stage 1 设定图确认五视图结构无错边、无漏洞、脚底紧贴红线 `Y=0` 后即可接入游戏。
