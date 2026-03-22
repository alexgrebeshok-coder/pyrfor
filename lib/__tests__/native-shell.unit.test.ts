import assert from "node:assert/strict";

import {
  isCapacitorNativeApp,
  isNativeShell,
  isStandaloneApp,
  isTauriDesktop,
} from "@/lib/utils";

type RestoreFn = () => void;

function setGlobalProperty<K extends "window" | "navigator">(
  key: K,
  value: unknown
): RestoreFn {
  const target = globalThis as typeof globalThis & {
    window?: unknown;
    navigator?: unknown;
  };
  const descriptor = Object.getOwnPropertyDescriptor(target, key);

  Object.defineProperty(target, key, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
      return;
    }

    delete target[key];
  };
}

function withMockBrowserEnv<T>(
  windowMock: Record<string, unknown> | undefined,
  navigatorMock: Record<string, unknown> | undefined,
  run: () => T
): T {
  const restoreWindow = setGlobalProperty("window", windowMock);
  const restoreNavigator = setGlobalProperty("navigator", navigatorMock);

  try {
    return run();
  } finally {
    restoreNavigator();
    restoreWindow();
  }
}

assert.equal(isTauriDesktop(), false);
assert.equal(isCapacitorNativeApp(), false);
assert.equal(isNativeShell(), false);
assert.equal(isStandaloneApp(), false);

withMockBrowserEnv(
  {
    __TAURI__: {},
    matchMedia: () => ({ matches: false }),
  },
  {
    standalone: false,
    userAgent: "Mozilla/5.0",
  },
  () => {
    assert.equal(isTauriDesktop(), true);
    assert.equal(isNativeShell(), true);
    assert.equal(isStandaloneApp(), true);
  }
);

withMockBrowserEnv(
  {
    Capacitor: {
      isNativePlatform: () => true,
    },
    matchMedia: () => ({ matches: false }),
  },
  {
    standalone: false,
    userAgent: "Mozilla/5.0",
  },
  () => {
    assert.equal(isCapacitorNativeApp(), true);
    assert.equal(isNativeShell(), true);
    assert.equal(isStandaloneApp(), true);
  }
);

withMockBrowserEnv(
  {
    matchMedia: () => ({ matches: true }),
  },
  {
    standalone: false,
    userAgent: "Mozilla/5.0",
  },
  () => {
    assert.equal(isStandaloneApp(), true);
  }
);

withMockBrowserEnv(
  {
    matchMedia: () => ({ matches: false }),
  },
  {
    standalone: true,
    userAgent: "Mozilla/5.0",
  },
  () => {
    assert.equal(isStandaloneApp(), true);
  }
);

console.log("PASS native-shell.unit");
