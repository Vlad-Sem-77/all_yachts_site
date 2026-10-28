import assert from "node:assert/strict";
import test from "node:test";

import { validateBoatListing } from "./listing-validation.js";

function validListing(overrides: Record<string, unknown> = {}) {
  return {
    title: "Лодка для проверки",
    description: "Тестовое описание объявления.",
    price: "100",
    currency: "RUB",
    priceUnit: "total",
    transactionType: "sale",
    condition: "used",
    engineType: "none",
    country: "Россия",
    cityOrRegion: "Москва",
    contactName: "Проверка",
    contactPhone: "+79991234567",
    email: "private@example.com",
    publicEmail: "public@example.com",
    telegram: "@valid_username",
    maxContact: "MAX username",
    ...overrides,
  };
}

test("keeps public contacts separate from the private account email", () => {
  const result = validateBoatListing(validListing(), 1, { requirePassword: false });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.email, "private@example.com");
  assert.equal(result.value.publicEmail, "public@example.com");
  assert.equal(result.value.telegram, "@valid_username");
  assert.equal(result.value.maxContact, "MAX username");
});

test("allows all optional seller contact methods to be omitted", () => {
  const result = validateBoatListing(
    validListing({ email: "", publicEmail: "", telegram: "", maxContact: "" }),
    1,
    { requirePassword: false },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.email, null);
  assert.equal(result.value.publicEmail, null);
  assert.equal(result.value.telegram, null);
  assert.equal(result.value.maxContact, null);
});

test("rejects an invalid public contact email", () => {
  const result = validateBoatListing(
    validListing({ publicEmail: "not-an-email" }),
    1,
    { requirePassword: false },
  );

  assert.deepEqual(result, { ok: false, errorKey: "email" });
});
