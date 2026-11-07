import bcrypt from "bcryptjs";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
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
  consumeMathChallenge,
  getIpHash,
  hashSecret,
  isMathChallengeValid,
  rateLimitLockKey,
  validFormRequest,
} from "./security";
import {
  deletePrivateObject,
  downloadPrivateObject,
  getPrivateObjectSize,
  saveListingImage,
  createStagingUpload,
} from "./object-storage";
import { messages, t } from "./localization";
import { renderPage } from "./view";
import { stringList, validateBoatListing } from "./listing-validation";
import { getSiteConfig } from "./site-config";
import { sendSiteEmail, smtpConfigured } from "./email";

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
    "sudno-na-vozdushnoy-podushke",
  ]);
  const engineCategories = new Set([
    "maloletnie-suda",
    "motornye-lodki",
    "katera-kayutnye",
    "katera-otkrytye",
    "motornye-yakhty",
    "sudno-na-vozdushnoy-podushke",
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
    const siteConfig = await getSiteConfig();
    await renderPage(
      res,
      "submit",
      {
        categories: footerCategories,
        categoryOptions,
        countries: siteConfig.countries,
        currencies: siteConfig.currencies,
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
  const actualSize = await getPrivateObjectSize(objectPath);
  if (!Number.isFinite(actualSize) || actualSize < 1 || actualSize > MAX_FILE_BYTES) {
    throw new Error("Image size is outside the allowed range.");
  }
  if (expectedSize > MAX_FILE_BYTES) {
    throw new Error("Image size is outside the allowed range.");
  }

  const source = await downloadPrivateObject(objectPath);
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
  const consumedCutoff = new Date(now.getTime() - 30 * 60 * 1000);
  const expired = await db
    .select({ id: pendingListingUploads.id, objectPath: pendingListingUploads.objectPath })
    .from(pendingListingUploads)
    .where(
      or(
        and(lt(pendingListingUploads.expiresAt, now), isNull(pendingListingUploads.consumedAt)),
        lt(pendingListingUploads.consumedAt, consumedCutoff),
      ),
    )
    .orderBy(asc(pendingListingUploads.expiresAt))
    .limit(25);
  const deletedUploadIds: number[] = [];
  for (const upload of expired) {
    try {
      await deletePrivateObject(upload.objectPath);
      deletedUploadIds.push(upload.id);
    } catch {
      // Keep the row so a later cleanup pass can retry the object deletion.
    }
  }
  if (deletedUploadIds.length) {
    await db.delete(pendingListingUploads).where(
      inArray(pendingListingUploads.id, deletedUploadIds),
    );
  }

  const expiredChallenges = await db
    .select({ id: listingCaptchaChallenges.id })
    .from(listingCaptchaChallenges)
    .where(lt(listingCaptchaChallenges.expiresAt, now))
    .limit(100);
  if (expiredChallenges.length) {
    await db.delete(listingCaptchaChallenges).where(
      inArray(
        listingCaptchaChallenges.id,
        expiredChallenges.map((challenge) => challenge.id),
      ),
    );
  }
}

router.get("/submit", async (req, res) => {
  const ipHash = getIpHash(req);
  if (!(await allowRateLimitedAction("submit-page", ipHash, 12, 15 * 60 * 1000))) {
    res.status(429).send(t("formErrors.rateLimit"));
    return;
  }
  const categories = await getCategoryOptions();
  await cleanExpiredStagingObjects();
  await renderSubmit(res, categories, { _ipHash: ipHash });
});

router.get("/listing-submitted", async (_req, res) => {
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  await renderPage(
    res,
    "listing-pending",
    {
      categories: await getCategoryOptions(),
      title: `${t("submit.pendingTitle")} | ${messages.brand.name}`,
      description: t("submit.pendingMessage"),
      robots: "noindex, nofollow, noarchive",
    },
  );
});

router.get("/rules", async (_req, res) => {
  const siteConfig = await getSiteConfig();
  await renderPage(res, "rules", {
    title: `${t("rules.title")} | ${messages.brand.name}`,
    description: siteConfig.rulesBody,
    rulesBody: siteConfig.rulesBody,
  });
});

router.post("/media/request-urls", async (req, res) => {
  if (!validFormRequest(req) || isHoneypotFilled(req.body)) {
    res.status(403).json({ error: t("formErrors.csrf") });
    return;
  }
  const ipHash = getIpHash(req);
  if (!(await allowRateLimitedAction("upload-urls", ipHash, 5, 60 * 60 * 1000))) {
    res.status(429).json({ error: t("formErrors.rateLimit") });
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

  const captchaId = typeof req.body.captchaId === "string" ? req.body.captchaId : "";
  if (!(await isMathChallengeValid(captchaId, req.body.captchaAnswer, ipHash))) {
    res.status(400).json({ error: t("formErrors.captcha") });
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

  if (!(await consumeMathChallenge(captchaId, ipHash))) {
    await Promise.all(uploads.map((item) => deletePrivateObject(item.objectPath).catch(() => undefined)));
    res.status(400).json({ error: t("formErrors.captcha") });
    return;
  }
  const captcha = await createMathChallenge(ipHash);
  res.status(201).json({ draftToken, uploads, captcha });
});

router.post("/submit", async (req: Request, res: Response) => {
  const ipHash = getIpHash(req);
  if (!validFormRequest(req)) {
    res.status(403).send(t("formErrors.csrf"));
    return;
  }
  if (!(await allowRateLimitedAction("listing-submit-attempt", ipHash, 6, 60 * 60 * 1000))) {
    res.status(429).send(t("formErrors.rateLimit"));
    return;
  }
  const categories = await getCategoryOptions();
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
  const siteConfig = await getSiteConfig();
  if (!siteConfig.currencies.some((currency) => currency.code === validation.value.currency)) {
    await fail("generic");
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

  const [dailyCount] = await db
    .select({ total: count() })
    .from(boatListings)
    .where(
      and(
        eq(boatListings.submissionIpHash, ipHash),
        gte(boatListings.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  if (dailyCount.total >= 3) {
    await fail("dailyLimit", 429);
    return;
  }
  if (!(await consumeMathChallenge(captchaId, ipHash))) {
    await fail("captchaExpired");
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
  const sessionForumUser = res.locals.forumUser as
    | { clerkUserId?: unknown; isActive?: unknown }
    | null
    | undefined;
  const authorClerkUserId =
    sessionForumUser?.isActive === true &&
    typeof sessionForumUser.clerkUserId === "string"
      ? sessionForumUser.clerkUserId
      : null;
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

      const [created] = await tx
        .insert(boatListings)
        .values({
          ...listingValues,
          authorClerkUserId,
          authorPasswordHash,
          submissionIpHash: ipHash,
          status: "pending",
          expiresAt: null,
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
    throw error;
  }

  const cleanedUploadIds: number[] = [];
  for (const upload of pending) {
    try {
      await deletePrivateObject(upload.objectPath);
      cleanedUploadIds.push(upload.id);
    } catch {
      // Leave the consumed row for the later staging-object cleanup pass.
    }
  }
  if (cleanedUploadIds.length) {
    await db.delete(pendingListingUploads).where(
      inArray(pendingListingUploads.id, cleanedUploadIds),
    );
  }
  if (
    smtpConfigured() &&
    siteConfig.newListingNotificationEmail &&
    siteConfig.siteUrl
  ) {
    const reviewUrl = new URL(
      "/admin/listings?status=pending",
      siteConfig.siteUrl,
    ).toString();
    try {
      await sendSiteEmail(
        siteConfig.newListingNotificationEmail,
        "Новое объявление ожидает проверки",
        `Добавлено объявление «${validation.value.title}». Оно ожидает проверки.\n${reviewUrl}`,
        `<p>Добавлено объявление «${validation.value.title.replace(/[&<>"']/g, "")}». Оно ожидает проверки.</p><p><a href="${reviewUrl}">Открыть очередь модерации</a></p>`,
      );
    } catch {
      req.log?.error("New-listing notification email could not be sent");
    }
  }
  res.redirect(303, "/listing-submitted");
});

export default router;
