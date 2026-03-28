import { z } from "zod";

export const equipmentSchema = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.string().trim().min(2).max(80),
  model: z.string().trim().max(120).optional().nullable(),
  serialNumber: z.string().trim().max(120).optional().nullable(),
  status: z.string().trim().min(2).max(40).default("available"),
  projectId: z.string().trim().optional().nullable(),
  hourlyRate: z.number().finite().nonnegative().optional().nullable(),
  dailyRate: z.number().finite().nonnegative().optional().nullable(),
  location: z.string().trim().max(160).optional().nullable(),
  latitude: z.number().finite().optional().nullable(),
  longitude: z.number().finite().optional().nullable(),
});

export const equipmentAssignmentSchema = z.object({
  projectId: z.string().trim().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  hoursUsed: z.number().finite().nonnegative().default(0),
});

export const materialSchema = z.object({
  name: z.string().trim().min(2).max(160),
  unit: z.string().trim().min(1).max(30),
  category: z.string().trim().min(2).max(80),
  currentStock: z.number().finite().nonnegative().default(0),
  minStock: z.number().finite().nonnegative().default(0),
  unitPrice: z.number().finite().nonnegative().optional().nullable(),
  supplierId: z.string().trim().optional().nullable(),
});

export const materialMovementSchema = z.object({
  projectId: z.string().trim().min(1),
  type: z.enum(["receipt", "consumption", "return", "writeoff"]),
  quantity: z.number().finite().positive(),
  unitPrice: z.number().finite().nonnegative().optional().nullable(),
  documentRef: z.string().trim().max(160).optional().nullable(),
  date: z.string().datetime(),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160),
  inn: z.string().trim().max(40).optional().nullable(),
  contactName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  email: z.string().trim().email().max(120).optional().nullable(),
  address: z.string().trim().max(240).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  rating: z.number().int().min(0).max(10).optional().nullable(),
});

export const contractSchema = z.object({
  number: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(160),
  type: z.string().trim().min(2).max(80),
  supplierId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  amount: z.number().finite().positive(),
  paidAmount: z.number().finite().nonnegative().default(0),
  currency: z.string().trim().min(3).max(8).default("RUB"),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  status: z.string().trim().min(2).max(40).default("active"),
  documentUrl: z.string().trim().url().optional().nullable(),
});
