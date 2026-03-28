/**
 * Universal export service — CSV, Excel, PDF for any entity type
 * Uses: exceljs (already in deps), jspdf (already in deps)
 */

export interface ColumnDef {
  key: string;
  label: string;
  width?: number;
}

/**
 * Export data rows to CSV string
 */
export function exportToCSV(
  data: Record<string, unknown>[],
  columns: ColumnDef[]
): string {
  const header = columns.map((c) => `"${c.label}"`).join(",");
  const rows = data.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key];
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(",")
  );
  // UTF-8 BOM for Excel compatibility
  return "\ufeff" + [header, ...rows].join("\n");
}

/**
 * Export data rows to Excel buffer (xlsx)
 */
export async function exportToExcel(
  data: Record<string, unknown>[],
  columns: ColumnDef[],
  sheetName = "Export"
): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.width || 20,
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8E8E8" },
  };

  for (const row of data) {
    sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Export data to simple PDF table
 * Lightweight — uses jsPDF for basic table layout
 */
export async function exportToPDF(
  data: Record<string, unknown>[],
  columns: ColumnDef[],
  title = "Export"
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape" });

  // Title
  doc.setFontSize(16);
  doc.text(title, 14, 20);

  // Table header
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  const colWidth = (doc.internal.pageSize.getWidth() - 28) / columns.length;
  let y = 35;

  columns.forEach((col, i) => {
    doc.text(col.label, 14 + i * colWidth, y);
  });

  // Table rows
  doc.setFont("helvetica", "normal");
  y += 8;

  for (const row of data) {
    if (y > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 20;
    }

    columns.forEach((col, i) => {
      const val = String(row[col.key] ?? "").slice(0, 40);
      doc.text(val, 14 + i * colWidth, y);
    });
    y += 6;
  }

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
