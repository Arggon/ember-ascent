/**
 * rows of {token, label, meaning} — no colon after the key anywhere.
 * @returns {Array<object>}
 */
export function rows() {
  const row = {};
  row.token = 'A';
  row.label = 'Attack';
  row.meaning = 'Deal the shown damage.';
  return [row];
}
