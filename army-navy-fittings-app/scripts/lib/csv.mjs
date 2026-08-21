/**
 * Minimal RFC-4180 CSV reader.
 *
 * Written by hand rather than pulled from npm because the import pipeline runs
 * over a file containing cost prices, and a dependency-free parser is one less
 * thing with access to it.
 */

/** @param {string} text @returns {string[][]} */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  // Strip a UTF-8 BOM: Google Sheets exports one and it would otherwise become
  // part of the first header name.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Finds the header row and returns the records beneath it keyed by column name.
 *
 * The export carries a free-text rule line above the header, so the header is
 * located by looking for the required column rather than assumed to be row 0.
 *
 * @param {string[][]} rows
 * @param {string} anchorColumn a column name that must be present in the header
 * @returns {{ header: string[], records: Record<string, string>[], headerIndex: number }}
 */
export function toRecords(rows, anchorColumn) {
  const headerIndex = rows.findIndex((r) => r.some((c) => c.trim() === anchorColumn));
  if (headerIndex === -1) {
    throw new Error(`Could not find a header row containing the column "${anchorColumn}".`);
  }
  const header = rows[headerIndex].map((h) => h.trim());
  const records = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw.some((c) => c.trim() !== '')) continue; // blank spacer row
    /** @type {Record<string, string>} */
    const record = {};
    header.forEach((name, col) => {
      record[name] = (raw[col] ?? '').trim();
    });
    records.push(record);
  }
  return { header, records, headerIndex };
}
