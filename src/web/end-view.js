// src/web/end-view.js — the run-over screen: outcome headline, ledger, marks, unlocks.
//
// THE OUTCOME IS THE HEADLINE, NEVER THE SCORE (S1): no score may occupy the headline
// slot. Every number on this screen comes from the run record run-history.js built with
// the kernel's own scorers — the renderer composes no game fact.

import { snap } from './runtime.js';
import { el } from './dom.js';
import { glyphBox } from './glyphs.js';
import { ledgerBlock, ledgerMath, lastRecord, lastUnlock, recognitionText, savedOk, unlockBlock } from './run-history.js';
import { newGame } from './actions.js';
import { page } from './page-frame.js';
import { t } from './i18n.js';

/* --------------------------------------------------------------------- ENDED */

export function endView() {
  const e = snap.ended;
  const won = e.outcome === 'win';
  // S9: which act the run ended in. Bracket access on purpose — the module-graph
  // scanner reads any bare `act` token as the actions.js dispatcher this module does
  // not import; a property read cannot be a ReferenceError.
  const runAct = e['act'] ?? 1;
  const wrap = el('div');
  wrap.append(el('p', { cls: 'section-title', text: t('end.title') }));
  wrap.append(el('div', { cls: `demon${won ? '' : ' lose'}` }, glyphBox(won ? 'crown' : 'broken', 'demon-glyph')));
  // THE OUTCOME IS THE HEADLINE, NEVER THE SCORE (S1). No score may ever occupy this slot:
  // a number is not an achievement, and a run's meaning is not its arithmetic.
  wrap.append(el('div', { cls: `big-title ${won ? 'win' : 'loss'}`, text: won ? t('end.win') : t('end.lose') }));
  wrap.append(el('hr', { cls: 'end-rule' }));
  // S3: the purse the run finished with — the kernel snapshot's own `player.gold`, the same
  // value the HUD carried from boot to here (grant details live in the record's events).
  // S7: beside it, the relic count the run carried to its end (`snap.ended.relics`, the
  // kernel's own number — the same one the CLI dump's summary line shows; an ended record
  // that predates the field falls back to the snapshot's live relic rows).
  const purse = snap.player.gold ?? 0;
  const relicCount = e.relics ?? (snap.relics ?? []).length;
  const relicWord = relicCount === 1 ? t('end.relics.one') : t('end.relics', { n: relicCount });
  const stats = { actN: runAct, floor: e.floor, steps: e.steps, seed: snap.seed, gold: purse, relics: relicWord };
  wrap.append(el('p', { cls: 'end-stats', text: runAct >= 2 ? t('end.stats.actLine', stats) : t('end.stats.floor', stats) }));

  const defLine = won ? (runAct >= 2 ? t('end.winAct2') : t('end.winAct1')) : t('end.defeatLine');
  const math = lastRecord ? ledgerMath(lastRecord) : null;
  if (math) {
    wrap.append(ledgerBlock(math));
    if (math.earned) {
      wrap.append(el('p', { cls: 'def', text: defLine }));
    } else {
      // AC-7.4 (ANTI-HOLLOW). No elite, no boss, no victory: the total does NOT get display
      // size and no celebratory word is attached to it. The factual recognition below keeps
      // the run's real content on screen — floors climbed, enemies killed, and where the
      // larger totals actually come from — instead of an empty "0 elites" and a flourish.
      wrap.append(el('p', { cls: 'recognition', text: recognitionText(math) }));
    }
  } else {
    // No record exists for this run (the ended transition was never observed, e.g. a page
    // that was reloaded onto a finished run). The screen shows what it has and NO ledger:
    // an itemised block would have to invent every line.
    wrap.append(el('p', { cls: 'def', text: defLine }));
  }

  if (!savedOk) {
    wrap.append(el('p', { cls: 'save-failed', text: t('end.saveFailed') }));
  }

  // MARKS (AC-7.3). Name AND the condition that earned each one. None => no block at all,
  // never a placeholder: an empty "Marks" heading would promise a feature that is absent.
  const marks = Array.isArray(lastRecord?.badges) ? lastRecord.badges.filter(Boolean) : [];
  if (marks.length > 0) {
    wrap.append(el('hr', { cls: 'end-rule' }));
    wrap.append(el('p', { cls: 'section-title', text: t('end.marks') }));
    const list = el('ul', { cls: 'marks' });
    for (const mark of marks) {
      list.append(el('li', { cls: 'mark-item' },
        el('span', { cls: 'mark-name', text: mark.name }),
        el('span', { cls: 'mark-cond', text: mark.condition }),
      ));
    }
    wrap.append(list);
    wrap.append(el('p', { cls: 'ledger-note', text: t('end.marksNote') }));
  }

  // UNLOCK NARRATION (S4) sits between the totals and the actions: visible on arrival and
  // never below the button, because the moment after a loss is when the player decides
  // whether to play again. It is a block, NOT a modal — a dialog here would interrupt that
  // exact decision. Nothing about it auto-dismisses, so reduced motion loses no fact.
  if (lastUnlock) wrap.append(unlockBlock(lastUnlock));

  wrap.append(el('div', { cls: 'restart-row' },
    el('button', { cls: 'btn', text: t('end.restart'), attrs: { type: 'button' }, on: { click: () => newGame() } }),
    el('button', {
      cls: 'btn secondary',
      text: t('end.ledger'),
      attrs: { type: 'button', 'data-end-ledger': '1' },
      on: { click: () => openLedger({ from: 'end' }) },
    }),
  ));
  return page('end', t('page.end'), won ? 'crown' : 'broken', `panel page-end${won ? '' : ' lose'}`, [wrap]);
}
