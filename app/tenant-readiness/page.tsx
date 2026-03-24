import { TenantReadinessPage } from "@/components/tenant-readiness/tenant-readiness-page";
import { buildAccessProfile } from "@/lib/auth/access-profile";
import { listCutoverDecisionRegister, type CutoverDecisionRegister } from "@/lib/cutover-decisions";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { buildTenantReadinessRuntimeTruth } from "@/lib/server/runtime-truth";
import { getTenantReadiness } from "@/lib/tenant-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TenantReadinessRoute() {
  const runtimeState = getServerRuntimeState();
  const accessProfile = buildAccessProfile();
  const readiness = await getTenantReadiness({
    accessProfile,
    runtime: runtimeState,
  });
  const decisionRegister: CutoverDecisionRegister = runtimeState.databaseConfigured
    ? await listCutoverDecisionRegister()
    : {
        entries: [],
        latestDecision: null,
        summary: {
          approvals: 0,
          latestDecisionAt: null,
          latestRollbackAt: null,
          latestWaiverAt: null,
          rollbacks: 0,
          total: 0,
          waivers: 0,
        },
      };

  const runtimeTruth = buildTenantReadinessRuntimeTruth({
    runtime: runtimeState,
    readiness,
  });

  return (
    <TenantReadinessPage
      currentReviewOutcomeLabel="Unavailable"
      decisionAvailabilityNote="Функция в разработке"
      decisionRegister={decisionRegister}
      readiness={readiness}
      runtimeTruth={runtimeTruth}
    />
  );
}
