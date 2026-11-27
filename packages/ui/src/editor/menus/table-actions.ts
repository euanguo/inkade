import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import Papa from "papaparse";

export interface TableSelectionLocation {
  readonly tableNode: PMNode;
  readonly tablePos: number;
  readonly rowIndex: number;
  readonly colIndex: number;
}

export interface TableNumericStats {
  readonly count: number;
  readonly sum: number;
  readonly avg: number;
}

export function locateActiveTableCell(editor: Editor): TableSelectionLocation | null {
  const { $from } = editor.state.selection;
  let tableDepth = -1;
  let rowDepth = -1;
  let cellDepth = -1;

  for (let d = $from.depth; d >= 0; d -= 1) {
    const node = $from.node(d);
    const name = node.type.name;
    if (cellDepth === -1 && (name === "tableCell" || name === "tableHeader")) {
      cellDepth = d;
    } else if (rowDepth === -1 && name === "tableRow") {
      rowDepth = d;
    } else if (name === "table") {
      tableDepth = d;
      break;
    }
  }

  if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) return null;
  const tableNode = $from.node(tableDepth);
  const tablePos = $from.before(tableDepth);
  const rowIndex = $from.index(tableDepth);
  const colIndex = $from.index(rowDepth);
  return { tableNode, tablePos, rowIndex, colIndex };
}

function getRowCellPos(
  tableNode: PMNode,
  tablePos: number,
  targetRow: number,
  targetCol: number,
): { readonly pos: number; readonly node: PMNode } | null {
  let rowPos = tablePos + 1;
  for (let r = 0; r < tableNode.childCount; r += 1) {
    const rowNode = tableNode.child(r);
    if (r === targetRow) {
      let cellPos = rowPos + 1;
      for (let c = 0; c < rowNode.childCount; c += 1) {
        const cellNode = rowNode.child(c);
        if (c === targetCol) {
          return { pos: cellPos, node: cellNode };
        }
        cellPos += cellNode.nodeSize;
      }
      return null;
    }
    rowPos += rowNode.nodeSize;
  }
  return null;
}

export function sortTableByActiveColumn(editor: Editor, dir: "asc" | "desc"): boolean {
  const loc = locateActiveTableCell(editor);
  if (!loc) return false;
  const { tableNode, tablePos, colIndex } = loc;
  if (tableNode.childCount < 2) return false;

  const headerRows: PMNode[] = [];
  const bodyRows: PMNode[] = [];
  for (let r = 0; r < tableNode.childCount; r += 1) {
    const row = tableNode.child(r);
    const isHeaderRow =
      r === 0 &&
      row.childCount > 0 &&
      row.child(0).type.name === "tableHeader";
    if (isHeaderRow && bodyRows.length === 0) {
      headerRows.push(row);
    } else {
      bodyRows.push(row);
    }
  }

  if (bodyRows.length < 2) return false;
  const mult = dir === "asc" ? 1 : -1;
  const sortedBody = [...bodyRows].sort((rowA, rowB) => {
    const textA = (colIndex < rowA.childCount ? rowA.child(colIndex).textContent : "").trim();
    const textB = (colIndex < rowB.childCount ? rowB.child(colIndex).textContent : "").trim();
    const numA = Number(textA.replace(/[,%$¥€]/g, ""));
    const numB = Number(textB.replace(/[,%$¥€]/g, ""));
    if (textA !== "" && textB !== "" && Number.isFinite(numA) && Number.isFinite(numB)) {
      return (numA - numB) * mult;
    }
    return textA.localeCompare(textB, undefined, { numeric: true, sensitivity: "base" }) * mult;
  });

  const nextTable = tableNode.type.create(tableNode.attrs, [...headerRows, ...sortedBody]);
  let tr = editor.state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, nextTable);
  const clampedRow = Math.min(loc.rowIndex, Math.max(0, nextTable.childCount - 1));
  const targetCell = getRowCellPos(nextTable, tablePos, clampedRow, colIndex);
  if (targetCell) {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(targetCell.pos + 1)));
  }
  editor.view.dispatch(tr);
  return true;
}

