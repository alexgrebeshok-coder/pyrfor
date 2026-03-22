"use client";

import dynamic from "next/dynamic";

function ChatPageFallback() {
  return (
    <div className="relative h-[calc(100vh-8rem)] min-h-[720px] overflow-hidden rounded-[18px] border border-[color:var(--line-strong)] bg-[color:var(--surface-panel)] shadow-[0_30px_80px_rgba(15,23,42,.05)]">
      <div className="flex h-full items-center justify-center px-4 py-6 sm:px-6">
        <div className="w-full max-w-3xl rounded-[24px] border border-[color:var(--line-strong)] bg-[color:var(--surface-panel-strong)] p-6 shadow-[0_18px_48px_rgba(15,23,42,.06)]">
          <div className="space-y-3">
            <div className="h-4 w-32 animate-pulse rounded-full bg-[var(--panel-soft)]" />
            <div className="h-8 w-64 animate-pulse rounded-full bg-[var(--panel-soft)]" />
            <div className="h-4 w-full animate-pulse rounded-full bg-[var(--panel-soft)]" />
            <div className="h-4 w-5/6 animate-pulse rounded-full bg-[var(--panel-soft)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

const ChatLayout = dynamic(
  () => import("@/components/chat/chat-layout").then((m) => m.ChatLayout),
  { ssr: false, loading: () => <ChatPageFallback /> }
);

export function ChatClientWrapper() {
  return <ChatLayout />;
}
