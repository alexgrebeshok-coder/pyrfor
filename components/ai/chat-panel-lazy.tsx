"use client";

import dynamic from "next/dynamic";

export const AIChatPanelLazy = dynamic(
  () => import("@/components/ai/chat-panel").then((module) => module.AIChatPanel),
  { ssr: false }
);
