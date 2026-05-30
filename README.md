# ▲ FRACTURE — 2D Physics Sandbox

A self-contained neon physics sandbox. Custom rigid-body engine, fracturing
destruction, particle-based fluid, and fire propagation — pure HTML/CSS/JS,
no build step, no dependencies, no backend.

## Run

Open `index.html` in any modern browser (Chrome / Edge / Firefox). That's it.

## What's inside (every system is hand-written)

| System | File | Notes |
|---|---|---|
| Vector math + helpers | `js/math.js` | `Vec2`, RNG, `roundRect` polyfill |
| Rigid bodies | `js/body.js` | polygons + circles, mass/inertia from density, 8 materials |
| Collision | `js/collision.js` | SAT + reference/incident face clipping (Catto) |
| Physics world | `js/world.js` | spatial-hash broadphase, **warm-started accumulated-impulse solver**, distance/rope constraints, sleeping, explosions |
| Particles + fluid | `js/particles.js` | pooled FX + **Clavet double-density-relaxation SPH water** with viscosity |
| Destruction | `js/destruction.js` | convex-slicing fracture into shards |
| Constructs | `js/entities.js` | ragdolls, drivable vehicles, prefab structures |
| Camera | `js/camera.js` | pan / zoom-to-cursor / screen shake |
| Renderer | `js/render.js` | additive neon glow, dynamic lights, shockwaves, vignette |
| Tools | `js/tools.js` | grab, spawn, delete, explode, fire, water, rope, weld, blaster, ragdoll, vehicle |
| Save/Load | `js/storage.js` | full snapshot to `localStorage` |
| Orchestrator | `js/game.js` | fixed-timestep loop, fire spread, FX, input, maps, minimap |
| UI | `js/ui.js` | toolbar, spawn pickers, time/gravity controls, save slots |

## Controls

- **1–9** tools · **scroll** zoom · **right / middle / Alt-drag** pan · **WASD** pan
- **Space** pause · **F** freeze · **R** clear · **[ ]** time scale · **M** minimap
- **← →** drive the last spawned vehicle

## Engineering notes

The solver uses warm starting with persistent contact impulses, which is what
keeps tall stacks (verified stable to 15+ boxes, sub-pixel drift) from
collapsing. Sleeping bodies are treated as immovable so settled scenes are
cheap. Water is a position-based SPH variant tuned for cohesion and basin
containment rather than physical accuracy. Fire is an intensity field per body
that damages, spreads to flammable neighbours, and cooks off TNT.
