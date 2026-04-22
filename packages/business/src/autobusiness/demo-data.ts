import type { MessageKey } from "@/lib/translations";

export type KpiTrend = "up" | "down" | "stable";
export type DebtorSeverity = "critical" | "watch";

export interface KpiCardData {
  id: "operatingBalance" | "cashMargin" | "netProfit" | "positiveMonths";
  labelKey: MessageKey;
  value: string;
  trend: KpiTrend;
}

export interface CashFlowYearData {
  year: number;
  inflow: number;
  outflow: number;
  balance: number;
}

export interface CashFlowMonthData {
  month: number;
  inflow: number;
  outflow: number;
}

export interface TopArticleData {
  id:
    | "supplierPayments"
    | "customerPayments"
    | "retailRevenue"
    | "retailRepurchase"
    | "retailOpaRevenue"
    | "accountTopUp"
    | "serviceRevenue"
    | "intercompanySettlements"
    | "fleetRepurchase"
    | "other";
  nameKey: MessageKey;
  inflow: number;
  outflow: number;
}

export interface OrganizationBreakdownData {
  name: string;
  balance: number;
  margin: number;
}

export interface PnlRevenueData {
  sto: number;
  parts: number;
  bonuses: number;
  other: number;
}

export interface PnlSummaryData {
  revenue: PnlRevenueData;
  cogs: number;
  grossProfit: number;
  netProfit: number;
}

export interface BrandBonusData {
  brand: string;
  amount: number;
}

export interface DebtorData {
  name: string;
  overdueDays: number;
  amount: number;
  managerKey: MessageKey;
  noteKey: MessageKey;
  severity: DebtorSeverity;
}

export const kpiCards = [
  {
    id: "operatingBalance",
    labelKey: "autobusiness.kpi.operatingBalance",
    value: "+4.09 млрд",
    trend: "up",
  },
  {
    id: "cashMargin",
    labelKey: "autobusiness.kpi.cashMargin",
    value: "11.4%",
    trend: "up",
  },
  {
    id: "netProfit",
    labelKey: "autobusiness.kpi.netProfit",
    value: "+4.11 млрд",
    trend: "up",
  },
  {
    id: "positiveMonths",
    labelKey: "autobusiness.kpi.positiveMonths",
    value: "78%",
    trend: "stable",
  },
] satisfies KpiCardData[];

export const cashFlowByYear = [
  { year: 2023, inflow: 7860, outflow: 8130, balance: -270 },
  { year: 2024, inflow: 13970, outflow: 11770, balance: 2200 },
  { year: 2025, inflow: 13600, outflow: 11430, balance: 2170 },
] satisfies CashFlowYearData[];

export const cashFlowMonthly2025 = [
  { month: 1, inflow: 980, outflow: 820 },
  { month: 2, inflow: 1050, outflow: 880 },
  { month: 3, inflow: 1120, outflow: 930 },
  { month: 4, inflow: 1080, outflow: 910 },
  { month: 5, inflow: 1150, outflow: 960 },
  { month: 6, inflow: 1180, outflow: 1020 },
  { month: 7, inflow: 1100, outflow: 890 },
  { month: 8, inflow: 1070, outflow: 950 },
  { month: 9, inflow: 1220, outflow: 1050 },
  { month: 10, inflow: 1140, outflow: 980 },
  { month: 11, inflow: 950, outflow: 870 },
  { month: 12, inflow: 1560, outflow: 1170 },
] satisfies CashFlowMonthData[];

export const topArticles = [
  {
    id: "supplierPayments",
    nameKey: "autobusiness.dds.article.supplierPayments",
    inflow: 0,
    outflow: 18070,
  },
  {
    id: "customerPayments",
    nameKey: "autobusiness.dds.article.customerPayments",
    inflow: 15660,
    outflow: 0,
  },
  {
    id: "retailRevenue",
    nameKey: "autobusiness.dds.article.retailRevenue",
    inflow: 5870,
    outflow: 0,
  },
  {
    id: "retailRepurchase",
    nameKey: "autobusiness.dds.article.retailRepurchase",
    inflow: 0,
    outflow: 5890,
  },
  {
    id: "retailOpaRevenue",
    nameKey: "autobusiness.dds.article.retailOpaRevenue",
    inflow: 4870,
    outflow: 0,
  },
  {
    id: "accountTopUp",
    nameKey: "autobusiness.dds.article.accountTopUp",
    inflow: 3100,
    outflow: 0,
  },
  {
    id: "serviceRevenue",
    nameKey: "autobusiness.dds.article.serviceRevenue",
    inflow: 1250,
    outflow: 0,
  },
  {
    id: "intercompanySettlements",
    nameKey: "autobusiness.dds.article.intercompanySettlements",
    inflow: 850,
    outflow: 1280,
  },
  {
    id: "fleetRepurchase",
    nameKey: "autobusiness.dds.article.fleetRepurchase",
    inflow: 0,
    outflow: 950,
  },
  {
    id: "other",
    nameKey: "autobusiness.dds.article.other",
    inflow: 600,
    outflow: 450,
  },
] satisfies TopArticleData[];

export const orgBreakdown = [
  { name: "ООО «Базис-Моторс»", balance: 2260, margin: 12.2 },
  { name: "ПОЛЮС-Д", balance: 486, margin: 15.9 },
  { name: "Базис-Сервис", balance: 452, margin: 48.5 },
  { name: "Полюс-Сервис", balance: 302, margin: 38.7 },
  { name: "Базис Тюмень", balance: 269, margin: 12.5 },
  { name: "Беляев А.В. ИП", balance: -22, margin: -18.3 },
] satisfies OrganizationBreakdownData[];

export const pnlSummary = {
  revenue: { sto: 1740, parts: 2720, bonuses: 3300, other: 530 },
  cogs: -1140,
  grossProfit: 7150,
  netProfit: 4110,
} satisfies PnlSummaryData;

export const brandBonuses = [
  { brand: "Джили", amount: 950 },
  { brand: "Чери", amount: 720 },
  { brand: "Чанган", amount: 550 },
  { brand: "Белджи", amount: 480 },
  { brand: "ТЕНЕТ", amount: 300 },
  { brand: "Haval", amount: 180 },
] satisfies BrandBonusData[];

export const topDebtors = [
  {
    name: "ТОО «Астана Fleet»",
    overdueDays: 62,
    amount: 118,
    managerKey: "autobusiness.debtors.manager.corporateSales",
    noteKey: "autobusiness.debtors.note.escalate",
    severity: "critical",
  },
  {
    name: "ООО «Север Авто Парк»",
    overdueDays: 41,
    amount: 74,
    managerKey: "autobusiness.debtors.manager.fleet",
    noteKey: "autobusiness.debtors.note.paymentPlan",
    severity: "watch",
  },
  {
    name: "ИП Смагулов",
    overdueDays: 35,
    amount: 66,
    managerKey: "autobusiness.debtors.manager.retail",
    noteKey: "autobusiness.debtors.note.reconcile",
    severity: "watch",
  },
  {
    name: "ТОО «Regional Taxi Group»",
    overdueDays: 28,
    amount: 39,
    managerKey: "autobusiness.debtors.manager.finance",
    noteKey: "autobusiness.debtors.note.contactLegal",
    severity: "critical",
  },
] satisfies DebtorData[];
