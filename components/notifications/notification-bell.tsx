"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Bell, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  entityType?: string;
  entityId?: string;
}

const notificationTypes = {
  task_assigned: { color: "bg-blue-500", label: "Задача" },
  due_date: { color: "bg-yellow-500", label: "Срок" },
  status_changed: { color: "bg-green-500", label: "Статус" },
  mention: { color: "bg-purple-500", label: "Упоминание" },
};

export const NotificationBell = React.memo(function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications?userId=default");
      const data = await response.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (error) {
      console.error("[NotificationBell] Error:", error);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    // Poll every 30 seconds for new notifications
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await fetch(`/api/notifications/${notificationId}/read`, {
        method: "PUT",
      });

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, read: true } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error("[NotificationBell] Error marking as read:", error);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
      await Promise.all(unreadIds.map((id) => markAsRead(id)));
    } catch (error) {
      console.error("[NotificationBell] Error marking all as read:", error);
    }
  }, [notifications, markAsRead]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Только что";
    if (minutes < 60) return `${minutes} мин назад`;
    if (hours < 24) return `${hours} ч назад`;
    return `${days} дн назад`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="relative transition-all duration-200 hover:scale-110"
        aria-label={`Уведомления (${unreadCount} непрочитанных)`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 origin-top-right rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-lg transition-all duration-200 animate-in slide-in-from-top-2">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <h3 className="font-semibold">Уведомления</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-[var(--accent)] hover:underline transition-all duration-200"
              >
                Прочитать все
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--ink-muted)]">
                Нет уведомлений
              </div>
            ) : (
              notifications.map((notification) => {
                const typeConfig = notificationTypes[notification.type as keyof typeof notificationTypes] || {
                  color: "bg-gray-500",
                  label: "Уведомление",
                };

                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "border-b border-[var(--line)] px-4 py-3 transition-all duration-200 hover:bg-[var(--surface-secondary)]",
                      !notification.read && "bg-blue-50 dark:bg-blue-900/20"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Type indicator */}
                      <div
                        className={cn(
                          "mt-1 h-2 w-2 rounded-full flex-shrink-0",
                          typeConfig.color
                        )}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-[var(--ink-muted)]">
                            {typeConfig.label}
                          </span>
                          <span className="text-xs text-[var(--ink-muted)]">
                            {formatDate(notification.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium truncate">
                          {notification.title}
                        </p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)] line-clamp-2">
                          {notification.message}
                        </p>
                      </div>

                      {/* Mark as read button */}
                      {!notification.read && (
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className="flex-shrink-0 rounded-full p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--ink)] transition-all duration-200"
                          aria-label="Пометить как прочитанное"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-[var(--line)] px-4 py-2">
              <button
                onClick={() => setIsOpen(false)}
                className="w-full text-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] transition-all duration-200"
              >
                Закрыть
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
