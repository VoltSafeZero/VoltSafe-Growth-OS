export interface CsvColumn {
  key: string;
  header: string;
}

/**
 * Neutralize CSV / spreadsheet formula injection.
 *
 * Cells that begin with =, +, -, @, TAB, or CR are interpreted as formulas
 * by Excel, LibreOffice Calc, and Google Sheets.  Prefixing with a single
 * quote (') forces those programs to treat the cell as plain text.  The
 * apostrophe is invisible to the reader inside a cell but is the standard
 * OWASP-recommended mitigation for CSV injection.
 */
function neutralizeFormula(str: string): string {
  if (str.length > 0 && /^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = neutralizeFormula(String(val));
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows: Record<string, unknown>[], columns: CsvColumn[]): string {
  const header = columns.map((c) => escapeValue(c.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escapeValue(row[c.key])).join(",")
  );
  return [header, ...lines].join("\r\n");
}

export function setCsvHeaders(res: any, filename: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
}
