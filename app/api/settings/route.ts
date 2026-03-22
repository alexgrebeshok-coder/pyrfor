import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  canAccessWorkspace,
  resolveAccessibleWorkspace,
  type PlatformRole,
} from "@/lib/policy/access";
import { AppPreferences, defaultAppPreferences, isLocale, supportedLocales } from "@/lib/preferences";
import { validationError, serverError } from "@/lib/server/api-utils";
import type { Locale } from "@/lib/translations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const languageEnum = z.enum(
  supportedLocales as [Locale, Locale, Locale]
);

const updatePreferencesSchema = z.object({
  workspaceId: z.enum(["executive", "delivery", "strategy"]).optional(),
  compactMode: z.boolean().optional(),
  desktopNotifications: z.boolean().optional(),
  soundEffects: z.boolean().optional(),
  emailDigest: z.boolean().optional(),
  aiResponseLocale: languageEnum.optional(),
});

type PreferenceSource = {
  workspaceId?: string | null;
  compactMode?: boolean | null;
  desktopNotifications?: boolean | null;
  soundEffects?: boolean | null;
  emailDigest?: boolean | null;
  aiResponseLocale?: string | null;
};

type UserPreferenceDelegate = {
  findUnique: (args: { where: { userId: string } }) => Promise<{
    workspaceId: string | null;
    compactMode: boolean | null;
    desktopNotifications: boolean | null;
    soundEffects: boolean | null;
    emailDigest: boolean | null;
    aiResponseLocale: string | null;
  } | null>;
  update: (args: {
    where: { userId: string };
    data: {
      workspaceId: string;
      compactMode: boolean;
      desktopNotifications: boolean;
      soundEffects: boolean;
      emailDigest: boolean;
      aiResponseLocale: string;
    };
  }) => Promise<PreferenceSource>;
  create: (args: {
    data: {
      userId: string;
      workspaceId: string;
      compactMode: boolean;
      desktopNotifications: boolean;
      soundEffects: boolean;
      emailDigest: boolean;
      aiResponseLocale: string;
    };
  }) => Promise<PreferenceSource>;
};

function getUserPreferenceDelegate() {
  return (prisma as typeof prisma & { userPreference?: UserPreferenceDelegate }).userPreference;
}

function isMissingPreferenceTableError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

async function ensurePreferenceUser(userId: string, name: string) {
  await prisma.user.upsert({
    where: { id: userId },
    update: { name },
    create: {
      id: userId,
      name,
      updatedAt: new Date(),
    },
  });
}

function buildFallbackPreferences(role: PlatformRole, workspaceId: string): AppPreferences {
  return mapPreferences({}, role, workspaceId);
}

function mapPreferences(
  source: PreferenceSource,
  role: PlatformRole,
  fallbackWorkspaceId: string
): AppPreferences {
  const resolvedWorkspace = resolveAccessibleWorkspace(role, source.workspaceId ?? fallbackWorkspaceId);
  return {
    workspaceId: resolvedWorkspace.id,
    compactMode:
      source.compactMode ?? defaultAppPreferences.compactMode,
    desktopNotifications:
      source.desktopNotifications ?? defaultAppPreferences.desktopNotifications,
    soundEffects: source.soundEffects ?? defaultAppPreferences.soundEffects,
    emailDigest: source.emailDigest ?? defaultAppPreferences.emailDigest,
    aiResponseLocale: isLocale(source.aiResponseLocale)
      ? source.aiResponseLocale
      : defaultAppPreferences.aiResponseLocale,
  };
}

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const { accessProfile } = authResult;
    const userPreference = getUserPreferenceDelegate();
    if (!userPreference) {
      const preferences = buildFallbackPreferences(
        accessProfile.role,
        accessProfile.workspaceId ?? defaultAppPreferences.workspaceId
      );

      return NextResponse.json({
        preferences,
        persisted: false,
      });
    }

    let preference: Awaited<ReturnType<UserPreferenceDelegate["findUnique"]>> | null = null;
    try {
      preference = await userPreference.findUnique({
        where: { userId: accessProfile.userId },
      });
    } catch (error) {
      if (isMissingPreferenceTableError(error)) {
        const preferences = buildFallbackPreferences(
          accessProfile.role,
          accessProfile.workspaceId ?? defaultAppPreferences.workspaceId
        );

        return NextResponse.json({
          preferences,
          persisted: false,
        });
      }

      throw error;
    }

    const workspaceId =
      preference?.workspaceId ?? accessProfile.workspaceId ?? defaultAppPreferences.workspaceId;
    const rawAiResponseLocale = preference?.aiResponseLocale;

    const preferences = mapPreferences(
      {
        workspaceId,
        compactMode: preference?.compactMode,
        desktopNotifications: preference?.desktopNotifications,
        soundEffects: preference?.soundEffects,
        emailDigest: preference?.emailDigest,
        aiResponseLocale: isLocale(rawAiResponseLocale)
          ? rawAiResponseLocale
          : undefined,
      },
      accessProfile.role,
      workspaceId
    );

    return NextResponse.json({
      preferences,
      persisted: Boolean(preference),
    });
  } catch (error) {
    return serverError(error, "Failed to load preferences.");
  }
}

