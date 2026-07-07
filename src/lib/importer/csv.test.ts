import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple file with header", () => {
    const { header, rows } = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(header).toEqual(["a", "b", "c"]);
    expect(rows).toHaveLength(2);
    expect(rows[0].values).toEqual({ a: "1", b: "2", c: "3" });
    expect(rows[0].line).toBe(2);
  });

  it("handles quoted fields with commas, escaped quotes, and newlines", () => {
    const content = 'a,b\n"hello, world","say ""hi""\nsecond line"\n';
    const { rows } = parseCsv(content);
    expect(rows[0].values.a).toBe("hello, world");
    expect(rows[0].values.b).toBe('say "hi"\nsecond line');
  });

  it("tolerates CRLF and blank lines", () => {
    const { rows } = parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1].values).toEqual({ a: "3", b: "4" });
  });

  it("fills missing trailing fields with empty strings", () => {
    const { rows } = parseCsv("a,b,c\n1,2\n");
    expect(rows[0].values).toEqual({ a: "1", b: "2", c: "" });
  });

  it("returns empty for an empty file", () => {
    expect(parseCsv("")).toEqual({ header: [], rows: [] });
  });
});
