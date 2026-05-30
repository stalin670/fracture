/* FRACTURE — tools.js
 * Interaction tools. Each tool handles pointer down/move/up in world space and
 * an optional preview render. The active spawn shape/material is shared state.
 */
'use strict';

const TOOL_LIST = [
  { id: 'drag',    name: 'Grab',     icon: '✊', hint: 'Drag bodies. Fling to throw.' },
  { id: 'spawn',   name: 'Spawn',    icon: '✚', hint: 'Click to drop. Drag for slingshot launch.' },
  { id: 'delete',  name: 'Delete',   icon: '✕', hint: 'Click/drag over bodies to remove.' },
  { id: 'explode', name: 'Explosion',icon: '💥', hint: 'Click to detonate a blast.' },
  { id: 'fire',    name: 'Fire',     icon: '🔥', hint: 'Ignite flammable objects / spray flame.' },
  { id: 'water',   name: 'Water',    icon: '💧', hint: 'Hold to pour liquid.' },
  { id: 'rope',    name: 'Rope',     icon: '🔗', hint: 'Click two bodies to link them.' },
  { id: 'weld',    name: 'Weld',     icon: '🛠', hint: 'Rigidly bolt two bodies together.' },
  { id: 'weapon',  name: 'Blaster',  icon: '🔫', hint: 'Click-drag to aim, release to fire.' },
  { id: 'ragdoll', name: 'Ragdoll',  icon: '🧍', hint: 'Click to drop a humanoid.' },
  { id: 'vehicle', name: 'Vehicle',  icon: '🚗', hint: 'Click to spawn a drivable car.' },
];

const SPAWN_SHAPES = ['box', 'circle', 'triangle', 'hexagon', 'plank'];
const SPAWN_MATERIALS = ['wood', 'stone', 'metal', 'ice', 'rubber', 'flesh', 'glass', 'tnt'];

class ToolController {
  constructor(game) {
    this.game = game;
    this.tool = 'drag';
    this.shape = 'box';
    this.material = 'wood';
    this.spawnSize = 34;
    this.brushDown = false;
    this.start = null;
    this.cur = null;
    this.dragConstraint = null;
    this.dragBody = null;
    this.lastDragPos = null;
    this.dragVel = new Vec2();
    this.ropeFirst = null;
  }

  setTool(t) {
    this.tool = t;
    this.ropeFirst = null;
    this._releaseDrag();
  }

  _releaseDrag() {
    if (this.dragConstraint) {
      const g = this.game;
      const idx = g.world.constraints.indexOf(this.dragConstraint);
      if (idx >= 0) g.world.constraints.splice(idx, 1);
      if (this.dragBody) this.dragBody.velocity.copy(this.dragVel.mul(1.1));
      this.dragConstraint = null;
      g.world.remove(this._dragAnchor);
      this._dragAnchor = null;
      this.dragBody = null;
    }
  }

  down(p, ev) {
    this.brushDown = true;
    this.start = p.clone();
    this.cur = p.clone();
    const g = this.game;
    switch (this.tool) {
      case 'drag': {
        const b = g.world.queryPoint(p);
        if (b && b.invMass > 0) {
          this.dragBody = b; b.wake(); b.frozen = false;
          this._dragAnchor = makeCircle(p.x, p.y, 1, { isStatic: true });
          g.world.add(this._dragAnchor);
          const local = p.sub(b.position).rotate(-b.angle);
          this.dragConstraint = new Constraint(this._dragAnchor, b, new Vec2(0, 0), local,
            { length: 0, stiffness: 0.35, maxForce: Infinity, render: false });
          g.world.addConstraint(this.dragConstraint);
          this.lastDragPos = p.clone();
        }
        break;
      }
      case 'delete': this._deleteAt(p); break;
      case 'explode':
        g.world.explode(p, 200, 520, { hue: 25 });
        g.onExplosion(p, 200, 520, 25);
        break;
      case 'fire': this._fireAt(p); break;
      case 'rope':
      case 'weld': this._linkClick(p, this.tool === 'weld'); break;
      case 'ragdoll': Entities.ragdoll(g.world, p.x, p.y, M.rand(0.9, 1.25)); g.toast('Ragdoll dropped'); break;
      case 'vehicle': g.lastVehicle = Entities.vehicle(g.world, p.x, p.y); g.toast('Vehicle spawned — drive with ← →'); break;
    }
  }

