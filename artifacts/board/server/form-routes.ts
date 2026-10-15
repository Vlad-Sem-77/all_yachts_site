import bcrypt from "bcryptjs";
import { and, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import sharp from "sharp";
import {
  boatCategories,
  boatListings,
  db,
  listingCaptchaChallenges,
  listingPhotos,
  pendingListingUploads,
} from "@workspace/db";
import {
  allowRateLimitedAction,
  createCsrfToken,
  createMathChallenge,
  createOpaqueToken,
  getIpHash,
  hashSecret,
  isMathChallengeValid,
  rateLimitLockKey,
  validFormRequest,
} from "./security";
import {
  deletePrivateObject,
  getPrivateObjectFile,
  saveListingImage,
  createStagingUpload,
} from "./object-storage";
import { messages, t } from "./localization";
import { renderPage } from "./view";
import { stringList, validateBoatListing } from "./listing-validation";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const router = Router();

type CategoryOption = {
  id: number;
  slug: string;
  nameRu: string;
  pathLabel: string;
  parentSlug: string | null;
  hasVesselFields: boolean;
  hasEngineFields: boolean;
};

export async function getCategoryOptions(): Promise<CategoryOption[]> {
  const rows = await db
    .select()
    .from(boatCategories)
    .where(eq(boatCategories.isActive, true))
    .orderBy(boatCategories.sortOrder, boatCategories.id);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const vesselCategories = new Set([
    "maloletnie-suda",
    "motornye-lodki",
    "katera-kayutnye",
    "katera-otkrytye",
    "motornye-yakhty",
    "parusnye-yakhty",
  ]);
  const engineCategories = new Set([
    "maloletnie-suda",
    "motornye-lodki",
    "katera-kayutnye",
    "katera-otkrytye",
    "motornye-yakhty",
    "motory",
  ]);

  return rows.map((row) => {
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);
    const rootSlug = parent?.slug ?? row.slug;
    const isRentalVessel =
      rootSlug === "arenda" &&
      ["arenda-lodok", "arenda-katerov", "arenda-yakht"].includes(row.slug);
    return {
      id: row.id,
      slug: row.slug,
      nameRu: row.nameRu,
      pathLabel: parent ? `${parent.nameRu} — ${row.nameRu}` : row.nameRu,
      parentSlug: parent?.slug ?? null,
      hasVesselFields:
        vesselCategories.has(rootSlug) || isRentalVessel,
      hasEngineFields:
        engineCategories.has(rootSlug) ||
        (rootSlug === "arenda" &&
          ["arenda-lodok", "arenda-katerov", "arenda-yakht"].includes(row.slug)),
    };
  });
}

async function getFooterCategories() {
  return db
    .select({
      id: boatCategories.id,
      slug: boatCategories.slug,
      nameRu: boatCategories.nameRu,
    })
    .from(boatCategories)
    .where(and(eq(boatCategories.isActive, true), isNull(boatCategories.parentId)))
    .orderBy(boatCategories.sortOrder, boatCategories.id);
}

function isHoneypotFilled(body: Record<string, unknown>): boolean {
  return typeof body.website === "string" && body.website.trim().length > 0;
}

function renderSubmit(
  res: Response,
  categoryOptions: CategoryOption[],
  values: Record<string, unknown>,
  options: { status?: number; errorKey?: string; draftToken?: string; uploadPaths?: string[] } = {},
): Promise<void> {
  return (async () => {
    const captcha = await createMathChallenge(
      values._ipHash as string,
    );
    const footerCategories = await getFooterCategories();
    await renderPage(
      res,
      "submit",
      {
        categories: footerCategories,
        categoryOptions,
        countries: messages.submit.countries,
        values,
        csrf: createCsrfToken(),
        captcha,
        error: options.errorKey ? t(`formErrors.${options.errorKey}`) : null,
        draftToken: options.draftToken ?? "",
        uploadPaths: options.uploadPaths ?? [],
        title: `${t("submit.title")} | ${messages.brand.name}`,
        description: t("submit.description"),
      },
      options.status ?? 200,
    );
  })();
}

