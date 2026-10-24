// Render the reward screen the way the browser does, and dump the tree.
import { bundleApp } from '../../tests/web/app-bundle.mjs';
class N {
  constructor(tag){ this.tag=tag; this.kids=[]; this.a={}; this.txt=''; this.style={}; }
  // Raw-string kids are wrapped as #text nodes, as the real DOM does (dom.js
  // keywordText appends plain strings); the tree dump below walks kids as nodes.
  append(...c){
    for(const x of c) if(x!=null){
      if(typeof x!=='object'){ const t=mk('#text'); t.txt=String(x); this.kids.push(t); continue; }
      this.kids.push(x);
    }
  }
  // src/web grew these two after the module split (map-view.js, combat-view.js cardTile).
  prepend(...c){
    for(const x of c) if(x!=null){
      if(typeof x!=='object'){ const t=mk('#text'); t.txt=String(x); this.kids.unshift(t); continue; }
      this.kids.unshift(x);
    }
  }
  insertBefore(n, ref){ if(ref==null || !this.kids.includes(ref)) return this.appendChild(n); this.kids.splice(this.kids.indexOf(ref),0,n); return n; }
  appendChild(c){ this.kids.push(c); return c; }
  replaceChildren(...c){ this.kids=c.filter(Boolean); }
  querySelector(){ return new N('i'); }
  addEventListener(){}
  setAttribute(k,v){ this.a[k]=v; }
  // src/web/fx.js throwLane() measures boxes (new after the module split): zero box,
  // as there is no layout in this host.
  getBoundingClientRect(){ return { x:0, y:0, top:0, left:0, right:0, bottom:0, width:0, height:0 }; }
  // dom.js el() writes className and cardTile adds a class: back both with a.cls,
  // which is what the tree dump below reads.
  get className(){ return this.a.cls || ''; }
  set className(v){ this.a.cls = String(v); }
  get classList(){
    const list = () => (this.a.cls || '').split(/\s+/).filter(Boolean);
    const set = (a) => { this.a.cls = a.join(' '); };
    return { contains:(c)=>list().includes(c), add:(...cs)=>set([...new Set([...list(),...cs])]), remove:(...cs)=>set(list().filter((x)=>!cs.includes(x))) };
  }
  set textContent(v){ this.txt=v; } get textContent(){ return this.txt; }
}
const mk=(t)=>new N(t);
globalThis.document={ getElementById:()=>mk('div'), createElement:mk, createTextNode:(t)=>{const n=mk('#text');n.txt=t;return n;}, querySelector:()=>mk('div'), addEventListener(){}, body:mk('body') };
globalThis.window={ addEventListener(){}, location:{search:''} };
globalThis.location={ search:'' };
globalThis.localStorage={ _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=v;} };
globalThis.requestAnimationFrame=(f)=>f();
globalThis.URLSearchParams=URLSearchParams;

// The surface is split into sibling ES modules (src/web/*.js); bundleApp concatenates
// them back into ONE body — the same evaluation contract this probe always used —
// re-binding the kernel/surface imports from the real modules, with createController
// stubbed by the factory below.
const { prelude, body, mods } = await bundleApp(new URL('../../src/web/app.js', import.meta.url), { stubController: true });
let src = body.replace(/\bboot\(\)\s*;?\s*$/, '');
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
const fn=new Function(`const __ctl=arguments[0]; const __mods=arguments[2]; function createController(){return __ctl;}\n${prelude}\n` + src + `\n__snap = arguments[1]; return { rewardView };`);
let __snap;
const api=fn(ctl, snap, mods);
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
