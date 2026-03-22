-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "initials" TEXT,
    "role" TEXT NOT NULL,
    "email" TEXT,
    "avatar" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 100,
    "allocated" INTEGER NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TeamMember" ("avatar", "capacity", "createdAt", "email", "id", "initials", "name", "role", "updatedAt") SELECT "avatar", "capacity", "createdAt", "email", "id", "initials", "name", "role", "updatedAt" FROM "TeamMember";
DROP TABLE "TeamMember";
ALTER TABLE "new_TeamMember" RENAME TO "TeamMember";
CREATE INDEX "TeamMember_name_idx" ON "TeamMember"("name");
CREATE INDEX "TeamMember_name_role_idx" ON "TeamMember"("name", "role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