  move(p) {
    this.cur = p.clone();
    if (!this.brushDown) return;
    const g = this.game;
    if (this.tool === 'drag' && this._dragAnchor) {
      this.dragVel = p.sub(this.lastDragPos).mul(26);
      this.lastDragPos = p.clone();
      this._dragAnchor.position.copy(p);
    } else if (this.tool === 'delete') {
      this._deleteAt(p);
    } else if (this.tool === 'water') {
      // handled continuously in update via isWaterPouring
    } else if (this.tool === 'fire') {
      this._fireAt(p);
    }
  }

  up(p) {
    this.brushDown = false;
    const g = this.game;
    if (this.tool === 'drag') { this._releaseDrag(); return; }
    if (this.tool === 'spawn') {
      const drag = this.start.sub(p);
      const launch = drag.mul(3.2);
      const b = this._spawnBody(this.start);
      if (b) {
        if (drag.len() > 14) b.velocity.copy(launch);
        g.toast(`${this.material} ${this.shape}`);
      }
    } else if (this.tool === 'weapon') {
      this._fireWeapon(this.start, p);
    }
    this.start = null;
  }

  // continuous: called each frame while pointer held
  update(dt) {
    const g = this.game;
    if (this.tool === 'water' && this.brushDown && this.cur) {
      const hue = 200;
      for (let i = 0; i < 4; i++) {
        g.liquid.add(this.cur.x + M.rand(-6, 6), this.cur.y + M.rand(-6, 6),
          M.rand(-30, 30), M.rand(20, 80), hue + M.rand(-10, 10));
      }
    }
  }

  _spawnBody(p) {
    const g = this.game;
    const s = this.spawnSize;
    const opt = { material: this.material };
    let b = null;
    switch (this.shape) {
      case 'box': b = makeBox(p.x, p.y, s, s, opt); break;
      case 'plank': b = makeBox(p.x, p.y, s * 2.6, s * 0.5, opt); break;
      case 'circle': b = makeCircle(p.x, p.y, s * 0.55, opt); break;
      case 'triangle': b = makePoly(p.x, p.y, 3, s * 0.7, Object.assign({ angleOffset: -Math.PI / 2 }, opt)); break;
      case 'hexagon': b = makePoly(p.x, p.y, 6, s * 0.62, opt); break;
    }
    if (b) g.world.add(b);
    return b;
  }

  _deleteAt(p) {
    const g = this.game;
    const b = g.world.queryPoint(p);
    if (b) {
      g.particles.burst(b.position.x, b.position.y, 10, { hue: b.hue, sat: b.sat, spdMax: 160, lifeMax: 0.5, type: 4 });
      g.world.remove(b);
    }
  }

  _fireAt(p) {
    const g = this.game;
    const b = g.world.queryPoint(p);
    if (b && b.flammable > 0) { b.burning = Math.max(b.burning, 0.8); b.wake(); }
    g.particles.burst(p.x, p.y, 5, { hue: 26, hueVar: 14, spdMax: 90, vy: -60, lifeMax: 0.5, type: 2, grav: -0.3 });
  }

