---
version: "alpha"
name: CEOClaw
description: "Executive project management platform — calm, professional, data-dense interface for decision-makers"

colors:
  primary: "#3b82f6"
  on-primary: "#ffffff"
  secondary: "#475569"
  tertiary: "#2563eb"
  neutral: "#f3f4f6"
  ink: "#0f172a"
  ink-soft: "#475569"
  ink-muted: "#6b7280"
  brand: "#3b82f6"
  brand-strong: "#2563eb"
  surface: "#f3f4f6"
  surface-panel: "#ffffff"
  surface-sidebar: "#eceef2"
  line: "#e2e4e9"
  line-strong: "#c9cdd4"
  dark-ink: "#f5f5f5"
  dark-ink-soft: "#c8c8c8"
  dark-surface: "#0f0f10"
  dark-surface-panel: "#1f1f1f"
  dark-line: "#2a2a2a"
  dark-brand: "#3b82f6"

typography:
  h1:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: "31px"
    lineHeight: "1.2"
  h2:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: "25px"
    lineHeight: "1.3"
  h3:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: "21px"
    lineHeight: "1.4"
  body:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: "1.6"
  caption:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: "1.5"
  label:
    fontFamily: "Inter, PingFang SC, system-ui, sans-serif"
    fontSize: "11px"
    lineHeight: "1.4"

rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  "2xl": "20px"

spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"

components:
  sidebar:
    width: "260px"
    backgroundColor: "{colors.surface-sidebar}"
  panel:
    backgroundColor: "{colors.surface-panel}"
    borderRadius: "{rounded.lg}"
    boxShadow: "0 20px 52px rgba(15, 23, 42, 0.05)"
  button-primary:
    backgroundColor: "{colors.brand-strong}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "#1d4ed8"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
  input-field:
    backgroundColor: "#ffffff"
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  badge:
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.surface-panel}"
    borderColor: "{colors.line}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    boxShadow: "0 20px 52px rgba(15, 23, 42, 0.05)"
  page-background:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  dark-page-background:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-ink}"
  dark-card:
    backgroundColor: "{colors.dark-surface-panel}"
    borderColor: "{colors.dark-line}"
    textColor: "{colors.dark-ink}"
  muted-text:
    textColor: "{colors.ink-muted}"
  dark-muted-text:
    textColor: "{colors.dark-ink-soft}"
---

## Overview

CEOClaw is a **calm, professional** project management platform designed for executives and decision-makers. The visual language prioritizes **clarity, density, and confidence** — evoking a premium SaaS tool, not a consumer app.

The interface uses a **light-first** approach with a meticulously crafted dark mode. Surfaces layer subtly (base → panel → overlay) to create depth without distraction. The brand blue (`#3b82f6`) is used sparingly — only for interactive elements and focus states.

Key principles:
- **Data-dense, not cluttered** — executives scan, they don't read
- **Quiet confidence** — no gradients on headings, no decorative noise
- **Responsive density** — compact mode for power users, comfortable default
- **Trilingual** — Russian, English, Chinese (font stack supports all three)

## Colors

Two complete palettes (light + dark), connected through CSS custom properties.

**Light mode:**
- **Ink (#0f172a):** Primary text — deep slate, never pure black
- **Ink-soft (#475569):** Secondary text, captions, metadata
- **Ink-muted (#6b7280):** Tertiary, placeholders, disabled states
- **Brand (#3b82f6):** Blue-500 — interactive elements, links, focus rings
- **Brand-strong (#2563eb):** Blue-600 — hover states, active states
- **Surface (#f3f4f6):** Page background — cool gray, warmer than pure gray
- **Surface-panel (#ffffff):** Cards, modals, panels — pure white
- **Line (#e2e4e9 → 8% opacity):** Subtle borders, dividers

**Dark mode:** Inverts the hierarchy — dark surfaces (#0f0f10 base), lighter ink (#f5f5f5), same brand blue.

## Typography

Single font family: **Inter** with CJK fallbacks (PingFang SC, Microsoft YaHei, Hiragino Sans GB).

Font sizes follow a **modular scale** optimized for data tables and dashboards:
- Headings are tight (line-height 1.2–1.4) for compact vertical space
- Body is generous (line-height 1.6) for readability in task descriptions
- Labels use 11px for maximum density without sacrificing clarity

## Layout

**App shell architecture:**
- Sidebar: 260px fixed, collapsible on mobile (<768px)
- Main content: max-width 1680px, centered
- Topbar: breadcrumb + actions + user menu
- Content padding scales with density mode

**Density modes:**
- Default: comfortable spacing for general use
- Compact (`data-density="compact"`): 12-15% tighter for power users
- Mobile: auto-adjusts sidebar (full-width overlay) and padding

**Responsive breakpoints:**
- Mobile: <768px
- Tablet: 769–1024px
- Desktop: >1024px

## Elevation & Depth

Three elevation levels:
1. **Flat** — sidebar, background panels (no shadow)
2. **Subtle** — cards, list items (`0 20px 52px rgba(15, 23, 42, 0.05)`)
3. **Prominent** — modals, popovers (`0 26px 70px rgba(15, 23, 42, 0.08)`)

Dark mode shadows use darker, more opaque values.

Ambient gradients (radial, very subtle) add depth to the main content area — a faint blue glow at top-left and a softer glow at top-right.

## Shapes

Rounded corners are consistent and moderate:
- `sm (8px)` — badges, tags, small inputs
- `md (10px)` — buttons, form fields
- `lg (12px)` — cards, panels
- `xl (16px)` — large cards, modals
- `2xl (20px)` — hero sections, feature cards

Scrollbars use fully rounded thumbs (`border-radius: 999px`).

## Components

**Sidebar:** Persistent navigation with project switcher, grouped nav links, and collapsible sections. Background uses a subtle vertical gradient on desktop.

**Cards:** White panels with 1px borders and soft shadows. Intro cards have a decorative brand-tinted gradient overlay (fades at 38%).

**Skeleton loading:** Animated shimmer effect using `translateX` animation. Respects `prefers-reduced-motion`.

**Skip link:** Accessible skip-to-content link, hidden by default, appears on focus.

**Focus states:** 2px solid brand-blue outline, 2px offset. Consistent across all interactive elements.

## Do's and Don'ts

**Do:**
- Use CSS custom properties for all colors (enables dark mode toggle)
- Test contrast ratios for WCAG AA (4.5:1 minimum)
- Use the density attribute for compact mode
- Support CJK fonts for Chinese localization
- Use `overscroll-behavior: contain` for scroll regions
- Provide `scrollbar-gutter: stable` to prevent layout shift

**Don't:**
- Use pure black (#000) for text — use ink (#0f172a) instead
- Add decorative gradients to text or headings
- Use brand blue for large background areas
- Hard-code pixel values outside the spacing scale
- Use `overflow: hidden` on scrollable regions
- Forget dark mode variants for new components