export async function PUT(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = await request.json();
    const parsed = updatePreferencesSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { accessProfile } = authResult;
    const workspaceCandidate =
      parsed.data.workspaceId &&
      canAccessWorkspace(accessProfile.role, parsed.data.workspaceId)
        ? parsed.data.workspaceId
        : accessProfile.workspaceId ?? defaultAppPreferences.workspaceId;

    const userPreference = getUserPreferenceDelegate();
    if (!userPreference) {
      const preferences = mapPreferences(
        {
          workspaceId: workspaceCandidate,
          compactMode: parsed.data.compactMode ?? defaultAppPreferences.compactMode,
          desktopNotifications:
            parsed.data.desktopNotifications ?? defaultAppPreferences.desktopNotifications,
          soundEffects: parsed.data.soundEffects ?? defaultAppPreferences.soundEffects,
          emailDigest: parsed.data.emailDigest ?? defaultAppPreferences.emailDigest,
          aiResponseLocale: parsed.data.aiResponseLocale ?? defaultAppPreferences.aiResponseLocale,
        },
        accessProfile.role,
        workspaceCandidate
      );

      return NextResponse.json({
        preferences,
        persisted: false,
      });
    }

    let existing: Awaited<ReturnType<UserPreferenceDelegate["findUnique"]>> | null = null;
    try {
      existing = await userPreference.findUnique({
        where: { userId: accessProfile.userId },
      });
    } catch (error) {
      if (isMissingPreferenceTableError(error)) {
        const preferences = mapPreferences(
          {
            workspaceId: workspaceCandidate,
            compactMode: parsed.data.compactMode ?? defaultAppPreferences.compactMode,
            desktopNotifications:
              parsed.data.desktopNotifications ?? defaultAppPreferences.desktopNotifications,
            soundEffects: parsed.data.soundEffects ?? defaultAppPreferences.soundEffects,
            emailDigest: parsed.data.emailDigest ?? defaultAppPreferences.emailDigest,
            aiResponseLocale: parsed.data.aiResponseLocale ?? defaultAppPreferences.aiResponseLocale,
          },
          accessProfile.role,
          workspaceCandidate
        );

        return NextResponse.json({
          preferences,
          persisted: false,
        });
      }

      throw error;
    }

    const nextPreferences = {
      workspaceId: workspaceCandidate,
      compactMode:
        parsed.data.compactMode ?? existing?.compactMode ?? defaultAppPreferences.compactMode,
      desktopNotifications:
        parsed.data.desktopNotifications ??
        existing?.desktopNotifications ??
        defaultAppPreferences.desktopNotifications,
      soundEffects:
        parsed.data.soundEffects ?? existing?.soundEffects ?? defaultAppPreferences.soundEffects,
      emailDigest:
        parsed.data.emailDigest ?? existing?.emailDigest ?? defaultAppPreferences.emailDigest,
      aiResponseLocale:
        parsed.data.aiResponseLocale ??
        existing?.aiResponseLocale ??
        defaultAppPreferences.aiResponseLocale,
    };

    await ensurePreferenceUser(accessProfile.userId, accessProfile.name);

    const preferenceRecord = existing
      ? await userPreference.update({
          where: { userId: accessProfile.userId },
          data: nextPreferences,
        })
      : await userPreference.create({
          data: {
            userId: accessProfile.userId,
            ...nextPreferences,
          },
        });

    const preferences = mapPreferences(
      preferenceRecord,
      accessProfile.role,
      workspaceCandidate
    );

    return NextResponse.json({
      preferences,
      persisted: true,
    });
  } catch (error) {
    return serverError(error, "Failed to update preferences.");
  }
}
