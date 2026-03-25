/**
 * QuickBooks Online finance adapter
 * Maps QBO entities → canonical finance types
 */

import { getValidAccessToken } from "@/lib/connectors/oauth/oauth-service";
import type {
  FinanceImporter,
  CanonicalExpense,
  CanonicalInvoice,
  CanonicalVendor,
  CanonicalLineItem,
} from "../canonical-model";

const QBO_BASE = "https://quickbooks.api.intuit.com/v3/company";

export class QuickBooksImporter implements FinanceImporter {
  readonly id = "quickbooks";
  readonly name = "QuickBooks Online";

  private async qboFetch(
    credentialId: string,
    query: string
  ): Promise<unknown> {
    const token = await getValidAccessToken(credentialId);
    if (!token) throw new Error("No valid QuickBooks credential");

    // realmId stored in credential metadata
    const { prisma } = await import("@/lib/db");
    const cred = await prisma.connectorCredential.findUnique({
      where: { id: credentialId },
    });
    const realmId = (() => {
      try {
        const meta = cred?.metadata ? JSON.parse(cred.metadata) : null;
        return meta?.realmId;
      } catch { return undefined; }
    })();
    if (!realmId) throw new Error("Missing QuickBooks realmId");

    const url = `${QBO_BASE}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`QBO API ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async fetchExpenses(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalExpense[]> {
    const sinceClause = since
      ? ` WHERE MetaData.LastUpdatedTime >= '${since.toISOString().split("T")[0]}'`
      : "";
    const data = (await this.qboFetch(
      credentialId,
      `SELECT * FROM Purchase${sinceClause} MAXRESULTS 500`
    )) as { QueryResponse?: { Purchase?: QBOPurchase[] } };

    const purchases = data?.QueryResponse?.Purchase ?? [];
    return purchases.map((p) => ({
      externalId: p.Id,
      source: "quickbooks",
      date: new Date(p.TxnDate),
      amount: p.TotalAmt,
      currency: p.CurrencyRef?.value || "USD",
      categoryCode: p.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.value || "uncategorized",
      categoryName: p.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.name || "Uncategorized",
      description: p.PrivateNote || `Purchase ${p.DocNumber || p.Id}`,
      vendorId: p.EntityRef?.value,
      vendorName: p.EntityRef?.name,
      status: "paid" as const,
    }));
  }

  async fetchInvoices(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalInvoice[]> {
    const sinceClause = since
      ? ` WHERE MetaData.LastUpdatedTime >= '${since.toISOString().split("T")[0]}'`
      : "";
    const data = (await this.qboFetch(
      credentialId,
      `SELECT * FROM Bill${sinceClause} MAXRESULTS 500`
    )) as { QueryResponse?: { Bill?: QBOBill[] } };

    const bills = data?.QueryResponse?.Bill ?? [];
    return bills.map((b) => ({
      externalId: b.Id,
      source: "quickbooks",
      number: b.DocNumber || b.Id,
      date: new Date(b.TxnDate),
      dueDate: b.DueDate ? new Date(b.DueDate) : undefined,
      vendorId: b.VendorRef?.value || "",
      vendorName: b.VendorRef?.name || "",
      lineItems: (b.Line || [])
        .filter((l) => l.DetailType === "AccountBasedExpenseLineDetail")
        .map(
          (l): CanonicalLineItem => ({
            description: l.Description || "",
            quantity: 1,
            unitPrice: l.Amount,
            amount: l.Amount,
          })
        ),
      totalAmount: b.TotalAmt,
      currency: b.CurrencyRef?.value || "USD",
      status: b.Balance === 0 ? ("paid" as const) : ("pending" as const),
    }));
  }

  async fetchVendors(credentialId: string): Promise<CanonicalVendor[]> {
    const data = (await this.qboFetch(
      credentialId,
      "SELECT * FROM Vendor MAXRESULTS 500"
    )) as { QueryResponse?: { Vendor?: QBOVendor[] } };

    const vendors = data?.QueryResponse?.Vendor ?? [];
    return vendors.map((v) => ({
      externalId: v.Id,
      source: "quickbooks",
      name: v.DisplayName || v.CompanyName || "",
      taxId: v.TaxIdentifier,
      email: v.PrimaryEmailAddr?.Address,
      phone: v.PrimaryPhone?.FreeFormNumber,
      currency: v.CurrencyRef?.value,
    }));
  }
}

// ─── QBO response types ────────────────────────────────────────────────

interface QBOPurchase {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  TotalAmt: number;
  CurrencyRef?: { value: string };
  EntityRef?: { value: string; name: string };
  PrivateNote?: string;
  Line?: Array<{
    Amount: number;
    AccountBasedExpenseLineDetail?: {
      AccountRef: { value: string; name: string };
    };
  }>;
}

interface QBOBill {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  CurrencyRef?: { value: string };
  VendorRef?: { value: string; name: string };
  Line?: Array<{
    DetailType: string;
    Description?: string;
    Amount: number;
  }>;
}

interface QBOVendor {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  TaxIdentifier?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  CurrencyRef?: { value: string };
}
