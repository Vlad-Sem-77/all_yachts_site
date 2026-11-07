import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

let replitObjectStorageClient: Storage | undefined;

function replitStorage(): Storage {
  if (!replitObjectStorageClient) {
    replitObjectStorageClient = new Storage({
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
  }
  return replitObjectStorageClient;
}

type S3Settings = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

let s3Client: S3Client | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when OBJECT_STORAGE_DRIVER=s3.`);
  return value;
}

function s3Settings(): S3Settings {
  const endpoint = requiredEnv("S3_ENDPOINT_URL");
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("S3_ENDPOINT_URL must be a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(parsedEndpoint.protocol)) {
    throw new Error("S3_ENDPOINT_URL must use HTTP or HTTPS.");
  }

  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase();
  const forcePathStyleValues = new Set(["true", "1", "yes", "false", "0", "no"]);
  if (forcePathStyle && !forcePathStyleValues.has(forcePathStyle)) {
    throw new Error("S3_FORCE_PATH_STYLE must be a boolean value.");
  }
  return {
    endpoint: parsedEndpoint.toString().replace(/\/$/, ""),
    region: requiredEnv("S3_REGION"),
    bucket: requiredEnv("S3_BUCKET"),
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: forcePathStyle ? ["true", "1", "yes"].includes(forcePathStyle) : true,
  };
}

function s3(): S3Client {
  if (s3Client) return s3Client;
  const settings = s3Settings();
  s3Client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  return s3Client;
}

function storageDriver(): "replit" | "s3" {
  const requested = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase();
  if (!requested) return "replit";
  if (requested === "replit" || requested === "s3") return requested;
  throw new Error("OBJECT_STORAGE_DRIVER must be either replit or s3.");
}

function relativeObjectPath(objectPath: string): string {
  if (
    !objectPath.startsWith("/objects/") ||
    objectPath.includes("..") ||
    objectPath.includes("\\")
  ) {
    throw new Error("Invalid private object path.");
  }
  const relative = objectPath.slice("/objects/".length);
  if (!relative || relative.startsWith("/") || relative.split("/").some((part) => !part)) {
    throw new Error("Invalid private object path.");
  }
  return relative;
}

export function mapObjectPathToS3Key(
  objectPath: string,
  prefix = process.env.S3_PREFIX ?? "",
): string {
  const relative = relativeObjectPath(objectPath);
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  if (
    normalizedPrefix &&
    (normalizedPrefix.includes("\\") ||
      normalizedPrefix.split("/").some((part) => part === "." || part === ".." || !part))
  ) {
    throw new Error("S3_PREFIX contains an invalid path segment.");
  }
  return normalizedPrefix ? `${normalizedPrefix}/${relative}` : relative;
}

function privateDirectory(): string {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  return directory.replace(/^\/+|\/+$/g, "");
}

function objectPathParts(objectPath: string): {
  bucket: string;
  name: string;
} {
  const relative = relativeObjectPath(objectPath);
  const [bucket, ...privateParts] = privateDirectory().split("/");
  const objectName = [...privateParts, ...relative.split("/")].join("/");
  if (!bucket || !objectName) throw new Error("Invalid private object path.");
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
  const objectPath = `/objects/${relative}`;
  if (storageDriver() === "s3") {
    const settings = s3Settings();
    const uploadURL = await getSignedUrl(
      s3(),
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: mapObjectPathToS3Key(objectPath),
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return { uploadURL, objectPath };
  }
  const { bucket, name } = objectPathParts(objectPath);
  return {
    uploadURL: await signPutUrl(bucket, name),
    objectPath,
  };
}

export async function getPrivateObjectSize(objectPath: string): Promise<number> {
  if (storageDriver() === "s3") {
    const settings = s3Settings();
    const result = await s3().send(new HeadObjectCommand({
      Bucket: settings.bucket,
      Key: mapObjectPathToS3Key(objectPath),
    }));
    if (typeof result.ContentLength !== "number") {
      throw new Error("Object storage returned no object size.");
    }
    return result.ContentLength;
  }
  const { bucket, name } = objectPathParts(objectPath);
  const [metadata] = await replitStorage().bucket(bucket).file(name).getMetadata();
  const size = Number(metadata.size);
  if (!Number.isFinite(size)) throw new Error("Object storage returned an invalid object size.");
  return size;
}

export async function downloadPrivateObject(objectPath: string): Promise<Buffer> {
  if (storageDriver() === "s3") {
    const settings = s3Settings();
    const result = await s3().send(new GetObjectCommand({
      Bucket: settings.bucket,
      Key: mapObjectPathToS3Key(objectPath),
    }));
    if (!result.Body) throw new Error("Object storage returned an empty object.");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  const { bucket, name } = objectPathParts(objectPath);
  const [buffer] = await replitStorage().bucket(bucket).file(name).download();
  return buffer;
}

export async function streamPrivateObject(objectPath: string): Promise<Readable> {
  if (storageDriver() === "s3") {
    const settings = s3Settings();
    const result = await s3().send(new GetObjectCommand({
      Bucket: settings.bucket,
      Key: mapObjectPathToS3Key(objectPath),
    }));
    if (!result.Body) throw new Error("Object storage returned an empty object.");
    const body = result.Body as unknown as {
      pipe?: unknown;
      [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
    };
    if (typeof body.pipe === "function") return body as unknown as Readable;
    if (typeof body[Symbol.asyncIterator] === "function") {
      return Readable.from(body as AsyncIterable<Uint8Array>);
    }
    throw new Error("Object storage returned an unsupported stream.");
  }
  const { bucket, name } = objectPathParts(objectPath);
  const file = replitStorage().bucket(bucket).file(name);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Object does not exist.");
  return file.createReadStream();
}

export async function saveListingImage(
  buffer: Buffer,
  variant: "full" | "thumb",
): Promise<string> {
  const relative = `listings/${randomUUID()}-${variant}.webp`;
  const objectPath = `/objects/${relative}`;
  if (storageDriver() === "s3") {
    const settings = s3Settings();
    await s3().send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: mapObjectPathToS3Key(objectPath),
      Body: buffer,
      ContentType: "image/webp",
      CacheControl: "public, max-age=86400",
    }));
    return objectPath;
  }
  const { bucket, name } = objectPathParts(objectPath);
  const file = replitStorage().bucket(bucket).file(name);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: "image/webp",
      cacheControl: "public, max-age=86400",
    },
  });
  return objectPath;
}

export async function deletePrivateObject(objectPath: string): Promise<void> {
  if (storageDriver() === "s3") {
    const settings = s3Settings();
    await s3().send(new DeleteObjectCommand({
      Bucket: settings.bucket,
      Key: mapObjectPathToS3Key(objectPath),
    }));
    return;
  }
  const { bucket, name } = objectPathParts(objectPath);
  await replitStorage()
    .bucket(bucket)
    .file(name)
    .delete({ ignoreNotFound: true });
}
