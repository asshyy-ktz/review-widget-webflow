// Public (public-key scoped) widget API plus the two server-to-server endpoints (admin token).

import { Request, Response, Router } from "express";
import { db } from "../db";
import { getInstallationByKey, getInstallation, requireAdmin } from "../services/auth";
import { hashEmail, hashIp, hashText, newId, newVoterCookie, parseVoterCookie, signPayload, verifyPayload } from "../services/signing";
import { enqueue, getWidgetConfig, scoreSpam } from "../services/moderation";
import { maybeSync, patchPublishedSafe } from "../services/reviews-sync";
import { InstallationRow, PublicReview, ReviewRequestPayload, ReviewRow, ReviewSummary } from "../../shared/types";

const router = Router();
const APP_BASE_URL = process.env.APP_PUBLIC_URL || "http://localhost:3000";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}
function isoFromSql(s: string): string {
  return s.replace(" ", "T") + "Z";
}
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function siteFromKey(req: Request, res: Response): InstallationRow | null {
  const key = (req.query.key as string) || (req.body && (req.body.key as string));
  const inst = getInstallationByKey(key);
  if (!inst) {
    res.status(401).json({ error: "Invalid or missing widget key" });
    return null;
  }
  return inst;
}

function toPublic(r: ReviewRow): PublicReview {
  return {
    id: r.id,
    authorName: r.author_name,
    rating: r.rating,
    title: r.title,
    body: r.body,
    verifiedPurchase: !!r.verified_purchase,
    helpfulCount: r.helpful_count,
    ownerReply: r.owner_reply,
    ownerReplyAt: r.owner_reply_at,
    createdAt: isoFromSql(r.created_at),
  };
}

function summarize(siteId: string, productId: string): ReviewSummary {
  const rows = db
    .prepare(`SELECT rating, COUNT(*) AS n FROM reviews WHERE site_id = ? AND product_id = ? AND status = 'approved' GROUP BY rating`)
    .all(siteId, productId) as { rating: number; n: number }[];
  const distribution: ReviewSummary["distribution"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    distribution[String(r.rating) as keyof ReviewSummary["distribution"]] = r.n;
    count += r.n;
    sum += r.rating * r.n;
  }
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : 0, distribution };
}

const SORTS: Record<string, string> = {
  newest: "created_at DESC",
  highest: "rating DESC, created_at DESC",
  helpful: "helpful_count DESC, created_at DESC",
};

// Widget defaults; data-* attributes on the embed override these.
router.get("/config", (req, res) => {
  const inst = siteFromKey(req, res);
  if (!inst) return;
  res.json(getWidgetConfig(inst.site_id));
});

router.get("/reviews", (req, res) => {
  const inst = siteFromKey(req, res);
  if (!inst) return;
  const product = str(req.query.product, 200);
  if (!product) return void res.status(400).json({ error: "Missing product" });
  const sort = SORTS[req.query.sort as string] ? (req.query.sort as string) : "newest";
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string, 10) || 6));
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);

  maybeSync(inst.site_id);
  const summary = summarize(inst.site_id, product);
  const rows = db
    .prepare(
      `SELECT * FROM reviews WHERE site_id = ? AND product_id = ? AND status = 'approved' ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`
    )
    .all(inst.site_id, product, pageSize, (page - 1) * pageSize) as ReviewRow[];
  res.set("Cache-Control", "public, max-age=30");
  res.json({ reviews: rows.map(toPublic), summary, page, pageSize, total: summary.count, sort });
});

