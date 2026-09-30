import * as THREE from 'three';
import { Aircraft, DATA } from '../sim/flight.js';
import { SHIP, rampHeight, Carrier } from '../sim/world.js';
const D2R=Math.PI/180, R2D=180/Math.PI;
class Ship extends THREE.Object3D { constructor(){ super(); this.velocity=new THREE.Vector3(0,0,-12);
  this.velocity=new THREE.Vector3(0,0,-12); const ca=Math.cos(SHIP.angle), sa=Math.sin(SHIP.angle); this.landDir=new THREE.Vector3(-sa,0,-ca); this.landPerp=new THREE.Vector3(ca,0,-sa);
  const t=SHIP.wires[1]-5; this.touchdown=new THREE.Vector3(SHIP.landA.x-sa*t, SHIP.deckY, SHIP.landA.y-ca*t); const ta=t+4.3/Math.tan(4*D2R)+10.5; this.lensAim=new THREE.Vector3(SHIP.landA.x-sa*ta, SHIP.deckY, SHIP.landA.y-ca*ta);
  this.wires=SHIP.wires.map(t=>({t,c:new THREE.Vector3(SHIP.landA.x-sa*t,SHIP.deckY,SHIP.landA.y-ca*t)})); }
}
for (const k of ['deckAt','xRange','surfaceAt','update','wakeAt','setSea']) Ship.prototype[k] = Carrier.prototype[k];
const ship=new Ship(); ship.updateMatrixWorld();
const zero=new THREE.Vector3();
let simT=0;
const env={ wind:new THREE.Vector3(0,0,7), windAt(p){ return new THREE.Vector3(0,0,7).add(ship.wakeAt(p, simT)); }, surface(x,z){ const d=ship.surfaceAt(x,z);
  if(d) return d; return {h:0,n:new THREE.Vector3(0,1,0),v:zero,water:true}; } };
