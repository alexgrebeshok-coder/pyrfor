export function shouldAutostartTelegramWithDaemon(input: {
  telegramEnabled: boolean;
  configToken?: string | null;
  envToken?: string | null;
  autostartEnv?: string | null;
}): boolean {
  const autostart = input.autostartEnv?.toLowerCase();
  const autostartOff = autostart === '0' || autostart === 'false';
  return input.telegramEnabled && Boolean(input.configToken ?? input.envToken) && !autostartOff;
}
