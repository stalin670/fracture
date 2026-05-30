/* FRACTURE — entities.js
 * Composite constructs: humanoid ragdolls (bodies + joints), wheeled vehicles
 * with a motor, and prefab structures used by procedural maps.
 */
'use strict';

const Entities = {
  ragdoll(world, x, y, scale = 1) {
    const s = scale;
    const parts = [];
    const mk = (px, py, w, h, mat = 'flesh') => {
      const b = makeBox(px, py, w, h, { material: mat, healthScale: 1.4 });
      b.hue = 14; b.sat = 50; b.light = 60;
      world.add(b); parts.push(b); return b;
    };
    const head = makeCircle(x, y - 56 * s, 13 * s, { material: 'flesh', healthScale: 1.4 });
    head.hue = 16; head.sat = 50; head.light = 64;
    world.add(head); parts.push(head);
    const torso = mk(x, y - 22 * s, 26 * s, 44 * s);
    const hipB = mk(x, y + 6 * s, 24 * s, 16 * s);
    const uLA = mk(x - 22 * s, y - 30 * s, 10 * s, 26 * s);
    const lLA = mk(x - 22 * s, y - 4 * s, 9 * s, 26 * s);
    const uRA = mk(x + 22 * s, y - 30 * s, 10 * s, 26 * s);
    const lRA = mk(x + 22 * s, y - 4 * s, 9 * s, 26 * s);
    const uLL = mk(x - 8 * s, y + 30 * s, 11 * s, 30 * s);
    const lLL = mk(x - 8 * s, y + 60 * s, 10 * s, 30 * s);
    const uRL = mk(x + 8 * s, y + 30 * s, 11 * s, 30 * s);
    const lRL = mk(x + 8 * s, y + 60 * s, 10 * s, 30 * s);

    const join = (a, b, ax, ay, bx, by, max = 9000) => {
      world.addConstraint(new Constraint(a, b,
        new Vec2(ax, ay), new Vec2(bx, by),
        { length: 0, stiffness: 0.9, maxForce: max, render: false, hue: 14 }));
    };
    join(head, torso, 0, 13 * s, 0, -22 * s, 6000);
    join(torso, hipB, 0, 22 * s, 0, -8 * s);
    join(torso, uLA, -13 * s, -20 * s, 0, -13 * s, 5000);
    join(uLA, lLA, 0, 13 * s, 0, -13 * s, 4000);
    join(torso, uRA, 13 * s, -20 * s, 0, -13 * s, 5000);
    join(uRA, lRA, 0, 13 * s, 0, -13 * s, 4000);
    join(hipB, uLL, -8 * s, 8 * s, 0, -15 * s, 6000);
    join(uLL, lLL, 0, 15 * s, 0, -15 * s, 5000);
    join(hipB, uRL, 8 * s, 8 * s, 0, -15 * s, 6000);
    join(uRL, lRL, 0, 15 * s, 0, -15 * s, 5000);

    return { type: 'ragdoll', parts, head, torso };
  },

  vehicle(world, x, y) {
    const chassis = makeBox(x, y, 120, 26, { material: 'metal' });
    chassis.hue = 200; chassis.sat = 60; chassis.light = 55;
    world.add(chassis);
    const cabin = makeBox(x, y - 22, 60, 26, { material: 'glass' });
    cabin.hue = 190; cabin.sat = 70; cabin.light = 70;
    world.add(cabin);
    world.addConstraint(new Constraint(chassis, cabin, new Vec2(0, -13), new Vec2(0, 13),
      { length: 0, stiffness: 1, maxForce: 12000, render: false }));

    const wheels = [];
    for (const wx of [-42, 42]) {
      const w = makeCircle(x + wx, y + 22, 20, { material: 'rubber' });
      w.hue = 280; w.sat = 65; w.light = 45;
      world.add(w);
      const c = new Constraint(chassis, w, new Vec2(wx, 14), new Vec2(0, 0),
        { length: 8, stiffness: 0.9, maxForce: 20000, render: false });
      world.addConstraint(c);
      wheels.push(w);
    }
    return { type: 'vehicle', chassis, cabin, wheels, motor: 0 };
  },

  driveVehicle(v, dir, dt) {
    for (const w of v.wheels) { w.angularVelocity += dir * 40 * dt; w.wake(); }
  },

  // ---- structures ----
  wall(world, x, y, cols, rows, brickW = 46, brickH = 24, mat = 'stone') {
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * brickW * 0.5;
      for (let c = 0; c < cols; c++) {
        const bx = x + c * brickW + offset;
        const by = y - r * brickH;
        const b = makeBox(bx, by, brickW - 2, brickH - 2, { material: mat });
        b.light += M.rand(-6, 6);
        world.add(b);
      }
    }
  },

  tower(world, x, y, height = 8, mat = 'stone') {
    const w = 70;
    for (let i = 0; i < height; i++) {
      const a = makeBox(x - w / 2, y - i * 50, 16, 46, { material: mat });
      const b = makeBox(x + w / 2, y - i * 50, 16, 46, { material: mat });
      const top = makeBox(x, y - i * 50 - 30, w + 16, 14, { material: mat });
      world.add(a); world.add(b); world.add(top);
    }
  },

  pyramid(world, x, y, base = 7, mat = 'stone') {
    const size = 38;
    for (let row = 0; row < base; row++) {
      const count = base - row;
      for (let c = 0; c < count; c++) {
        const bx = x + (c - count / 2) * size + size / 2;
        const by = y - row * size;
        world.add(makeBox(bx, by, size - 3, size - 3, { material: mat }));
      }
    }
  },
};
