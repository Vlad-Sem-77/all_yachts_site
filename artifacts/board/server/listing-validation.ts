const allowedPriceUnits = new Set(["total", "day", "week", "month", "year"]);
const allowedTransactionTypes = new Set(["sale", "rent"]);
const allowedConditions = new Set(["new", "used"]);
const allowedEngineTypes = new Set(["none", "outboard", "inboard", "other"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface BoatListingInput {
  categoryId: number;
  title: string;
  description: string;
  price: number | null;
  currency: string;
  isNegotiable: boolean;
  priceUnit: string;
  transactionType: string;
  year: number | null;
  lengthM: number | null;
  widthM: number | null;
  manufacturer: string | null;
  model: string | null;
  engineType: string | null;
  enginePowerHp: number | null;
  engineHours: number | null;
  condition: string;
  country: string;
  cityOrRegion: string;
  waterArea: string | null;
  contactName: string;
  contactPhone: string;
  telegram: string | null;
  whatsapp: string | null;
  email: string | null;
  publicEmail: string | null;
  maxContact: string | null;
  authorPassword?: string;
}

export type ValidationResult =
  | { ok: true; value: BoatListingInput }
  | { ok: false; errorKey: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown, max: number): string | null {
  const result = text(value);
  return result ? result.slice(0, max) : null;
}

function optionalNumber(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number | null | false {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    return false;
  }
  return parsed;
}

function countLinks(value: string): number {
  return value.match(/(?:https?:\/\/|www\.)[^\s]+/gi)?.length ?? 0;
}

export function validateBoatListing(
  body: Record<string, unknown>,
  categoryId: number,
  options: { requirePassword: boolean },
): ValidationResult {
  const title = text(body.title);
  if (
    !title ||
    title.length > 100 ||
    /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|ru|io|co)\b)/i.test(title)
  ) {
    return { ok: false, errorKey: "title" };
  }

  const description = text(body.description);
  if (!description || description.length > 3000) {
    return { ok: false, errorKey: "description" };
  }
  if (countLinks(description) > 3) {
    return { ok: false, errorKey: "links" };
  }

  const isNegotiable = body.isNegotiable === "on" || body.isNegotiable === "true";
  const priceValue = optionalNumber(body.price, 0, 1_000_000_000_000);
  if (priceValue === false || (!isNegotiable && priceValue === null)) {
    return { ok: false, errorKey: "price" };
  }
  const currency = text(body.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, errorKey: "price" };
  }

  const priceUnit = text(body.priceUnit) || "total";
  if (!allowedPriceUnits.has(priceUnit)) {
    return { ok: false, errorKey: "generic" };
  }
  const transactionType = text(body.transactionType);
  if (!allowedTransactionTypes.has(transactionType)) {
    return { ok: false, errorKey: "generic" };
  }

  const year = optionalNumber(body.year, 1900, new Date().getFullYear() + 1, true);
  const lengthM = optionalNumber(body.lengthM, 0.1, 1000);
  const widthM = optionalNumber(body.widthM, 0.1, 200);
  const enginePowerHp = optionalNumber(body.enginePowerHp, 1, 100_000, true);
  const engineHours = optionalNumber(body.engineHours, 0, 10_000_000);
  if (
    year === false ||
    lengthM === false ||
    widthM === false ||
    enginePowerHp === false ||
    engineHours === false
  ) {
    return { ok: false, errorKey: "generic" };
  }

  const condition = text(body.condition);
  if (!allowedConditions.has(condition)) {
    return { ok: false, errorKey: "generic" };
  }
  let engineType = text(body.engineType);
  if (!engineType) engineType = "none";
  if (!allowedEngineTypes.has(engineType)) {
    return { ok: false, errorKey: "generic" };
  }

  const country = text(body.country);
  const cityOrRegion = text(body.cityOrRegion);
  const contactName = text(body.contactName);
  if (!country || country.length > 100 || !cityOrRegion || cityOrRegion.length > 120) {
    return { ok: false, errorKey: "generic" };
  }
  if (!contactName || contactName.length > 80) {
    return { ok: false, errorKey: "generic" };
  }

  const contactPhone = text(body.contactPhone).replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(contactPhone)) {
    return { ok: false, errorKey: "phone" };
  }

  const email = optionalText(body.email, 254)?.toLowerCase() ?? null;
  if (email && !emailPattern.test(email)) {
    return { ok: false, errorKey: "email" };
  }

  const publicEmail = optionalText(body.publicEmail, 254)?.toLowerCase() ?? null;
  if (publicEmail && !emailPattern.test(publicEmail)) {
    return { ok: false, errorKey: "email" };
  }

  const telegram = optionalText(body.telegram, 80);
  const whatsapp = optionalText(body.whatsapp, 80);
  const maxContact = optionalText(body.maxContact, 120);
  if (
    [telegram, whatsapp].some(
      (contact) => contact && (contact.length > 80 || /(?:https?:\/\/|www\.)/i.test(contact)),
    )
  ) {
    return { ok: false, errorKey: "generic" };
  }

  const authorPassword = text(body.authorPassword);
  if (options.requirePassword && (authorPassword.length < 4 || Buffer.byteLength(authorPassword, "utf8") > 72)) {
    return { ok: false, errorKey: "password" };
  }

  return {
    ok: true,
    value: {
      categoryId,
      title,
      description,
      price: isNegotiable ? null : priceValue,
      currency,
      isNegotiable,
      priceUnit,
      transactionType,
      year: year === null ? null : year,
      lengthM: lengthM === null ? null : lengthM,
      widthM: widthM === null ? null : widthM,
      manufacturer: optionalText(body.manufacturer, 100),
      model: optionalText(body.model, 100),
      engineType,
      enginePowerHp: enginePowerHp === null ? null : enginePowerHp,
      engineHours: engineHours === null ? null : engineHours,
      condition,
      country,
      cityOrRegion,
      waterArea: optionalText(body.waterArea, 120),
      contactName,
      contactPhone,
      telegram,
      whatsapp,
      email,
      publicEmail,
      maxContact,
      ...(options.requirePassword ? { authorPassword } : {}),
    },
  };
}

export function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === "string");
}
