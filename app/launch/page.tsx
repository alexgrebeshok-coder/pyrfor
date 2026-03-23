import type { Metadata } from "next";

import { LaunchKitPage } from "@/components/marketing/launch-kit-page";

export const metadata: Metadata = {
  title: "CEOClaw — Launch kit",
  description: "Launch-ready copy for Product Hunt, Habr, Telegram, the demo video, and the welcome sequence.",
  alternates: {
    canonical: "/launch",
  },
  openGraph: {
    title: "CEOClaw — Launch kit",
    description: "Launch-ready copy for Product Hunt, Habr, Telegram, the demo video, and the welcome sequence.",
    url: "/launch",
    siteName: "CEOClaw",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "CEOClaw — Launch kit",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CEOClaw — Launch kit",
    description: "Launch-ready copy for Product Hunt, Habr, Telegram, the demo video, and the welcome sequence.",
    images: ["/opengraph-image"],
  },
};

export default function LaunchRoute() {
  return <LaunchKitPage />;
}
