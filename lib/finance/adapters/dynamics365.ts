/**
 * Microsoft Dynamics 365 Business Central finance adapter (stub)
 * Maps Dynamics entities → canonical finance types
 */

import { getValidAccessToken } from "@/lib/connectors/oauth/oauth-service";
import type {
  FinanceImporter,
  CanonicalExpense,
  CanonicalInvoice,
  CanonicalVendor,
} from "../canonical-model";

export class Dynamics365Importer implements FinanceImporter {
  readonly id = "dynamics365";
  readonly name = "Microsoft Dynamics 365";

  private async d365Fetch(
    credentialId: string,
    path: string
  ): Promise<unknown> {
    const token = await getValidAccessToken(credentialId);
    if (!token) throw new Error("No valid Dynamics 365 credential");

    const { prisma } = await import("@/lib/db");
    const cred = await prisma.connectorCredential.findUnique({
      where: { id: credentialId },
    });
    const parsedMeta = (() => {
      try {
        return cred?.metadata ? JSON.parse(cred.metadata) : null;
      } catch { return null; }
    })();
    const tenant = parsedMeta?.tenant;
    const environment = parsedMeta?.environment || "production";

    if (!tenant) throw new Error("Missing Dynamics 365 tenant");

    const url = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${environment}/api/v2.0${path}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`D365 API ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async fetchExpenses(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalExpense[]> {
    const filter = since
      ? `?$filter=lastModifiedDateTime ge ${since.toISOString()}`
      : "";

    const data = (await this.d365Fetch(
      credentialId,
      `/purchaseInvoices${filter}`
    )) as { value?: D365PurchaseInvoice[] };

    const invoices = data?.value ?? [];
    return invoices.map((inv) => ({
      externalId: inv.id,
      source: "dynamics365",
      date: new Date(inv.invoiceDate),
      amount: inv.totalAmountIncludingTax,
      currency: inv.currencyCode || "USD",
      categoryCode: "purchase",
      categoryName: "Purchase Invoice",
      description: `D365 Invoice ${inv.number}`,
      vendorId: inv.vendorId,
      vendorName: inv.vendorName,
      status: inv.status === "Paid" ? ("paid" as const) : ("pending" as const),
    }));
  }

  async fetchInvoices(
    credentialId: string,
    since?: Date
  ): Promise<CanonicalInvoice[]> {
    const filter = since
      ? `?$filter=lastModifiedDateTime ge ${since.toISOString()}`
      : "";

    const data = (await this.d365Fetch(
      credentialId,
      `/purchaseInvoices${filter}`
    )) as { value?: D365PurchaseInvoice[] };

    const invoices = data?.value ?? [];
    return invoices.map((inv) => ({
      externalId: inv.id,
      source: "dynamics365",
      number: inv.number,
      date: new Date(inv.invoiceDate),
      dueDate: inv.dueDate ? new Date(inv.dueDate) : undefined,
      vendorId: inv.vendorId || "",
      vendorName: inv.vendorName || "",
      lineItems: [],
      totalAmount: inv.totalAmountIncludingTax,
      currency: inv.currencyCode || "USD",
      status: inv.status === "Paid" ? ("paid" as const) : ("pending" as const),
    }));
  }

  async fetchVendors(credentialId: string): Promise<CanonicalVendor[]> {
    const data = (await this.d365Fetch(
      credentialId,
      "/vendors"
    )) as { value?: D365Vendor[] };

    const vendors = data?.value ?? [];
    return vendors.map((v) => ({
      externalId: v.id,
      source: "dynamics365",
      name: v.displayName || v.number,
      taxId: v.taxRegistrationNumber,
      email: v.email,
      phone: v.phoneNumber,
      currency: v.currencyCode,
    }));
  }
}

// ─── D365 response types ────────────────────────────────────────────────

interface D365PurchaseInvoice {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate?: string;
  vendorId?: string;
  vendorName?: string;
  totalAmountIncludingTax: number;
  currencyCode?: string;
  status: string;
}

interface D365Vendor {
  id: string;
  number: string;
  displayName?: string;
  taxRegistrationNumber?: string;
  email?: string;
  phoneNumber?: string;
  currencyCode?: string;
}
