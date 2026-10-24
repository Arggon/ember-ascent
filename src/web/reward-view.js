// src/web/reward-view.js — the spoils screen after a victory: three cards, one choice.

import { arriving, snap } from './runtime.js';
import { el, sceneIllus } from './dom.js';
import { cardTile } from './combat-view.js';
import { consumeClick } from './targeting.js';
import { act } from './actions.js';
import { page } from './page-frame.js';

export function rewardView() {
  const wrap = el('div');
  // The reward arrives after a victory, so the spoils head and the three tiles come in as a
  // sequence rather than all at once. `.reveal` is on the ONCE-per-arrival class string
  // built in `render()`; an incidental repaint inside the phase reproduces the same string
  // and the browser restarts nothing.
  wrap.append(sceneIllus('reward'));
  wrap.append(el('div', { cls: 'reward-head' + (arriving.reward ? ' reveal' : ''), text: 'Victory — choose a card' }));
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
