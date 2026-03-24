"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DraggableFABProps {
  icon?: React.ReactNode;
  onClick?: () => void;
  isOpen?: boolean;
  children?: React.ReactNode;
  storageKey?: string;
}

/**
 * DraggableFAB — Floating Action Button with drag support
 * 
 * - Long-press to start dragging (desktop: hold, mobile: touch and hold)
 * - Visual feedback when dragging
 * - Position saved to localStorage
 * - Constrained within viewport
 * - Works on both desktop and mobile
 */
export function DraggableFAB({
  icon = <MessageCircle className="h-6 w-6" />,
  onClick,
  isOpen = false,
  children,
  storageKey = "ceoclaw-fab-position",
}: DraggableFABProps) {
  const [position, setPosition] = useState({ x: 24, y: 24 }); // bottom-right: 24px from edges
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef({ x: 0, y: 0 });

  // Load saved position
  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPosition(parsed);
      } catch {
        // Ignore parse errors
      }
    }
  }, [storageKey]);

  // Save position
  const savePosition = useCallback(
    (pos: { x: number; y: number }) => {
      localStorage.setItem(storageKey, JSON.stringify(pos));
    },
    [storageKey]
  );

  // Constrain position within viewport
  const constrainPosition = useCallback((x: number, y: number) => {
    const buttonSize = 56; // h-14 w-14 = 56px
    const padding = 16;
    const maxX = window.innerWidth - buttonSize - padding;
    const maxY = window.innerHeight - buttonSize - padding;

    return {
      x: Math.max(padding, Math.min(x, maxX)),
      y: Math.max(padding, Math.min(y, maxY)),
    };
  }, []);

  // Start dragging (desktop)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isOpen) return;
    
    e.preventDefault();
    longPressTimer.current = setTimeout(() => {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }, 150); // 150ms hold to start drag
  };

  // Start dragging (mobile)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isOpen) return;
    
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };
    
    longPressTimer.current = setTimeout(() => {
      setIsDragging(true);
      setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
      // Haptic feedback on mobile
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 200); // 200ms hold on mobile
  };

  // Move (desktop)
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      const constrained = constrainPosition(newX, newY);
      
      setPosition(constrained);
      setHasMoved(true);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
      savePosition(position);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragStart, constrainPosition, savePosition, position]);

  // Move (mobile)
  useEffect(() => {
    if (!isDragging) return;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const newX = touch.clientX - dragStart.x;
      const newY = touch.clientY - dragStart.y;
      const constrained = constrainPosition(newX, newY);
      
      setPosition(constrained);
      setHasMoved(true);
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
      savePosition(position);
    };

    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);

    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging, dragStart, constrainPosition, savePosition, position]);

  // Cancel long-press on mouse leave
  const handleMouseLeave = () => {
    if (longPressTimer.current && !isDragging) {
      clearTimeout(longPressTimer.current);
    }
  };

  // Cancel long-press on touch cancel
  const handleTouchCancel = () => {
    if (longPressTimer.current && !isDragging) {
      clearTimeout(longPressTimer.current);
    }
  };

  // Handle click (only if not dragging)
  const handleClick = () => {
    if (hasMoved) {
      setHasMoved(false);
      return;
    }
    onClick?.();
  };

  // Convert position to CSS (position is from top-left)
  const style: React.CSSProperties = {
    position: "fixed",
    left: position.x,
    top: position.y,
    zIndex: isDragging ? 9999 : 50,
    touchAction: isDragging ? "none" : "auto",
  };

  // Closed state - just the button
  if (!isOpen) {
    return (
      <div
        ref={containerRef}
        style={style}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchCancel={handleTouchCancel}
        onClick={handleClick}
        className={cn(
          "group",
          isDragging && "cursor-grabbing"
        )}
      >
        <Button
          className={cn(
            "h-14 w-14 rounded-full shadow-lg transition-all duration-200",
            isDragging && "scale-110 shadow-2xl ring-2 ring-blue-400 ring-offset-2"
          )}
          size="icon"
        >
          {isDragging ? (
            <GripVertical className="h-6 w-6 animate-pulse" />
          ) : (
            icon
          )}
        </Button>
        
        {/* Drag hint tooltip */}
        {isDragging && (
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
            Перетащи кнопку
          </div>
        )}
      </div>
    );
  }

  // Open state - panel with close button
  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        bottom: position.y > window.innerHeight / 2 ? "auto" : 24,
        top: position.y > window.innerHeight / 2 ? position.y - 400 : "auto",
        right: position.x < window.innerWidth / 2 ? "auto" : 24,
        left: position.x < window.innerWidth / 2 ? position.x : "auto",
        zIndex: 50,
      }}
      className="w-96"
    >
      <div className="relative">
        {/* Drag handle at top */}
        <div
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          className="absolute -top-1 left-1/2 -translate-x-1/2 w-16 h-4 bg-gray-300 dark:bg-gray-700 rounded-full cursor-grab active:cursor-grabbing flex items-center justify-center"
        >
          <div className="w-8 h-1 bg-gray-400 dark:bg-gray-600 rounded-full" />
        </div>
        
        {children}
      </div>
    </div>
  );
}
