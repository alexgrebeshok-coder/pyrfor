import type { Metadata } from "next";

import PublicDemoPage from "@/components/demo/public-demo-page";

export const metadata: Metadata = {
  title: "Demo | CEOClaw",
  description: "Public demo with seed data, briefings, budget signals, and a five-message AI chat.",
  alternates: {
    canonical: "/demo",
  },
  openGraph: {
    title: "Demo | CEOClaw",
    description: "Public demo with seed data, briefings, budget signals, and a five-message AI chat.",
    url: "/demo",
    siteName: "CEOClaw",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "CEOClaw public demo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Demo | CEOClaw",
    description: "Public demo with seed data, briefings, budget signals, and a five-message AI chat.",
    images: ["/opengraph-image"],
  },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function DemoRoute() {
  return <PublicDemoPage />;
}
