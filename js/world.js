/* FRACTURE — world.js
 * Physics world: spatial-hash broadphase, sequential-impulse contact solver
 * with warm-ish restitution + friction, distance constraints (ropes/joints),
 * sleeping, explosions, and a destruction queue consumed by the game layer.
 */
'use strict';

class Constraint {
  // distance/spring constraint between two bodies at local anchor points
  constructor(a, b, anchorA, anchorB, opts = {}) {
    this.a = a; this.b = b;
    this.anchorA = anchorA.clone();   // local space
    this.anchorB = anchorB.clone();
    this.length = opts.length != null ? opts.length : this._currentLen();
    this.stiffness = opts.stiffness != null ? opts.stiffness : 1.0;
    this.maxForce = opts.maxForce != null ? opts.maxForce : Infinity; // breaking
    this.broken = false;
    this.isRope = !!opts.isRope;      // rope: only resists stretch
    this.render = opts.render !== false;
    this.hue = opts.hue != null ? opts.hue : 180;
  }
  _worldA() { return this.a.position.add(this.anchorA.rotate(this.a.angle)); }
  _worldB() { return this.b.position.add(this.anchorB.rotate(this.b.angle)); }
  _currentLen() { return this._worldB().sub(this._worldA()).len(); }

  solve() {
    if (this.broken) return;
    const a = this.a, b = this.b;
    const pa = this._worldA(), pb = this._worldB();
    const ra = pa.sub(a.position), rb = pb.sub(b.position);
    const d = pb.sub(pa);
    const dist = d.len();
    if (dist < 1e-6) return;
    const n = d.div(dist);
    let C = dist - this.length;
    if (this.isRope && C < 0) return;   // ropes don't push

    const rva = a.velocity.add(crossSV(a.angularVelocity, ra));
    const rvb = b.velocity.add(crossSV(b.angularVelocity, rb));
    const relVel = rvb.sub(rva).dot(n);

    const rnA = ra.cross(n), rnB = rb.cross(n);
    const invMassSum = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
    if (invMassSum < 1e-9) return;

    const beta = 0.2;
    const bias = beta * C; // position bias (per-step, dt folded into stiffness)
    let lambda = -(relVel + bias) / invMassSum * this.stiffness;

    const force = Math.abs(lambda);
    if (force > this.maxForce) { this.broken = true; return; }

    const imp = n.mul(lambda);
    a.applyImpulse(imp.neg(), ra);
    b.applyImpulse(imp, rb);
  }
}

class World {
  constructor(opts = {}) {
    this.bodies = [];
    this.constraints = [];
    this.gravity = new Vec2(0, opts.gravity != null ? opts.gravity : 980);
    this.cell = 90;
    this.grid = new Map();
    this.contactCache = new Map();   // pairKey -> [{Pn,Pt},...] for warm starting
    this.iterations = 10;
    this.bounds = opts.bounds || { min: new Vec2(-4000, -3000), max: new Vec2(4000, 3000) };
    this.destroyQueue = [];   // {body, impactPoint, force}
    this.explosionEvents = []; // for FX layer
    this.timeScale = 1;
    this.paused = false;
    this.contacts = [];
  }

