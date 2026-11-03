import { useState } from "react";
import { strToU8, zipSync } from "fflate";

type CellValue = string | number | boolean | null;
type ExportColumn = { key: string; label: string };

const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellXml(reference: string, value: CellValue, style = 0) {
  const styleAttribute = style ? ` s="${style}"` : "";
  if (value === null) return `<c r="${reference}"${styleAttribute}/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"${styleAttribute}><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function safeFilename(title: string) {
  const cleaned = title.trim().replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-").replace(/\s+/g, " ").slice(0, 80);
  return `${cleaned || "AI Hub data"}.xlsx`;
}

function worksheetXml(columns: ExportColumn[], rows: Record<string, CellValue>[]) {
  const allRows: CellValue[][] = [columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => row[column.key] ?? null))];
  const widths = columns.map((column, columnIndex) => Math.min(60, Math.max(10, ...allRows.map((row) => String(row[columnIndex] ?? "").length + 2))));
  const sheetRows = allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, value, rowIndex === 0 ? 1 : 0)).join("")}</row>`).join("");
  const lastCell = `${columnName(Math.max(0, columns.length - 1))}${Math.max(1, allRows.length)}`;
  return `${xmlHeader}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCell}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData>${columns.length ? `<autoFilter ref="A1:${columnName(columns.length - 1)}${Math.max(1, allRows.length)}"/>` : ""}</worksheet>`;
}

export function createExcelWorkbook(title: string, columns: ExportColumn[], rows: Record<string, CellValue>[]) {
  const sheetName = escapeXml(title.replace(/[\\/*?:\[\]]/g, "-").slice(0, 31) || "Data");
  const files = {
    "[Content_Types].xml": strToU8(`${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`${xmlHeader}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`${xmlHeader}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml(columns, rows)),
  };
  return zipSync(files, { level: 6 });
}

function exportLabels(locale: string) {
  if (/^zh[-_]HK/i.test(locale)) return { export: "匯出 Excel", exporting: "匯出中…", failed: "匯出失敗，請重試" };
  if (locale.startsWith("zh")) return { export: "导出 Excel", exporting: "导出中…", failed: "导出失败，请重试" };
  if (locale.startsWith("ja")) return { export: "Excel に出力", exporting: "出力中…", failed: "出力に失敗しました。再試行してください" };
  return { export: "Export Excel", exporting: "Exporting…", failed: "Export failed. Please try again." };
}

export function ExcelExportButton({ title, columns, rows, locale }: { title: string; columns: ExportColumn[]; rows: Record<string, CellValue>[]; locale: string }) {
  const [state, setState] = useState<"idle" | "exporting" | "error">("idle");
  const copy = exportLabels(locale);
  const label = state === "exporting" ? copy.exporting : state === "error" ? copy.failed : copy.export;
  const download = () => {
    setState("exporting");
    try {
      const workbook = createExcelWorkbook(title, columns, rows);
      const bytes = workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFilename(title);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return <button className="aih-excel-export" type="button" title={label} aria-label={label} disabled={state === "exporting" || columns.length === 0} onClick={download}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 2 4 4h-4ZM8.2 11h2l1.3 2.1 1.3-2.1h2l-2.2 3.4 2.4 3.6h-2l-1.5-2.3-1.5 2.3H8l2.4-3.6Z"/></svg><span>{label}</span></button>;
}
