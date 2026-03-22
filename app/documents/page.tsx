import { ErrorBoundary } from "@/components/error-boundary";
import { DocumentsPage } from "@/components/documents/documents-page";

export default function DocumentsRoute() {
  return (
    <ErrorBoundary resetKey="documents">
      <DocumentsPage />
    </ErrorBoundary>
  );
}
