// Replicates what web/app.js does: controller -> snapshot -> dispatch
const { createController } = await import('./src/surface/gui/controller.js');
const ctl = createController({ run: { seed: 42 } });
let steps = 0;
while (steps < 600) {
  const snap = ctl.snapshot();
  if (snap.over || snap.phase === 'ended') break;
  let list = [];
  try { list = ctl.actions() || []; } catch { list = snap.actions || []; }
  if (!list.length) list = snap.actions || [];
  if (!list.length) { console.log('no actions at step', steps); break; }
  const a = list[0];
  const id = typeof a === 'string' ? a : (a.id ?? a.act);
  if (!id) { console.log('no id, first action shape:', JSON.stringify(a)); break; }
  ctl.dispatch(id);
  steps++;
}
const fin = ctl.snapshot();
console.log('steps played :', steps);
console.log('final phase  :', fin.phase ?? fin.kind);
console.log('final hash   :', ctl.hash());
console.log('hand tiles   :', (fin.hand || []).length, '| enemies:', (fin.enemies || []).length);
console.log('snapshot keys:', Object.keys(fin).join(', '));
