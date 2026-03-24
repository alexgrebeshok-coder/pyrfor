/* eslint-disable no-console */
/**
 * Web Vitals Monitoring
 * 
 * Collects and reports Core Web Vitals metrics
 */

import type { Metric } from 'web-vitals';
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals';

interface WebVitalMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  id: string;
}

const vitalsBuffer: WebVitalMetric[] = [];
const FLUSH_INTERVAL = 10000; // 10 seconds

// Collect metrics
function collectMetric(metric: WebVitalMetric): void {
  vitalsBuffer.push(metric);
  
  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Web Vitals] ${metric.name}: ${metric.value}ms (${metric.rating})`);
  }
  
  // Flush when buffer is full
  if (vitalsBuffer.length >= 10) {
    flushVitals();
  }
}

// Flush to analytics endpoint
async function flushVitals(): Promise<void> {
  if (vitalsBuffer.length === 0) return;
  
  const payload = [...vitalsBuffer];
  vitalsBuffer.length = 0; // Clear buffer
  
  try {
    // Send to analytics endpoint (if configured)
    if (process.env.NEXT_PUBLIC_ANALYTICS_ID) {
      await fetch('/api/analytics/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metrics: payload,
          timestamp: new Date().toISOString(),
          url: window.location.href,
        }),
      });
    }
  } catch (error) {
    // Silently fail - don't impact user experience
    if (process.env.NODE_ENV === 'development') {
      console.error('[Web Vitals] Failed to flush:', error);
    }
  }
}

// Initialize web vitals monitoring
export function initWebVitals(): void {
  if (typeof window === 'undefined') return;
  
  // Core Web Vitals
  onCLS((metric: Metric) => collectMetric({
    name: 'CLS',
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
  }));
  
  onINP((metric: Metric) => collectMetric({
    name: 'INP',
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
  }));
  
  onLCP((metric: Metric) => collectMetric({
    name: 'LCP',
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
  }));
  
  // Other metrics
  onFCP((metric: Metric) => collectMetric({
    name: 'FCP',
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
  }));
  
  onTTFB((metric: Metric) => collectMetric({
    name: 'TTFB',
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
  }));
  
  // Flush periodically
  setInterval(flushVitals, FLUSH_INTERVAL);
  
  // Flush on page unload
  window.addEventListener('beforeunload', flushVitals);
}
