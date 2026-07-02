/**
 * Gateway bearer-token helpers — secure defaults with explicit opt-in for open mode.
 */

import { randomBytes } from 'crypto';
import { logger } from '../observability/logger';
import type { RuntimeConfig } from './config';
import { saveConfig } from './config';

export function hasGatewayBearerToken(config: RuntimeConfig): boolean {
  return !!(config.gateway.bearerToken) || (config.gateway.bearerTokens?.length ?? 0) > 0;
}

/** Auth is required unless the operator explicitly opts into unauthenticated localhost access. */
export function gatewayRequiresAuth(config: RuntimeConfig): boolean {
  return config.gateway.allowUnauthenticated !== true;
}

/**
 * Ensure a bearer token exists when auth is required.
 * Persists to configPath when provided; otherwise returns an in-memory token only.
 */
export async function ensureGatewayBearerToken(
  config: RuntimeConfig,
  configPath?: string,
): Promise<{ config: RuntimeConfig; provisioned: boolean }> {
  if (!gatewayRequiresAuth(config) || hasGatewayBearerToken(config)) {
    return { config, provisioned: false };
  }

  const newToken = randomBytes(32).toString('hex');
  const updated: RuntimeConfig = {
    ...config,
    gateway: {
      ...config.gateway,
      bearerToken: newToken,
    },
  };

  if (configPath) {
    try {
      await saveConfig(updated, configPath);
      logger.info('[gateway-auth] Auto-provisioned bearer token', { configPath });
      return { config: updated, provisioned: true };
    } catch (err) {
      logger.error('[gateway-auth] Failed to persist auto-provisioned bearer token', {
        configPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.warn('[gateway-auth] Using ephemeral in-memory bearer token (configPath unavailable)');
  return { config: updated, provisioned: true };
}
