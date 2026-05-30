/* FRACTURE — particles.js
 * Fast pooled particle system (sparks, smoke, embers, debris) +
 * particle-based liquid using Clavet double-density relaxation,
 * which gives convincing splashing water that interacts with rigid bodies.
 */
'use strict';

class ParticleSystem {
  constructor(max = 4000) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.hue = new Float32Array(max);
    this.sat = new Float32Array(max);
    this.lum = new Float32Array(max);
    this.type = new Uint8Array(max);   // 0 spark,1 smoke,2 ember,3 debris,4 dust
    this.grav = new Float32Array(max);
    this.count = 0;
    this.head = 0;
  }

  spawn(o) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    if (this.count < this.max) this.count++;
    this.x[i] = o.x; this.y[i] = o.y;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0;
    this.life[i] = this.maxLife[i] = o.life || 1;
    this.size[i] = o.size || 2;
    this.hue[i] = o.hue || 30; this.sat[i] = o.sat != null ? o.sat : 90; this.lum[i] = o.lum != null ? o.lum : 60;
    this.type[i] = o.type || 0;
    this.grav[i] = o.grav != null ? o.grav : 1;
  }

  burst(x, y, n, opt) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * M.TAU;
      const sp = M.rand(opt.spdMin || 40, opt.spdMax || 260);
      this.spawn({
        x, y, vx: Math.cos(a) * sp + (opt.vx || 0), vy: Math.sin(a) * sp + (opt.vy || 0),
        life: M.rand(opt.lifeMin || 0.3, opt.lifeMax || 0.9),
        size: M.rand(opt.sizeMin || 1, opt.sizeMax || 3),
        hue: (opt.hue || 30) + M.rand(-(opt.hueVar || 12), opt.hueVar || 12),
        sat: opt.sat != null ? opt.sat : 95, lum: opt.lum != null ? opt.lum : 62,
        type: opt.type != null ? opt.type : 0, grav: opt.grav != null ? opt.grav : 1,
      });
    }
  }

  update(dt, gravity) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      this.vy[i] += gravity * this.grav[i] * dt;
      const t = this.type[i];
      if (t === 1) { // smoke rises & drags
        this.vy[i] -= gravity * this.grav[i] * dt * 1.4;
        this.vx[i] *= 0.96; this.vy[i] *= 0.97;
        this.size[i] += dt * 14;
      } else if (t === 2) { // ember flicker
        this.vx[i] *= 0.98;
      } else {
        this.vx[i] *= 0.995;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }
}

// ------- Liquid: Clavet (2005) particle hydrodynamics -------
class Liquid {
  constructor(opts = {}) {
    this.px = []; this.py = []; this.vx = []; this.vy = [];
    this.opx = []; this.opy = [];
    this.hue = [];
    this.h = opts.h || 24;          // interaction radius
    this.rest = opts.rest || 6;     // rest density (high = cohesive/contained)
    this.k = opts.k || 0.8;         // pressure stiffness
    this.kNear = opts.kNear || 1.6; // near-pressure
    this.sigma = opts.sigma != null ? opts.sigma : 0.06;  // linear viscosity
    this.beta = opts.beta != null ? opts.beta : 0.10;     // quadratic viscosity
    this.max = opts.max || 1400;
    this.grid = new Map();
    this.cell = this.h;
  }
  get count() { return this.px.length; }

  add(x, y, vx = 0, vy = 0, hue = 200) {
    if (this.px.length >= this.max) {
      // recycle oldest
      this.px.shift(); this.py.shift(); this.vx.shift(); this.vy.shift();
      this.opx.shift(); this.opy.shift(); this.hue.shift();
    }
    this.px.push(x); this.py.push(y); this.vx.push(vx); this.vy.push(vy);
    this.opx.push(x); this.opy.push(y); this.hue.push(hue);
  }

