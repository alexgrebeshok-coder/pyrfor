import { TenantOnboardingPage } from "@/components/tenant-onboarding/tenant-onboarding-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TenantOnboardingRoute() {
  // Safe defaults
  const runbooks: any[] = [];
  const steps: any[] = [];

  return <TenantOnboardingPage runbooks={runbooks} steps={steps} />;
}
