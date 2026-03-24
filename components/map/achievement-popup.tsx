"use client";

import { useEffect, useState } from "react";

interface AchievementPopupProps {
  title: string;
  xp: number;
  icon?: string;
  onClose: () => void;
}

export function AchievementPopup({
  title,
  xp,
  icon = "🏅",
  onClose,
}: AchievementPopupProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Auto-close after 3 seconds
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onClose, 300);
    }, 3000);

    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 transition-all duration-300 ${
        isVisible && !isExiting ? "opacity-100 scale-100" : "opacity-0 scale-75"
      }`}
    >
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/10 backdrop-blur-xl p-6 shadow-2xl">
        <div className="text-center">
          <div className="mb-3 text-5xl animate-bounce">{icon}</div>
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span className="text-2xl">✨</span>
            <span className="text-xl font-bold text-amber-300">+{xp} XP</span>
          </div>
          <p className="mt-3 text-sm text-amber-200/80">Отличная работа!</p>
        </div>
      </div>
    </div>
  );
}
