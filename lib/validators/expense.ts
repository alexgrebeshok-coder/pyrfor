import { z } from "zod";

export const expenseStatusSchema = z.enum(["pending", "approved", "rejected", "paid"]);

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_-]+$/i, "Code must contain only letters, numbers, _ or -"),
  icon: z.string().trim().max(40).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
  parentId: z.string().trim().optional().nullable(),
});

export const createExpenseSchema = z.object({
  projectId: z.string().trim().min(1),
  categoryId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  amount: z.number().finite().positive(),
  currency: z.string().trim().min(3).max(8).default("RUB"),
  date: z.string().datetime(),
  status: expenseStatusSchema.default("pending"),
  documentUrl: z.string().trim().url().optional().nullable(),
  supplierId: z.string().trim().optional().nullable(),
  taskId: z.string().trim().optional().nullable(),
  equipmentId: z.string().trim().optional().nullable(),
  oneCRef: z.string().trim().max(160).optional().nullable(),
});

export const updateExpenseSchema = createExpenseSchema.partial();
