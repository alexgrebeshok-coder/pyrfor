type TelegramFetch = typeof fetch;

export interface TelegramBotProfile {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
}

export interface TelegramSentMessage {
  message_id: number;
  date?: number;
}

type TelegramApiSuccess<T> = {
  ok: true;
  result: T;
};

type TelegramApiFailure = {
  ok: false;
  error_code?: number;
  description?: string;
};

type TelegramApiResponse<T> = TelegramApiSuccess<T> | TelegramApiFailure;

export function getTelegramToken(env: NodeJS.ProcessEnv = process.env) {
  return env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function getTelegramDefaultChatId(env: NodeJS.ProcessEnv = process.env) {
  return env.TELEGRAM_DEFAULT_CHAT_ID?.trim() || null;
}

export async function probeTelegramMethod<T>(
  token: string,
  method: "getMe" | "getWebhookInfo",
  fetchImpl: TelegramFetch = fetch
): Promise<{ ok: true; result: T } | { ok: false; message: string }> {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false,
      message: `HTTP ${response.status} while calling ${method}`,
    };
  }

  const payload = (await response.json()) as TelegramApiResponse<T>;
  if (!payload.ok) {
    return {
      ok: false,
      message: payload.description || `Telegram API rejected ${method}`,
    };
  }

  return {
    ok: true,
    result: payload.result,
  };
}

export async function sendTelegramTextMessage(
  input: {
    token: string;
    chatId: string | number;
    text: string;
    parseMode?: "Markdown" | "HTML";
  },
  fetchImpl: TelegramFetch = fetch
): Promise<
  | { ok: true; result: TelegramSentMessage }
  | { ok: false; message: string; status?: number }
> {
  const response = await fetchImpl(
    `https://api.telegram.org/bot${input.token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
      }),
    }
  );

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: `HTTP ${response.status} while calling sendMessage`,
    };
  }

  const payload = (await response.json()) as TelegramApiResponse<TelegramSentMessage>;
  if (!payload.ok) {
    return {
      ok: false,
      status: payload.error_code,
      message: payload.description || "Telegram API rejected sendMessage",
    };
  }

  return {
    ok: true,
    result: payload.result,
  };
}