  _hash(cx, cy) { return cx * 92837111 ^ cy * 689287499; }
  _buildGrid() {
    this.grid.clear();
    const cs = this.cell;
    for (let i = 0; i < this.px.length; i++) {
      const cx = Math.floor(this.px[i] / cs), cy = Math.floor(this.py[i] / cs);
      const key = this._hash(cx, cy);
      let arr = this.grid.get(key);
      if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(i);
    }
  }
  _neighbors(i) {
    const cs = this.cell;
    const cx = Math.floor(this.px[i] / cs), cy = Math.floor(this.py[i] / cs);
    const res = [];
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        const arr = this.grid.get(this._hash(cx + ox, cy + oy));
        if (arr) for (const j of arr) if (j !== i) res.push(j);
      }
    return res;
  }

  step(dt, gravity, world) {
    const n = this.px.length;
    if (n === 0) return;
    const h = this.h;

    // apply gravity
    for (let i = 0; i < n; i++) this.vy[i] += gravity * dt;

    // viscosity pass (Clavet): damp inward relative velocity for cohesion
    this._buildGrid();
    if (this.sigma > 0 || this.beta > 0) {
      for (let i = 0; i < n; i++) {
        const nb = this._neighbors(i);
        for (const j of nb) {
          if (j <= i) continue;
          const dx = this.px[j] - this.px[i], dy = this.py[j] - this.py[i];
          const r = Math.sqrt(dx * dx + dy * dy);
          if (r >= h || r < 1e-6) continue;
          const q = 1 - r / h;
          const nx = dx / r, ny = dy / r;
          const u = (this.vx[i] - this.vx[j]) * nx + (this.vy[i] - this.vy[j]) * ny;
          if (u <= 0) continue;
          let I = dt * q * (this.sigma * u + this.beta * u * u);
          if (I > 90) I = 90;
          const ix = nx * I * 0.5, iy = ny * I * 0.5;
          this.vx[i] -= ix; this.vy[i] -= iy;
          this.vx[j] += ix; this.vy[j] += iy;
        }
      }
    }

    // predict positions
    for (let i = 0; i < n; i++) {
      this.opx[i] = this.px[i]; this.opy[i] = this.py[i];
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
    }

    this._buildGrid();

    // double density relaxation
    for (let i = 0; i < n; i++) {
      let rho = 0, rhoNear = 0;
      const nb = this._neighbors(i);
      const qcache = [];
      for (const j of nb) {
        const dx = this.px[j] - this.px[i], dy = this.py[j] - this.py[i];
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < h && r > 1e-6) {
          const q = 1 - r / h;
          rho += q * q;
          rhoNear += q * q * q;
          qcache.push([j, q, dx / r, dy / r]);
        }
      }
      // position-based pressure (dt-independent). dt² scaling makes the
      // displacement vanish at small timesteps, so we use a direct stiffness.
      const P = this.k * (rho - this.rest);
      const Pnear = this.kNear * rhoNear;
      let dxi = 0, dyi = 0;
      for (const [j, q, nx, ny] of qcache) {
        let D = (P * q + Pnear * q * q);
        if (D > 8) D = 8; else if (D < -4) D = -4;   // clamp to stay stable
        const dpx = nx * D * 0.5, dpy = ny * D * 0.5;
        this.px[j] += dpx; this.py[j] += dpy;
        dxi -= dpx; dyi -= dpy;
      }
      this.px[i] += dxi; this.py[i] += dyi;
    }

    // collide with rigid bodies (push particles out)
    if (world) {
      for (let i = 0; i < n; i++) {
        const p = { x: this.px[i], y: this.py[i] };
        const cs = world.cell;
        // brute over nearby bodies via world grid
        const cx = Math.floor(p.x / cs), cy = Math.floor(p.y / cs);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const arr = world.grid.get(world._key(cx + ox, cy + oy));
          if (!arr) continue;
          for (const b of arr) {
            this._collideBody(i, b);
          }
        }
      }
    }

    // world floor/walls handled by bounds
    if (world) {
      const bnd = world.bounds;
      for (let i = 0; i < n; i++) {
        if (this.py[i] > bnd.max.y - 2) this.py[i] = bnd.max.y - 2;
        if (this.px[i] < bnd.min.x + 2) this.px[i] = bnd.min.x + 2;
        if (this.px[i] > bnd.max.x - 2) this.px[i] = bnd.max.x - 2;
      }
    }

    // recompute velocity from movement
    for (let i = 0; i < n; i++) {
      this.vx[i] = (this.px[i] - this.opx[i]) / dt;
      this.vy[i] = (this.py[i] - this.opy[i]) / dt;
      // clamp speed
      const sp = Math.hypot(this.vx[i], this.vy[i]);
      if (sp > 1600) { this.vx[i] *= 1600 / sp; this.vy[i] *= 1600 / sp; }
    }
  }

  _collideBody(i, b) {
    const px = this.px[i], py = this.py[i];
    if (b.type === 'circle') {
      const dx = px - b.position.x, dy = py - b.position.y;
      const d2 = dx * dx + dy * dy;
      const r = b.radius + 3;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        this.px[i] = b.position.x + nx * r;
        this.py[i] = b.position.y + ny * r;
        if (b.invMass > 0 && !b.frozen) {
          b.velocity.x += nx * 1.2 * b.invMass * 30;
          b.velocity.y += ny * 1.2 * b.invMass * 30;
          b.wake();
        }
      }
    } else {
      // point-in-polygon -> push out along the LEAST-penetrating face
      // (minimal translation axis), so water rises out the top instead of
      // being ejected through the deepest (bottom) face of a thick slab.
      const wv = b.worldVerts(), wn = b.worldNormals();
      const margin = 3;
      let inside = true, maxSep = -Infinity, mn = null;
      for (let k = 0; k < wv.length; k++) {
        const sep = wn[k].dot(new Vec2(px - wv[k].x, py - wv[k].y));
        if (sep > margin) { inside = false; break; }
        if (sep > maxSep) { maxSep = sep; mn = wn[k]; }
      }
      if (inside && mn) {
        const push = (margin - maxSep);
        this.px[i] = px + mn.x * push;
        this.py[i] = py + mn.y * push;
        if (b.invMass > 0 && !b.frozen) {
          b.velocity.x -= mn.x * 0.6 * b.invMass * 22;
          b.velocity.y -= mn.y * 0.6 * b.invMass * 22;
          b.wake();
        }
      }
    }
  }
}
