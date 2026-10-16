const entry = (token, label, meaning) => ({ token, label, meaning });
export const viaFactory = [entry('A', 'Attack', 'Deal the shown damage.')];
export const literalShort = [{ token: 'A', label: 'Attack', meaning: 'Deal the shown damage.' }];
export const literalPlus = [{ token: 'HP+', label: 'Heal', meaning: 'Heal HP equal to the damage dealt.' }];
export const literalXall = [{ token: 'A4xall', label: 'Attack all', meaning: 'Attack every enemy for 4 damage.' }];
export const literalBlk = [{ token: 'BLKx2', label: 'Block x2', meaning: 'Double your current Block.' }];
export const literalPwr = [{ token: 'PWRx2', label: 'Strength x2', meaning: 'Double your current Strength.' }];
export const literalExh = [{ token: 'EXH', label: 'Exhaust', meaning: 'The card leaves the fight for good.' }];
export const literalMulti = [{ token: 'A n + m', label: 'attack grows by m', meaning: 'The attack grows each time you play it.' }];
