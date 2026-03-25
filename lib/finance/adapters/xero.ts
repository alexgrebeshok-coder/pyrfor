/**
 * Xero finance adapter
 * Maps Xero entities → canonical finance types
 */

import { getValidAccessToken } from "@/lib/connectors/oauth/oauth-service";
import type {
  FinanceImporter,
  CanonicalExpense,
  CanonicalInvoice,
  CanonicalVendor,
  CanonicalLineItem,
} from "../canonical-model";

const XERO_API = "https://api.xero.com/api.xro/2.0";

export class XeroImporter implements FinanceImporter {
  readonly id = "xero";
  readonly name = "Xero";

  private async xeroFetch(
    credentialId: string,
    path: string,
    params?: URLSearchParams
  ): Promise<unknown> {
    const token = await getValidAccessToken(credentialId);
    if (!token) throw new Error("No valid Xero credential");

    // tenantId stored in credential metadata
    const { prisma } = await import("@/lib/db");
    const cred = await prisma.connectorCredential.findUnique({
      where: { id: credentialId },
    });
    const parsedMeta = (() => {
      try {
        return cred?.metadata ? JSON.parse(cred.metadata) : null;
      } catch { return null; }
    })();
    const tenantId = parsedMeta?.tenantId;
    if (!tenantId) throw new Error("Missing Xero tenantId");

    const url = params
      ? `${XERO_API}${path}?${params.toString()}`
      : `${XERO_API}${path}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Xero-Tenant-Id": tenantId,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Xero API ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async fetchExpenses(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalExpense[]> {
    const params = new URLSearchParams();
    if (since) {
      params.set(
        "where",
        `Date >= DateTime(${since.getFullYear()},${since.getMonth() + 1},${since.getDate()})`
      );
    }

    const data = (await this.xeroFetch(
      credentialId,
      "/BankTransactions",
      params
    )) as { BankTransactions?: XeroBankTransaction[] };

    const txns = data?.BankTransactions ?? [];
    return txns
      .filter((t) => t.Type === "SPEND")
      .map((t) => ({
        externalId: t.BankTransactionID,
        source: "xero",
        date: new Date(t.Date),
        amount: t.Total,
        currency: t.CurrencyCode || "USD",
        categoryCode:
          t.LineItems?.[0]?.AccountCode || "uncategorized",
        categoryName:
          t.LineItems?.[0]?.AccountCode || "Uncategorized",
        description: t.Reference || `Xero txn ${t.BankTransactionID.slice(0, 8)}`,
        vendorId: t.Contact?.ContactID,
        vendorName: t.Contact?.Name,
        status: t.Status === "AUTHORISED" ? ("approved" as const) : ("paid" as const),
      }));
  }

  async fetchInvoices(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalInvoice[]> {
    const params = new URLSearchParams();
    params.set("where", 'Type=="ACCPAY"');
    if (since) {
      params.append(
        "where",
        `Date >= DateTime(${since.getFullYear()},${since.getMonth() + 1},${since.getDate()})`
      );
    }

    const data = (await this.xeroFetch(
      credentialId,
      "/Invoices",
      params
    )) as { Invoices?: XeroInvoice[] };

    const invoices = data?.Invoices ?? [];
    return invoices.map((inv) => ({
      externalId: inv.InvoiceID,
      source: "xero",
      number: inv.InvoiceNumber || inv.InvoiceID,
      date: new Date(inv.Date),
      dueDate: inv.DueDate ? new Date(inv.DueDate) : undefined,
      vendorId: inv.Contact?.ContactID || "",
      vendorName: inv.Contact?.Name || "",
      lineItems: (inv.LineItems || []).map(
        (l): CanonicalLineItem => ({
          description: l.Description || "",
          quantity: l.Quantity || 1,
          unitPrice: l.UnitAmount || 0,
          amount: l.LineAmount || 0,
          taxAmount: l.TaxAmount,
        })
      ),
      totalAmount: inv.Total,
      currency: inv.CurrencyCode || "USD",
      status: mapXeroInvoiceStatus(inv.Status),
    }));
  }

  async fetchVendors(credentialId: string): Promise<CanonicalVendor[]> {
    const params = new URLSearchParams();
    params.set("where", "IsSupplier==true");

    const data = (await this.xeroFetch(
      credentialId,
      "/Contacts",
      params
    )) as { Contacts?: XeroContact[] };

    const contacts = data?.Contacts ?? [];
    return contacts.map((c) => ({
      externalId: c.ContactID,
      source: "xero",
      name: c.Name,
      taxId: c.TaxNumber,
      email: c.EmailAddress,
      phone: c.Phones?.[0]?.PhoneNumber,
      currency: c.DefaultCurrency,
    }));
  }
}

function mapXeroInvoiceStatus(
  status: string
): "draft" | "pending" | "paid" | "overdue" | "cancelled" {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "SUBMITTED":
    case "AUTHORISED":
      return "pending";
    case "PAID":
      return "paid";
    case "VOIDED":
    case "DELETED":
      return "cancelled";
    default:
      return "pending";
  }
}

// ─── Xero response types ────────────────────────────────────────────────

interface XeroBankTransaction {
  BankTransactionID: string;
  Type: string;
  Date: string;
  Total: number;
  CurrencyCode?: string;
  Reference?: string;
  Status: string;
  Contact?: { ContactID: string; Name: string };
  LineItems?: Array<{ AccountCode: string }>;
}

interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Type: string;
  Date: string;
  DueDate?: string;
  Total: number;
  CurrencyCode?: string;
  Status: string;
  Contact?: { ContactID: string; Name: string };
  LineItems?: Array<{
    Description?: string;
    Quantity?: number;
    UnitAmount?: number;
    LineAmount?: number;
    TaxAmount?: number;
  }>;
}

interface XeroContact {
  ContactID: string;
  Name: string;
  TaxNumber?: string;
  EmailAddress?: string;
  Phones?: Array<{ PhoneNumber: string }>;
  DefaultCurrency?: string;
}
