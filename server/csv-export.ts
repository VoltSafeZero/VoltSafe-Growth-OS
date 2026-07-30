export interface CsvColumn {
  key: string;
  header: string;
}

// CSV injection guard: neutralize cells that start with formula-trigger characters
// (=, +, -, @) by prepending a tab. This prevents spreadsheet apps from evaluating
// attacker-controlled values as formulas while preserving the original text.
const FORMULA_PREFIX_RE = /^[=+\-@\t]/;

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (FORMULA_PREFIX_RE.test(str)) {
    str = "\t" + str;
  }
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