export function alignActiveTableColumn(
  editor: Editor,
  align: "left" | "center" | "right",
): boolean {
  const loc = locateActiveTableCell(editor);
  if (!loc) return false;
  const { tableNode, tablePos, colIndex } = loc;
  let tr = editor.state.tr;
  let modified = false;
  for (let r = 0; r < tableNode.childCount; r += 1) {
    const cell = getRowCellPos(tableNode, tablePos, r, colIndex);
    if (!cell) continue;
    tr = tr.setNodeMarkup(cell.pos, undefined, { ...cell.node.attrs, align });
    modified = true;
  }
  if (!modified) return false;
  editor.view.dispatch(tr);
  return true;
}

export function toggleActiveRowHighlight(editor: Editor): boolean {
  const loc = locateActiveTableCell(editor);
  if (!loc) return false;
  const { tableNode, tablePos, rowIndex } = loc;
  const row = tableNode.child(rowIndex);
  if (!row) return false;

  const firstCell = row.childCount > 0 ? row.child(0) : null;
  const currentHighlight =
    firstCell && typeof firstCell.attrs.highlightColor === "string"
      ? firstCell.attrs.highlightColor
      : null;
  const nextHighlight = currentHighlight ? null : "rgba(99, 102, 241, 0.10)";

  let tr = editor.state.tr;
  for (let c = 0; c < row.childCount; c += 1) {
    const cell = getRowCellPos(tableNode, tablePos, rowIndex, c);
    if (!cell) continue;
    tr = tr.setNodeMarkup(cell.pos, undefined, {
      ...cell.node.attrs,
      highlightColor: nextHighlight,
    });
  }
  editor.view.dispatch(tr);
  return true;
}

export function extractActiveTableMatrix(editor: Editor): readonly (readonly string[])[] {
  const loc = locateActiveTableCell(editor);
  if (!loc) return [];
  const rows: string[][] = [];
  for (let r = 0; r < loc.tableNode.childCount; r += 1) {
    const row = loc.tableNode.child(r);
    const cols: string[] = [];
    for (let c = 0; c < row.childCount; c += 1) {
      cols.push(row.child(c).textContent.replace(/\s+/g, " ").trim());
    }
    rows.push(cols);
  }
  return rows;
}

export function formatMatrixAsGfmMarkdown(matrix: readonly (readonly string[])[]): string {
  if (matrix.length === 0) return "";
  const colCount = Math.max(...matrix.map((r) => r.length));
  if (colCount === 0) return "";
  const escapeCell = (s: string) => s.replace(/\|/g, "\\|");
  const normalizeRow = (r: readonly string[]) =>
    Array.from({ length: colCount }, (_, idx) => escapeCell(r[idx] ?? ""));

  const header = normalizeRow(matrix[0] ?? []);
  const divider = Array.from({ length: colCount }, () => "---");
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...matrix.slice(1).map((r) => `| ${normalizeRow(r).join(" | ")} |`),
  ];
  return lines.join("\n");
}

export function formatMatrixAsCsv(matrix: readonly (readonly string[])[]): string {
  if (matrix.length === 0) return "";
  return Papa.unparse(matrix.map((r) => [...r]));
}

export function computeActiveColumnNumericStats(editor: Editor): TableNumericStats | null {
  const loc = locateActiveTableCell(editor);
  if (!loc) return null;
  const { tableNode, colIndex } = loc;
  let count = 0;
  let sum = 0;

  for (let r = 0; r < tableNode.childCount; r += 1) {
    const row = tableNode.child(r);
    if (colIndex >= row.childCount) continue;
    const cell = row.child(colIndex);
    if (r === 0 && cell.type.name === "tableHeader") continue;
    const raw = cell.textContent.trim().replace(/[,$¥€\s]/g, "");
    if (!raw) continue;
    const num = Number(raw);
    if (Number.isFinite(num)) {
      count += 1;
      sum += num;
    }
  }

  if (count === 0) return null;
  return {
    count,
    sum: Number(sum.toFixed(2)),
    avg: Number((sum / count).toFixed(2)),
  };
}
