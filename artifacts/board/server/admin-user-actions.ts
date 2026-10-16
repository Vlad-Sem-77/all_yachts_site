import { db, adminAuditLogs, forumUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { ForumUserRole } from "./user-access";

export type UserAdminActionResult = "updated" | "unchanged" | "not-found";

export async function setForumUserRole(
  userId: number,
  role: ForumUserRole,
  ipHash: string,
): Promise<UserAdminActionResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ role: forumUsers.role })
      .from(forumUsers)
      .where(eq(forumUsers.id, userId))
      .for("update");
    if (!user) return "not-found";
    if (user.role === role) return "unchanged";

    await tx
      .update(forumUsers)
      .set({ role, updatedAt: new Date() })
      .where(eq(forumUsers.id, userId));
    await tx.insert(adminAuditLogs).values({
      action: "forum_role_changed",
      targetUserId: userId,
      previousValue: user.role,
      nextValue: role,
      ipHash,
    });
    return "updated";
  });
}

export async function setForumUserActive(
  userId: number,
  isActive: boolean,
  ipHash: string,
): Promise<UserAdminActionResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ isActive: forumUsers.isActive })
      .from(forumUsers)
      .where(eq(forumUsers.id, userId))
      .for("update");
    if (!user) return "not-found";
    if (user.isActive === isActive) return "unchanged";

    await tx
      .update(forumUsers)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(forumUsers.id, userId));
    await tx.insert(adminAuditLogs).values({
      action: "account_access_changed",
      targetUserId: userId,
      previousValue: user.isActive ? "active" : "restricted",
      nextValue: isActive ? "active" : "restricted",
      ipHash,
    });
    return "updated";
  });
}
