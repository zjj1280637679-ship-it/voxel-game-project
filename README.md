# Voxel Game Project

微体素游戏渲染引擎与交互动力学规则形式化验证系统。

---

## 目录结构

```text
voxel-game-project/
├── voxel_stage1/           # 主体素前端与渲染引擎（Three.js + TypeScript + Vite）
│   ├── src/                # 引擎核心（骨骼网格、贪婪网格化、渲染器、材质）
│   ├── data/               # 体素模型契约数据与规则库 (iron_knight.json, rules.json)
│   ├── docs/               # 美术管线规范与多视角参考图 (VOXEL_ASSET_PIPELINE.md)
│   ├── scripts/            # 离线验证与质检工具 (render_multiview_ref.py 等)
│   ├── tests/              # 自动化与无头测试 (headless.test.ts)
│   ├── package.json
│   └── vite.config.ts
└── voxel_formal_demo/      # 规则形式化与动力学闭包验证系统（Python）
    ├── demo.py             # 交互演示程序
    ├── engine.py           # 动力学与复合脉冲结算核心引擎
    ├── rules.json          # 形式化交互契约与气场定义
    └── verify_closure.py   # 状态闭包与一致性验证测试脚本
```

---

## 模块介绍

### 1. voxel_stage1（Web 前端引擎）

- **技术栈**：Three.js (`^0.174.0`) + TypeScript 5.7 + Vite 6.1
- **核心特性**：
  - **1-DrawCall `THREE.SkinnedMesh`**：全角色分骨 2D 贪婪网格管线，大幅降低 WebGL 绘制开销。
  - **微体素资产管线**：支持两阶段 AI 生图到标准 5 视角质检图、模型契约（含 meta / palette / parts / rig / voxels / animations）的闭环校验。
  - **内置无头测试**：基于 Node.js 原生测试运行器。

#### 快速启动

```bash
cd voxel_stage1
npm install
npm run dev
```

运行测试与构建：

```bash
npm run typecheck       # TypeScript 类型检查
npm run test:headless   # 运行无头测试
npm run build           # 生产构建
```

### 2. voxel_formal_demo（规则闭包验证）

- **技术栈**：Python 3.10+
- **核心特性**：
  - 加权归一化复合脉冲与体素微交互结算。
  - 气场位掩码（Atmo Bits）与态势免疫/导向结算机制。
  - 形式化规则闭包检验，保障实体转换过程无死锁与无限发散。

#### 快速运行

```bash
cd voxel_formal_demo
python demo.py             # 运行交互验证演示
python verify_closure.py    # 执行规则闭包与合法性校验
```

---

## 许可证与说明

本项目为私有/内部体素研发原型，包含微体素资产规格及形式化规则体系。
