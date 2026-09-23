// CMS bootstrap, review -> CMS publishing, and CMS -> local cache reconciliation.

import { db } from "../db";
import { webflowClient, NewField, WebflowField } from "./webflow-client";
import { FieldKey, FieldMap, InstallationRow, ReviewRow } from "../../shared/types";

interface FieldDef {
  key: FieldKey;
  slug: string;
  displayName: string;
  type: string;
}

export const FIELD_DEFS: FieldDef[] = [
  { key: "authorName", slug: "author-name", displayName: "Author Name", type: "PlainText" },
  { key: "rating", slug: "rating", displayName: "Rating", type: "Number" },
  { key: "title", slug: "title", displayName: "Title", type: "PlainText" },
  { key: "body", slug: "body", displayName: "Body", type: "RichText" },
  { key: "status", slug: "status", displayName: "Status", type: "PlainText" },
  { key: "helpfulCount", slug: "helpful-vote-count", displayName: "Helpful Vote Count", type: "Number" },
  { key: "verifiedPurchase", slug: "verified-purchase-flag", displayName: "Verified Purchase Flag", type: "Switch" },
  { key: "ownerReply", slug: "owner-reply", displayName: "Owner Reply", type: "RichText" },
];
const PRODUCT_DEF: FieldDef = { key: "product", slug: "product-reference", displayName: "Product Reference", type: "Reference" };

export function readFieldMap(inst: InstallationRow): FieldMap {
  try {
    return JSON.parse(inst.field_map || "{}") as FieldMap;
  } catch {
    return {};
  }
}

function findExisting(fields: WebflowField[], def: FieldDef): WebflowField | undefined {
  return fields.find((f) => f.slug === def.slug || f.displayName.toLowerCase() === def.displayName.toLowerCase());
}

async function ensureField(siteId: string, collectionId: string, existing: WebflowField[], def: FieldDef, extra?: Partial<NewField>): Promise<string> {
  const found = findExisting(existing, def);
  if (found) return found.slug;
  const created = await webflowClient.createField(siteId, collectionId, {
    displayName: def.displayName,
    type: def.type,
    slug: def.slug,
    ...extra,
  });
  return created.slug || def.slug;
}

/** Creates the Reviews collection (or attaches to an existing one) and ensures all fields exist. */
export async function bootstrapReviewsCollection(siteId: string): Promise<void> {
  const inst = db.prepare(`SELECT * FROM installations WHERE site_id = ?`).get(siteId) as InstallationRow;
  let collectionId = inst.reviews_collection_id;

  if (!collectionId) {
    const { collections } = await webflowClient.listCollections(siteId);
    const existing = collections.find((c) => c.slug === "reviews" || c.displayName.toLowerCase() === "reviews");
    if (existing) collectionId = existing.id;
    else collectionId = (await webflowClient.createCollection(siteId, "Reviews", "Review", "reviews")).id;
    db.prepare(`UPDATE installations SET reviews_collection_id = ? WHERE site_id = ?`).run(collectionId, siteId);
  }

  const collection = await webflowClient.getCollection(siteId, collectionId);
  const fields = [...collection.fields];
  const map: FieldMap = readFieldMap(inst);
  for (const def of FIELD_DEFS) {
    map[def.key] = await ensureField(siteId, collectionId, fields, def);
  }
  db.prepare(`UPDATE installations SET field_map = ? WHERE site_id = ?`).run(JSON.stringify(map), siteId);

  if (inst.products_collection_id) await ensureProductReference(siteId, inst.products_collection_id);
}

