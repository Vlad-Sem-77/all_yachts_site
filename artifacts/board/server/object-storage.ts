import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateDirectory(): string {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  return directory.replace(/^\/+|\/+$/g, "");
}

function objectPathParts(objectPath: string): {
  bucket: string;
  name: string;
} {
  if (
    !objectPath.startsWith("/objects/") ||
    objectPath.includes("..") ||
    objectPath.includes("\\")
  ) {
    throw new Error("Invalid private object path.");
  }
  const relative = objectPath.slice("/objects/".length);
  if (!relative || relative.startsWith("/")) {
    throw new Error("Invalid private object path.");
  }
  const [bucket, ...privateParts] = privateDirectory().split("/");
  const objectName = [...privateParts, ...relative.split("/")].join("/");
  if (!bucket || !objectName || relative.split("/").some((part) => !part)) {
    throw new Error("Invalid private object path.");
  }
  return { bucket, name: objectName };
}

async function signPutUrl(bucketName: string, objectName: string): Promise<string> {
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Object storage signer returned ${response.status}.`);
  const payload = (await response.json()) as { signed_url?: string };
  if (!payload.signed_url) throw new Error("Object storage signer returned no URL.");
  return payload.signed_url;
}

export async function createStagingUpload(): Promise<{
  uploadURL: string;
  objectPath: string;
}> {
  const relative = `staging/${randomUUID()}`;
  const { bucket, name } = objectPathParts(`/objects/${relative}`);
  return {
    uploadURL: await signPutUrl(bucket, name),
    objectPath: `/objects/${relative}`,
  };
}

export async function getPrivateObjectFile(objectPath: string): Promise<File> {
  const { bucket, name } = objectPathParts(objectPath);
  const file = objectStorageClient.bucket(bucket).file(name);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Object does not exist.");
  return file;
}

export async function saveListingImage(
  buffer: Buffer,
  variant: "full" | "thumb",
): Promise<string> {
  const relative = `listings/${randomUUID()}-${variant}.webp`;
  const { bucket, name } = objectPathParts(`/objects/${relative}`);
  const file = objectStorageClient.bucket(bucket).file(name);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: "image/webp",
      cacheControl: "public, max-age=86400",
    },
  });
  return `/objects/${relative}`;
}

export async function deletePrivateObject(objectPath: string): Promise<void> {
  const { bucket, name } = objectPathParts(objectPath);
  await objectStorageClient
    .bucket(bucket)
    .file(name)
    .delete({ ignoreNotFound: true });
}
