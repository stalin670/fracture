/* FRACTURE — math.js
 * Vec2 + small math utilities. Mutating helpers used in hot solver paths,
 * allocating helpers used everywhere else for clarity.
 */
'use strict';

class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }

  set(x, y) { this.x = x; this.y = y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  clone() { return new Vec2(this.x, this.y); }

  add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
  mul(s) { return new Vec2(this.x * s, this.y * s); }
  div(s) { return new Vec2(this.x / s, this.y / s); }

  addi(v) { this.x += v.x; this.y += v.y; return this; }
  subi(v) { this.x -= v.x; this.y -= v.y; return this; }
  muli(s) { this.x *= s; this.y *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }

  dot(v) { return this.x * v.x + this.y * v.y; }
  cross(v) { return this.x * v.y - this.y * v.x; }            // z of cross product
  crossS(s) { return new Vec2(s * this.y, -s * this.x); }      // (s x this) -> vector? see helpers

  len() { return Math.hypot(this.x, this.y); }
  lenSq() { return this.x * this.x + this.y * this.y; }

  normalize() {
    const l = this.len();
    if (l > 1e-9) { this.x /= l; this.y /= l; }
    return this;
  }
  normalized() {
    const l = this.len();
    return l > 1e-9 ? new Vec2(this.x / l, this.y / l) : new Vec2(0, 0);
  }

  perp() { return new Vec2(-this.y, this.x); }
  neg() { return new Vec2(-this.x, -this.y); }

  rotate(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }
  rotatei(a) {
    const c = Math.cos(a), s = Math.sin(a);
    const x = this.x * c - this.y * s;
    const y = this.x * s + this.y * c;
    this.x = x; this.y = y; return this;
  }
}

// cross(scalar, vector) -> vector  (s x v)
function crossSV(s, v) { return new Vec2(-s * v.y, s * v.x); }
// cross(vector, scalar) -> vector  (v x s)
function crossVS(v, s) { return new Vec2(s * v.y, -s * v.x); }

const M = {
  clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
  randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: (arr) => arr[(Math.random() * arr.length) | 0],
  TAU: Math.PI * 2,
  sign: (x) => (x < 0 ? -1 : 1),
};

// HSL helper -> css string
function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})`; }

// roundRect polyfill for older canvas implementations
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
    else r = Object.assign({ tl: 0, tr: 0, br: 0, bl: 0 }, r);
    this.beginPath();
    this.moveTo(x + r.tl, y);
    this.lineTo(x + w - r.tr, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
    this.lineTo(x + w, y + h - r.br);
    this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
    this.lineTo(x + r.bl, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
    this.lineTo(x, y + r.tl);
    this.quadraticCurveTo(x, y, x + r.tl, y);
    this.closePath();
    return this;
  };
}
