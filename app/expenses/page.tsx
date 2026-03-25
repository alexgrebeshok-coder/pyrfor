import { ErrorBoundary } from "@/components/error-boundary";
import { ExpensesPage } from "@/components/expenses/expenses-page";

export default function ExpensesRoute() {
  return (
    <ErrorBoundary resetKey="expenses">
      <ExpensesPage />
    </ErrorBoundary>
  );
}
