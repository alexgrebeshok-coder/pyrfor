import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  databaseUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * GET /api/notifications
 * Get notifications for current user
 * P1-3: Fixed IDOR - userId derived from session, not query params
 */
export async function GET(request: NextRequest) {
  // Require authentication
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  // P1-3: Derive userId from authenticated session, ignore client-supplied value
  const userId = authResult.accessProfile.userId;

  try {
    const runtime = getServerRuntimeState();

        if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { searchParams } = new URL(request.url);
    // P1-3: Removed userId from query params - now from session only
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const limit = parseInt(searchParams.get("limit") || "50");

    const where = {
      userId, // From session
      ...(unreadOnly && { read: false }),
    };

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const unreadCount = await prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });

    return NextResponse.json({
      notifications,
      unreadCount,
      total: notifications.length,
    });
  } catch (error) {
    console.error("[Notifications API] Error:", error);
    return serverError(error, "Failed to fetch notifications");
  }
}

/**
 * POST /api/notifications
 * Create a new notification
 * P1-3: Fixed IDOR - userId from session only
 */
export async function POST(request: NextRequest) {
  // Require authentication
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  // P1-3: Derive userId from session
  const sessionUserId = authResult.accessProfile.userId;

  try {
    const runtime = getServerRuntimeState();

        if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const body = await request.json();
    const { type, title, message, entityType, entityId } = body;

    // P1-3: Ignore client-supplied userId, use session userId
    if (!type || !title || !message) {
      return badRequest("Missing required fields: type, title, message");
    }

    const notification = await prisma.notification.create({
      data: {
        id: randomUUID(),
        userId: sessionUserId,
        type,
        title,
        message,
        entityType,
        entityId,
      },
    });

    return NextResponse.json(notification, { status: 201 });
  } catch (error) {
    console.error("[Notifications API] Error:", error);
    return serverError(error, "Failed to create notification");
  }
}
