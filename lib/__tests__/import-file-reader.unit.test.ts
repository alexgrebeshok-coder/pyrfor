import assert from "node:assert/strict";

import ExcelJS from "exceljs";

import { detectImportFormat, readImportFile } from "@/lib/import/file-reader";

async function testReadsDelimitedTextWithAutoDelimiter() {
  const file = {
    name: "Budget_Plan.csv",
    bytes: new TextEncoder().encode("Статья;Сумма;Период\nПодготовка;120000;01.03.2026\n"),
  };

  const parsed = await readImportFile(file);

  assert.equal(parsed.format, "csv");
  assert.equal(parsed.metadata.delimiter, ";");
  assert.deepEqual(parsed.sheets[0].columns, ["Статья", "Сумма", "Период"]);
  assert.equal(parsed.sheets[0].rowCount, 1);
  assert.equal(parsed.sheets[0].rows[0]["Сумма"], "120000");
}

async function testReadsXlsxWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("WBS");
  worksheet.columns = [
    { header: "Код", key: "code" },
    { header: "Наименование работы", key: "name" },
    { header: "Дни", key: "days" },
    { header: "Начало", key: "start" },
    { header: "Окончание", key: "end" },
  ];
  worksheet.addRow({
    code: "1.1",
    name: "Подготовить площадку",
    days: 5,
    start: "01.03.2026",
    end: "05.03.2026",
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  
  const parsed = await readImportFile({
    name: "WBS.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
  });

  assert.equal(detectImportFormat("WBS.xlsx", bytes), "xlsx");
  assert.equal(parsed.sheets.length, 1);
  assert.deepEqual(parsed.sheets[0].columns, [
    "Код",
    "Наименование работы",
    "Дни",
    "Начало",
    "Окончание",
  ]);
  assert.equal(parsed.sheets[0].rows[0]["Код"], "1.1");
}

async function testRecognizesPdfByMagicHeader() {
  const bytes = new TextEncoder().encode("%PDF-1.7\ncontract");
  const parsed = await readImportFile({
    name: "Main_Contract.bin",
    bytes,
  });

  assert.equal(parsed.format, "pdf");
  assert.equal(parsed.sheets.length, 0);
}

async function main() {
  await testReadsDelimitedTextWithAutoDelimiter();
  await testReadsXlsxWorkbook();
  await testRecognizesPdfByMagicHeader();
  console.log("PASS import-file-reader.unit");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