ship.setSea(parseFloat(process.env.SEA||'1')); ship.update(0);
const DT=1/240;
function run(ac, secs, ctl, logEvery=1, tag=''){
  let t=0, next=0;
  while(t<secs && !ac.crashed){ ctl && ctl(ac,t); ship.update(DT); ac.step(DT, env); t+=DT; simT+=DT; for(const [m] of ac._msgQ) console.log('   MSG', m); ac._msgQ.length=0; for(const e of ac.events){ if(['touchdown','airborne','hookbounce','stopped','crash','scrape'].includes(e.kind)) console.log('   EVT', e.kind, (()=>{const lp=ship.worldToLocal(ac.pos.clone()); return 'L('+lp.x.toFixed(1)+','+lp.y.toFixed(2)+','+lp.z.toFixed(1)+') hook '+ac.hookAng.toFixed(2)+' th '+((ac.t.theta||0)*57.3).toFixed(1);})(), JSON.stringify(e.sink||e.ias||e.run||e.msg||'')); } ac.events.length=0;
    if(t>=next){ next+=logEvery; const T=ac.t;
      console.log(`${tag} t=${t.toFixed(1)} V=${(T.V*3.6).toFixed(0)}kmh ias=${(T.ias*3.6).toFixed(0)} h=${ac.pos.y.toFixed(1)} a=${(T.alpha*R2D).toFixed(1)} th=${((T.theta||0)*R2D).toFixed(1)} ph=${((T.phi||0)*R2D).toFixed(0)} nz=${T.nz.toFixed(2)} vs=${T.vs.toFixed(1)} M=${T.M.toFixed(2)} dE=${(ac.dE*R2D).toFixed(1)} N=${ac.N[0].toFixed(2)} AB=${ac.AB[0].toFixed(2)} gnd=${ac.onGround} p=${((T.p||0)*R2D).toFixed(0)} hdg=${(T.heading||0).toFixed(0)}`); } }
  if(ac.crashed) { const lp=ship.worldToLocal(ac.pos.clone()); console.log(tag,'CRASH', ac.crashed, 't=',t.toFixed(2), 'local', lp.x.toFixed(1), lp.y.toFixed(2), lp.z.toFixed(1), 'deckrange', ship.xRange(lp.z).map(v=>v.toFixed(1))); }
  return t;
}
const mode=process.argv[2]||'launch';
const ac=new Aircraft();
if(mode==='launch'){
  const sp=SHIP.start[process.argv[3]==='short'?1:0]; const local=new THREE.Vector3(sp.x, SHIP.deckY+1.84, sp.z);
  ac.pos.copy(ship.localToWorld(local.clone())); if(process.argv[3]==='short'){ ac.fuel=2600; ac.stores=false; } ac.vel.copy(ship.velocity); ac.flap=ac.flapCmd=1; if(process.argv[3]!=='short') ac.fuel=DATA.fuelMax*0.95;
  ac.setEnginesRunning(); ac.holdback={ship, local:local.clone()};
  ac.inp.throttle=1;
  run(ac, 7, null, 1, 'hold');
  ac.holdback=null;
  run(ac, 25, (a,t)=>{ a.inp.pitch = (a.onGround? 0 : (t<4? 0.35:0.15)); if(t>6) a.gearCmd=0; if(t>9) a.flapCmd=0; }, 0.5, 'fly');
} else if(mode==='level'){
  ac.pos.set(0,parseFloat(process.argv[4]||'100'),0); ac.vel.set(0,0,-150); ac.gear=ac.gearCmd=0; ac.inp.throttle=parseFloat(process.argv[3]||'1'); ac.setEnginesRunning(); for(const e of ac.engines) e.N=1;
  ac.quat.setFromEuler(new THREE.Euler(3*D2R,0,0,'YXZ'));
  run(ac, 120, (a,t)=>{ a.inp.pitch=0; }, 10, 'lvl');
} else if(mode==='turn'){
  ac.pos.set(0,3000,0); ac.vel.set(0,0,-240); ac.gear=ac.gearCmd=0; ac.inp.throttle=1; ac.setEnginesRunning(); for(const e of ac.engines) e.N=1;
  ac.quat.setFromEuler(new THREE.Euler(2*D2R,0,0,'YXZ'));
  run(ac, 3, null, 1, 'pre');
  run(ac, 2.5, (a,t)=>{ a.inp.roll=1; }, 0.25, 'roll');
  run(ac, 1.2, (a,t)=>{ a.inp.roll=0; }, 0.4, 'stop');
  run(ac, 8, (a,t)=>{ a.inp.pitch=1; a.inp.roll= (a.t.phi*R2D<80? 0.3: (a.t.phi*R2D>90?-0.3:0)); }, 0.5, 'pull');
} else if(mode==='slow'){
  ac.pos.set(0,3000,0); ac.vel.set(0,0,-120); ac.gear=ac.gearCmd=0; ac.inp.throttle=0.0; ac.setEnginesRunning();
  run(ac, 40, (a,t)=>{ a.inp.pitch=1; }, 2, 'slow');
} else if(mode==='approach'){
  const dir=ship.landDir.clone(); const td=ship.localToWorld(ship.touchdown.clone());
  const dist=5200, gs=4*D2R; ac.pos.copy(td).addScaledVector(dir,-dist); ac.pos.y=SHIP.deckY+dist*Math.tan(gs)+2;
  ac.vel.copy(dir).multiplyScalar(60); ac.vel.y=-(60-ship.velocity.dot(dir))*Math.tan(gs);
  ac.quat.setFromEuler(new THREE.Euler(7.5*D2R, Math.atan2(-dir.x,-dir.z),0,'YXZ'));
  ac.gear=ac.gearCmd=1; ac.flap=ac.flapCmd=1; ac.hook=ac.hookCmd=1; ac.fuel=1600; ac.stores=false; ac.inp.throttle=parseFloat(process.argv[3]||'0.33'); ac.setEnginesRunning(); for(const e of ac.engines) e.N=0.83;
  run(ac, 40, null, 2, 'app');
}
if(mode==='trap'){
  const dir=ship.landDir.clone(); const td=ship.localToWorld(ship.lensAim.clone());
  const dist=parseFloat(process.argv[3]||'2500'), gs=4*D2R; ac.pos.copy(td).addScaledVector(dir,-dist); ac.pos.y=SHIP.deckY+dist*Math.tan(gs)+2;
  ac.vel.copy(dir).multiplyScalar(57); ac.vel.y=-(57-ship.velocity.dot(dir))*Math.tan(gs);
  ac.quat.setFromEuler(new THREE.Euler(7.5*D2R, Math.atan2(-dir.x,-dir.z),0,'YXZ'));
  ac.gear=ac.gearCmd=1; ac.flap=ac.flapCmd=1; ac.hookCmd=1; ac.hookAng=38*D2R; ac.fuel=1600; ac.stores=false; ac.inp.throttle=0.29; ac.setEnginesRunning(); for(const e of ac.engines) e.N=0.83;
  let last=null, trapped=false, ie=0, maxDec=0;
  run(ac, 140, (a,t)=>{
    const eye=new THREE.Vector3(0,1.12,-5.05).applyQuaternion(a.quat).add(a.pos); const lp=ship.worldToLocal(eye); const d=lp.clone().sub(ship.lensAim); const along=-d.dot(ship.landDir); const lat=d.dot(ship.landPerp);
    const hWant=Math.max(along,0)*Math.tan(gs); const eh=hWant-d.y;
    if(((Math.round(t*4)%8===0 && along<900) || (along<350 && along>-60 && Math.round(t*20)%4===0)) && along<900 && Math.abs(t*4-Math.round(t*4))<0.01) console.log('   AP along',along.toFixed(0),'eh',eh.toFixed(1),'lat',lat.toFixed(1),'vs',a.vel.y.toFixed(1)); const vsDes=-3.3+0.4*eh; a.inp.pitch = THREE.MathUtils.clamp(0.012*(vsDes-a.vel.y) ,-0.3,0.3);
    ie += ((a.t.alpha*R2D)-10.5)*DT;
    a.inp.throttle = THREE.MathUtils.clamp(0.30 + 0.025*((a.t.alpha*R2D)-10.5) + 0.002*ie + 0.02*(vsDes-a.vel.y), 0.1, 0.8);
    const latv = a.vel.clone().sub(ship.velocity).dot(ship.landPerp);
    const phiDes = THREE.MathUtils.clamp(-0.004*lat - 0.02*latv, -0.25, 0.25);
    a.inp.roll = THREE.MathUtils.clamp(1.2*(phiDes-(a.t.phi||0)), -0.25, 0.25);
    if(a.onGround) { a.inp.throttle=0.85; a.inp.pitch=0.15; }
    // wires
    if(!a.arrest){ const tip=a.hookTipWorld(); const tl=ship.worldToLocal(tip.clone()); const dk=ship.deckAt(tl.x,tl.z);
      const cur=ship.wires.map(w=>tl.clone().sub(w.c).dot(ship.landDir));
      if(dk && tl.y-dk.h<0.14 && a.hookBounce===0 && last){ for(let i=0;i<3;i++){ const w=ship.wires[i]; const perp=Math.abs(tl.clone().sub(w.c).dot(ship.landPerp));
        if(last[i]<0 && cur[i]>=0 && perp<SHIP.wireSpan){ const rv=a.vel.clone().sub(ship.velocity); const v=Math.max(rv.dot(ship.landDir),5);
          a.arrest={ship, dirL:ship.landDir.clone(), p0:ship.worldToLocal(a.pos.clone()), stop:82, wire:i+1, t:0, v0:v};
          console.log('TRAP wire',i+1,'closure',(rv.length()*3.6).toFixed(0),'sink',(-a.vel.y).toFixed(1),'t',t.toFixed(1)); } } }
      last=cur; }
    if(a.arrest && !trapped){ a._lt=(a._lt||0)+1; if(a._lt%12==0){ const rv=a.vel.clone().sub(ship.velocity).dot(ship.landDir); console.log('  AR t',a.arrest.t.toFixed(2),'run',a.arrest.run.toFixed(1),'v',(rv*3.6).toFixed(0),'F/mg',a.arrest.decel.toFixed(2),'th',(a.t.theta*57.3).toFixed(1),'q',(a.omega.x*57.3).toFixed(1)); } }
    if(a.arrest && a.arrest.decel) maxDec=Math.max(maxDec,a.arrest.decel); if(a.arrest && a.arrest.stopped && !trapped){ trapped=true; console.log('STOPPED run',a.arrest.run.toFixed(1),'peak decel',maxDec.toFixed(2),'g'); a.inp.throttle=0; }
  }, 2, 'trap');
}