router.post("/reviews", (req, res) => {
  const inst = siteFromKey(req, res);
  if (!inst) return;
  const b = req.body || {};

  // Honeypot: real visitors never see this field. Pretend success so bots don't adapt.
  if (str(b.website, 200) || str(b.honeypot, 200)) return void res.status(201).json({ ok: true, status: "pending" });

  const productId = str(b.productId, 200);
  const authorName = str(b.authorName, 80);
  const title = str(b.title, 120);
  const body = str(b.body, 5000);
  const rating = Number(b.rating);
  const email = str(b.email, 200).toLowerCase();
  if (!productId) return void res.status(400).json({ error: "Missing productId" });
  if (!authorName) return void res.status(400).json({ error: "Please enter your name" });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return void res.status(400).json({ error: "Rating must be 1-5" });
  if (body.length < 3) return void res.status(400).json({ error: "Please write a review" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void res.status(400).json({ error: "Invalid email address" });

  const ipHash = hashIp(clientIp(req));
  const bodyHash = hashText(body);
  let emailHash = hashEmail(email);
  let verified = 0;

  // Signed review-request link: carries verification context and is single use.
  let requestId: string | null = null;
  const requestToken = str(b.requestToken, 1000);
  if (requestToken) {
    const payload = verifyPayload<ReviewRequestPayload>(requestToken);
    if (payload && payload.s === inst.site_id) {
      const row = db
        .prepare(`SELECT * FROM review_requests WHERE id = ? AND site_id = ? AND used_at IS NULL`)
        .get(payload.r, inst.site_id) as { id: string; product_id: string; email_hash: string; verified: number } | undefined;
      if (row && row.product_id === productId) {
        requestId = row.id;
        if (!emailHash) emailHash = row.email_hash;
        if (row.verified) verified = 1;
      }
    }
  }

  const recent = db
    .prepare(`SELECT COUNT(*) AS n FROM reviews WHERE site_id = ? AND ip_hash = ? AND created_at >= datetime('now','-1 hour')`)
    .get(inst.site_id, ipHash) as { n: number };
  if (recent.n >= 5) return void res.status(429).json({ error: "Too many submissions. Please try again later." });

  const spam = scoreSpam({ authorName, title, body }, { siteId: inst.site_id, bodyHash, ipHash });
  const id = newId();

  db.transaction(() => {
    let verificationId: string | null = null;
    if (emailHash) {
      const v = db
        .prepare(
          `SELECT id FROM verifications WHERE site_id = ? AND email_hash = ? AND product_id = ? AND consumed_at IS NULL ORDER BY created_at LIMIT 1`
        )
        .get(inst.site_id, emailHash, productId) as { id: string } | undefined;
      if (v) {
        verified = 1;
        verificationId = v.id;
      }
    }
    db.prepare(
      `INSERT INTO reviews (id, site_id, product_id, product_name, author_name, email_hash, rating, title, body, status, flagged, spam_score, spam_reasons, verified_purchase, ip_hash, body_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    ).run(
      id, inst.site_id, productId, str(b.productName, 200), authorName, emailHash, rating, title, body,
      spam.flagged ? 1 : 0, spam.score, JSON.stringify(spam.reasons), verified, ipHash, bodyHash
    );
    enqueue({ id, site_id: inst.site_id }, spam);
    if (verificationId) db.prepare(`UPDATE verifications SET consumed_at = datetime('now'), review_id = ? WHERE id = ?`).run(id, verificationId);
    if (requestId) db.prepare(`UPDATE review_requests SET used_at = datetime('now') WHERE id = ?`).run(requestId);
  })();

  // Status is deliberately generic: visitors are not told whether they were auto-flagged.
  res.status(201).json({ ok: true, status: "pending", message: "Thanks! Your review is awaiting moderation." });
});

router.post("/reviews/:id/helpful", (req, res) => {
  const inst = siteFromKey(req, res);
  if (!inst) return;
  const review = db
    .prepare(`SELECT * FROM reviews WHERE id = ? AND site_id = ? AND status = 'approved'`)
    .get(req.params.id, inst.site_id) as ReviewRow | undefined;
  if (!review) return void res.status(404).json({ error: "Review not found" });

  let voterId = parseVoterCookie(req.cookies?.rw_voter);
  if (!voterId) {
    const v = newVoterCookie();
    voterId = v.id;
    res.cookie("rw_voter", v.cookie, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "none",
      secure: true,
    });
  }
  const ipHash = hashIp(clientIp(req));
  const clientToken = str(req.body?.clientToken, 100);

  const dupe = db
    .prepare(
      `SELECT 1 FROM vote_log WHERE review_id = ? AND (voter_id = ? OR (? != '' AND client_token = ?))`
    )
    .get(review.id, voterId, clientToken, clientToken);
  // Same IP with a fresh cookie and token is allowed a few times (shared networks) but not unlimited.
  const ipVotes = db.prepare(`SELECT COUNT(*) AS n FROM vote_log WHERE review_id = ? AND ip_hash = ?`).get(review.id, ipHash) as { n: number };
  if (dupe || ipVotes.n >= 3) {
    return void res.status(409).json({ error: "You already marked this review as helpful", helpfulCount: review.helpful_count });
  }

  db.transaction(() => {
    db.prepare(`INSERT INTO vote_log (site_id, review_id, voter_id, client_token, ip_hash) VALUES (?, ?, ?, ?, ?)`).run(
      inst.site_id, review.id, voterId, clientToken, ipHash
    );
    db.prepare(`UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = ?`).run(review.id);
  })();
  const updated = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(review.id) as ReviewRow;
  patchPublishedSafe(inst.site_id, updated, ["helpfulCount"]);
  res.json({ ok: true, helpfulCount: updated.helpful_count });
});

// ---- server-to-server (admin token) ----

/** External order system pre-authorizes a future review as a verified purchase. */
router.post("/verify-purchase", requireAdmin, (req, res) => {
  const site = res.locals.site as InstallationRow;
  const email = str(req.body?.email, 200).toLowerCase();
  const productId = str(req.body?.productId, 200);
  const orderId = str(req.body?.orderId, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !productId) {
    return void res.status(400).json({ error: "email and productId are required" });
  }
  const result = db
    .prepare(`INSERT OR IGNORE INTO verifications (id, site_id, email_hash, product_id, order_id) VALUES (?, ?, ?, ?, ?)`)
    .run(newId(), site.site_id, hashEmail(email), productId, orderId);
  res.status(result.changes ? 201 : 200).json({ ok: true, created: result.changes > 0 });
});

/** External post-purchase flow asks for a signed, 30-day review link with product + order context. */
router.post("/request-review", requireAdmin, (req, res) => {
  const site = res.locals.site as InstallationRow;
  const productId = str(req.body?.productId, 200);
  if (!productId) return void res.status(400).json({ error: "productId is required" });
  const email = str(req.body?.email, 200).toLowerCase();
  const orderId = str(req.body?.orderId, 100);
  const pageUrlRaw = str(req.body?.pageUrl, 1000);
  let base: URL;
  try {
    base = new URL(pageUrlRaw || `${APP_BASE_URL}/widget/review.html`);
    if (!/^https?:$/.test(base.protocol)) throw new Error("bad protocol");
  } catch {
    return void res.status(400).json({ error: "pageUrl must be an http(s) URL" });
  }

  const id = newId();
  const exp = Date.now() + THIRTY_DAYS_MS;
  const emailHash = hashEmail(email);
  db.prepare(
    `INSERT INTO review_requests (id, site_id, product_id, product_name, author_name, email_hash, order_id, verified, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, site.site_id, productId, str(req.body?.productName, 200), str(req.body?.authorName, 80), emailHash, orderId, orderId ? 1 : 0, new Date(exp).toISOString());

  const payload: ReviewRequestPayload = { r: id, s: site.site_id, exp };
  base.searchParams.set("rw_request", signPayload(payload));
  res.status(201).json({ ok: true, url: base.toString(), expiresAt: new Date(exp).toISOString() });
});

/** Resolves a signed request token for the widget so it can pre-fill the form. */
router.get("/review-request", (req, res) => {
  const payload = verifyPayload<ReviewRequestPayload>(str(req.query.token, 1000));
  if (!payload) return void res.status(410).json({ error: "This review link is invalid or has expired" });
  const row = db
    .prepare(`SELECT * FROM review_requests WHERE id = ? AND site_id = ?`)
    .get(payload.r, payload.s) as
    | { product_id: string; product_name: string; author_name: string; verified: number; used_at: string | null }
    | undefined;
  const inst = getInstallation(payload.s);
  if (!row || !inst) return void res.status(410).json({ error: "This review link is invalid or has expired" });
  if (row.used_at) return void res.status(410).json({ error: "This review link has already been used" });
  res.json({
    key: inst.public_key,
    productId: row.product_id,
    productName: row.product_name,
    authorName: row.author_name,
    verified: !!row.verified,
  });
});

export default router;
