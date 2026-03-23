import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: new URL("/landing", siteUrl).toString(),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: new URL("/demo", siteUrl).toString(),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: new URL("/launch", siteUrl).toString(),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.75,
    },
  ];
}
