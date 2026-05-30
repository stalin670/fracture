/* FRACTURE — destruction.js
 * Shatters a destroyed body into convex shards by recursively slicing the
 * convex hull with random chords. Circles burst into smaller circles.
 * Returns an array of new Body shards (or empty if too small).
 */
'use strict';

const Destruction = {
  MIN_AREA: 70,
  MAX_GEN: 2,

  shatter(body, point, force) {
    if (body.generation >= this.MAX_GEN) return this._dust(body);
    const pieces = [];
    if (body.type === 'circle') {
      if (body.radius < 9) return this._dust(body);
      const n = M.randInt(2, 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * M.TAU + M.rand(0, 1);
        const r = body.radius * M.rand(0.4, 0.6);
        const off = new Vec2(Math.cos(a), Math.sin(a)).mul(body.radius * 0.4);
        const nb = makeCircle(body.position.x + off.x, body.position.y + off.y, r, {
          material: body.matName, generation: body.generation + 1,
        });
        this._inherit(nb, body, point, force, off);
        pieces.push(nb);
      }
      return pieces;
    }

    // polygon: world-space convex slicing
    let polys = [body.worldVerts()];
    const cuts = M.randInt(2, 3);
    for (let c = 0; c < cuts; c++) {
      const next = [];
      for (const poly of polys) {
        if (this._area(poly) < this.MIN_AREA * 2) { next.push(poly); continue; }
        const ctr = this._centroid(poly);
        const ang = M.rand(0, Math.PI);
        const nrm = new Vec2(Math.cos(ang), Math.sin(ang));
        const off = nrm.dot(ctr) + M.rand(-8, 8);
        const [pa, pb] = this._slice(poly, nrm, off);
        if (pa.length >= 3) next.push(pa);
        if (pb.length >= 3) next.push(pb);
        if (pa.length < 3 && pb.length < 3) next.push(poly);
      }
      polys = next;
    }

    for (const poly of polys) {
      if (this._area(poly) < this.MIN_AREA) continue;
      const ctr = this._centroid(poly);
      const local = poly.map(p => p.sub(ctr));
      const nb = new Body({
        type: 'polygon', position: ctr, vertices: local,
        material: body.matName, generation: body.generation + 1,
      });
      nb.angle = body.angle;
      this._inherit(nb, body, point, force, ctr.sub(body.position));
      pieces.push(nb);
    }
    if (pieces.length === 0) return this._dust(body);
    return pieces;
  },

  _inherit(nb, body, point, force, off) {
    nb.velocity.copy(body.velocity);
    nb.angularVelocity = body.angularVelocity;
    nb.burning = body.burning;
    nb.charred = Math.min(body.charred + 0.15, 1);
    // outward kick from fracture point
    const dir = nb.position.sub(point);
    const d = dir.len();
    const out = d > 1e-3 ? dir.div(d) : off.normalized();
    const kick = M.clamp(force * 0.25, 30, 380);
    nb.velocity.addScaled(out, kick * M.rand(0.5, 1));
    nb.angularVelocity += M.rand(-6, 6);
  },

  _dust() { return []; },

  _area(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      a += p.cross(q);
    }
    return Math.abs(a) * 0.5;
  },
  _centroid(poly) {
    let cx = 0, cy = 0, a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const cr = p.cross(q);
      a += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-6) { // fallback average
      cx = 0; cy = 0;
      for (const p of poly) { cx += p.x; cy += p.y; }
      return new Vec2(cx / poly.length, cy / poly.length);
    }
    return new Vec2(cx / (6 * a), cy / (6 * a));
  },

  // split convex polygon by line nrm·p = off -> [sidePos, sideNeg]
  _slice(poly, nrm, off) {
    const pos = [], neg = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], nxt = poly[(i + 1) % poly.length];
      const dc = nrm.dot(cur) - off;
      const dn = nrm.dot(nxt) - off;
      if (dc >= 0) pos.push(cur.clone()); else neg.push(cur.clone());
      if (dc * dn < 0) {
        const t = dc / (dc - dn);
        const ip = cur.add(nxt.sub(cur).mul(t));
        pos.push(ip.clone()); neg.push(ip.clone());
      }
    }
    return [pos, neg];
  },
};
