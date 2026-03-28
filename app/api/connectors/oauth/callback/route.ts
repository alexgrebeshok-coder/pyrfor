/**
 * OAuth callback — exchanges code for tokens, saves credential
 * GET /api/connectors/oauth/callback?code=...&state=...
 */

import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  saveCredential,
} from "@/lib/connectors/oauth/oauth-service";

export const dynamic = "force-dynamic";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${APP_URL}/integrations?oauth_error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${APP_URL}/integrations?oauth_error=missing_code`
    );
  }

  let state: { provider: string; connectorId: string; workspaceId: string };
  try {
    state = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf-8")
    );
  } catch {
    return NextResponse.redirect(
      `${APP_URL}/integrations?oauth_error=invalid_state`
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(state.provider, code);

    // Try to get account email from userinfo (for label)
    let accountEmail: string | undefined;
    if (state.provider === "google") {
      try {
        const userRes = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
            },
          }
        );
        if (userRes.ok) {
          const user = (await userRes.json()) as { email?: string };
          accountEmail = user.email;
        }
      } catch {
        /* best-effort */
      }
    } else if (state.provider === "microsoft") {
      try {
        const userRes = await fetch(
          "https://graph.microsoft.com/v1.0/me",
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
            },
          }
        );
        if (userRes.ok) {
          const user = (await userRes.json()) as {
            mail?: string;
            userPrincipalName?: string;
          };
          accountEmail = user.mail || user.userPrincipalName;
        }
      } catch {
        /* best-effort */
      }
    }

    await saveCredential({
      workspaceId: state.workspaceId,
      connectorId: state.connectorId,
      provider: state.provider,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scopes: tokens.scope,
      accountEmail,
      accountLabel: accountEmail
        ? `${state.connectorId} (${accountEmail})`
        : state.connectorId,
    });

    return NextResponse.redirect(
      `${APP_URL}/integrations?oauth_success=${state.connectorId}`
    );
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Token exchange failed";
    console.error("[oauth-callback]", msg);
    return NextResponse.redirect(
      `${APP_URL}/integrations?oauth_error=${encodeURIComponent(msg.slice(0, 100))}`
    );
  }
}
