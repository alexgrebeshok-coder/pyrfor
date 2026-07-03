/**
 * Shared URL policy for outbound HTTP(S) fetches — blocks SSRF to private/link-local targets.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_PROTOCOLS = new Set(['file:', 'data:', 'javascript:', 'blob:', 'ftp:']);

function isPrivateOrLocalIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / shared address space
  return false;
}

function isPrivateOrLocalIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  return false;
}

function hostnameLooksPrivate(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === 'metadata.google.internal') return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return isPrivateOrLocalIpv4(host.split('.').map((n) => Number.parseInt(n, 10)));
  }
  if (ipVersion === 6) {
    return isPrivateOrLocalIpv6(host);
  }
  return false;
}

function addressLooksPrivate(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    return isPrivateOrLocalIpv4(address.split('.').map((n) => Number.parseInt(n, 10)));
  }
  if (ipVersion === 6) {
    return isPrivateOrLocalIpv6(address);
  }
  return false;
}

function assertResolvedAddressesAllowed(hostname: string, addresses: string[]): void {
  for (const address of addresses) {
    if (addressLooksPrivate(address)) {
      throw new UrlPolicyError(
        `Blocked private or local resolved address for ${hostname}: ${address}`,
      );
    }
  }
}

export class UrlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlPolicyError';
  }
}

/** Validate a URL before outbound fetch/navigation. Only http/https; deny private/link-local hosts. */
export function assertOutboundUrlAllowed(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlPolicyError(`Invalid URL: ${rawUrl}`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (BLOCKED_PROTOCOLS.has(protocol)) {
    throw new UrlPolicyError(`Blocked URL protocol: ${protocol}`);
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new UrlPolicyError(`Only http and https URLs are allowed (got ${protocol})`);
  }

  if (!parsed.hostname) {
    throw new UrlPolicyError('URL hostname is required');
  }

  if (hostnameLooksPrivate(parsed.hostname)) {
    throw new UrlPolicyError(`Blocked private or local URL host: ${parsed.hostname}`);
  }

  return parsed;
}

/**
 * Validate URL and resolve hostnames before fetch — blocks DNS rebinding to private IPs.
 */
export async function assertOutboundUrlAllowedResolved(rawUrl: string): Promise<URL> {
  const parsed = assertOutboundUrlAllowed(rawUrl);
  const host = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');

  if (isIP(host)) {
    return parsed;
  }

  const results = await lookup(host, { all: true, verbatim: true });
  assertResolvedAddressesAllowed(host, results.map((entry) => entry.address));
  return parsed;
}
