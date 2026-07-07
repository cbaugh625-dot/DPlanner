/**
 * Minimal RFC-4180-ish CSV parser: quoted fields, escaped quotes (""),
 * embedded commas/newlines in quotes, CRLF tolerance. Header row required.
 */

export interface CsvRow {
  /** 1-based line number of the row's first line in the file (header = 1). */
  line: number;
  values: Record<string, string>;
}

export function parseCsv(content: string): { header: string[]; rows: CsvRow[] } {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let sawAny = false;

  const pushField = () => {
    fields.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    // Skip fully empty records (blank lines)
    if (!(fields.length === 1 && fields[0] === "")) {
      records.push({ line: recordStartLine, fields });
    }
    fields = [];
    recordStartLine = line;
  };

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    sawAny = true;
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      line++;
      pushRecord();
    } else if (c === "\r") {
      // handled by following \n; standalone \r treated as newline
      if (content[i + 1] !== "\n") {
        line++;
        pushRecord();
      }
    } else {
      field += c;
    }
  }
  if (sawAny && (field !== "" || fields.length > 0)) pushRecord();

  if (records.length === 0) return { header: [], rows: [] };

  const header = records[0].fields.map((h) => h.trim());
  const rows: CsvRow[] = records.slice(1).map((r) => {
    const values: Record<string, string> = {};
    header.forEach((h, idx) => {
      values[h] = (r.fields[idx] ?? "").trim();
    });
    return { line: r.line, values };
  });
  return { header, rows };
}