  _linkClick(p, rigid) {
    const g = this.game;
    const b = g.world.queryPoint(p);
    if (!b) { this.ropeFirst = null; return; }
    if (!this.ropeFirst) {
      this.ropeFirst = { body: b, anchor: p.sub(b.position).rotate(-b.angle) };
      g.toast(rigid ? 'Weld: pick second body' : 'Rope: pick second body');
    } else {
      const a = this.ropeFirst;
      if (a.body === b) { this.ropeFirst = null; return; }
      const anchorB = p.sub(b.position).rotate(-b.angle);
      const len = b.position.add(anchorB.rotate(b.angle)).sub(a.body.position.add(a.anchor.rotate(a.body.angle))).len();
      const c = new Constraint(a.body, b, a.anchor, anchorB, {
        length: rigid ? len : len, stiffness: rigid ? 1 : 0.8,
        maxForce: rigid ? 26000 : 14000, isRope: !rigid, hue: rigid ? 50 : 190,
      });
      g.world.addConstraint(c);
      this.ropeFirst = null;
      g.toast(rigid ? 'Welded' : 'Roped');
    }
  }

  _fireWeapon(from, to) {
    const g = this.game;
    const dir = to.sub(from).normalize();
    if (dir.lenSq() < 0.01) dir.set(1, 0);
    const muzzle = from.add(dir.mul(20));
    const proj = makeCircle(muzzle.x, muzzle.y, 6, { material: 'metal', healthScale: 3 });
    proj.hue = 50; proj.sat = 90; proj.light = 65;
    proj.velocity = dir.mul(2600);
    proj.isProjectile = true;
    g.world.add(proj);
    g.cam.addShake(6);
    g.particles.burst(muzzle.x, muzzle.y, 14, { hue: 48, spdMax: 360, vx: dir.x * 200, vy: dir.y * 200, lifeMax: 0.4 });
    g.renderer.addShockwave(muzzle.x, muzzle.y, 40, 48);
  }

  drawPreview(ctx) {
    const g = this.game;
    if (this.tool === 'spawn' && this.cur) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      const s = this.spawnSize;
      ctx.strokeStyle = hsl(MATERIALS[this.material].hue, 70, 70);
      ctx.lineWidth = 2 / g.cam.zoom;
      ctx.beginPath();
      if (this.shape === 'circle') ctx.arc(this.cur.x, this.cur.y, s * 0.55, 0, M.TAU);
      else ctx.rect(this.cur.x - s / 2, this.cur.y - (this.shape === 'plank' ? s * 0.25 : s / 2),
        this.shape === 'plank' ? s * 2.6 : s, this.shape === 'plank' ? s * 0.5 : s);
      ctx.stroke();
      if (this.brushDown && this.start) {
        ctx.beginPath();
        ctx.moveTo(this.start.x, this.start.y);
        ctx.lineTo(this.cur.x, this.cur.y);
        ctx.strokeStyle = hsl(50, 90, 60);
        ctx.stroke();
      }
      ctx.restore();
    }
    if ((this.tool === 'explode') && this.cur) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = hsl(25, 90, 60);
      ctx.lineWidth = 2 / g.cam.zoom;
      ctx.beginPath(); ctx.arc(this.cur.x, this.cur.y, 200, 0, M.TAU); ctx.stroke();
      ctx.restore();
    }
    if (this.tool === 'weapon' && this.brushDown && this.start && this.cur) {
      ctx.save();
      ctx.strokeStyle = hsl(50, 90, 65); ctx.lineWidth = 2 / g.cam.zoom;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(this.start.x, this.start.y); ctx.lineTo(this.cur.x, this.cur.y); ctx.stroke();
      ctx.restore();
    }
    if ((this.tool === 'rope' || this.tool === 'weld') && this.ropeFirst && this.cur) {
      const a = this.ropeFirst.body.position.add(this.ropeFirst.anchor.rotate(this.ropeFirst.body.angle));
      ctx.save();
      ctx.strokeStyle = hsl(this.tool === 'weld' ? 50 : 190, 80, 60, 0.6);
      ctx.lineWidth = 2 / g.cam.zoom;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(this.cur.x, this.cur.y); ctx.stroke();
      ctx.restore();
    }
  }
}
