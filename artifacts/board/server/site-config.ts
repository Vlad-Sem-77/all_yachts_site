import { db, siteSettings } from "@workspace/db";

export type CurrencyOption = { code: string; symbol: string };

export type SiteConfig = {
  currencies: CurrencyOption[];
  countries: string[];
  siteUrl: string;
  yandexMetrikaId: string;
  googleAnalyticsId: string;
  reportNotificationEmail: string;
  newListingNotificationEmail: string;
  rulesBody: string;
};

const DEFAULT_CURRENCIES: CurrencyOption[] = [
  { code: "RUB", symbol: "₽" },
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "€" },
  { code: "GBP", symbol: "£" },
];

const DEFAULT_COUNTRIES = [
  "Австралия", "Австрия", "Азербайджан", "Албания", "Армения", "Болгария",
  "Великобритания", "Венгрия", "Германия", "Греция", "Грузия", "Египет",
  "Израиль", "Индонезия", "Испания", "Италия", "Казахстан", "Канада",
  "Кипр", "Китай", "Коста-Рика", "Латвия", "Литва", "Мальта", "Мексика",
  "Нидерланды", "Норвегия", "ОАЭ", "Польша", "Португалия", "Россия",
  "Румыния", "США", "Таиланд", "Турция", "Украина", "Финляндия",
  "Франция", "Хорватия", "Черногория", "Швеция", "Эстония", "Япония",
];

const DEFAULT_RULES =
  "Размещайте объявления о водном транспорте, оборудовании, аренде и стоянках. Указывайте достоверные характеристики и контактные данные. Не публикуйте запрещённые товары, вводящие в заблуждение сведения и ссылки в заголовке.";

let cached: { config: SiteConfig; expiresAt: number } | null = null;

function parseCurrencies(value: string | undefined): CurrencyOption[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const currencies = parsed
      .filter(
        (item): item is CurrencyOption =>
          item !== null &&
          typeof item === "object" &&
          "code" in item &&
          typeof item.code === "string" &&
          /^[A-Z]{3}$/.test(item.code) &&
          "symbol" in item &&
          typeof item.symbol === "string" &&
          item.symbol.length > 0 &&
          item.symbol.length <= 8,
      )
      .map((item) => ({ code: item.code, symbol: item.symbol }));
    return currencies.length ? currencies : null;
  } catch {
    return null;
  }
}

function parseCountries(value: string | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const countries = [...new Set(
      parsed
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0 && item.length <= 100,
        )
        .map((item) => item.trim()),
    )].slice(0, 300);
    return countries.length ? countries : null;
  } catch {
    return null;
  }
}

function validSiteUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

export async function getSiteConfig(forceRefresh = false): Promise<SiteConfig> {
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.config;
  const rows = await db.select().from(siteSettings);
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const config: SiteConfig = {
    currencies:
      parseCurrencies(values.get("currencies")) ?? DEFAULT_CURRENCIES,
    countries:
      parseCountries(values.get("countries")) ?? DEFAULT_COUNTRIES,
    siteUrl: validSiteUrl(process.env.SITE_URL) || validSiteUrl(values.get("site_url")),
    yandexMetrikaId: /^\d{1,15}$/.test(values.get("yandex_metrika_id") ?? "")
      ? values.get("yandex_metrika_id")!
      : "",
    googleAnalyticsId: /^G-[A-Z0-9]{4,20}$/.test(values.get("google_analytics_id") ?? "")
      ? values.get("google_analytics_id")!
      : "",
    reportNotificationEmail: values.get("report_notification_email") ?? "",
    newListingNotificationEmail: values.get("new_listing_notification_email") ?? "",
    rulesBody: values.get("rules_body")?.slice(0, 5000) || DEFAULT_RULES,
  };
  cached = { config, expiresAt: Date.now() + 30_000 };
  return config;
}

export async function saveSiteSettings(values: Record<string, string>): Promise<void> {
  const allowedKeys = new Set([
    "currencies",
    "countries",
    "site_url",
    "yandex_metrika_id",
    "google_analytics_id",
    "report_notification_email",
    "new_listing_notification_email",
    "rules_body",
  ]);
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      if (!allowedKeys.has(key)) throw new Error("Unknown site setting.");
      await tx
        .insert(siteSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value, updatedAt: new Date() },
        });
    }
  });
  cached = null;
  await getSiteConfig(true);
}

export function clearSiteConfigCache(): void {
  cached = null;
}

export function getDefaultCurrencies(): CurrencyOption[] {
  return DEFAULT_CURRENCIES.map((currency) => ({ ...currency }));
}

export function getDefaultCountries(): string[] {
  return [...DEFAULT_COUNTRIES];
}

export function cleanSiteUrl(value: string): string | null {
  const clean = validSiteUrl(value.trim());
  return clean || (value.trim() === "" ? "" : null);
}

export function isYandexMetrikaId(value: string): boolean {
  return /^\d{1,15}$/.test(value);
}

export function isGoogleAnalyticsId(value: string): boolean {
  return /^G-[A-Z0-9]{4,20}$/.test(value);
}

export function isEmail(value: string): boolean {
  return value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