function slugPart(value: string): string {
  const replacements: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo",
    ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return value
    .toLowerCase()
    .split("")
    .map((character) => replacements[character] ?? character)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
}

async function processImage(
  objectPath: string,
  expectedSize: number,
): Promise<{ objectKey: string; thumbnailKey: string }> {
  const sourceFile = await getPrivateObjectFile(objectPath);
  const [metadata] = await sourceFile.getMetadata();
  const actualSize = Number(metadata.size);
  if (!Number.isFinite(actualSize) || actualSize < 1 || actualSize > MAX_FILE_BYTES) {
    throw new Error("Image size is outside the allowed range.");
  }
  if (expectedSize > MAX_FILE_BYTES) {
    throw new Error("Image size is outside the allowed range.");
  }

  const [source] = await sourceFile.download();
  const image = sharp(source, { failOn: "warning", limitInputPixels: 50_000_000 });
  const imageMetadata = await image.metadata();
  if (!imageMetadata.format || !["jpeg", "png", "webp"].includes(imageMetadata.format)) {
    throw new Error("Unsupported image format.");
  }

  const fullImage = await sharp(source, {
    failOn: "warning",
    limitInputPixels: 50_000_000,
  })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();
  const thumbnail = await sharp(source, {
    failOn: "warning",
    limitInputPixels: 50_000_000,
  })
    .rotate()
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 76, effort: 4 })
    .toBuffer();

  const objectKey = await saveListingImage(fullImage, "full");
  try {
    const thumbnailKey = await saveListingImage(thumbnail, "thumb");
    return { objectKey, thumbnailKey };
  } catch (error) {
    await deletePrivateObject(objectKey);
    throw error;
  }
}

async function cleanExpiredStagingObjects(): Promise<void> {
  const now = new Date();
  const expired = await db
    .select({ id: pendingListingUploads.id, objectPath: pendingListingUploads.objectPath })
    .from(pendingListingUploads)
    .where(and(lt(pendingListingUploads.expiresAt, now), isNull(pendingListingUploads.consumedAt)))
    .orderBy(desc(pendingListingUploads.expiresAt))
    .limit(25);
  for (const upload of expired) {
    await deletePrivateObject(upload.objectPath).catch(() => undefined);
  }
  if (expired.length) {
    await db.delete(pendingListingUploads).where(
      inArray(
        pendingListingUploads.id,
        expired.map((upload) => upload.id),
      ),
    );
  }
}

router.get("/submit", async (req, res) => {
  const categories = await getCategoryOptions();
  const ipHash = getIpHash(req);
  await cleanExpiredStagingObjects();
  await renderSubmit(res, categories, { _ipHash: ipHash });
});

router.get("/rules", async (_req, res) => {
  await renderPage(res, "rules", {
    title: `${t("rules.title")} | ${messages.brand.name}`,
    description: t("rules.body"),
  });
});

