// Moderation pipeline: heuristic spam/profanity scoring, queueing, approve -> CMS, reject (soft delete).

import { db } from "../db";
import { publishReview, patchPublished } from "./cms";
import { FieldKey, InstallationRow, ReviewRow, SpamResult, WidgetConfig } from "../../shared/types";

const FLAG_THRESHOLD = Number(process.env.SPAM_FLAG_THRESHOLD || 50);

const PROFANITY = ["fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "piss", "slut", "whore", "crap", "damn", "bollocks", "wanker", "prick"];
const SPAM_PHRASES = [
  "viagra", "cialis", "casino", "poker", "crypto", "bitcoin", "forex", "click here", "free money", "buy now", "seo services",
  "payday loan", "work from home", "make money", "whatsapp", "telegram", "earn $", "limited offer", "act now", "guaranteed income",
];

export interface SpamContext {
  siteId: string;
  bodyHash: string;
  ipHash: string;
}

function countMatches(haystack: string, words: string[]): number {
  let n = 0;
  for (const w of words) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")}`, "gi");
    const m = haystack.match(re);
    if (m) n += m.length;
  }
  return n;
}

/** Scores a submission 0-100. Every rule adds points and a human-readable reason. */
export function scoreSpam(input: { authorName: string; title: string; body: string }, ctx: SpamContext): SpamResult {
  const text = `${input.title}\n${input.body}`;
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${reason} (+${points})`);
  };

  const profane = countMatches(text, PROFANITY);
  if (profane > 0) add(Math.min(45, profane * 15), `profanity x${profane}`);

  const spammy = countMatches(text, SPAM_PHRASES);
  if (spammy > 0) add(Math.min(40, spammy * 20), `spam phrases x${spammy}`);

  const links = (text.match(/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ru|xyz|top|info|biz)\b/gi) || []).length;
  if (links === 1) add(15, "contains a link");
  else if (links >= 2) add(Math.min(50, 25 + links * 5), `${links} links`);

  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(input.body)) add(10, "email address in body");

  if (/(\S)\1{5,}/.test(text)) add(15, "repeated characters");
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    const distinct = new Set(words).size;
    if (distinct / words.length < 0.4) add(15, "repeated words");
  }

  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 15 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7) add(20, "mostly upper-case");
  if (/[!?]{4,}/.test(text)) add(10, "excessive punctuation");
  if (input.body.trim().length < 10) add(10, "very short body");

  if (ctx.bodyHash) {
    const dup = db
      .prepare(`SELECT status, COUNT(*) AS n FROM reviews WHERE site_id = ? AND body_hash = ? GROUP BY status`)
      .all(ctx.siteId, ctx.bodyHash) as { status: string; n: number }[];
    if (dup.some((d) => d.status === "rejected")) add(60, "matches a previously rejected review");
    else if (dup.length > 0) add(40, "duplicate of an earlier review");
  }
  if (ctx.ipHash) {
    const recent = db
      .prepare(`SELECT COUNT(*) AS n FROM reviews WHERE site_id = ? AND ip_hash = ? AND created_at >= datetime('now','-1 hour')`)
      .get(ctx.siteId, ctx.ipHash) as { n: number };
    if (recent.n >= 3) add(25, "many submissions from one source in the last hour");
  }

  score = Math.min(100, score);
  return { score, flagged: score >= FLAG_THRESHOLD, reasons };
}

/** Puts a freshly inserted pending review on the moderation queue. */
export function enqueue(review: { id: string; site_id: string }, spam: SpamResult): void {
  db.prepare(
    `INSERT OR REPLACE INTO moderation_queue (review_id, site_id, spam_score, reasons, flagged) VALUES (?, ?, ?, ?, ?)`
  ).run(review.id, review.site_id, spam.score, JSON.stringify(spam.reasons), spam.flagged ? 1 : 0);
}

export function getReview(siteId: string, id: string): ReviewRow | undefined {
  return db.prepare(`SELECT * FROM reviews WHERE id = ? AND site_id = ?`).get(id, siteId) as ReviewRow | undefined;
}

export interface ReviewEdits {
  authorName?: string;
  title?: string;
  body?: string;
  rating?: number;
}

export function validateEdits(e: ReviewEdits): string | null {
  if (e.authorName !== undefined && (!e.authorName.trim() || e.authorName.length > 80)) return "Author name must be 1-80 characters";
  if (e.title !== undefined && e.title.length > 120) return "Title must be at most 120 characters";
  if (e.body !== undefined && (!e.body.trim() || e.body.length > 5000)) return "Body must be 1-5000 characters";
  if (e.rating !== undefined && (!Number.isInteger(e.rating) || e.rating < 1 || e.rating > 5)) return "Rating must be an integer 1-5";
  return null;
}

export function applyEdits(review: ReviewRow, e: ReviewEdits): ReviewRow {
  db.prepare(`UPDATE reviews SET author_name = ?, title = ?, body = ?, rating = ?, updated_at = datetime('now') WHERE id = ?`).run(
    e.authorName !== undefined ? e.authorName.trim() : review.author_name,
    e.title !== undefined ? e.title.trim() : review.title,
    e.body !== undefined ? e.body.trim() : review.body,
    e.rating !== undefined ? e.rating : review.rating,
    review.id
  );
  return getReview(review.site_id, review.id) as ReviewRow;
}

/** Applies optional edits, writes the review to the CMS (published), then marks it approved. */
export async function approveReview(inst: InstallationRow, id: string, edits?: ReviewEdits): Promise<ReviewRow> {
  let review = getReview(inst.site_id, id);
  if (!review) throw new HttpError(404, "Review not found");
  if (review.status !== "pending") throw new HttpError(409, `Review is already ${review.status}`);
  if (edits) {
    const err = validateEdits(edits);
    if (err) throw new HttpError(400, err);
    review = applyEdits(review, edits);
  }
  const cmsId = await publishReview(inst, review);
  db.transaction(() => {
    db.prepare(
      `UPDATE reviews SET status = 'approved', flagged = 0, cms_item_id = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(cmsId, id);
    db.prepare(`DELETE FROM moderation_queue WHERE review_id = ?`).run(id);
  })();
  return getReview(inst.site_id, id) as ReviewRow;
}

