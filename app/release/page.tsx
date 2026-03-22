import type { Metadata } from "next";

import { ReleasePage } from "@/components/release/release-page";

export const metadata: Metadata = {
  title: "Release Center | CEOClaw",
  description: "Install the CEOClaw web app, macOS shell, or iPhone shell from one place.",
};

export default function ReleaseRoute() {
  return <ReleasePage />;
}
