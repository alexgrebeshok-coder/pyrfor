import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailable,
  forbidden,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * PUT /api/notifications/[id]/read
 * Mark notification as read
 * P1-3: Fixed IDOR - verify ownership before updating
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Require authentication
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const sessionUserId = authResult.accessProfile.userId;

  try {
    const runtime = getServerRuntimeState();

        if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { id: notificationId } = await params;

    // P1-3: Check ownership before allowing update
    const existingNotification = await prisma.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true },
    });

    if (!existingNotification) {
      return notFound("Notification not found");
    }

    if (existingNotification.userId !== sessionUserId) {
      return forbidden("You can only mark your own notifications as read");
    }

    const notification = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        read: true,
        readAt: new Date(),
      },
    });

    return NextResponse.json(notification);
  } catch (error) {
    console.error("[Notifications Read API] Error:", error);
    if (error instanceof Error && /record to update not found/i.test(error.message)) {
      return notFound("Notification not found");
    }

    return serverError(error, "Failed to mark notification as read");
  }
}
