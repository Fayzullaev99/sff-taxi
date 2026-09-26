import type { TaxReport } from '../api/types';

/** Byte order mark: Excel then reads the file as UTF-8 (Uzbek letters, "so‘m"). */
const BOM = '﻿';

/** The report as CSV for the accountant (semicolons: Excel with a Russian/Uzbek locale). */
export function taxCsv(report: TaxReport): string {
  const rows = [
    ['Haydovchi', 'JShShIR', 'Safarlar', 'Aylanma (so‘m)', 'Soliq 1% (so‘m)', 'To‘langan'],
    ...report.drivers.map((d) => [
      d.fullName,
      d.pinfl,
      String(d.rides),
      String(d.base),
      String(d.amount),
      d.remitted ? 'ha' : 'yo‘q',
    ]),
    [
      'Jami',
      '',
      String(report.totals.rides),
      String(report.totals.base),
      String(report.totals.amount),
      '',
    ],
  ];
  const cell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // the PINFL must stay text in Excel, or its 14 digits turn into a rounded number
  const line = (r: string[]) =>
    r.map((v, i) => (i === 1 && /^\d+$/.test(v) ? `="${v}"` : cell(v))).join(';');
  return `${BOM}${rows.map(line).join('\r\n')}\r\n`;
}