router.post("/media/request-urls", async (req, res) => {
  if (!validFormRequest(req) || isHoneypotFilled(req.body)) {
    res.status(403).json({ error: t("formErrors.csrf") });
    return;
  }
  const ipHash = getIpHash(req);
  if (!(await allowRateLimitedAction("upload-urls", ipHash, 10, 60 * 60 * 1000))) {
    res.status(429).json({ error: t("formErrors.rateLimit") });
    return;
  }
  if (
    !(await isMathChallengeValid(
      req.body.captchaId,
      req.body.captchaAnswer,
      ipHash,
    ))
  ) {
    res.status(400).json({ error: t("formErrors.captcha") });
    return;
  }

  const files = req.body.files;
  if (
    !Array.isArray(files) ||
    files.length < 1 ||
    files.length > 5 ||
    files.some(
      (file: unknown) =>
        !file ||
        typeof file !== "object" ||
        typeof (file as Record<string, unknown>).name !== "string" ||
        typeof (file as Record<string, unknown>).contentType !== "string" ||
        !Number.isInteger((file as Record<string, unknown>).size) ||
        Number((file as Record<string, unknown>).size) < 1 ||
        Number((file as Record<string, unknown>).size) > MAX_FILE_BYTES ||
        !allowedMimeTypes.has(String((file as Record<string, unknown>).contentType)),
    )
  ) {
    res.status(400).json({ error: t("submit.uploadInvalid") });
    return;
  }

  const draftToken = createOpaqueToken();
  const draftTokenHash = hashSecret(draftToken);
  const uploads: Array<{ uploadURL: string; objectPath: string }> = [];
  try {
    const expiry = new Date(Date.now() + 20 * 60 * 1000);
    for (const file of files as Array<{ name: string; size: number; contentType: string }>) {
      const upload = await createStagingUpload();
      await db.insert(pendingListingUploads).values({
        objectPath: upload.objectPath,
        draftTokenHash,
        ipHash,
        originalName: file.name.slice(0, 120),
        contentType: file.contentType,
        byteSize: file.size,
        expiresAt: expiry,
      });
      uploads.push(upload);
    }
  } catch (error) {
    await Promise.all(uploads.map((item) => deletePrivateObject(item.objectPath).catch(() => undefined)));
    throw error;
  }

  res.status(201).json({ draftToken, uploads });
});

