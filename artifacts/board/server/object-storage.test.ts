import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createStagingUpload,
  mapObjectPathToS3Key,
} from "./object-storage";

test("maps stored object paths to S3 keys without changing the database path", () => {
  assert.equal(
    mapObjectPathToS3Key("/objects/listings/boat-full.webp", "marketplace"),
    "marketplace/listings/boat-full.webp",
  );
});

test("supports a bucket with no optional S3 prefix", () => {
  assert.equal(
    mapObjectPathToS3Key("/objects/listings/boat-full.webp", ""),
    "listings/boat-full.webp",
  );
});

test("rejects unsafe object paths and prefixes", () => {
  assert.throws(() => mapObjectPathToS3Key("/objects/../secret"));
  assert.throws(() => mapObjectPathToS3Key("/objects/listings\\secret"));
  assert.throws(() => mapObjectPathToS3Key("/objects/listings/image.webp", "safe/../unsafe"));
});

test("creates a short-lived S3-compatible staging PUT URL without uploading bytes", async () => {
  const keys = [
    "OBJECT_STORAGE_DRIVER",
    "S3_ENDPOINT_URL",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_PREFIX",
    "S3_FORCE_PATH_STYLE",
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  process.env.OBJECT_STORAGE_DRIVER = "s3";
  process.env.S3_ENDPOINT_URL = "https://objects.example.test";
  process.env.S3_REGION = "test-region-1";
  process.env.S3_BUCKET = "site-images";
  process.env.S3_ACCESS_KEY_ID = "test-access-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.S3_PREFIX = "marketplace";
  process.env.S3_FORCE_PATH_STYLE = "true";

  try {
    const result = await createStagingUpload();
    const uploadUrl = new URL(result.uploadURL);

    assert.match(result.objectPath, /^\/objects\/staging\/[0-9a-f-]+$/);
    assert.equal(uploadUrl.hostname, "objects.example.test");
    assert.match(uploadUrl.pathname, /^\/site-images\/marketplace\/staging\//);
    assert.ok(uploadUrl.searchParams.has("X-Amz-Signature"));
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
