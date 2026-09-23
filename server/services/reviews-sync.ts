// Thin re-exports so route files depend on one module for CMS write-through helpers.

import { db } from "../db";
import { maybeSync, patchPublished } from "./cms";
import { FieldKey, ReviewRow } from "../../shared/types";

export { maybeSync };

/** Fire-and-forget CMS write-through; the local cache stays the source of truth for the widget. */
export function patchPublishedSafe(siteId: string, review: ReviewRow, keys: FieldKey[]): void {
  if (!review.cms_item_id) return;
  const exists = db.prepare(`SELECT 1 FROM installations WHERE site_id = ? AND uninstalled_at IS NULL`).get(siteId);
  if (!exists) return;
  patchPublished(siteId, review, keys).catch(() => undefined);
}
