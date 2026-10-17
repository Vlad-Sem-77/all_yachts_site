import assert from "node:assert/strict";
import test from "node:test";
import {
  canModerateByForumRole,
  parseForumUserRole,
} from "./user-access";

test("only known forum roles are accepted", () => {
  assert.equal(parseForumUserRole("user"), "user");
  assert.equal(parseForumUserRole("moderator"), "moderator");
  assert.equal(parseForumUserRole("admin"), "admin");
  assert.equal(parseForumUserRole("site-admin"), null);
  assert.equal(parseForumUserRole(undefined), null);
});

test("inactive accounts cannot moderate, even with a moderator role", () => {
  assert.equal(canModerateByForumRole("moderator", true), true);
  assert.equal(canModerateByForumRole("admin", true), true);
  assert.equal(canModerateByForumRole("user", true), false);
  assert.equal(canModerateByForumRole("moderator", false), false);
  assert.equal(canModerateByForumRole("admin", false), false);
});

