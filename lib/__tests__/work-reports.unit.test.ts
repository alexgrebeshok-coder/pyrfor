import assert from "node:assert/strict";

import {
  mapAIPMOBotWorkReportToCreateInput,
  parseJsonArray,
  serializeJsonArray,
} from "../work-reports/mapper";
import { normalizeWorkReportStatus } from "../work-reports/service";
import {
  createWorkReportSchema,
  legacyAIPMOBotWorkReportSchema,
  rejectWorkReportSchema,
  reviewWorkReportSchema,
} from "../validators/work-report";

const mapped = mapAIPMOBotWorkReportToCreateInput(
  {
    report_id: "#202603110001",
    project_name: "Северный объект",
    section: "Секция А",
    report_date: "2026-03-11",
    work_description: "Устройство основания",
    reporter_telegram_id: 123456,
    reporter_name: "Иван Петров",
    personnel_count: 12,
    attachments: [{ name: "photo-1.jpg", type: "photo" }],
    volumes: [{ description: "Щебень", value: 120, unit: "м3" }],
  },
  {
    projectId: "project-1",
    authorId: "member-1",
  }
);

assert.equal(mapped.projectId, "project-1");
assert.equal(mapped.authorId, "member-1");
assert.equal(mapped.source, "telegram_bot");
assert.equal(mapped.externalReporterTelegramId, "123456");
assert.equal(mapped.reportNumber, "#202603110001");
assert.equal(mapped.attachments?.[0]?.name, "photo-1.jpg");

const createParsed = createWorkReportSchema.safeParse({
  projectId: "project-1",
  authorId: "member-1",
  section: "Секция А",
  reportDate: "2026-03-11",
  workDescription: "Работы выполнены",
  volumes: [{ description: "Щебень", value: 120, unit: "м3" }],
  attachments: [{ name: "photo.jpg", type: "photo", size: 1024 }],
});

assert.equal(createParsed.success, true);

const legacyParsed = legacyAIPMOBotWorkReportSchema.safeParse({
  project_name: "Северный объект",
  section: "Секция Б",
  report_date: "2026-03-11",
  work_description: "Подготовка основания",
  reporter_telegram_id: 999,
});

assert.equal(legacyParsed.success, true);

const rejectParsed = rejectWorkReportSchema.safeParse({
  reviewerId: "member-2",
});

assert.equal(rejectParsed.success, false);

const reviewParsed = reviewWorkReportSchema.safeParse({
  reviewerId: "member-2",
  reviewComment: "",
});

assert.equal(reviewParsed.success, true);

const rejectWithCommentParsed = rejectWorkReportSchema.safeParse({
  reviewerId: "member-2",
  reviewComment: "Нужно приложить подтверждение по технике.",
});

assert.equal(rejectWithCommentParsed.success, true);

assert.equal(normalizeWorkReportStatus("approved"), "approved");
assert.equal(normalizeWorkReportStatus("unknown"), undefined);

const encoded = serializeJsonArray([{ description: "Щебень" }]);
const decoded = parseJsonArray<{ description: string }>(encoded);
assert.equal(decoded.length, 1);
assert.equal(decoded[0].description, "Щебень");
assert.deepEqual(parseJsonArray("not-json"), []);

console.log("PASS work-reports.unit");
