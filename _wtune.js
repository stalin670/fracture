const fs=require('fs'),vm=require('vm');
const files=['math','body','collision','world','particles','destruction','entities'];
let src=files.map(f=>fs.readFileSync('js/'+f+'.js','utf8')).join('\n;\n');
const ctx={console,Math,isFinite,Float32Array,Uint8Array,Map,Set,Array,JSON,performance:{now:()=>0}};
vm.createContext(ctx);vm.runInContext(src,ctx);
function run(p){
 return vm.runInContext(`(function(){
  const w=new World({gravity:980});
  w.add(makeBox(0,600,800,80,{material:'stone',isStatic:true}));
  w.add(makeBox(-260,470,40,340,{material:'stone',isStatic:true}));
  w.add(makeBox(260,470,40,340,{material:'stone',isStatic:true}));
  const lq=new Liquid({max:700,h:${p.h},rest:${p.rest},k:${p.k},kNear:${p.kNear}});
  for(let i=0;i<500;i++) lq.add(Math.random()*440-220, -Math.random()*200, 0,0,200);
  let settleSpeed=0;
  for(let i=0;i<1000;i++){ w.step(1/120); lq.step(1/120,980,w); }
  let minY=1e9,maxY=-1e9,minX=1e9,maxX=-1e9,maxSp=0,nan=false;
  for(let i=0;i<lq.py.length;i++){
   const y=lq.py[i],x=lq.px[i]; if(!isFinite(x)||!isFinite(y)){nan=true;continue;}
   if(y<minY)minY=y;if(y>maxY)maxY=y;if(x<minX)minX=x;if(x>maxX)maxX=x;
   const s=Math.hypot(lq.vx[i],lq.vy[i]); if(s>maxSp)maxSp=s;
  }
  return {depth:+(maxY-minY).toFixed(0),width:+(maxX-minX).toFixed(0),topY:+minY.toFixed(0),maxSpeed:+maxSp.toFixed(0),nan};
 })()`,ctx);
}
const sets=[
 {h:26,rest:3.2,k:0.9,kNear:2.4},
 {h:24,rest:3.0,k:0.4,kNear:0.8},
 {h:22,rest:4.0,k:0.5,kNear:1.0},
 {h:20,rest:5.0,k:0.6,kNear:1.2},
 {h:24,rest:6.0,k:0.8,kNear:1.6},
];
for(const s of sets) console.log(JSON.stringify(s), '->', JSON.stringify(run(s)));
