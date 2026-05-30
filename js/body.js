/* FRACTURE — body.js
 * Rigid body: convex polygon or circle. Mass/inertia from area + density.
 * Materials define density, restitution, friction, health, color, flammability.
 */
'use strict';

const MATERIALS = {
  wood:   { density: 0.55, rest: 0.18, fric: 0.55, health: 40,  hue: 28,  sat: 55, light: 42, flam: 0.9,  metal: false },
  stone:  { density: 2.4,  rest: 0.10, fric: 0.75, health: 120, hue: 220, sat: 8,  light: 55, flam: 0,    metal: false },
  metal:  { density: 4.2,  rest: 0.22, fric: 0.45, health: 260, hue: 200, sat: 12, light: 70, flam: 0,    metal: true  },
  ice:    { density: 0.92, rest: 0.05, fric: 0.06, health: 30,  hue: 190, sat: 70, light: 78, flam: 0,    metal: false },
  rubber: { density: 1.1,  rest: 0.85, fric: 0.9,  health: 60,  hue: 320, sat: 60, light: 50, flam: 0.4,  metal: false },
  flesh:  { density: 1.05, rest: 0.12, fric: 0.7,  health: 50,  hue: 12,  sat: 55, light: 58, flam: 0.7,  metal: false },
  sand:   { density: 1.6,  rest: 0.02, fric: 0.85, health: 8,   hue: 45,  sat: 55, light: 60, flam: 0,    metal: false },
  glass:  { density: 1.5,  rest: 0.05, fric: 0.3,  health: 14,  hue: 175, sat: 50, light: 80, flam: 0,    metal: false },
  tnt:    { density: 1.2,  rest: 0.2,  fric: 0.6,  health: 18,  hue: 0,   sat: 80, light: 48, flam: 1,    metal: false, explosive: true },
};

let __bodyId = 1;

class Body {
  constructor(opts) {
    this.id = __bodyId++;
    this.type = opts.type;                 // 'circle' | 'polygon'
    this.position = opts.position.clone();
    this.velocity = new Vec2();
    this.force = new Vec2();
    this.angle = opts.angle || 0;
    this.angularVelocity = 0;
    this.torque = 0;

    this.matName = opts.material || 'wood';
    const mat = MATERIALS[this.matName];
    this.restitution = mat.rest;
    this.friction = mat.fric;
    this.flammable = mat.flam;
    this.explosive = !!mat.explosive;
    this.metal = mat.metal;

    this.radius = opts.radius || 0;
    this.vertices = opts.vertices || null; // local-space CCW for polygon
    this.normals = null;

    this.color = opts.color || hsl(mat.hue, mat.sat, mat.light);
    this.hue = mat.hue; this.sat = mat.sat; this.light = mat.light;

    this.isStatic = !!opts.isStatic;
    this.frozen = false;                   // user freeze
    this.sleeping = false;
    this.sleepTimer = 0;

    // destruction
    this.maxHealth = mat.health * (opts.healthScale || 1);
    this.health = this.maxHealth;
    this.destructible = opts.destructible !== false && !this.isStatic;
    this.generation = opts.generation || 0;

    // fire
    this.burning = 0;                      // 0..1 intensity
    this.charred = 0;

    if (this.type === 'polygon') this._buildPolygon();
    this._computeMass(mat.density);

    this.aabb = { min: new Vec2(), max: new Vec2() };
    this.updateAABB();
    this.gridCells = [];
  }

  _buildPolygon() {
    // ensure CCW + compute face normals
    let area = 0;
    const v = this.vertices;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      area += a.cross(b);
    }
    if (area < 0) v.reverse();
    this.normals = [];
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      const edge = b.sub(a);
      this.normals.push(new Vec2(edge.y, -edge.x).normalize());
    }
  }

  _computeMass(density) {
    if (this.isStatic) {
      this.mass = 0; this.invMass = 0; this.inertia = 0; this.invInertia = 0;
      return;
    }
    if (this.type === 'circle') {
      const r = this.radius;
      this.mass = density * Math.PI * r * r * 0.01;
      this.inertia = this.mass * r * r * 0.5;
    } else {
      const v = this.vertices;
      let area = 0, I = 0;
      const ref = new Vec2();
      for (let i = 0; i < v.length; i++) {
        const p1 = v[i].sub(ref), p2 = v[(i + 1) % v.length].sub(ref);
        const cross = p1.cross(p2);
        area += cross * 0.5;
        I += cross * (p1.lenSq() + p1.dot(p2) + p2.lenSq());
      }
      area = Math.abs(area);
      this.mass = density * area * 0.01;
      this.inertia = (density * 0.01) * I / 12;
      this.inertia = Math.abs(this.inertia);
    }
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.invInertia = this.inertia > 0 ? 1 / this.inertia : 0;
  }

  // world-space vertices (cached per step)
  worldVerts() {
    const out = [];
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    for (const lv of this.vertices) {
      out.push(new Vec2(
        this.position.x + lv.x * c - lv.y * s,
        this.position.y + lv.x * s + lv.y * c
      ));
    }
    return out;
  }
  worldNormals() {
    const out = [];
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    for (const n of this.normals) {
      out.push(new Vec2(n.x * c - n.y * s, n.x * s + n.y * c));
    }
    return out;
  }

  updateAABB() {
    if (this.type === 'circle') {
      const r = this.radius;
      this.aabb.min.set(this.position.x - r, this.position.y - r);
      this.aabb.max.set(this.position.x + r, this.position.y + r);
    } else {
      const wv = this.worldVerts();
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of wv) {
        if (p.x < minx) minx = p.x; if (p.y < miny) miny = p.y;
        if (p.x > maxx) maxx = p.x; if (p.y > maxy) maxy = p.y;
      }
      this.aabb.min.set(minx, miny); this.aabb.max.set(maxx, maxy);
    }
  }

  applyImpulse(imp, contactVec) {
    if (this.invMass === 0 || this.frozen) return;
    this.velocity.addScaled(imp, this.invMass);
    this.angularVelocity += this.invInertia * contactVec.cross(imp);
    this.wake();
  }

  applyForce(f) { this.force.addi(f); }

  wake() {
    this.sleeping = false; this.sleepTimer = 0;
  }

  // bounding radius for broadphase/explosions
  boundRadius() {
    if (this.type === 'circle') return this.radius;
    let m = 0;
    for (const v of this.vertices) { const l = v.len(); if (l > m) m = l; }
    return m;
  }

  damage(amount) {
    if (!this.destructible || this.isStatic) return false;
    this.health -= amount;
    return this.health <= 0;
  }
}

// ---- factory helpers ----
function makeBox(x, y, w, h, opts = {}) {
  const hw = w / 2, hh = h / 2;
  const verts = [
    new Vec2(-hw, -hh), new Vec2(hw, -hh), new Vec2(hw, hh), new Vec2(-hw, hh),
  ];
  return new Body(Object.assign({ type: 'polygon', position: new Vec2(x, y), vertices: verts }, opts));
}
function makeCircle(x, y, r, opts = {}) {
  return new Body(Object.assign({ type: 'circle', position: new Vec2(x, y), radius: r }, opts));
}
function makePoly(x, y, sides, r, opts = {}) {
  const verts = [];
  const off = opts.angleOffset || 0;
  for (let i = 0; i < sides; i++) {
    const a = off + (i / sides) * M.TAU;
    verts.push(new Vec2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return new Body(Object.assign({ type: 'polygon', position: new Vec2(x, y), vertices: verts }, opts));
}