/** Soft delete: the row is kept (status 'rejected') so its body hash feeds duplicate/spam detection. */
export function rejectReview(siteId: string, id: string): ReviewRow {
  const review = getReview(siteId, id);
  if (!review) throw new HttpError(404, "Review not found");
  if (review.status !== "pending") throw new HttpError(409, `Review is already ${review.status}`);
  db.transaction(() => {
    db.prepare(`UPDATE reviews SET status = 'rejected', decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM moderation_queue WHERE review_id = ?`).run(id);
  })();
  return getReview(siteId, id) as ReviewRow;
}

/** Edits an already-approved review and mirrors the change to the CMS (best effort). */
export async function editReview(siteId: string, id: string, edits: ReviewEdits): Promise<ReviewRow> {
  const review = getReview(siteId, id);
  if (!review) throw new HttpError(404, "Review not found");
  if (review.status === "rejected" || review.status === "removed") throw new HttpError(409, `Review is ${review.status}`);
  const err = validateEdits(edits);
  if (err) throw new HttpError(400, err);
  const updated = applyEdits(review, edits);
  if (updated.status === "approved") {
    const keys: FieldKey[] = [];
    if (edits.authorName !== undefined) keys.push("authorName");
    if (edits.title !== undefined) keys.push("title");
    if (edits.body !== undefined) keys.push("body");
    if (edits.rating !== undefined) keys.push("rating");
    await patchPublished(siteId, updated, keys).catch(() => undefined);
  }
  return updated;
}

export async function setOwnerReply(siteId: string, id: string, reply: string): Promise<ReviewRow> {
  const review = getReview(siteId, id);
  if (!review) throw new HttpError(404, "Review not found");
  if (review.status !== "approved") throw new HttpError(409, "Only approved reviews can be replied to");
  const text = reply.trim();
  if (text.length > 2000) throw new HttpError(400, "Reply must be at most 2000 characters");
  db.prepare(`UPDATE reviews SET owner_reply = ?, owner_reply_at = ?, updated_at = datetime('now') WHERE id = ?`).run(
    text,
    text ? new Date().toISOString() : null,
    id
  );
  const updated = getReview(siteId, id) as ReviewRow;
  await patchPublished(siteId, updated, ["ownerReply"]).catch(() => undefined);
  return updated;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---- widget config helpers ----

interface ConfigRow {
  preset: string;
  layout: "list" | "carousel";
  star_color: string;
  cards_per_row: number;
  page_size: number;
  default_sort: "newest" | "highest" | "helpful";
  theme: "light" | "dark";
  show_form: number;
}

export function getWidgetConfig(siteId: string): WidgetConfig {
  let row = db.prepare(`SELECT * FROM widget_configs WHERE site_id = ?`).get(siteId) as ConfigRow | undefined;
  if (!row) {
    db.prepare(`INSERT INTO widget_configs (site_id) VALUES (?)`).run(siteId);
    row = db.prepare(`SELECT * FROM widget_configs WHERE site_id = ?`).get(siteId) as ConfigRow;
  }
  return {
    preset: row.preset,
    layout: row.layout,
    starColor: row.star_color,
    cardsPerRow: row.cards_per_row,
    pageSize: row.page_size,
    defaultSort: row.default_sort,
    theme: row.theme,
    showForm: !!row.show_form,
  };
}

export function saveWidgetConfig(siteId: string, input: Partial<WidgetConfig>): WidgetConfig {
  const cur = getWidgetConfig(siteId);
  const next: WidgetConfig = { ...cur, ...input };
  if (!["list", "carousel"].includes(next.layout)) throw new HttpError(400, "Invalid layout");
  if (!/^#[0-9a-fA-F]{6}$/.test(next.starColor)) throw new HttpError(400, "Star color must be a #rrggbb hex value");
  if (!Number.isInteger(next.cardsPerRow) || next.cardsPerRow < 1 || next.cardsPerRow > 4) throw new HttpError(400, "cardsPerRow must be 1-4");
  if (!Number.isInteger(next.pageSize) || next.pageSize < 1 || next.pageSize > 50) throw new HttpError(400, "pageSize must be 1-50");
  if (!["newest", "highest", "helpful"].includes(next.defaultSort)) throw new HttpError(400, "Invalid default sort");
  if (!["light", "dark"].includes(next.theme)) throw new HttpError(400, "Invalid theme");
  db.prepare(
    `UPDATE widget_configs SET preset = ?, layout = ?, star_color = ?, cards_per_row = ?, page_size = ?, default_sort = ?, theme = ?, show_form = ?, updated_at = datetime('now') WHERE site_id = ?`
  ).run(String(next.preset).slice(0, 40), next.layout, next.starColor, next.cardsPerRow, next.pageSize, next.defaultSort, next.theme, next.showForm ? 1 : 0, siteId);
  return getWidgetConfig(siteId);
}