/** Creates (or reuses) the Reference field pointing at the chosen products collection. */
export async function ensureProductReference(siteId: string, productsCollectionId: string): Promise<void> {
  const inst = db.prepare(`SELECT * FROM installations WHERE site_id = ?`).get(siteId) as InstallationRow;
  if (!inst.reviews_collection_id) throw new Error("Reviews collection has not been created yet");
  const map = readFieldMap(inst);
  const collection = await webflowClient.getCollection(siteId, inst.reviews_collection_id);
  const existing = findExisting(collection.fields, PRODUCT_DEF);
  if (existing) {
    if (inst.products_collection_id && inst.products_collection_id !== productsCollectionId) {
      throw new Error("The Reviews collection already has a product reference pointing at another collection. Delete that field in the CMS first.");
    }
    map.product = existing.slug;
  } else {
    const created = await webflowClient.createField(siteId, inst.reviews_collection_id, {
      displayName: PRODUCT_DEF.displayName,
      type: PRODUCT_DEF.type,
      slug: PRODUCT_DEF.slug,
      metadata: { collectionId: productsCollectionId },
    });
    map.product = created.slug || PRODUCT_DEF.slug;
  }
  db.prepare(`UPDATE installations SET products_collection_id = ?, field_map = ? WHERE site_id = ?`).run(
    productsCollectionId,
    JSON.stringify(map),
    siteId
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function buildFieldData(inst: InstallationRow, r: ReviewRow): Record<string, unknown> {
  const map = readFieldMap(inst);
  const data: Record<string, unknown> = {
    name: r.title || `${r.author_name} - ${r.rating} stars`,
    slug: `review-${r.id.slice(0, 8)}`,
  };
  const set = (k: FieldKey, v: unknown) => {
    if (map[k]) data[map[k] as string] = v;
  };
  set("authorName", r.author_name);
  set("rating", r.rating);
  set("title", r.title);
  set("body", textToHtml(r.body));
  set("status", "approved");
  set("helpfulCount", r.helpful_count);
  set("verifiedPurchase", !!r.verified_purchase);
  set("ownerReply", textToHtml(r.owner_reply || ""));
  // Reference fields need a real CMS item id (24 hex chars); free-form product ids are kept locally only.
  if (map.product && inst.products_collection_id && /^[a-f0-9]{24}$/i.test(r.product_id)) set("product", r.product_id);
  return data;
}

/** Writes an approved review to the CMS and publishes it. Returns the CMS item id. */
export async function publishReview(inst: InstallationRow, review: ReviewRow): Promise<string> {
  if (!inst.reviews_collection_id) throw new Error("Reviews collection has not been created yet");
  const data = buildFieldData(inst, review);
  if (review.cms_item_id) {
    await webflowClient.updateItemLive(inst.site_id, inst.reviews_collection_id, review.cms_item_id, data);
    return review.cms_item_id;
  }
  return (await webflowClient.createItemLive(inst.site_id, inst.reviews_collection_id, data)).id;
}

/** Best-effort partial CMS update for an already published review (helpful count, owner reply, edits). */
export async function patchPublished(siteId: string, review: ReviewRow, keys: FieldKey[]): Promise<void> {
  const inst = db.prepare(`SELECT * FROM installations WHERE site_id = ? AND uninstalled_at IS NULL`).get(siteId) as InstallationRow | undefined;
  if (!inst || !inst.reviews_collection_id || !review.cms_item_id) return;
  const full = buildFieldData(inst, review);
  const map = readFieldMap(inst);
  const partial: Record<string, unknown> = {};
  for (const k of keys) {
    const slug = map[k];
    if (slug && slug in full) partial[slug] = full[slug];
  }
  if (keys.includes("title")) partial.name = full.name;
  if (Object.keys(partial).length === 0) return;
  await webflowClient.updateItemLive(siteId, inst.reviews_collection_id, review.cms_item_id, partial);
}

// ---- CMS -> local cache reconciliation ----

const lastSync = new Map<string, number>();
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Pulls CMS items and reconciles owner edits/deletions into the local cache the widget reads from. */
export async function syncFromCms(siteId: string): Promise<{ checked: number; updated: number; removed: number }> {
  lastSync.set(siteId, Date.now());
  const inst = db.prepare(`SELECT * FROM installations WHERE site_id = ? AND uninstalled_at IS NULL`).get(siteId) as InstallationRow | undefined;
  if (!inst || !inst.reviews_collection_id) return { checked: 0, updated: 0, removed: 0 };
  const map = readFieldMap(inst);

  const items = new Map<string, { isArchived?: boolean; isDraft?: boolean; fieldData: Record<string, unknown> }>();
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await webflowClient.listItems(siteId, inst.reviews_collection_id, 100, offset);
    page.items.forEach((i) => items.set(i.id, i));
    if (page.items.length < 100) break;
  }

  const local = db
    .prepare(`SELECT * FROM reviews WHERE site_id = ? AND status = 'approved' AND cms_item_id IS NOT NULL`)
    .all(siteId) as ReviewRow[];
  let updated = 0;
  let removed = 0;
  for (const r of local) {
    const item = items.get(r.cms_item_id as string);
    if (!item || item.isArchived || item.isDraft) {
      db.prepare(`UPDATE reviews SET status = 'removed', updated_at = datetime('now') WHERE id = ?`).run(r.id);
      removed++;
      continue;
    }
    const fd = item.fieldData;
    const rating = map.rating ? Number(fd[map.rating]) : r.rating;
    const title = map.title && typeof fd[map.title] === "string" ? (fd[map.title] as string) : r.title;
    const author = map.authorName && typeof fd[map.authorName] === "string" ? (fd[map.authorName] as string) : r.author_name;
    if ((rating >= 1 && rating <= 5 && rating !== r.rating) || title !== r.title || author !== r.author_name) {
      db.prepare(`UPDATE reviews SET rating = ?, title = ?, author_name = ?, updated_at = datetime('now') WHERE id = ?`).run(
        rating >= 1 && rating <= 5 ? Math.round(rating) : r.rating,
        title,
        author,
        r.id
      );
      updated++;
    }
  }
  return { checked: local.length, updated, removed };
}

/** Non-blocking lazy refresh used by the public GET /api/reviews path. */
export function maybeSync(siteId: string): void {
  if (Date.now() - (lastSync.get(siteId) || 0) < SYNC_INTERVAL_MS) return;
  lastSync.set(siteId, Date.now());
  syncFromCms(siteId).catch(() => undefined);
}
