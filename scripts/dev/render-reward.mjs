// Render the reward screen the way the browser does, and dump the tree.
class N {
  constructor(tag){ this.tag=tag; this.kids=[]; this.a={}; this.txt=''; this.style={}; }
  append(...c){ for(const x of c) if(x!=null) this.kids.push(x); }
  appendChild(c){ this.kids.push(c); return c; }
  replaceChildren(...c){ this.kids=c.filter(Boolean); }
  querySelector(){ return new N('i'); }
  addEventListener(){}
  setAttribute(k,v){ this.a[k]=v; }
  set textContent(v){ this.txt=v; } get textContent(){ return this.txt; }
}
const mk=(t)=>new N(t);
globalThis.document={ getElementById:()=>mk('div'), createElement:mk, createTextNode:(t)=>{const n=mk('#text');n.txt=t;return n;}, querySelector:()=>mk('div'), addEventListener(){}, body:mk('body') };
globalThis.window={ addEventListener(){}, location:{search:''} };
globalThis.location={ search:'' };
globalThis.localStorage={ _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=v;} };
globalThis.requestAnimationFrame=(f)=>f();
globalThis.URLSearchParams=URLSearchParams;

const fs=await import('node:fs');
let src=fs.readFileSync(new URL('../../web/app.js', import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/\bboot\(\)\s*;?\s*$/,'');
const ctlMod=await import('../../src/surface/gui/controller.js');

// drive to a reward screen
let ctl=ctlMod.createController({run:{seed:1}});
ctl.dispatch('n1');
let snap;
for(let i=0;i<80;i++){
  snap=ctl.snapshot();
  if(snap.phase==='reward') break;
  if(snap.ended) break;
  const a=snap.actions?.[0]; if(!a) break;
  ctl.dispatch(a.id??a);
}
console.log('phase:', snap.phase);
// app.js declares its own `let snap/location`; rename ours to avoid a redeclare.
const fn=new Function(`const __ctl=arguments[0]; function createController(){return __ctl;}\n` + src + `\n__snap = arguments[1]; return { rewardView };`);
let __snap;
const api=fn(ctl, snap);
function walk(n,d=0,out=[]){
  if(!n) return out;
  const cls=n.a.cls||'';
  const t=n.txt?` "${n.txt}"`:'';
  out.push('  '.repeat(d)+`<${n.tag}${cls?' .'+cls.split(' ').join('.'):''}>${t}`);
  for(const k of n.kids) walk(k,d+1,out);
  return out;
}
const lines=walk(api.rewardView());
console.log(lines.join('\n'));
console.log('\n--- any literal "undefined"? ---');
console.log(lines.filter(l=>l.includes('undefined')).join('\n') || '  none in the tree');
