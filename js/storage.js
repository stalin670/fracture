/* FRACTURE — storage.js : serialize/deserialize sandbox to localStorage */
'use strict';

const Storage = {
  KEY: 'fracture_saves_v1',

  _serializeBody(b) {
    return {
      t: b.type, x: b.position.x, y: b.position.y, a: b.angle,
      vx: b.velocity.x, vy: b.velocity.y, av: b.angularVelocity,
      r: b.radius, v: b.type === 'polygon' ? b.vertices.map(p => [p.x, p.y]) : null,
      m: b.matName, st: b.isStatic, fz: b.frozen, hp: b.health, mh: b.maxHealth, bn: b.burning, ch: b.charred,
      id: b.id,
    };
  },

  snapshot(world, liquid) {
    return {
      bodies: world.bodies.map(b => this._serializeBody(b)),
      constraints: world.constraints.filter(c => !c.broken).map(c => ({
        a: c.a.id, b: c.b.id, aa: [c.anchorA.x, c.anchorA.y], ab: [c.anchorB.x, c.anchorB.y],
        len: c.length, st: c.stiffness, mf: c.maxForce === Infinity ? null : c.maxForce,
        rope: c.isRope, render: c.render, hue: c.hue,
      })),
      liquid: liquid ? { px: Array.from(liquid.px), py: Array.from(liquid.py), hue: Array.from(liquid.hue) } : null,
      gravity: world.gravity.y,
    };
  },

  restore(snap, world, liquid) {
    world.clear();
    if (liquid) { liquid.px.length = 0; liquid.py.length = 0; liquid.vx.length = 0; liquid.vy.length = 0; liquid.opx.length = 0; liquid.opy.length = 0; liquid.hue.length = 0; }
    const idMap = new Map();
    for (const d of snap.bodies) {
      let b;
      if (d.t === 'circle') b = makeCircle(d.x, d.y, d.r, { material: d.m, isStatic: d.st });
      else b = new Body({ type: 'polygon', position: new Vec2(d.x, d.y), vertices: d.v.map(p => new Vec2(p[0], p[1])), material: d.m, isStatic: d.st });
      b.angle = d.a; b.velocity.set(d.vx, d.vy); b.angularVelocity = d.av;
      b.frozen = d.fz; b.health = d.hp; b.maxHealth = d.mh; b.burning = d.bn || 0; b.charred = d.ch || 0;
      world.add(b);
      idMap.set(d.id, b);
    }
    for (const c of snap.constraints) {
      const a = idMap.get(c.a), b = idMap.get(c.b);
      if (!a || !b) continue;
      world.addConstraint(new Constraint(a, b, new Vec2(c.aa[0], c.aa[1]), new Vec2(c.ab[0], c.ab[1]), {
        length: c.len, stiffness: c.st, maxForce: c.mf == null ? Infinity : c.mf, isRope: c.rope, render: c.render, hue: c.hue,
      }));
    }
    if (snap.liquid && liquid) {
      for (let i = 0; i < snap.liquid.px.length; i++)
        liquid.add(snap.liquid.px[i], snap.liquid.py[i], 0, 0, snap.liquid.hue[i]);
    }
    if (snap.gravity != null) world.gravity.y = snap.gravity;
  },

  saveSlot(name, world, liquid) {
    const all = this.list();
    all[name] = this.snapshot(world, liquid);
    try { localStorage.setItem(this.KEY, JSON.stringify(all)); return true; }
    catch (e) { return false; }
  },
  loadSlot(name, world, liquid) {
    const all = this.list();
    if (!all[name]) return false;
    this.restore(all[name], world, liquid);
    return true;
  },
  deleteSlot(name) {
    const all = this.list();
    delete all[name];
    localStorage.setItem(this.KEY, JSON.stringify(all));
  },
  list() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch (e) { return {}; }
  },
};
