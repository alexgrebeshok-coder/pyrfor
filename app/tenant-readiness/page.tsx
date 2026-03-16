import { TenantReadinessPage } from "@/components/tenant-readiness/tenant-readiness-page";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { buildTenantReadinessRuntimeTruth } from "@/lib/server/runtime-truth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TenantReadinessRoute() {
  const runtimeState = getServerRuntimeState();
  
  // Safe defaults
  const readiness: any = {
    overall: 0,
    categories: [],
    generatedAt: new Date().toISOString(),
  };
  
  const decisionRegister: any = {
    decisions: [],
    pending: 0,
  };
  
  const runtimeTruth = buildTenantReadinessRuntimeTruth({
    runtime: runtimeState,
    readiness,
  });

  return (
    <TenantReadinessPage
      currentReviewOutcomeLabel="Ожидает проверки"
      decisionAvailabilityNote="Функция в разработке"
      decisionRegister={decisionRegister}
      readiness={readiness}
      runtimeTruth={runtimeTruth}
    />
  );
}
