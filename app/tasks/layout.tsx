import type { ReactNode } from "react";

import { AIProvider } from "@/contexts/ai-context";

export default function TasksLayout({ children }: { children: ReactNode }) {
  return <AIProvider>{children}</AIProvider>;
}

