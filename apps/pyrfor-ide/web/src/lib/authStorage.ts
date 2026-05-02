const LEGACY_TOKEN_KEY = 'pyrfor-token';
const SECRET_TOKEN_KEY = 'gateway:bearer-token';
const memorySecrets = new Map<string, string>();

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function getSecretValue(key: string): Promise<string> {
  if (isTauri()) {
    return (await invokeTauri<string | null>('get_secret', { key })) || '';
  }
  return memorySecrets.get(key) || '';
}

export async function setSecretValue(key: string, value: string): Promise<void> {
  if (isTauri()) {
    await invokeTauri('set_secret', { key, value });
    return;
  }
  memorySecrets.set(key, value);
}

export async function deleteSecretValue(key: string): Promise<void> {
  if (isTauri()) {
    await invokeTauri('delete_secret', { key });
    return;
  }
  memorySecrets.delete(key);
}

function readLegacyToken(): string {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(LEGACY_TOKEN_KEY)) || '';
  } catch {
    return '';
  }
}

function clearLegacyToken(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Ignore browser storage failures.
  }
}

export async function getBearerToken(): Promise<string> {
  if (!isTauri()) return readLegacyToken();

  const secret = await getSecretValue(SECRET_TOKEN_KEY);
  if (secret) {
    clearLegacyToken();
    return secret;
  }

  const legacy = readLegacyToken();
  if (legacy) {
    await setSecretValue(SECRET_TOKEN_KEY, legacy);
    clearLegacyToken();
  }
  return legacy;
}

export async function setBearerToken(token: string): Promise<void> {
  const value = token.trim();
  if (!value) {
    await clearBearerToken();
    return;
  }

  if (isTauri()) {
    await setSecretValue(SECRET_TOKEN_KEY, value);
    clearLegacyToken();
    return;
  }

  localStorage.setItem(LEGACY_TOKEN_KEY, value);
}

export async function clearBearerToken(): Promise<void> {
  clearLegacyToken();
  await deleteSecretValue(SECRET_TOKEN_KEY);
}
