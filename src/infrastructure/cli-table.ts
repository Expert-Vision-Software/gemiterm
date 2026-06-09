import Table from "cli-table3";
import chalk from "chalk";

export interface ColumnDef<T> {
  header: string;
  width: number;
  cell: (row: T) => string;
  align?: "left" | "center" | "right";
}

export interface RenderTableOptions<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  emptyMessage?: string;
  footer?: string;
}

export function renderTable<T>(opts: RenderTableOptions<T>): string {
  if (opts.rows.length === 0 && opts.emptyMessage) {
    return chalk.dim(opts.emptyMessage);
  }

  const head = opts.columns.map((c) => c.header);
  const colWidths = opts.columns.map((c) => c.width);
  const colAligns = opts.columns.map((c) => c.align ?? "left");

  const table = new Table({
    head,
    colWidths,
    colAligns,
    wordWrap: false,
  });

  for (const row of opts.rows) {
    const cells = opts.columns.map((c) => c.cell(row));
    table.push(cells);
  }

  const lines = [table.toString()];
  if (opts.footer) {
    lines.push("");
    lines.push(chalk.dim(opts.footer));
  }
  return lines.join("\n");
}