router.post("/submit", async (req: Request, res: Response) => {
  const categories = await getCategoryOptions();
  const ipHash = getIpHash(req);
  const rawValues = req.body as Record<string, unknown>;
  const values = { ...rawValues, _ipHash: ipHash };
  const uploadPaths = stringList(rawValues.uploadPaths);
  const draftToken = typeof rawValues.draftToken === "string" ? rawValues.draftToken : "";
  const captchaId = typeof rawValues.captchaId === "string" ? rawValues.captchaId : "";

  const fail = (errorKey: string, status = 400) =>
    renderSubmit(res, categories, values, {
      status,
      errorKey,
      draftToken,
      uploadPaths,
    });

  if (!validFormRequest(req)) {
    await fail("csrf", 403);
    return;
  }
  if (isHoneypotFilled(rawValues)) {
    await fail("honeypot", 400);
    return;
  }
  if (rawValues.rulesAgree !== "on") {
    await fail("generic");
    return;
  }

  const categoryId = Number(rawValues.categoryId);
  const category = categories.find((item) => item.id === categoryId);
  if (!category) {
    await fail("category");
    return;
  }
  const validation = validateBoatListing(
    { ...rawValues, condition: rawValues.condition || "used" },
    categoryId,
    { requirePassword: true },
  );
  if (!validation.ok) {
    await fail(validation.errorKey);
    return;
  }
  if (
    uploadPaths.length < 1 ||
    uploadPaths.length > 5 ||
    new Set(uploadPaths).size !== uploadPaths.length ||
    !/^[a-f0-9]{64}$/.test(draftToken)
  ) {
    await fail("photos");
    return;
  }
  if (
    !(await isMathChallengeValid(
      captchaId,
      rawValues.captchaAnswer,
      ipHash,
    ))
  ) {
    await fail("captcha");
    return;
  }

  const now = new Date();
  const pending = await db
    .select()
    .from(pendingListingUploads)
    .where(
      and(
        eq(pendingListingUploads.draftTokenHash, hashSecret(draftToken)),
        eq(pendingListingUploads.ipHash, ipHash),
        inArray(pendingListingUploads.objectPath, uploadPaths),
        isNull(pendingListingUploads.consumedAt),
        gte(pendingListingUploads.expiresAt, now),
      ),
    );
  if (
    pending.length !== uploadPaths.length ||
    pending.some((item) => !uploadPaths.includes(item.objectPath))
  ) {
    await fail("photos");
    return;
  }

  const claimed = await db
    .update(pendingListingUploads)
    .set({ consumedAt: now })
    .where(
      and(
        inArray(
          pendingListingUploads.id,
          pending.map((item) => item.id),
        ),
        isNull(pendingListingUploads.consumedAt),
      ),
    )
    .returning({ id: pendingListingUploads.id });
  if (claimed.length !== pending.length) {
    await fail("photos");
    return;
  }

  const storedImages: Array<{ objectKey: string; thumbnailKey: string }> = [];
  try {
    for (const item of uploadPaths) {
      const pendingUpload = pending.find((upload) => upload.objectPath === item);
      if (!pendingUpload) throw new Error("Missing pending image upload.");
      storedImages.push(await processImage(item, pendingUpload.byteSize));
    }
  } catch {
    await Promise.all([
      ...storedImages.flatMap((image) => [
        deletePrivateObject(image.objectKey).catch(() => undefined),
        deletePrivateObject(image.thumbnailKey).catch(() => undefined),
      ]),
      db
        .update(pendingListingUploads)
        .set({ consumedAt: null })
        .where(inArray(pendingListingUploads.id, pending.map((item) => item.id))),
    ]);
    await fail("image");
    return;
  }

  const { authorPassword: authorPasswordPlaintext, ...listingValues } = validation.value;
  const authorPasswordHash = await bcrypt.hash(authorPasswordPlaintext ?? "", 12);
  let listingId: number | undefined;
  try {
    await db.transaction(async (tx) => {
      const lockId = rateLimitLockKey("listing-create", ipHash);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);
      const [daily] = await tx
        .select({ total: count() })
        .from(boatListings)
        .where(
          and(
            eq(boatListings.submissionIpHash, ipHash),
            gte(boatListings.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ),
        );
      if (daily.total >= 3) throw new Error("daily-listing-limit");

      const [captchaUsed] = await tx
        .update(listingCaptchaChallenges)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(listingCaptchaChallenges.id, captchaId),
            eq(listingCaptchaChallenges.ipHash, ipHash),
            isNull(listingCaptchaChallenges.consumedAt),
            gte(listingCaptchaChallenges.expiresAt, new Date()),
          ),
        )
        .returning({ id: listingCaptchaChallenges.id });
      if (!captchaUsed) throw new Error("captcha-expired");

      const [created] = await tx
        .insert(boatListings)
        .values({
          ...listingValues,
          authorPasswordHash,
          submissionIpHash: ipHash,
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        })
        .returning({ id: boatListings.id });
      listingId = created.id;
      const listingSlug = `${slugPart(validation.value.title) || "obyavlenie"}-${created.id}`;
      await tx
        .update(boatListings)
        .set({ slug: listingSlug })
        .where(eq(boatListings.id, created.id));
      await tx.insert(listingPhotos).values(
        storedImages.map((image, sortOrder) => ({
          listingId: created.id,
          objectKey: image.objectKey,
          thumbnailKey: image.thumbnailKey,
          sortOrder,
          isPrimary: sortOrder === 0,
        })),
      );
    });
  } catch (error) {
    await Promise.all([
      ...storedImages.flatMap((image) => [
        deletePrivateObject(image.objectKey).catch(() => undefined),
        deletePrivateObject(image.thumbnailKey).catch(() => undefined),
      ]),
      db
        .update(pendingListingUploads)
        .set({ consumedAt: null })
        .where(inArray(pendingListingUploads.id, pending.map((item) => item.id))),
    ]);
    if (error instanceof Error && error.message === "daily-listing-limit") {
      await fail("dailyLimit", 429);
      return;
    }
    if (error instanceof Error && error.message === "captcha-expired") {
      await fail("captchaExpired");
      return;
    }
    throw error;
  }

  await Promise.all([
    ...uploadPaths.map((objectPath) => deletePrivateObject(objectPath).catch(() => undefined)),
    db
      .delete(pendingListingUploads)
      .where(inArray(pendingListingUploads.id, pending.map((item) => item.id))),
  ]);
  const listingSlug = `${slugPart(validation.value.title) || "obyavlenie"}-${listingId}`;
  const categoryPath = category.parentSlug ?? category.slug;
  res.redirect(303, `/category/${categoryPath}/${listingSlug}?published=1`);
});

export default router;
