import { describe, test, expect } from "bun:test";
import { renderTable, type ColumnDef } from "../../src/infrastructure/cli-table.ts";

interface Row {
  name: string;
  age: number;
}

describe("renderTable", () => {
  test("returns dim emptyMessage for empty rows", () => {
    const out = renderTable<Row>({
      columns: [
        { header: "Name", width: 10, cell: (r) => r.name },
        { header: "Age", width: 5, cell: (r) => String(r.age) },
      ],
      rows: [],
      emptyMessage: "Nothing here",
    });
    expect(out).toContain("Nothing here");
    expect(out).not.toContain("Name");
  });

  test("renders header row with column names", () => {
    const out = renderTable<Row>({
      columns: [
        { header: "Name", width: 10, cell: (r) => r.name },
        { header: "Age", width: 5, cell: (r) => String(r.age) },
      ],
      rows: [{ name: "Alice", age: 30 }],
    });
    expect(out).toContain("Name");
    expect(out).toContain("Age");
  });

  test("renders data rows with cell values", () => {
    const out = renderTable<Row>({
      columns: [
        { header: "Name", width: 10, cell: (r) => r.name },
        { header: "Age", width: 5, cell: (r) => String(r.age) },
      ],
      rows: [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ],
    });
    expect(out).toContain("Alice");
    expect(out).toContain("30");
    expect(out).toContain("Bob");
    expect(out).toContain("25");
  });

  test("includes Unicode box-drawing borders", () => {
    const out = renderTable<Row>({
      columns: [
        { header: "Name", width: 10, cell: (r) => r.name },
        { header: "Age", width: 5, cell: (r) => String(r.age) },
      ],
      rows: [{ name: "Alice", age: 30 }],
    });
    expect(out).toMatch(/[\u2500-\u257f]/);
  });

  test("appends footer when provided", () => {
    const out = renderTable<Row>({
      columns: [
        { header: "Name", width: 10, cell: (r) => r.name },
        { header: "Age", width: 5, cell: (r) => String(r.age) },
      ],
      rows: [{ name: "Alice", age: 30 }],
      footer: "Total: 1",
    });
    expect(out).toContain("Total: 1");
  });

  test("does not crash with zero columns", () => {
    const out = renderTable<Row>({
      columns: [],
      rows: [{ name: "Alice", age: 30 }],
    });
    expect(typeof out).toBe("string");
  });

  test("handles zero rows with no emptyMessage", () => {
    const out = renderTable<Row>({
      columns: [
        { header: "Name", width: 10, cell: (r) => r.name },
        { header: "Age", width: 5, cell: (r) => String(r.age) },
      ],
      rows: [],
    });
    expect(out).toContain("Name");
  });

  test("respects optional PROFILE-style spread-in column", () => {
    const includeExtra = true;
    const columns: ColumnDef<Row & { extra?: string }>[] = [
      { header: "Name", width: 10, cell: (r) => r.name },
      ...(includeExtra ? [{ header: "Extra", width: 8, cell: (r: Row & { extra?: string }) => r.extra ?? "" }] : []),
    ];
    const out = renderTable({
      columns,
      rows: [{ name: "Alice", age: 30, extra: "yes" }],
    });
    expect(out).toContain("Extra");
    expect(out).toContain("yes");
  });
});
