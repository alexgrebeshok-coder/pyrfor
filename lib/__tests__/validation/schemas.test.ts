import { describe, it, expect } from "vitest";
import { createProjectSchema } from "@/lib/validators/project";
import { createTaskSchema } from "@/lib/validators/task";

describe("Validation Schemas", () => {
  describe("Project schema", () => {
    it("accepts minimal project data", () => {
      const result = createProjectSchema.safeParse({
        name: "New Project",
        direction: "logistics",
        start: "2025-01-01",
        end: "2025-06-30",
      });

      expect(result.success).toBe(true);
    });

    it("rejects missing required fields and invalid enums", () => {
      const result = createProjectSchema.safeParse({
        name: "",
        direction: "unknown",
        start: "not-a-date",
        end: "2025-06-30",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("Task schema", () => {
    it("validates standard task payloads", () => {
      const result = createTaskSchema.safeParse({
        title: "Align stakeholders",
        projectId: "550e8400-e29b-41d4-a716-446655440000",
        dueDate: "2025-03-01",
        status: "todo",
        priority: "medium",
      });

      expect(result.success).toBe(true);
    });

    it("rejects missing project id or invalid dates", () => {
      const result = createTaskSchema.safeParse({
        title: "Missing data",
        projectId: "",
        dueDate: "tomorrow",
      });

      expect(result.success).toBe(false);
    });
  });
});
