export const forumUserRoles = ["user", "moderator", "admin"] as const;

export type ForumUserRole = (typeof forumUserRoles)[number];

export function parseForumUserRole(value: unknown): ForumUserRole | null {
  return typeof value === "string" &&
    forumUserRoles.includes(value as ForumUserRole)
    ? (value as ForumUserRole)
    : null;
}

export function canModerateByForumRole(
  role: unknown,
  isActive: unknown,
): boolean {
  return isActive === true && (role === "moderator" || role === "admin");
}

export function canManageForumRoles(isSiteAdmin: boolean): boolean {
  return isSiteAdmin;
}
