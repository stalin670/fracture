/* FRACTURE — camera.js : pan, zoom, screen shake, world<->screen transforms */
'use strict';

class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.pos = new Vec2(0, 0);      // world point at screen center
    this.zoom = 1;
    this.targetZoom = 1;
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
  }

  update(dt) {
    this.zoom = M.lerp(this.zoom, this.targetZoom, 1 - Math.pow(0.001, dt));
    if (this.shake > 0.01) {
      this.shake *= Math.pow(0.0008, dt);
      const a = Math.random() * M.TAU;
      this.shakeX = Math.cos(a) * this.shake;
      this.shakeY = Math.sin(a) * this.shake;
    } else { this.shake = 0; this.shakeX = 0; this.shakeY = 0; }
  }

  addShake(amt) { this.shake = Math.min(this.shake + amt, 60); }

  apply(ctx) {
    const w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(this.zoom, 0, 0, this.zoom,
      w / 2 - (this.pos.x + this.shakeX) * this.zoom,
      h / 2 - (this.pos.y + this.shakeY) * this.zoom);
  }

  screenToWorld(sx, sy) {
    const w = this.canvas.width, h = this.canvas.height;
    return new Vec2(
      (sx - w / 2) / this.zoom + this.pos.x,
      (sy - h / 2) / this.zoom + this.pos.y
    );
  }
  worldToScreen(wx, wy) {
    const w = this.canvas.width, h = this.canvas.height;
    return new Vec2(
      (wx - this.pos.x) * this.zoom + w / 2,
      (wy - this.pos.y) * this.zoom + h / 2
    );
  }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.targetZoom = M.clamp(this.targetZoom * factor, 0.18, 4.5);
    this.zoom = this.targetZoom;
    const after = this.screenToWorld(sx, sy);
    this.pos.addi(before.sub(after));
  }

  // visible world rect (for culling)
  viewBounds() {
    const w = this.canvas.width, h = this.canvas.height;
    const hw = w / 2 / this.zoom, hh = h / 2 / this.zoom;
    return { minx: this.pos.x - hw, miny: this.pos.y - hh, maxx: this.pos.x + hw, maxy: this.pos.y + hh };
  }
}
