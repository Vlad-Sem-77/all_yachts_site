import assert from "node:assert/strict";
import { test } from "node:test";
import { safeLocalReturnPath } from "./safe-return-path";

const siteOrigin = "https://all-yachts.ru";

test("keeps safe same-site return paths and their query/hash", () => {
  assert.equal(
    safeLocalReturnPath("/forum/topic/12?from=signin#post-4", siteOrigin),
    "/forum/topic/12?from=signin#post-4",
  );
});

test("falls back for external, malformed, or oversized return values", () => {
  const unsafeValues = [
    "//outside.example/path",
    "/\\outside.example/path",
    "https://outside.example/path",
    "/forum\nLocation: https://outside.example",
    `/${"a".repeat(2048)}`,
    null,
  ];

  for (const value of unsafeValues) {
    assert.equal(safeLocalReturnPath(value, siteOrigin), "/forum");
  }
});
