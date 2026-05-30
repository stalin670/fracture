/* FRACTURE — game.js
 * Orchestrator: fixed-timestep loop, fire propagation, destruction processing,
 * explosion FX, input (pointer/keyboard/wheel), procedural maps, minimap, HUD.
 */
'use strict';

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.cam = new Camera(canvas);
    this.world = new World({ gravity: 980 });
    this.liquid = new Liquid({ max: 1300 });
    this.particles = new ParticleSystem(5000);
    this.renderer = new Renderer(canvas, this.cam);
    this.tools = new ToolController(this);

    this.acc = 0;
    this.fixed = 1 / 120;
    this.invDt = 1 / this.fixed;
    this.lastT = performance.now();
    this.fps = 60; this._fpsAcc = 0; this._fpsN = 0;

    this.burning = new Set();
    this.toastMsg = ''; this.toastT = 0;
    this.panKeys = {};
    this.paused = false;
    this.showMinimap = true;
    this.lastVehicle = null;
    this.substeps = 1;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._bindInput();
    this.loadMap('demolition');
    this.cam.pos.set(400, 350);
    this.cam.targetZoom = 0.8; this.cam.zoom = 0.8;
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.dpr = dpr;
  }

  toast(msg) { this.toastMsg = msg; this.toastT = 2; }

  // ---------- input ----------
  _bindInput() {
    const c = this.canvas;
    const getPos = (e) => {
      const t = e.touches ? e.touches[0] : e;
      return new Vec2(t.clientX * this.dpr, t.clientY * this.dpr);
    };
    let panning = false, panStart = null, camStart = null;

    const down = (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        panning = true; panStart = getPos(e); camStart = this.cam.pos.clone();
        e.preventDefault(); return;
      }
      const w = this.cam.screenToWorld(getPos(e).x, getPos(e).y);
      this.tools.down(w, e);
    };
    const move = (e) => {
      const sp = getPos(e);
      if (panning) {
        const d = sp.sub(panStart).div(this.cam.zoom);
        this.cam.pos.copy(camStart.sub(d));
        return;
      }
      const w = this.cam.screenToWorld(sp.x, sp.y);
      this.tools.move(w);
    };
    const up = (e) => {
      if (panning) { panning = false; return; }
      const sp = getPos(e);
      const w = this.cam.screenToWorld(sp.x, sp.y);
      this.tools.up(w);
    };

    c.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('touchstart', e => { e.preventDefault(); down(e.touches[0]); }, { passive: false });
    c.addEventListener('touchmove', e => { e.preventDefault(); move(e.touches[0]); }, { passive: false });
    c.addEventListener('touchend', e => { e.preventDefault(); up(e.changedTouches[0]); }, { passive: false });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.cam.zoomAt(e.clientX * this.dpr, e.clientY * this.dpr, f);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      this.panKeys[e.key.toLowerCase()] = true;
      this._hotkey(e);
    });
    window.addEventListener('keyup', (e) => { this.panKeys[e.key.toLowerCase()] = false; });
  }

  _hotkey(e) {
    const k = e.key.toLowerCase();
    const map = { '1': 'drag', '2': 'spawn', '3': 'delete', '4': 'explode', '5': 'fire', '6': 'water', '7': 'rope', '8': 'weld', '9': 'weapon' };
    if (map[k]) { this.tools.setTool(map[k]); if (window.UI) UI.syncTool(); return; }
    if (k === ' ') { e.preventDefault(); this.togglePause(); }
    if (k === 'f') this.freezeAll();
    if (k === 'r') this.clearDynamic();
    if (k === 'm') this.showMinimap = !this.showMinimap;
    if (k === '[') { this.world.timeScale = M.clamp(this.world.timeScale * 0.6, 0.05, 3); if (window.UI) UI.syncTime(); }
    if (k === ']') { this.world.timeScale = M.clamp(this.world.timeScale * 1.6, 0.05, 3); if (window.UI) UI.syncTime(); }
  }

  togglePause() { this.world.paused = !this.world.paused; if (window.UI) UI.syncPause(); }
  freezeAll() {
    const anyUnfrozen = this.world.bodies.some(b => b.invMass > 0 && !b.frozen);
    for (const b of this.world.bodies) if (b.invMass > 0) { b.frozen = anyUnfrozen; if (anyUnfrozen) { b.velocity.set(0, 0); b.angularVelocity = 0; } else b.wake(); }
    this.toast(anyUnfrozen ? 'Physics frozen' : 'Physics released');
  }
  clearDynamic() {
    this.world.bodies = this.world.bodies.filter(b => b.invMass === 0);
    this.world.constraints = [];
    this.liquid.px.length = 0; this.liquid.py.length = 0; this.liquid.vx.length = 0; this.liquid.vy.length = 0; this.liquid.opx.length = 0; this.liquid.opy.length = 0; this.liquid.hue.length = 0;
    this.burning.clear();
    this.toast('Cleared');
  }

  // ---------- maps ----------
  _ground() {
    const g = makeBox(400, 660, 6000, 120, { material: 'stone', isStatic: true });
    g.hue = 220; g.sat = 12; g.light = 26;
    this.world.add(g);
  }
  loadMap(name) {
    this.world.clear(); this.burning.clear();
    this.liquid.px.length = 0; this.liquid.py.length = 0; this.liquid.vx.length = 0; this.liquid.vy.length = 0; this.liquid.opx.length = 0; this.liquid.opy.length = 0; this.liquid.hue.length = 0;
    this._ground();
    if (name === 'demolition') {
      Entities.tower(this.world, 300, 600, 7, 'stone');
      Entities.wall(this.world, 540, 600, 6, 7, 46, 24, 'wood');
      Entities.pyramid(this.world, 900, 600, 7, 'stone');
      for (let i = 0; i < 3; i++) this.world.add(Object.assign(makeBox(560 + i * 80, 200, 30, 30, { material: 'tnt' })));
    } else if (name === 'ragdoll') {
      for (let i = 0; i < 5; i++) Entities.ragdoll(this.world, 200 + i * 130, 300, M.rand(0.9, 1.3));
      Entities.wall(this.world, 700, 600, 5, 8, 46, 24, 'glass');
    } else if (name === 'pool') {
      const lW = makeBox(120, 560, 24, 200, { material: 'stone', isStatic: true });
      const rW = makeBox(900, 560, 24, 200, { material: 'stone', isStatic: true });
      this.world.add(lW); this.world.add(rW);
      for (let i = 0; i < 900; i++) this.liquid.add(M.rand(150, 870), M.rand(420, 600), 0, 0, 200 + M.rand(-12, 14));
      Entities.wall(this.world, 300, 380, 4, 4, 46, 24, 'wood');
    } else if (name === 'cannon') {
      Entities.tower(this.world, 700, 600, 9, 'metal');
      Entities.pyramid(this.world, 1000, 600, 6, 'stone');
      this.world.add(makeBox(720, 120, 36, 36, { material: 'tnt' }));
    } else if (name === 'sandbox') {
      // empty
    }
  }

  onExplosion(pos, radius, power, hue) {
    this.cam.addShake(M.clamp(power / 28, 6, 40));
    this.renderer.addShockwave(pos.x, pos.y, radius, hue);
    this.renderer.addLight(pos.x, pos.y, radius * 1.6, hue, 0.9);
    this.particles.burst(pos.x, pos.y, 60, { hue, hueVar: 18, spdMax: radius * 2.4, lifeMax: 0.9, sizeMax: 5, type: 2 });
    this.particles.burst(pos.x, pos.y, 26, { hue: 0, sat: 0, lum: 22, spdMax: radius * 0.7, lifeMax: 1.8, sizeMax: 16, type: 1, grav: -0.4 });
  }

  // ---------- fire ----------
  _updateFire(dt) {
    // collect currently burning
    this.burning.clear();
    for (const b of this.world.bodies) if (b.burning > 0.02) this.burning.add(b);

    for (const b of this.burning) {
      b.burning = Math.min(b.burning + dt * 0.25 * b.flammable, 1);
      b.charred = Math.min(b.charred + dt * 0.3, 1);
      // fire particles
      if (Math.random() < 0.9) {
        const r = b.boundRadius();
        const ox = M.rand(-r, r) * 0.7, oy = M.rand(-r, r) * 0.7;
        this.particles.spawn({
          x: b.position.x + ox, y: b.position.y + oy,
          vx: M.rand(-30, 30), vy: M.rand(-120, -50),
          life: M.rand(0.3, 0.7), size: M.rand(2, 5),
          hue: 20 + M.rand(0, 24), sat: 95, lum: 60, type: 2, grav: -0.5,
        });
      }
      if (Math.random() < 0.25) {
        this.particles.spawn({
          x: b.position.x, y: b.position.y - 6,
          vx: M.rand(-12, 12), vy: M.rand(-50, -20),
          life: M.rand(1, 2), size: M.rand(6, 12),
          hue: 0, sat: 0, lum: 20, type: 1, grav: -0.5,
        });
      }
      // burn damage
      if (b.damage(dt * 9 * b.burning)) {
        this.world.queueDestroy(b, b.position, 120);
      }
      // explosive cook-off
      if (b.explosive && (b.burning > 0.7)) {
        this.world.queueDestroy(b, b.position, 600);
      }
      // spread
      this._spreadFire(b, dt);
    }
  }

  _spreadFire(b, dt) {
    if (Math.random() > dt * 4) return;
    const cs = this.world.cell;
    const cx = Math.floor(b.position.x / cs), cy = Math.floor(b.position.y / cs);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const arr = this.world.grid.get(this.world._key(cx + ox, cy + oy));
      if (!arr) continue;
      for (const o of arr) {
        if (o === b || o.flammable <= 0 || o.burning > 0.1) continue;
        const d = o.position.sub(b.position).len();
        if (d < o.boundRadius() + b.boundRadius() + 28 && Math.random() < o.flammable * 0.5) {
          o.burning = 0.3;
        }
      }
    }
  }

  // ---------- destruction ----------
  _processDestruction() {
    const q = this.world.destroyQueue;
    if (q.length === 0) return;
    this.world.destroyQueue = [];
    for (const { body, point, force } of q) {
      if (this.world.bodies.indexOf(body) < 0) continue;
      // FX
      this.particles.burst(point.x, point.y, 16, { hue: body.hue, sat: body.sat, lum: body.light, spdMax: 240, lifeMax: 0.7, sizeMax: 4, type: 3 });
      this.cam.addShake(M.clamp(force / 90, 1, 12));
      if (body.matName === 'glass') this.particles.burst(point.x, point.y, 20, { hue: 175, sat: 60, lum: 85, spdMax: 320, lifeMax: 0.6, type: 0 });

      if (body.explosive) {
        this.world.explode(body.position, 240, 680, { hue: 12 });
        this.onExplosion(body.position, 240, 680, 14);
      }
      const shards = Destruction.shatter(body, point, force);
      this.world.remove(body);
      for (const s of shards) this.world.add(s);
    }
  }

  // ---------- main loop ----------
  frame(now) {
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.05) dt = 0.05;

    // fps
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }

    // camera pan via keys
    const ps = 600 / this.cam.zoom * dt;
    if (this.panKeys['w'] || this.panKeys['arrowup']) {}
    if (this.panKeys['a']) this.cam.pos.x -= ps;
    if (this.panKeys['d']) this.cam.pos.x += ps;
    if (this.panKeys['w']) this.cam.pos.y -= ps;
    if (this.panKeys['s']) this.cam.pos.y += ps;
    // vehicle drive
    if (this.lastVehicle) {
      if (this.panKeys['arrowleft']) Entities.driveVehicle(this.lastVehicle, -1, dt);
      if (this.panKeys['arrowright']) Entities.driveVehicle(this.lastVehicle, 1, dt);
    }

    // fixed-step physics
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.fixed && steps < 5) {
      this.world.step(this.fixed);
      this.liquid.step(this.fixed, this.world.gravity.y * this.world.timeScale, this.world);
      this.acc -= this.fixed;
      steps++;
    }
    if (steps === 5) this.acc = 0; // avoid spiral

    this.tools.update(dt);
    this._updateFire(dt * this.world.timeScale);
    this._processDestruction();
    this.particles.update(dt * this.world.timeScale, this.world.gravity.y);
    this.cam.update(dt);
    this.renderer.updateFX(dt);

    if (this.toastT > 0) this.toastT -= dt;

    this._render();
    requestAnimationFrame((t) => this.frame(t));
  }

  _render() {
    const r = this.renderer, ctx = this.renderer.ctx;
    r.clear();
    this.cam.apply(ctx);
    r.drawGrid();
    r.drawBounds(this.world);
    r.drawLiquid(this.liquid);

    // cull to view
    const vb = this.cam.viewBounds();
    for (const b of this.world.bodies) {
      if (b.aabb.max.x < vb.minx || b.aabb.min.x > vb.maxx || b.aabb.max.y < vb.miny || b.aabb.min.y > vb.maxy) continue;
      r.drawBody(b);
    }
    for (const c of this.world.constraints) r.drawConstraint(c);
    r.drawParticles(this.particles);
    this.tools.drawPreview(ctx);
    r.drawLights();
    r.vignette();
    this._drawHUD();
    if (this.showMinimap) this._drawMinimap();
  }

  _drawHUD() {
    const ctx = this.renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${13 * this.dpr}px 'Segoe UI', sans-serif`;
    ctx.textBaseline = 'top';
    const pad = 12 * this.dpr;
    // toast
    if (this.toastT > 0) {
      const a = M.clamp(this.toastT, 0, 1);
      ctx.fillStyle = `rgba(120,200,255,${a})`;
      ctx.font = `${20 * this.dpr}px 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(this.toastMsg, this.canvas.width / 2, this.canvas.height - 80 * this.dpr);
      ctx.textAlign = 'left';
    }
  }

  stats() {
    return {
      bodies: this.world.bodies.length,
      liquid: this.liquid.count,
      particles: this.particles.count,
      fps: Math.round(this.fps),
      contacts: this.world.contacts.length,
      timeScale: this.world.timeScale,
      paused: this.world.paused,
    };
  }

  _drawMinimap() {
    const ctx = this.renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = 180 * this.dpr, H = 110 * this.dpr;
    const x = this.canvas.width - W - 14 * this.dpr, y = this.canvas.height - H - 14 * this.dpr;
    ctx.fillStyle = 'rgba(10,14,28,0.7)';
    ctx.strokeStyle = 'rgba(90,170,255,0.5)';
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.beginPath(); ctx.roundRect(x, y, W, H, 8 * this.dpr); ctx.fill(); ctx.stroke();
    // world region
    const wx0 = -200, wy0 = 0, wx1 = 1200, wy1 = 720;
    const sx = W / (wx1 - wx0), sy = H / (wy1 - wy0);
    const tx = (wx) => x + (wx - wx0) * sx;
    const ty = (wy) => y + (wy - wy0) * sy;
    for (const b of this.world.bodies) {
      ctx.fillStyle = b.burning > 0.1 ? '#ff7a2a' : (b.isStatic ? 'rgba(120,140,180,0.7)' : hsl(b.hue, b.sat, b.light, 0.9));
      const px = tx(b.position.x), py = ty(b.position.y);
      if (px < x || px > x + W || py < y || py > y + H) continue;
      ctx.fillRect(px - 1, py - 1, 2.5 * this.dpr, 2.5 * this.dpr);
    }
    // view rect
    const vb = this.cam.viewBounds();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1 * this.dpr;
    ctx.strokeRect(tx(vb.minx), ty(vb.miny), (vb.maxx - vb.minx) * sx, (vb.maxy - vb.miny) * sy);
  }

  start() { requestAnimationFrame((t) => { this.lastT = t; this.frame(t); }); }
}