  add(body) { this.bodies.push(body); return body; }
  addConstraint(c) { this.constraints.push(c); return c; }
  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    this.constraints = this.constraints.filter(c => c.a !== body && c.b !== body);
  }
  clear() { this.bodies.length = 0; this.constraints.length = 0; }

  _key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }

  _rebuildGrid() {
    this.grid.clear();
    const cs = this.cell;
    for (const b of this.bodies) {
      b.updateAABB();
      const min = b.aabb.min, max = b.aabb.max;
      const x0 = Math.floor(min.x / cs), x1 = Math.floor(max.x / cs);
      const y0 = Math.floor(min.y / cs), y1 = Math.floor(max.y / cs);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = this._key(cx, cy);
          let arr = this.grid.get(k);
          if (!arr) { arr = []; this.grid.set(k, arr); }
          arr.push(b);
        }
      }
    }
  }

  _broadphase() {
    const pairs = [];
    const seen = new Set();
    for (const arr of this.grid.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          let a = arr[i], b = arr[j];
          if (a.invMass === 0 && b.invMass === 0) continue;
          if (a.sleeping && b.sleeping) continue;
          if (a.frozen && b.frozen) continue;
          if (a.id > b.id) { const t = a; a = b; b = t; }
          const key = a.id * 100000 + b.id;
          if (seen.has(key)) continue;
          seen.add(key);
          // AABB overlap test
          if (a.aabb.max.x < b.aabb.min.x || a.aabb.min.x > b.aabb.max.x ||
              a.aabb.max.y < b.aabb.min.y || a.aabb.min.y > b.aabb.max.y) continue;
          pairs.push([a, b]);
        }
      }
    }
    return pairs;
  }

  step(dt) {
    if (this.paused) dt = 0;
    dt *= this.timeScale;
    if (dt <= 0) { return; }

    // integrate forces
    for (const b of this.bodies) {
      if (b.invMass === 0 || b.frozen || b.sleeping) continue;
      b.velocity.addScaled(this.gravity, dt);
      b.velocity.addScaled(b.force, b.invMass * dt);
      b.angularVelocity += b.torque * b.invInertia * dt;
      // damping
      b.velocity.muli(0.999);
      b.angularVelocity *= 0.997;
      b.force.set(0, 0); b.torque = 0;
    }

    this._rebuildGrid();
    const pairs = this._broadphase();

    // narrowphase -> manifolds
    const manifolds = [];
    const liveKeys = new Set();
    for (const [a, b] of pairs) {
      const m = Collision.test(a, b);
      if (!m) continue;
      m.a = a; m.b = b;
      m.e = Math.min(a.restitution, b.restitution);
      m.sf = Math.sqrt(a.friction * b.friction);
      m.key = a.id * 1000003 + b.id;
      liveKeys.add(m.key);
      manifolds.push(m);
      this._registerImpact(a, b, m);
      // wake a sleeping body only when struck by a fast-moving neighbour
      if (a.sleeping !== b.sleeping) {
        const sleeper = a.sleeping ? a : b, other = a.sleeping ? b : a;
        if (!other.isStatic && other.velocity.lenSq() > 1600) sleeper.wake();
      }
    }
    this.contacts = manifolds;

    // drop stale warm-start data
    for (const k of this.contactCache.keys()) if (!liveKeys.has(k)) this.contactCache.delete(k);

    const invDt = dt > 0 ? 1 / dt : 0;
    for (const m of manifolds) this._prestep(m, invDt);
    for (const m of manifolds) this._warmStart(m);

    // solve velocity (accumulated impulses)
    for (let it = 0; it < this.iterations; it++) {
      for (const m of manifolds) this._solveVelocity(m);
      for (const c of this.constraints) c.solve();
    }
    this.constraints = this.constraints.filter(c => !c.broken);

    // persist impulses for next-frame warm start
    for (const m of manifolds) {
      const store = [];
      for (const cp of m.cps) store.push({ Pn: cp.Pn, Pt: cp.Pt });
      this.contactCache.set(m.key, store);
    }

    // integrate velocity -> position
    for (const b of this.bodies) {
      if (b.invMass === 0 || b.frozen || b.sleeping) continue;
      b.position.addScaled(b.velocity, dt);
      b.angle += b.angularVelocity * dt;
      this._clampToBounds(b);
    }

    this._updateSleep(dt);
  }

  // treat sleeping/frozen bodies as immovable in the solver
  _imA(b) { return (b.sleeping || b.frozen) ? 0 : b.invMass; }
  _iiA(b) { return (b.sleeping || b.frozen) ? 0 : b.invInertia; }

  _applyImp(body, imp, r) {
    if (body.invMass === 0 || body.frozen || body.sleeping) return;
    body.velocity.addScaled(imp, body.invMass);
    body.angularVelocity += body.invInertia * r.cross(imp);
  }

  _prestep(m, invDt) {
    const a = m.a, b = m.b, n = m.normal;
    const t = new Vec2(-n.y, n.x);
    m.tangent = t;
    const prev = this.contactCache.get(m.key);
    const imA = this._imA(a), imB = this._imA(b), iiA = this._iiA(a), iiB = this._iiA(b);
    const slop = 0.5, beta = 0.2;
    m.cps = [];
    for (let i = 0; i < m.contacts.length; i++) {
      const point = m.contacts[i];
      const ra = point.sub(a.position), rb = point.sub(b.position);
      const rnA = ra.cross(n), rnB = rb.cross(n);
      const kn = imA + imB + iiA * rnA * rnA + iiB * rnB * rnB;
      const rtA = ra.cross(t), rtB = rb.cross(t);
      const kt = imA + imB + iiA * rtA * rtA + iiB * rtB * rtB;
      const dv = b.velocity.add(crossSV(b.angularVelocity, rb))
                  .sub(a.velocity).sub(crossSV(a.angularVelocity, ra));
      const vn = dv.dot(n);
      const restBias = vn < -160 ? -m.e * vn : 0;
      const posBias = beta * invDt * Math.max(m.penetration - slop, 0);
      const cp = {
        ra, rb, massN: kn > 1e-9 ? 1 / kn : 0, massT: kt > 1e-9 ? 1 / kt : 0,
        bias: posBias + restBias, Pn: 0, Pt: 0,
      };
      if (prev && prev[i]) { cp.Pn = prev[i].Pn; cp.Pt = prev[i].Pt; }
      m.cps.push(cp);
    }
  }

  _warmStart(m) {
    const a = m.a, b = m.b, n = m.normal, t = m.tangent;
    for (const cp of m.cps) {
      const P = n.mul(cp.Pn).addi(t.mul(cp.Pt));
      this._applyImp(a, P.neg(), cp.ra);
      this._applyImp(b, P, cp.rb);
    }
  }

  _solveVelocity(m) {
    const a = m.a, b = m.b, n = m.normal, t = m.tangent;
    for (const cp of m.cps) {
      // normal
      let dv = b.velocity.add(crossSV(b.angularVelocity, cp.rb))
                .sub(a.velocity).sub(crossSV(a.angularVelocity, cp.ra));
      let vn = dv.dot(n);
      let dPn = cp.massN * (cp.bias - vn);
      const newPn = Math.max(cp.Pn + dPn, 0);
      dPn = newPn - cp.Pn; cp.Pn = newPn;
      const Pn = n.mul(dPn);
      this._applyImp(a, Pn.neg(), cp.ra);
      this._applyImp(b, Pn, cp.rb);
      // friction
      dv = b.velocity.add(crossSV(b.angularVelocity, cp.rb))
            .sub(a.velocity).sub(crossSV(a.angularVelocity, cp.ra));
      const vt = dv.dot(t);
      let dPt = cp.massT * (-vt);
      const maxPt = m.sf * cp.Pn;
      const newPt = M.clamp(cp.Pt + dPt, -maxPt, maxPt);
      dPt = newPt - cp.Pt; cp.Pt = newPt;
      const Pt = t.mul(dPt);
      this._applyImp(a, Pt.neg(), cp.ra);
      this._applyImp(b, Pt, cp.rb);
    }
  }

  _clampToBounds(b) {
    const bnd = this.bounds, r = b.boundRadius();
    if (b.position.x < bnd.min.x + r) { b.position.x = bnd.min.x + r; b.velocity.x *= -0.3; }
    if (b.position.x > bnd.max.x - r) { b.position.x = bnd.max.x - r; b.velocity.x *= -0.3; }
    if (b.position.y > bnd.max.y - r) { b.position.y = bnd.max.y - r; b.velocity.y *= -0.3; b.velocity.x *= 0.96; }
  }

  _registerImpact(a, b, m) {
    const rv = b.velocity.sub(a.velocity).len();
    if (rv > 220) {
      const impact = (a.invMass === 0 ? b : a);
      const other = (a.invMass === 0 ? a : b);
      const energy = rv * (impact.mass || 1) * 0.5;
      const dmg = energy * 0.0008;
      if (dmg > 1.5) {
        const cp = m.contacts[0];
        if (a.damage(dmg)) this.queueDestroy(a, cp, rv);
        if (b.damage(dmg)) this.queueDestroy(b, cp, rv);
        this.explosionEvents.push({ type: 'impact', pos: cp.clone(), mag: Math.min(rv / 12, 40), hue: 200 });
      }
    }
  }

  queueDestroy(body, point, force) {
    if (body._queuedDestroy) return;
    body._queuedDestroy = true;
    this.destroyQueue.push({ body, point: point.clone(), force });
  }

  _updateSleep(dt) {
    const linTol = 9, angTol = 0.05;
    for (const b of this.bodies) {
      if (b.invMass === 0 || b.frozen) continue;
      if (b.velocity.lenSq() < linTol * linTol && Math.abs(b.angularVelocity) < angTol) {
        b.sleepTimer += dt;
        if (b.sleepTimer > 0.7) { b.sleeping = true; b.velocity.set(0, 0); b.angularVelocity = 0; }
      } else {
        b.sleepTimer = 0; b.sleeping = false;
      }
    }
  }

  // radial explosion: impulse + damage falloff
  explode(center, radius, power, opts = {}) {
    for (const b of this.bodies) {
      if (b.invMass === 0 || b.frozen) continue;
      const d = b.position.sub(center);
      const dist = d.len();
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;
      const dir = dist > 1e-3 ? d.div(dist) : new Vec2(0, -1);
      const imp = power * falloff;
      b.velocity.addScaled(dir, imp * b.invMass * 60);
      b.angularVelocity += (Math.random() - 0.5) * falloff * 8;
      b.wake();
      const dmg = power * falloff * 0.18;
      if (b.flammable > 0 && Math.random() < falloff * 0.6) b.burning = Math.max(b.burning, 0.6);
      if (b.damage(dmg)) this.queueDestroy(b, b.position, imp);
    }
    this.explosionEvents.push({
      type: 'explosion', pos: center.clone(), radius, mag: power,
      hue: opts.hue != null ? opts.hue : 25,
    });
  }

  queryPoint(p) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (this._pointInBody(p, b)) return b;
    }
    return null;
  }
  _pointInBody(p, b) {
    if (b.type === 'circle') return p.sub(b.position).lenSq() <= b.radius * b.radius;
    const wv = b.worldVerts(), wn = b.worldNormals();
    for (let i = 0; i < wv.length; i++) {
      if (wn[i].dot(p.sub(wv[i])) > 0) return false;
    }
    return true;
  }
}
