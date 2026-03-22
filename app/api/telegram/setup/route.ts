import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Setup endpoint to register Telegram webhook on Vercel
 * POST /api/telegram/setup?url=https://your-app.vercel.app
 * Or uses NEXT_PUBLIC_APP_URL from env if url param not provided
 */
export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN not set" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const baseUrl = searchParams.get("url") || process.env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "Base URL not provided (use ?url= or set NEXT_PUBLIC_APP_URL)" },
      { status: 400 }
    );
  }

  const webhookUrl = `${baseUrl}/api/telegram/webhook`;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ["message", "callback_query"],
        }),
      }
    );

    const result = await response.json();

    if (result.ok) {
      logger.info(`Telegram webhook registered: ${webhookUrl}`);
      return NextResponse.json({
        ok: true,
        webhook_url: webhookUrl,
        telegram_response: result,
      });
    } else {
      logger.error("Failed to register webhook:", result);
      return NextResponse.json(
        { ok: false, error: "Failed to register webhook", details: result },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error("Webhook setup error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to setup webhook" },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check webhook status
 */
export async function GET(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN not set" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getWebhookInfo`
    );

    const result = await response.json();

    return NextResponse.json({
      ok: true,
      webhook_info: result.result,
    });
  } catch (error) {
    logger.error("Failed to get webhook info:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to get webhook info" },
      { status: 500 }
    );
  }
}
