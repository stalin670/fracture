const fs=require('fs'),vm=require('vm');
const files=['math','body','collision','world','particles','destruction','entities'];
let src=files.map(f=>fs.readFileSync('js/'+f+'.js','utf8')).join('\n;\n');
const ctx={console,Math,isFinite,Float32Array,Uint8Array,Map,Set,Array,JSON,performance:{now:()=>0}};
vm.createContext(ctx);vm.runInContext(src,ctx);
const out=vm.runInContext(`(function(){
  const w=new World({gravity:980});
  // walled basin: floor + two walls
  w.add(makeBox(0,600,800,80,{material:'stone',isStatic:true}));
  w.add(makeBox(-260,500,40,280,{material:'stone',isStatic:true}));
  w.add(makeBox(260,500,40,280,{material:'stone',isStatic:true}));
  const lq=new Liquid({max:700});
  for(let i=0;i<500;i++) lq.add(Math.random()*400-200, -Math.random()*300, 0,0,200);
  for(let i=0;i<900;i++){ w.step(1/120); lq.step(1/120,980,w); }
  let above=0,below=0,minY=1e9,maxY=-1e9;
  for(let i=0;i<lq.py.length;i++){ const y=lq.py[i]; if(y<=562)above++; else below++; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  return {count:lq.count, aboveFloor:above, leakedBelow:below, minY:+minY.toFixed(1), maxY:+maxY.toFixed(1)};
})()`,ctx);
console.log(JSON.stringify(out,null,2));
