/* FRACTURE — ui.js : builds and wires the DOM control surface around the game */
'use strict';

const UI = {
  game: null,

  init(game) {
    this.game = game;
    this._buildTools();
    this._buildSpawnPanel();
    this._buildTopbar();
    this._buildSaveLoad();
    this._bindButtons();
    this.syncTool();
    this.syncTime();
    setInterval(() => this._updateStats(), 250);
  },

  el(id) { return document.getElementById(id); },

  _buildTools() {
    const wrap = this.el('toolbar');
    TOOL_LIST.forEach(t => {
      const b = document.createElement('button');
      b.className = 'tool-btn';
      b.dataset.tool = t.id;
      b.innerHTML = `<span class="ic">${t.icon}</span><span class="lbl">${t.name}</span>`;
      b.title = t.hint;
      b.onclick = () => { this.game.tools.setTool(t.id); this.syncTool(); this.game.toast(t.hint); };
      wrap.appendChild(b);
    });
  },

  _buildSpawnPanel() {
    const shapes = this.el('shapeRow');
    SPAWN_SHAPES.forEach(s => {
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = s; b.dataset.shape = s;
      b.onclick = () => { this.game.tools.shape = s; this.game.tools.setTool('spawn'); this._syncSpawn(); this.syncTool(); };
      shapes.appendChild(b);
    });
    const mats = this.el('matRow');
    SPAWN_MATERIALS.forEach(m => {
      const mt = MATERIALS[m];
      const b = document.createElement('button');
      b.className = 'swatch'; b.dataset.mat = m;
      b.style.background = hsl(mt.hue, mt.sat, mt.light);
      b.title = m;
      const lbl = document.createElement('span'); lbl.textContent = m; lbl.className = 'sw-lbl';
      b.appendChild(lbl);
      b.onclick = () => { this.game.tools.material = m; this.game.tools.setTool('spawn'); this._syncSpawn(); this.syncTool(); };
      mats.appendChild(b);
    });
    const size = this.el('sizeSlider');
    size.oninput = () => { this.game.tools.spawnSize = +size.value; this.el('sizeVal').textContent = size.value; };
    this._syncSpawn();
  },

  _syncSpawn() {
    const g = this.game;
    document.querySelectorAll('#shapeRow .chip').forEach(c => c.classList.toggle('active', c.dataset.shape === g.tools.shape));
    document.querySelectorAll('#matRow .swatch').forEach(c => c.classList.toggle('active', c.dataset.mat === g.tools.material));
  },

  _buildTopbar() {
    const sel = this.el('mapSelect');
    [['demolition', 'Demolition Yard'], ['ragdoll', 'Ragdoll Arena'], ['pool', 'Liquid Pool'], ['cannon', 'Siege Range'], ['sandbox', 'Empty Sandbox']]
      .forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); });
    sel.onchange = () => { this.game.loadMap(sel.value); this.game.toast('Loaded: ' + sel.options[sel.selectedIndex].text); };
  },

  _buildSaveLoad() {
    this._refreshSlots();
  },
  _refreshSlots() {
    const sel = this.el('slotSelect');
    if (!sel) return;
    sel.innerHTML = '';
    const all = Storage.list();
    const names = Object.keys(all);
    if (names.length === 0) { const o = document.createElement('option'); o.textContent = '(no saves)'; o.value = ''; sel.appendChild(o); }
    names.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  },

  _bindButtons() {
    const g = this.game;
    this.el('btnPause').onclick = () => g.togglePause();
    this.el('btnFreeze').onclick = () => g.freezeAll();
    this.el('btnClear').onclick = () => g.clearDynamic();
    this.el('btnSlow').onclick = () => { g.world.timeScale = M.clamp(g.world.timeScale * 0.6, 0.05, 3); this.syncTime(); };
    this.el('btnFast').onclick = () => { g.world.timeScale = M.clamp(g.world.timeScale * 1.6, 0.05, 3); this.syncTime(); };
    this.el('btnNormal').onclick = () => { g.world.timeScale = 1; this.syncTime(); };
    this.el('btnSave').onclick = () => {
      const name = this.el('saveName').value.trim() || ('sandbox ' + (Object.keys(Storage.list()).length + 1));
      Storage.saveSlot(name, g.world, g.liquid); this._refreshSlots(); g.toast('Saved: ' + name);
    };
    this.el('btnLoad').onclick = () => {
      const n = this.el('slotSelect').value;
      if (n && Storage.loadSlot(n, g.world, g.liquid)) g.toast('Loaded: ' + n);
    };
    this.el('btnDelSlot').onclick = () => {
      const n = this.el('slotSelect').value;
      if (n) { Storage.deleteSlot(n); this._refreshSlots(); g.toast('Deleted save'); }
    };
    this.el('btnHelp').onclick = () => this.el('helpModal').classList.toggle('show');
    this.el('helpClose').onclick = () => this.el('helpModal').classList.remove('show');
    this.el('btnMinimap').onclick = () => { g.showMinimap = !g.showMinimap; };
    // gravity slider
    const grav = this.el('gravSlider');
    grav.oninput = () => { g.world.gravity.y = +grav.value; this.el('gravVal').textContent = grav.value; };
  },

  syncTool() {
    const g = this.game;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === g.tools.tool));
    const spawnPanel = this.el('spawnPanel');
    spawnPanel.style.display = g.tools.tool === 'spawn' ? 'block' : 'none';
    this._syncSpawn();
  },
  syncTime() {
    this.el('timeVal').textContent = this.game.world.timeScale.toFixed(2) + '×';
  },
  syncPause() {
    const b = this.el('btnPause');
    b.classList.toggle('active', this.game.world.paused);
    b.querySelector('.lbl').textContent = this.game.world.paused ? 'Resume' : 'Pause';
  },

  _updateStats() {
    const s = this.game.stats();
    const e = this.el('stats');
    if (!e) return;
    e.innerHTML =
      `<b>${s.fps}</b> fps &nbsp; <b>${s.bodies}</b> bodies &nbsp; <b>${s.liquid}</b> fluid &nbsp; <b>${s.particles}</b> fx &nbsp; <b>${s.contacts}</b> contacts`;
  },
};
