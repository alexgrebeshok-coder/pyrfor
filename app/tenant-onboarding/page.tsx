import { TenantOnboardingPage } from "@/components/tenant-onboarding/tenant-onboarding-page";
import { buildAccessProfile } from "@/lib/auth/access-profile";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { buildTenantOnboardingRuntimeTruth } from "@/lib/server/runtime-truth";
import { getTenantOnboardingOverview } from "@/lib/tenant-onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TenantOnboardingRoute() {
  const runtimeState = getServerRuntimeState();
  const accessProfile = buildAccessProfile();
  const overview = await getTenantOnboardingOverview({
    accessProfile,
  });

  const runtimeTruth = buildTenantOnboardingRuntimeTruth({
    runtime: runtimeState,
    overview,
  });

  return (
    <TenantOnboardingPage
      overview={overview}
      runtimeTruth={runtimeTruth}
      availabilityNote="Функция в разработке"
    />
  );
}
