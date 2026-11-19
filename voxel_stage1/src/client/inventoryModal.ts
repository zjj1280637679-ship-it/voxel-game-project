import {
  BLOCK_CATALOG,
  createCustomTool,
  getBlockOption,
  TOOL_CATALOG,
  type CustomPulseConfig,
  type ToolDefinition,
} from './tools.ts';

export interface InventoryModalCallbacks {
  getToolSlots: () => readonly ToolDefinition[];
  getBlockSlots: () => readonly string[];
  getActiveToolIndex: () => number;
  getActiveBlockSlot: () => number;
  onAssignToolSlot: (slotIndex: number, tool: ToolDefinition) => void;
  onAssignBlockSlot: (slotIndex: number, protoId: string) => void;
  onSelectToolSlot: (slotIndex: number) => void;
  onSelectBlockSlot: (slotIndex: number) => void;
  onResetDefaults: () => void;
  onClose: () => void;
}

export class InventoryModal {
  private readonly backdrop: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly toolSlotListEl: HTMLDivElement;
  private readonly blockSlotListEl: HTMLDivElement;
  private readonly toolCatalogEl: HTMLDivElement;
  private readonly blockCatalogEl: HTMLDivElement;

  private readonly customNameInput: HTMLInputElement;
  private readonly customAmountInput: HTMLInputElement;
  private readonly mechWeightInput: HTMLInputElement;
  private readonly mechTagSelect: HTMLSelectElement;
  private readonly thermoWeightInput: HTMLInputElement;
  private readonly thermoTagSelect: HTMLSelectElement;
  private readonly magicWeightInput: HTMLInputElement;
  private readonly magicTagSelect: HTMLSelectElement;
  private readonly atmoTagSelect: HTMLSelectElement;
  private readonly customErrorEl: HTMLDivElement;

  private readonly callbacks: InventoryModalCallbacks;
  private editingToolIdx = 0;
  private editingBlockIdx = 0;
  private visible = false;

  constructor(container: HTMLElement, callbacks: InventoryModalCallbacks) {
    this.callbacks = callbacks;

    this.backdrop = document.createElement('div');
    this.backdrop.id = 'inventory-modal-backdrop';
    this.backdrop.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 60',
      'display: none',
      'align-items: center',
      'justify-content: center',
      'background: rgba(6, 10, 18, 0.72)',
      'backdrop-filter: blur(8px)',
      'pointer-events: auto',
      'padding: 16px',
    ].join(';');

