import type { Metadata } from "next";

import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = {
  title: "CEOClaw — AI project cockpit",
  description: "AI product cockpit for projects, budgets, evidence, and team briefings.",
  alternates: {
    canonical: "/landing",
  },
  openGraph: {
    title: "CEOClaw — AI project cockpit",
    description: "AI product cockpit for projects, budgets, evidence, and team briefings.",
    url: "/landing",
    siteName: "CEOClaw",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "CEOClaw — AI project cockpit",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CEOClaw — AI project cockpit",
    description: "AI product cockpit for projects, budgets, evidence, and team briefings.",
    images: ["/opengraph-image"],
  },
};

export default function LandingRoute() {
  return <LandingPage />;
}
