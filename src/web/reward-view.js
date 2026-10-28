// src/web/reward-view.js — the spoils screen after a victory: three cards, one choice,
// and the gold the fight just paid (S3); on the boss, the warden's three relic offers
// replace the cards (S7) and the elite's guaranteed relic names itself beside the gold.

import { arriving, snap } from './runtime.js';
import { el, keywordText, sceneIllus } from './dom.js';
import { cardTile } from './combat-view.js';
import { consumeClick } from './targeting.js';
import { act } from './actions.js';
import { page } from './page-frame.js';
import { glyphBox } from './glyphs.js';

export function rewardView() {
  const wrap = el('div');
  // The reward arrives after a victory, so the spoils head and the three tiles come in as a
  // sequence rather than all at once. `.reveal` is on the ONCE-per-arrival class string
  // built in `render()`; an incidental repaint inside the phase reproduces the same string
  // and the browser restarts nothing.
  wrap.append(sceneIllus('reward'));
  // S7: the boss reward carries the relic offers INSTEAD of the cards, so the head names
  // the different choice. Everything below reads the kernel's own snapshot rows.
  // S10: `isBoss` reads the kernel's own flag, not the offer count — a warden whose
  // vault is empty (the profile has not unlocked the rare tier yet) is STILL the
  // warden's reward, and rendering it as an empty card reward would promise a pick
  // that does not exist. The empty case gets its own honest branch below.
  const isBoss = Boolean(snap.reward.boss);
  const boss = (snap.reward.relicOffers ?? []).length > 0;
  // S3: the head carries both facts the victory just produced — the choice offered and the
  // gold paid. The +N is the kernel's own `snap.reward.goldGained` (set in the same breath
  // as the grant), and `purse` is the total it landed in: one computed value each, never
  // re-derived here. null goldGained (a legacy save's reward predates the field) hides the
  // chip instead of printing "+0" for a grant the engine never computed.
  const head = el('div', { cls: 'reward-head' + (arriving.reward ? ' reveal' : '') });
  head.append(el('span', { text: boss ? 'Victory — claim the warden\u2019s relic' : isBoss ? 'Victory — the warden offers nothing' : 'Victory — choose a card' }));
  if (snap.reward.goldGained != null) {
    head.append(el('span', { cls: 'reward-gold', attrs: { title: `Spoils of the fight — purse: ${snap.reward.purse} gold` } },
      glyphBox('coin', 'coin-glyph'),
      el('span', { text: `+${snap.reward.goldGained} gold` }),
    ));
  }
  // S7: an elite's GUARANTEED drop, named beside the gold exactly like it. The row is the
  // kernel's `relicGained` (null when this fight dropped nothing — no chip, never "+0");
  // the tooltip is the relic's own kernel sentence.
  const gained = snap.reward.relicGained;
  if (gained) {
    head.append(el('span', { cls: 'reward-relic', attrs: { title: `${gained.name} — ${gained.text || 'unknown relic'}` } },
      glyphBox('relic', 'coin-glyph'),
      el('span', { text: gained.name }),
    ));
  }
  wrap.append(head);

  if (isBoss) {
    // S10/UX-1: the warden's vault is EXHAUSTED — the run holds every relic its pool
    // can give (through play this is reachable on a fresh profile: the elite-heavy
    // climb can hold all five commons by the act-2 warden; a gated pool otherwise
    // offers down-tier commons first). The count is TRUE and the screen says so
    // plainly instead of padding the offer or pretending this is a card reward. The
    // one way out is the walk-away the kernel itself offers (it climbs on — winning
    // is what widens the vault for the NEXT run).
    if (!boss) {
      wrap.append(el('div', { cls: 'boon-list' + (arriving.reward ? ' reveal' : '') },
        el('p', { cls: 'boon-name', text: 'You hold everything the warden\u2019s vault can give.' }),
        keywordText(el('p', { cls: 'boon-text' }), 'New relics enter the vault as your lifetime climbs win.'),
      ));
      const controls = el('div', { cls: 'controls' });
      if (snap.reward.canSkip) {
        controls.append(el('button', {
          cls: 'btn secondary',
          text: 'Walk away',
          attrs: { type: 'button', title: 'Leave the vault — the climb goes on' },
          on: { click: () => act(snap.reward.skipId) },
        }));
      }
      controls.append(el('span', { cls: 'hint', text: 'Win climbs to fill the warden\u2019s vault' }));
      wrap.append(controls);
      return page('reward', 'III — The Warden\u2019s Relic', 'star', 'panel', [wrap]);
    }
    // The warden's offers, one boon-style button each (the kindling boon list is the
    // precedent: name, then the kernel's own sentence). Every button's id is the
    // snapshot's `actionId` — null exactly when the kernel offers no pick (a torn id or
    // an already-held relic), and a null-id offer renders INERT with its raw name rather
    // than promising a click the engine would reject.
    const list = el('div', { cls: 'boon-list' + (arriving.reward ? ' reveal' : '') });
    for (const o of snap.reward.relicOffers) {
      list.append(el('button', {
        cls: 'boon relic-offer' + (o.actionId ? '' : ' inert'),
        attrs: {
          type: 'button',
          ...(o.actionId ? { 'data-action': o.actionId } : {}),
          'aria-label': `${o.name}: ${o.text || 'unknown relic'}`,
          title: o.actionId ? `Take ${o.name}` : 'This relic cannot be taken',
        },
        ...(o.actionId ? { on: { click: (ev) => { consumeClick(ev); act(o.actionId); } } } : {}),
      },
      el('span', { cls: 'boon-name', text: o.name }),
      keywordText(el('span', { cls: 'boon-text' }), o.text || 'An unknown relic — its id is not in this build\u2019s table.'),
      ));
    }
    wrap.append(list);
    const controls = el('div', { cls: 'controls' });
    if (snap.reward.canSkip) {
      controls.append(el('button', {
        cls: 'btn secondary',
        text: 'Walk away',
        // True in every shape the run can be in: a one-act (legacy) run ends here, a
        // two-act climb goes on. Saying which would be a rule the kernel owns — the
        // button only refuses the relic.
        attrs: { type: 'button', title: 'Leave the relic where it lies' },
        on: { click: () => act(snap.reward.skipId) },
      }));
    }
    controls.append(el('span', { cls: 'hint', text: 'Take one relic — it stays with you for the rest of the climb' }));
    wrap.append(controls);
    return page('reward', 'III — The Warden\u2019s Relic', 'star', 'panel', [wrap]);
  }

  const row = el('div', { cls: 'hand' + (arriving.reward ? ' reveal-cards' : '') });
  for (const c of snap.reward.cards) {
    // The reward tile's own action: taking a card, not playing one. Marked with `data-action`
    // so the hotkey handler can also reach it.
    const tile = cardTile(
      { slot: c.actionId, cardId: c.cardId, name: c.name, flavor: c.flavor, cost: c.cost, type: c.type, typeLabel: c.typeLabel, summary: c.summary, description: c.description, hint: c.hint, playable: true, showSummary: false },
      { actionId: c.actionId, onClick: (ev) => { consumeClick(ev); act(c.actionId); } },
    );
    row.append(tile);
  }
  wrap.append(row);
  const controls = el('div', { cls: 'controls' });
  if (snap.reward.canSkip) {
    controls.append(el('button', {
      cls: 'btn secondary',
      text: `Skip  (HP ${snap.player.hp}/${snap.player.maxHp})`,
      attrs: { type: 'button' },
      on: { click: () => act(snap.reward.skipId) },
    }));
  }
  controls.append(el('span', { cls: 'hint', text: 'Click a card to add it to your deck' }));
  wrap.append(controls);
  return page('reward', 'III — The Spoils', 'star', 'panel', [wrap]);
}
