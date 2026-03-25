export interface ExpenseCategoryView {
  id: string;
  name: string;
  code: string;
  color: string | null;
  icon: string | null;
}

export interface ExpenseView {
  id: string;
  projectId: string;
  categoryId: string;
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  date: string;
  status: string;
  documentUrl: string | null;
  supplierId: string | null;
  taskId: string | null;
  equipmentId: string | null;
  oneCRef: string | null;
  project: { id: string; name: string };
  category: ExpenseCategoryView;
  supplier: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
  equipment: { id: string; name: string } | null;
}

export interface ExpensesResponse {
  expenses: ExpenseView[];
  summary: {
    total: number;
    approved: number;
    pending: number;
    byCategory: Array<{
      categoryId: string;
      name: string;
      amount: number;
      color: string | null;
    }>;
  };
}
