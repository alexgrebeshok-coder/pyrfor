/**
 * Finance importer registry — factory for getting importers by source
 */

import type { FinanceImporter } from "./canonical-model";
import { QuickBooksImporter } from "./adapters/quickbooks";
import { XeroImporter } from "./adapters/xero";
import { Dynamics365Importer } from "./adapters/dynamics365";

const importers: Record<string, FinanceImporter> = {
  quickbooks: new QuickBooksImporter(),
  xero: new XeroImporter(),
  dynamics365: new Dynamics365Importer(),
};

export function getFinanceImporter(source: string): FinanceImporter {
  const importer = importers[source];
  if (!importer)
    throw new Error(`Unknown finance importer: ${source}`);
  return importer;
}

export function listFinanceImporters(): Array<{
  id: string;
  name: string;
}> {
  return Object.values(importers).map((i) => ({
    id: i.id,
    name: i.name,
  }));
}

export type { FinanceImporter } from "./canonical-model";
