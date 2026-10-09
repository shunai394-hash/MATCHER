import type { SourceProduct } from "./types";

const IDENTIFIER_TYPES = new Set(["JAN", "EAN", "UPC", "MPN", "SKU"]);

export function normalizeIdentifier(value: string) {
  return value.normalize("NFKC").trim().toUpperCase().replace(/[\s-]/g, "");
}

export function normalizeSourceProduct(input: SourceProduct): SourceProduct {
  const identifiers = (input.identifiers ?? [])
    .filter((x) => IDENTIFIER_TYPES.has(x.type) && x.value.trim())
    .map((x) => ({ type: x.type, value: normalizeIdentifier(x.value) }))
    .filter((x, i, all) => all.findIndex((y) => y.type === x.type && y.value === x.value) === i);

  return {
    ...input,
    externalId: input.externalId.normalize("NFKC").trim(),
    productName: input.productName.normalize("NFKC").trim(),
    brand: input.brand?.normalize("NFKC").trim() || null,
    manufacturer: input.manufacturer?.normalize("NFKC").trim() || null,
    modelNumber: input.modelNumber?.normalize("NFKC").trim() || null,
    identifiers,
    sourceUrl: input.sourceUrl?.trim() || null,
    currency: (input.currency ?? "JPY").toUpperCase(),
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
}