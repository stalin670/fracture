const fs = require('fs');
const vm = require('vm');
const files = ['math','body','collision','world','particles','destruction','entities'];
let src = files.map(f => fs.readFileSync('js/' + f + '.js', 'utf8')).join('\n;\n');
const ctx = { console, Math, isFinite, Float32Array, Uint8Array, Map, Set, Array, JSON, performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 } };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const out = vm.runInContext(`(function(){
  const R={};
  // 15-tall tower stability
  const w=new World({gravity:980});
  w.add(makeBox(0,600,2000,80,{material:'stone',isStatic:true}));
  for(let i=0;i<15;i++) w.add(makeBox(0,540-i*42,40,40,{material:'wood'}));
  for(let i=0;i<1200;i++) w.step(1/120);
  let maxDrift=0; for(let i=1;i<w.bodies.length;i++) maxDrift=Math.max(maxDrift,Math.abs(w.bodies[i].position.x));
  R.tower15_maxDriftX=+maxDrift.toFixed(2);
  R.tower15_topY=+w.bodies[15].position.y.toFixed(1);

  // ragdoll integrity
  const w2=new World({gravity:980});
  w2.add(makeBox(0,600,3000,80,{material:'stone',isStatic:true}));
  const rd=Entities.ragdoll(w2,0,300,1.1);
  let nan=false,maxJointStretch=0;
  for(let i=0;i<900;i++){
    w2.step(1/120);
    for(const p of rd.parts) if(!isFinite(p.position.x)||!isFinite(p.position.y)) nan=true;
  }
  // measure head-torso distance vs rest
  const hd=rd.head.position.sub(rd.torso.position).len();
  R.ragdoll_nan=nan; R.ragdoll_headTorsoDist=+hd.toFixed(1); R.ragdoll_constraints=w2.constraints.length;
  R.ragdoll_headY=+rd.head.position.y.toFixed(1);

  // pyramid + explosion chain
  const w3=new World({gravity:980});
  w3.add(makeBox(0,600,3000,80,{material:'stone',isStatic:true}));
  Entities.pyramid(w3,0,560,7,'stone');
  for(let i=0;i<200;i++) w3.step(1/120);
  const before=w3.bodies.length;
  w3.explode(new Vec2(0,540),300,800);
  for(let i=0;i<60;i++) w3.step(1/120);
  R.pyramid_bodies=before;

  // perf: 300 boxes settling, time 200 steps
  const w4=new World({gravity:980});
  w4.add(makeBox(0,600,4000,80,{material:'stone',isStatic:true}));
  for(let i=0;i<300;i++) w4.add(makeBox((i%30-15)*44,500-((i/30)|0)*44,38,38,{material:'wood'}));
  const t0=performance.now();
  for(let i=0;i<200;i++) w4.step(1/120);
  const t1=performance.now();
  R.perf300_bodies=w4.bodies.length;
  R.perf300_msPerStep=+((t1-t0)/200).toFixed(3);
  let anyNan=false; for(const b of w4.bodies) if(!isFinite(b.position.x)) anyNan=true;
  R.perf300_nan=anyNan;

  // liquid stability
  const w5=new World({gravity:980});
  w5.add(makeBox(0,600,1200,80,{material:'stone',isStatic:true}));
  const lq=new Liquid({max:900});
  for(let i=0;i<700;i++) lq.add((Math.random()*400-200),(Math.random()*-200),0,0,200);
  let lnan=false;
  for(let i=0;i<200;i++){ w5.step(1/120); lq.step(1/120,980,w5); }
  for(let i=0;i<lq.px.length;i++) if(!isFinite(lq.px[i])||!isFinite(lq.py[i])) lnan=true;
  R.liquid_count=lq.count; R.liquid_nan=lnan;
  let avgY=0; for(let i=0;i<lq.py.length;i++) avgY+=lq.py[i]; R.liquid_avgY=+(avgY/lq.py.length).toFixed(1);
  return R;
})()`, ctx);
console.log(JSON.stringify(out, null, 2));