    this.backdrop.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.target === this.backdrop) {
        this.close();
      }
    });
    this.backdrop.addEventListener('wheel', (e) => e.stopPropagation());

    this.panel = document.createElement('div');
    this.panel.id = 'inventory-modal';
    this.panel.style.cssText = [
      'width: 980px',
      'max-width: 96vw',
      'max-height: 90vh',
      'overflow-y: auto',
      'border-radius: 14px',
      'background: rgba(15, 23, 42, 0.96)',
      'border: 1px solid rgba(148, 163, 184, 0.35)',
      'box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65)',
      'padding: 16px 18px',
      'color: #f1f5f9',
      'display: flex',
      'flex-direction: column',
      'gap: 14px',
    ].join(';');
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation());

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid rgba(148,163,184,0.2); padding-bottom: 10px;';
    header.innerHTML = `
      <div>
        <div style="font-size: 16px; font-weight: 800; color: #f8fafc;">背包与槽位定义 (Inventory & Slot Configurator)</div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">左键触发工具槽 (T1~T6) · 右键放置方块种类槽 (1~8) · 点击右侧目录可重定义任意槽位</div>
      </div>
    `;

    const headerActions = document.createElement('div');
    headerActions.style.cssText = 'display: flex; gap: 8px;';
    const resetBtn = this.makeBtn('↺ 恢复默认槽位', '#475569', () => {
      this.callbacks.onResetDefaults();
      this.render();
    });
    const closeBtn = this.makeBtn('✕ 关闭 (Q / ESC)', '#2563eb', () => this.close());
    headerActions.appendChild(resetBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(headerActions);
    this.panel.appendChild(header);

    // Two-column main body: Left = Tool Slots + Customizer, Right = Block Slots 1-8
    const columns = document.createElement('div');
    columns.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px;';

    // LEFT COLUMN: Tool Slots
    const leftCol = document.createElement('div');
    leftCol.style.cssText = 'display: flex; flex-direction: column; gap: 10px; background: rgba(30,41,59,0.45); padding: 12px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.18);';
    leftCol.innerHTML = `<div style="font-size: 13px; font-weight: 700; color: #93c5fd;">工具槽定义 (左键触发 · 滚轮 / Shift+1~6 切换)</div>`;

    this.toolSlotListEl = document.createElement('div');
    this.toolSlotListEl.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;';
    leftCol.appendChild(this.toolSlotListEl);

    const toolLibTitle = document.createElement('div');
    toolLibTitle.textContent = '点击工具预设替换选中工具槽：';
    toolLibTitle.style.cssText = 'font-size: 11px; color: #cbd5e1; margin-top: 4px;';
    leftCol.appendChild(toolLibTitle);

    this.toolCatalogEl = document.createElement('div');
    this.toolCatalogEl.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; max-height: 175px; overflow-y: auto;';
    leftCol.appendChild(this.toolCatalogEl);

    // Custom pulse builder
    const customBox = document.createElement('div');
    customBox.style.cssText = 'margin-top: 4px; padding: 10px; border-radius: 8px; background: rgba(15,23,42,0.7); border: 1px solid rgba(192,132,252,0.3); display: flex; flex-direction: column; gap: 6px;';
    customBox.innerHTML = `<div style="font-size: 12px; font-weight: 700; color: #d8b4fe;">自定义正式脉冲工坊 (写入当前工具槽)</div>`;

    const rowTop = document.createElement('div');
    rowTop.style.cssText = 'display: grid; grid-template-columns: 1fr 90px; gap: 6px;';
    this.customNameInput = this.makeInput('工具名', '魔导焰镐');
    this.customAmountInput = this.makeNumberInput('总强度', '45', '1', '200');
    rowTop.appendChild(this.customNameInput);
    rowTop.appendChild(this.customAmountInput);
    customBox.appendChild(rowTop);

    this.mechWeightInput = this.makeNumberInput('机械权重', '0.4', '0', '10', '0.1');
    this.mechTagSelect = this.makeSelect([
      ['Mech_T1', 'Mech_T1 (木)'],
      ['Mech_T2', 'Mech_T2 (铁)'],
      ['Mech_T3', 'Mech_T3 (钻)'],
      ['Mech_T1 | Mech_Sharp', 'T1 | 锐利'],
      ['Mech_T1 | Mech_Sharp | Mech_Gentle', 'T1 | 锐利 | 柔取'],
      ['Mech_T2 | Mech_Blunt', 'T2 | 钝击'],
      ['Mech_Toggle', 'Mech_Toggle (拨动)'],
    ]);
    customBox.appendChild(this.makeRow('机械 Mech', this.mechWeightInput, this.mechTagSelect));

    this.thermoWeightInput = this.makeNumberInput('热力权重', '0.6', '0', '10', '0.1');
    this.thermoTagSelect = this.makeSelect([
      ['Thermo_Heat_T1', 'Heat_T1 (微温)'],
      ['Thermo_Heat_T2', 'Heat_T2 (明火)'],
      ['Thermo_Heat_T3', 'Heat_T3 (高炉)'],
      ['Thermo_Cold_T1', 'Cold_T1 (冰冻)'],
    ]);
    customBox.appendChild(this.makeRow('热力 Thermo', this.thermoWeightInput, this.thermoTagSelect));

    this.magicWeightInput = this.makeNumberInput('魔法权重', '0', '0', '10', '0.1');
    this.magicTagSelect = this.makeSelect([
      ['Magic_Vita', 'Magic_Vita (生机)'],
      ['Magic_Arcane', 'Magic_Arcane (奥术)'],
      ['Magic_Decay', 'Magic_Decay (腐朽)'],
      ['Magic_Volt', 'Magic_Volt (雷能)'],
    ]);
    customBox.appendChild(this.makeRow('魔法 Magic', this.magicWeightInput, this.magicTagSelect));

    this.atmoTagSelect = this.makeSelect([
      ['', '附带气场: 无'],
      ['Atmo_O2', 'Atmo_O2 (有氧)'],
      ['Atmo_NoO2', 'Atmo_NoO2 (缺氧密闭)'],
      ['Atmo_Wet', 'Atmo_Wet (潮湿)'],
      ['Atmo_Toxic', 'Atmo_Toxic (毒瘴)'],
    ]);
    const applyCustomBtn = this.makeBtn('✨ 写入选中工具槽', '#7e22ce', () => this.applyCustomTool());
    const atmoRow = document.createElement('div');
    atmoRow.style.cssText = 'display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: center;';
    atmoRow.appendChild(this.atmoTagSelect);
    atmoRow.appendChild(applyCustomBtn);
    customBox.appendChild(atmoRow);

    this.customErrorEl = document.createElement('div');
    this.customErrorEl.style.cssText = 'font-size: 11px; color: #f87171; min-height: 14px; display: none;';
    customBox.appendChild(this.customErrorEl);

    leftCol.appendChild(customBox);

    // RIGHT COLUMN: Block Slots 1-8
    const rightCol = document.createElement('div');
    rightCol.style.cssText = 'display: flex; flex-direction: column; gap: 10px; background: rgba(30,41,59,0.45); padding: 12px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.18);';
    rightCol.innerHTML = `<div style="font-size: 13px; font-weight: 700; color: #86efac;">方块种类槽定义 (右键放置 · 数字键 1~8 / 滚轮切换)</div>`;

    this.blockSlotListEl = document.createElement('div');
    this.blockSlotListEl.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;';
    rightCol.appendChild(this.blockSlotListEl);

    const blockLibTitle = document.createElement('div');
    blockLibTitle.textContent = '点击原型库，将其赋予当前选中的方块槽 (含工作台小资源)：';
    blockLibTitle.style.cssText = 'font-size: 11px; color: #cbd5e1; margin-top: 4px;';
    rightCol.appendChild(blockLibTitle);

    this.blockCatalogEl = document.createElement('div');
    this.blockCatalogEl.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-height: 390px; overflow-y: auto;';
    rightCol.appendChild(this.blockCatalogEl);

    columns.appendChild(leftCol);
    columns.appendChild(rightCol);
    this.panel.appendChild(columns);
    this.backdrop.appendChild(this.panel);
    container.appendChild(this.backdrop);
  }

  public get isOpen(): boolean {
    return this.visible;
  }

  public open(): void {
    this.editingToolIdx = this.callbacks.getActiveToolIndex();
    this.editingBlockIdx = this.callbacks.getActiveBlockSlot() - 1;
    this.syncCustomFormFromSelectedTool();
    this.visible = true;
    this.backdrop.style.display = 'flex';
    this.render();
  }

  private syncCustomFormFromSelectedTool(): void {
    this.customErrorEl.style.display = 'none';
    const tool = this.callbacks.getToolSlots()[this.editingToolIdx];
    const cfg = tool?.customConfig;
    if (!cfg) return;
    this.customNameInput.value = tool.name;
    this.customAmountInput.value = String(cfg.amount);
    this.mechWeightInput.value = String(cfg.mechWeight);
    if (cfg.mechExpr) this.mechTagSelect.value = cfg.mechExpr;
    this.thermoWeightInput.value = String(cfg.thermoWeight);
    if (cfg.thermoExpr) this.thermoTagSelect.value = cfg.thermoExpr;
    this.magicWeightInput.value = String(cfg.magicWeight);
    if (cfg.magicExpr) this.magicTagSelect.value = cfg.magicExpr;
    this.atmoTagSelect.value = cfg.atmoExpr ?? '';
  }

  public close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.backdrop.style.display = 'none';
    this.callbacks.onClose();
  }

  public toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  private applyCustomTool(): void {
    const cfg: CustomPulseConfig = {
      amount: Math.max(1, Number(this.customAmountInput.value) || 20),
      mechWeight: Math.max(0, Number(this.mechWeightInput.value) || 0),
      mechExpr: this.mechTagSelect.value,
      thermoWeight: Math.max(0, Number(this.thermoWeightInput.value) || 0),
      thermoExpr: this.thermoTagSelect.value,
      magicWeight: Math.max(0, Number(this.magicWeightInput.value) || 0),
      magicExpr: this.magicTagSelect.value,
      atmoExpr: this.atmoTagSelect.value || undefined,
    };
    const totalWeight = cfg.mechWeight + cfg.thermoWeight + cfg.magicWeight;
    if (totalWeight <= 0 && !cfg.atmoExpr) {
      this.customErrorEl.textContent = '请至少为 机械 / 热力 / 魔法 之一设置大于 0 的权重（或选择气场）';
      this.customErrorEl.style.display = 'block';
      return;
    }
    this.customErrorEl.style.display = 'none';
    const tool = createCustomTool(this.customNameInput.value, cfg);
    this.callbacks.onAssignToolSlot(this.editingToolIdx, tool);
    this.render();
  }

  public render(): void {
    if (!this.visible) return;

    const toolSlots = this.callbacks.getToolSlots();
    const blockSlots = this.callbacks.getBlockSlots();

    // Render tool slots T1..T6
    this.toolSlotListEl.innerHTML = '';
    toolSlots.forEach((tool, idx) => {
      const selected = idx === this.editingToolIdx;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = [
        'padding: 7px 6px',
        'border-radius: 8px',
        `border: 2px solid ${selected ? tool.accentColor : 'rgba(148,163,184,0.28)'}`,
        `background: ${selected ? 'rgba(51,65,85,0.95)' : 'rgba(15,23,42,0.75)'}`,
        'color: #f8fafc',
        'cursor: pointer',
        'text-align: left',
      ].join(';');
      btn.innerHTML = `
        <div style="font-size:11px; color:${tool.accentColor}; font-weight:800;">T${idx + 1} · ${this.esc(tool.name)}</div>
        <div style="font-size:10px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.esc(tool.tagLabel)}</div>
      `;
      btn.addEventListener('click', () => {
        this.editingToolIdx = idx;
        this.callbacks.onSelectToolSlot(idx);
        this.syncCustomFormFromSelectedTool();
        this.render();
      });
      this.toolSlotListEl.appendChild(btn);
    });

    // Render tool preset catalog
    this.toolCatalogEl.innerHTML = '';
    for (const preset of TOOL_CATALOG) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = [
        'padding: 6px',
        'border-radius: 6px',
        'border: 1px solid rgba(148,163,184,0.25)',
        'background: rgba(15,23,42,0.8)',
        'color: #e2e8f0',
        'cursor: pointer',
        'text-align: left',
      ].join(';');
      btn.innerHTML = `
        <div style="font-size:11px; font-weight:700; color:${preset.accentColor};">${this.esc(preset.name)}</div>
        <div style="font-size:10px; color:#94a3b8;">${this.esc(preset.tagLabel)}</div>
      `;
      btn.addEventListener('click', () => {
        this.callbacks.onAssignToolSlot(this.editingToolIdx, preset);
        this.render();
      });
      this.toolCatalogEl.appendChild(btn);
    }

    // Render block slots 1..8
    this.blockSlotListEl.innerHTML = '';
    blockSlots.forEach((protoId, idx) => {
      const opt = getBlockOption(protoId);
      const selected = idx === this.editingBlockIdx;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = [
        'padding: 7px 6px',
        'border-radius: 8px',
        `border: 2px solid ${selected ? opt.accentColor : 'rgba(148,163,184,0.28)'}`,
        `background: ${selected ? 'rgba(51,65,85,0.95)' : 'rgba(15,23,42,0.75)'}`,
        'color: #f8fafc',
        'cursor: pointer',
        'text-align: left',
      ].join(';');
      btn.innerHTML = `
        <div style="font-size:11px; color:${opt.accentColor}; font-weight:800;">${idx + 1} · ${this.esc(opt.name)}</div>
        <div style="font-size:10px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.esc(opt.protoId)}</div>
      `;
      btn.addEventListener('click', () => {
        this.editingBlockIdx = idx;
        this.callbacks.onSelectBlockSlot(idx + 1);
        this.render();
      });
      this.blockSlotListEl.appendChild(btn);
    });

    // Render block catalog grouped
    this.blockCatalogEl.innerHTML = '';
    const groups: Array<typeof BLOCK_CATALOG[number]['group']> = ['地形矿石', '木质机关', '流体植物', '生物与隔离料'];
    for (const grp of groups) {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div style="font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px;">${grp}</div>`;
      const grid = document.createElement('div');
      grid.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;';
      for (const opt of BLOCK_CATALOG.filter((b) => b.group === grp)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = [
          'padding: 5px 6px',
          'border-radius: 6px',
          'border: 1px solid rgba(148,163,184,0.25)',
          'background: rgba(15,23,42,0.8)',
          'color: #e2e8f0',
          'cursor: pointer',
          'text-align: left',
        ].join(';');
        btn.innerHTML = `
          <div style="font-size:11px; font-weight:700; color:${opt.accentColor};">${this.esc(opt.name)}</div>
          <div style="font-size:10px; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.esc(opt.protoId)}</div>
        `;
        btn.addEventListener('click', () => {
          this.callbacks.onAssignBlockSlot(this.editingBlockIdx, opt.protoId);
          this.render();
        });
        grid.appendChild(btn);
      }
      wrap.appendChild(grid);
      this.blockCatalogEl.appendChild(wrap);
    }
  }

  private makeBtn(text: string, bg: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = `padding:6px 10px; border-radius:7px; border:1px solid rgba(255,255,255,0.2); background:${bg}; color:#fff; font-size:12px; font-weight:600; cursor:pointer;`;
    b.addEventListener('click', onClick);
    return b;
  }

  private makeInput(placeholder: string, val: string): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = placeholder;
    inp.value = val;
    inp.style.cssText = 'padding:5px 8px; border-radius:6px; border:1px solid rgba(148,163,184,0.35); background:#0f172a; color:#f8fafc; font-size:12px;';
    return inp;
  }

  private makeNumberInput(label: string, val: string, min: string, max: string, step = '1'): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.title = label;
    inp.value = val;
    inp.min = min;
    inp.max = max;
    inp.step = step;
    inp.style.cssText = 'width:100%; padding:4px 6px; border-radius:6px; border:1px solid rgba(148,163,184,0.35); background:#0f172a; color:#f8fafc; font-size:12px;';
    return inp;
  }

  private makeSelect(options: Array<[string, string]>): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%; padding:4px 6px; border-radius:6px; border:1px solid rgba(148,163,184,0.35); background:#0f172a; color:#f8fafc; font-size:11px;';
    for (const [val, text] of options) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      sel.appendChild(opt);
    }
    return sel;
  }

  private makeRow(label: string, weightEl: HTMLElement, selectEl: HTMLElement): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display: grid; grid-template-columns: 78px 60px 1fr; gap: 6px; align-items: center;';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:11px; color:#cbd5e1; font-weight:600;';
    row.appendChild(lbl);
    row.appendChild(weightEl);
    row.appendChild(selectEl);
    return row;
  }

  private esc(s: string): string {
    return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  public dispose(): void {
    this.backdrop.remove();
  }
}
