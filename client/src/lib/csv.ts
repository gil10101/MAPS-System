/**
 * Client-side CSV export.
 *
 * Reports are already fetched and rendered in the browser, so a server export
 * endpoint would re-run the same query to produce data the page is holding.
 * Building the file here keeps the download identical to what the user is
 * looking at — including the filters they picked — and costs no round trip.
 */

export interface CsvColumn<Row> {
  /** Property to read off each row. */
  key: keyof Row & string;
  /** Header cell text. */
  label: string;
  /**
   * Optional presentation for the cell. Use it to write '9:30 AM' rather than
   * '09:30' — a spreadsheet is read by a person, not parsed back by this app.
   */
  format?: (value: Row[keyof Row & string], row: Row) => string;
}

/**
 * RFC 4180 quoting: a field is wrapped in quotes when it contains a delimiter,
 * a quote or a line break, and inner quotes are doubled. Skipping this turns a
 * cancellation reason with a comma in it into two columns.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Build a CSV from `rows` and hand it to the browser as a download.
 *
 * The blob URL is revoked on the next tick rather than immediately: Safari
 * needs the URL to still resolve when it processes the synthetic click.
 */
export function exportCsv<Row extends Record<string, any>>(
  filename: string,
  columns: CsvColumn<Row>[],
  rows: Row[]
): void {
  const header = columns.map((c) => escapeField(c.label)).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const raw = row[c.key];
        return escapeField(c.format ? c.format(raw, row) : raw);
      })
      .join(',')
  );

  // CRLF per RFC 4180, and a UTF-8 BOM so Excel reads accented names as text
  // rather than mojibake — clinic staff open these in Excel.
  const csv = `﻿${[header, ...body].join('\r\n')}\r\n`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 'Doctor Workload' + a date range -> 'medisync-doctor-workload-2026-07-01_2026-07-31.csv' */
export function reportFilename(title: string, from: string, to?: string): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `medisync-${slug}-${from}${to && to !== from ? `_${to}` : ''}.csv`;
}
