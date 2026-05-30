/* FRACTURE — render.js
 * Neon/futuristic renderer. Layered: background grid -> liquid metaballs ->
 * bodies (with material shading, burn glow, cracks) -> constraints ->
 * particles -> additive light/shockwave pass -> vignette.
 */
'use strict';

class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = camera;
    this.lights = [];           // transient additive lights {x,y,r,hue,a}
    this.shockwaves = [];       // {x,y,r,maxR,hue,life,maxLife}
    this.quality = 1;           // 0 perf, 1 high
  }

  addLight(x, y, r, hue, a) { this.lights.push({ x, y, r, hue, a }); }
  addShockwave(x, y, maxR, hue) {
    this.shockwaves.push({ x, y, r: 6, maxR, hue, life: 1, maxLife: 1 });
  }

  updateFX(dt) {
    for (const s of this.shockwaves) {
      s.life -= dt * 1.6;
      s.r = s.maxR * (1 - s.life);
    }
    this.shockwaves = this.shockwaves.filter(s => s.life > 0);
  }

  clear() {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#070912');
    g.addColorStop(1, '#0c1020');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  drawGrid() {
    const ctx = this.ctx, cam = this.cam;
    const vb = cam.viewBounds();
    const step = 120;
    ctx.lineWidth = 1 / cam.zoom;
    ctx.strokeStyle = 'rgba(80,120,200,0.07)';
    ctx.beginPath();
    const x0 = Math.floor(vb.minx / step) * step;
    const y0 = Math.floor(vb.miny / step) * step;
    for (let x = x0; x < vb.maxx; x += step) { ctx.moveTo(x, vb.miny); ctx.lineTo(x, vb.maxy); }
    for (let y = y0; y < vb.maxy; y += step) { ctx.moveTo(vb.minx, y); ctx.lineTo(vb.maxx, y); }
    ctx.stroke();
  }

  drawBounds(world) {
    const ctx = this.ctx, b = world.bounds;
    ctx.lineWidth = 6 / this.cam.zoom;
    ctx.strokeStyle = 'rgba(90,170,255,0.5)';
    ctx.shadowColor = 'rgba(90,170,255,0.8)';
    ctx.shadowBlur = 18;
    ctx.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
    ctx.shadowBlur = 0;
  }

  drawLiquid(liquid) {
    if (!liquid || liquid.count === 0) return;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < liquid.px.length; i++) {
      const x = liquid.px[i], y = liquid.py[i];
      const r = liquid.h * 0.9;
      const hue = liquid.hue[i];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hsl(hue, 90, 60, 0.5));
      g.addColorStop(0.5, hsl(hue, 95, 50, 0.18));
      g.addColorStop(1, hsl(hue, 95, 45, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, M.TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // bright cores
    ctx.fillStyle = 'rgba(180,230,255,0.5)';
    for (let i = 0; i < liquid.px.length; i++) {
      ctx.beginPath();
      ctx.arc(liquid.px[i], liquid.py[i], 2.2, 0, M.TAU);
      ctx.fill();
    }
  }

  drawBody(b) {
    const ctx = this.ctx;
    const lum = M.clamp(b.light - b.charred * 30, 8, 92);
    const baseFill = hsl(b.hue, b.sat, lum);
    const glow = b.burning > 0.02;

    ctx.save();
    if (b.sleeping) ctx.globalAlpha = 0.96;

    if (glow) {
      ctx.shadowColor = hsl(28 + b.burning * 6, 95, 60);
      ctx.shadowBlur = 14 + b.burning * 26;
    } else if (b.metal) {
      ctx.shadowColor = hsl(b.hue, 30, 75); ctx.shadowBlur = 6;
    }

    if (b.type === 'circle') {
      const grd = ctx.createRadialGradient(
        b.position.x - b.radius * 0.3, b.position.y - b.radius * 0.3, b.radius * 0.1,
        b.position.x, b.position.y, b.radius);
      grd.addColorStop(0, hsl(b.hue, b.sat, Math.min(lum + 18, 95)));
      grd.addColorStop(1, hsl(b.hue, b.sat, Math.max(lum - 14, 6)));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(b.position.x, b.position.y, b.radius, 0, M.TAU);
      ctx.fill();
      // orientation tick
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hsl(b.hue, b.sat, Math.min(lum + 30, 98), 0.6);
      ctx.lineWidth = Math.max(1.4, b.radius * 0.08);
      ctx.beginPath();
      ctx.moveTo(b.position.x, b.position.y);
      ctx.lineTo(b.position.x + Math.cos(b.angle) * b.radius, b.position.y + Math.sin(b.angle) * b.radius);
      ctx.stroke();
    } else {
      const wv = b.worldVerts();
      ctx.beginPath();
      ctx.moveTo(wv[0].x, wv[0].y);
      for (let i = 1; i < wv.length; i++) ctx.lineTo(wv[i].x, wv[i].y);
      ctx.closePath();
      // subtle directional gradient for depth
      const c = b.position;
      const grd = ctx.createLinearGradient(c.x, c.y - 20, c.x, c.y + 20);
      grd.addColorStop(0, hsl(b.hue, b.sat, Math.min(lum + 12, 95)));
      grd.addColorStop(1, hsl(b.hue, b.sat, Math.max(lum - 12, 6)));
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = hsl(b.hue, b.sat, Math.min(lum + 28, 96), 0.55);
      ctx.stroke();
    }

    // damage cracks (health based)
    const dmg = 1 - b.health / b.maxHealth;
    if (dmg > 0.25 && b.destructible) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(0,0,0,${0.25 + dmg * 0.4})`;
      ctx.lineWidth = 1;
      const br = b.boundRadius();
      const seed = b.id * 9301;
      ctx.beginPath();
      for (let k = 0; k < 3 + (dmg * 4 | 0); k++) {
        const a1 = ((seed * (k + 1)) % 100) / 100 * M.TAU;
        ctx.moveTo(b.position.x, b.position.y);
        ctx.lineTo(b.position.x + Math.cos(a1) * br * dmg, b.position.y + Math.sin(a1) * br * dmg);
      }
      ctx.stroke();
    }
    ctx.restore();

    if (glow) this.addLight(b.position.x, b.position.y, b.boundRadius() * (2 + b.burning * 3), 26, b.burning * 0.5);
  }

  drawConstraint(c) {
    if (!c.render || c.broken) return;
    const ctx = this.ctx;
    const pa = c.a.position.add(c.anchorA.rotate(c.a.angle));
    const pb = c.b.position.add(c.anchorB.rotate(c.b.angle));
    ctx.strokeStyle = hsl(c.hue, 80, 60, 0.85);
    ctx.shadowColor = hsl(c.hue, 90, 60); ctx.shadowBlur = 8;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  drawParticles(ps) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.max; i++) {
      if (ps.life[i] <= 0) continue;
      const t = ps.life[i] / ps.maxLife[i];
      const type = ps.type[i];
      let a = t;
      if (type === 1) a = t * 0.4;        // smoke softer
      const lum = type === 1 ? 30 : ps.lum[i];
      ctx.fillStyle = hsl(ps.hue[i], ps.sat[i], lum, a);
      const s = ps.size[i] * (type === 1 ? 1 : (0.4 + t * 0.6));
      ctx.beginPath();
      ctx.arc(ps.x[i], ps.y[i], s, 0, M.TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawLights() {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, hsl(l.hue, 95, 60, l.a));
      g.addColorStop(1, hsl(l.hue, 95, 55, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.r, 0, M.TAU);
      ctx.fill();
    }
    // shockwaves
    for (const s of this.shockwaves) {
      ctx.strokeStyle = hsl(s.hue, 95, 70, s.life * 0.8);
      ctx.lineWidth = (2 + s.life * 8) / this.cam.zoom;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, M.TAU);
      ctx.stroke();
      const g = ctx.createRadialGradient(s.x, s.y, s.r * 0.7, s.x, s.y, s.r);
      g.addColorStop(0, hsl(s.hue, 95, 60, 0));
      g.addColorStop(1, hsl(s.hue, 95, 65, s.life * 0.25));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, M.TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    this.lights.length = 0;
  }

  vignette() {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
