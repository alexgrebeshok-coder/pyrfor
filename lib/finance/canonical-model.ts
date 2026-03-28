/**
 * Finance canonical model — abstracts over 1C, QuickBooks, Xero, NetSuite, etc.
 * Every finance importer normalizes to these types before writing to DB
 */

// ─── Canonical Types ────────────────────────────────────────────────────

export interface CanonicalVendor {
  externalId: string;
  source: string; // "one-c", "quickbooks", "xero", "netsuite"
  name: string;
  taxId?: string; // INN (Russia), EIN (US), ABN (AU), VAT (EU)
  email?: string;
  phone?: string;
  address?: string;
  currency?: string; // ISO 4217
}

export interface CanonicalExpense {
  externalId: string;
  source: string;
  date: Date;
  amount: number;
  currency: string; // ISO 4217
  categoryCode: string;
  categoryName: string;
  description?: string;
  vendorId?: string;
  vendorName?: string;
  projectRef?: string;
  taskRef?: string;
  equipmentRef?: string;
  status: "pending" | "approved" | "paid" | "rejected";
}

export interface CanonicalInvoice {
  externalId: string;
  source: string;
  number: string;
  date: Date;
  dueDate?: Date;
  vendorId: string;
  vendorName: string;
  lineItems: CanonicalLineItem[];
  totalAmount: number;
  currency: string;
  status: "draft" | "pending" | "paid" | "overdue" | "cancelled";
  projectRef?: string;
  contractRef?: string;
}

export interface CanonicalLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  categoryCode?: string;
  taxAmount?: number;
}

export interface CanonicalPayment {
  externalId: string;
  source: string;
  date: Date;
  amount: number;
  currency: string;
  vendorId?: string;
  invoiceRef?: string;
  method?: string; // "bank_transfer", "card", "cash", "check"
  reference?: string;
}

export interface CanonicalBudgetLine {
  externalId: string;
  source: string;
  projectRef: string;
  categoryCode: string;
  categoryName: string;
  plannedAmount: number;
  actualAmount: number;
  currency: string;
  period?: string; // "2026-Q1", "2026-03", etc.
}

// ─── Importer Interface ────────────────────────────────────────────────

export interface FinanceImporter {
  readonly id: string;
  readonly name: string;

  fetchExpenses(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalExpense[]>;

  fetchInvoices(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalInvoice[]>;

  fetchVendors(credentialId: string): Promise<CanonicalVendor[]>;

  fetchPayments?(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalPayment[]>;
}

// ─── Reconciliation ────────────────────────────────────────────────────

export interface ReconciliationResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ externalId: string; error: string }>;
}
