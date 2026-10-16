export function f(custom, CUSTOM_SHORTHAND, CUSTOM_SUMMARY) {
  const wholeCard = new Set([...custom]);
  for (const s of Object.values(CUSTOM_SUMMARY)) {
    for (const tok of String(s).split(' ').filter(Boolean)) wholeCard.add(tok);
  }
  for (const tok of Object.keys(CUSTOM_SHORTHAND)) wholeCard.add(tok);

  const emitted = [...wholeCard]
    .sort()
    .map((tok) => (CUSTOM_SHORTHAND[tok]
      ? { token: tok, label: labelForShorthand(tok), meaning: CUSTOM_SHORTHAND[tok] }
      : null))
    .filter(Boolean);
  return emitted;
}

function labelForShorthand(tok) {
  const m = /^([A-Za-z]{1,4})(\d*)(?:x(\d*))?$/.exec(tok);
  if (!m) return tok;
  const [, letters, num, times] = m;
  const name = { HP: 'HP cost', A: 'Attack', BLK: 'Block', PWR: 'Strength', D: 'Draw', E: 'Energy' }[letters] ?? letters;
  if (times !== undefined) return `${name} ${num} ×${times || 'all'}`;
  return num ? `${name} ${num}` : name;
}
