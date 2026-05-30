/* FRACTURE — collision.js
 * Manifold generation for circle/circle, circle/polygon, polygon/polygon.
 * Polygon-polygon uses SAT + reference/incident face clipping (Catto style).
 * Returns { normal (A->B), penetration, contacts: [Vec2,...] } or null.
 */
'use strict';

const Collision = {
  test(a, b) {
    if (a.type === 'circle' && b.type === 'circle') return this.circleCircle(a, b);
    if (a.type === 'circle' && b.type === 'polygon') {
      const m = this.polygonCircle(b, a);
      if (m) m.normal.muli(-1);
      return m;
    }
    if (a.type === 'polygon' && b.type === 'circle') return this.polygonCircle(a, b);
    return this.polygonPolygon(a, b);
  },

  circleCircle(a, b) {
    const d = b.position.sub(a.position);
    const r = a.radius + b.radius;
    const distSq = d.lenSq();
    if (distSq >= r * r) return null;
    const dist = Math.sqrt(distSq);
    let normal, pen;
    if (dist < 1e-6) { normal = new Vec2(0, -1); pen = r; }
    else { normal = d.div(dist); pen = r - dist; }
    const contact = a.position.add(normal.mul(a.radius));
    return { normal, penetration: pen, contacts: [contact] };
  },

  // polygon A vs circle B
  polygonCircle(a, b) {
    const wv = a.worldVerts();
    const wn = a.worldNormals();
    const c = b.position;
    let sep = -Infinity, faceIdx = 0;
    for (let i = 0; i < wv.length; i++) {
      const s = wn[i].dot(c.sub(wv[i]));
      if (s > b.radius) return null;
      if (s > sep) { sep = s; faceIdx = i; }
    }
    const v1 = wv[faceIdx];
    const v2 = wv[(faceIdx + 1) % wv.length];

    if (sep < 1e-6) {
      // center inside polygon: normal points polygon -> circle (outward face)
      const n = wn[faceIdx];
      return { normal: n.clone(), penetration: b.radius, contacts: [c.sub(n.mul(b.radius))] };
    }
    // determine voronoi region
    const e = v2.sub(v1);
    const u = M.clamp(c.sub(v1).dot(e) / e.lenSq(), 0, 1);
    const closest = v1.add(e.mul(u));
    const d = c.sub(closest);            // polygon surface -> circle center
    const distSq = d.lenSq();
    if (distSq > b.radius * b.radius) return null;
    const dist = Math.sqrt(distSq);
    const normal = dist > 1e-6 ? d.div(dist) : wn[faceIdx].clone();
    return { normal, penetration: b.radius - dist, contacts: [closest] };
  },

  // find max separation of A's faces against B
  _maxSeparation(a, b, awv, awn, bwv) {
    let best = -Infinity, bestIdx = 0;
    for (let i = 0; i < awv.length; i++) {
      const n = awn[i], v = awv[i];
      // support point of B along -n
      let minProj = Infinity, sv = null;
      for (const p of bwv) {
        const proj = n.dot(p);
        if (proj < minProj) { minProj = proj; sv = p; }
      }
      const sep = n.dot(sv) - n.dot(v);
      if (sep > best) { best = sep; bestIdx = i; }
    }
    return { sep: best, idx: bestIdx };
  },

  polygonPolygon(a, b) {
    const awv = a.worldVerts(), awn = a.worldNormals();
    const bwv = b.worldVerts(), bwn = b.worldNormals();

    const sepA = this._maxSeparation(a, b, awv, awn, bwv);
    if (sepA.sep > 0) return null;
    const sepB = this._maxSeparation(b, a, bwv, bwn, awv);
    if (sepB.sep > 0) return null;

    let refPoly, incPoly, refWV, refWN, incWV, refIdx, flip;
    if (sepA.sep >= sepB.sep - 0.01) {
      refWV = awv; refWN = awn; incWV = bwv;
      refPoly = a; incPoly = b; refIdx = sepA.idx; flip = false;
    } else {
      refWV = bwv; refWN = bwn; incWV = awv;
      refPoly = b; incPoly = a; refIdx = sepB.idx; flip = true;
    }

    const refNormal = refWN[refIdx];

    // incident face = most anti-parallel face on incident poly
    let incIdx = 0, minDot = Infinity;
    const incWN = (incPoly === a) ? awn : bwn;
    for (let i = 0; i < incWN.length; i++) {
      const d = refNormal.dot(incWN[i]);
      if (d < minDot) { minDot = d; incIdx = i; }
    }
    let i1 = incWV[incIdx];
    let i2 = incWV[(incIdx + 1) % incWV.length];

    const refV1 = refWV[refIdx];
    const refV2 = refWV[(refIdx + 1) % refWV.length];
    const refDir = refV2.sub(refV1).normalize();

    // clip incident segment to reference side planes
    const negSide = -refDir.dot(refV1);
    const posSide = refDir.dot(refV2);

    let cp = this._clip(refDir.neg(), negSide, i1, i2);
    if (cp.length < 2) return null;
    i1 = cp[0]; i2 = cp[1];
    cp = this._clip(refDir, posSide, i1, i2);
    if (cp.length < 2) return null;
    i1 = cp[0]; i2 = cp[1];

    const contacts = [];
    const refC = refNormal.dot(refV1);
    let pen = 0;
    for (const p of [i1, i2]) {
      const sep = refNormal.dot(p) - refC;
      if (sep <= 0) { contacts.push(p); pen += -sep; }
    }
    if (contacts.length === 0) return null;
    pen /= contacts.length;

    const normal = flip ? refNormal.neg() : refNormal.clone();
    return { normal, penetration: pen, contacts };
  },

  _clip(n, c, v1, v2) {
    const out = [];
    const d1 = n.dot(v1) - c;
    const d2 = n.dot(v2) - c;
    if (d1 <= 0) out.push(v1.clone());
    if (d2 <= 0) out.push(v2.clone());
    if (d1 * d2 < 0) {
      const t = d1 / (d1 - d2);
      out.push(v1.add(v2.sub(v1).mul(t)));
    }
    return out;
  },
};
