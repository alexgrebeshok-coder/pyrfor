import type { ReactNode } from "react";

import { AIProvider } from "@/contexts/ai-context";

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <AIProvider>{children}</AIProvider>;
}
