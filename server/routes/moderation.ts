// Owner-only endpoints used by the Designer Extension App Panel (Authorization: Bearer <admin_token>).

import { NextFunction, Request, Response, Router } from "express";
import { db } from "../db";
import { requireAdmin } from "../services/auth";
import { webflowClient } from "../services/webflow-client";
import { bootstrapReviewsCollection, ensureProductReference, syncFromCms } from "../services/cms";
import {
  approveReview, editReview, getWidgetConfig, HttpError, rejectReview, saveWidgetConfig, setOwnerReply,
} from "../services/moderation";
import { InstallationRow, ReviewRow, WidgetConfig } from "../../shared/types";

const router = Router();
router.use("/admin", requireAdmin);

const APP_BASE_URL = process.env.APP_PUBLIC_URL || "http://localhost:3000";

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
function wrap(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
        if (err && typeof err === "object" && "status" in err && "body" in err) return void res.status(502).json({ error: String((err as Error).message) });
        next(err);
      });
  };
}
const site = (res: Response) => res.locals.site as InstallationRow;

function adminShape(r: ReviewRow) {
  return {
    id: r.id,
    productId: r.product_id,
    productName: r.product_name,
    authorName: r.author_name,
    rating: r.rating,
    title: r.title,
    body: r.body,
    status: r.status,
    flagged: !!r.flagged,
    spamScore: r.spam_score,
    spamReasons: JSON.parse(r.spam_reasons || "[]") as string[],
    verifiedPurchase: !!r.verified_purchase,
    helpfulCount: r.helpful_count,
    ownerReply: r.owner_reply,
    createdAt: r.created_at.replace(" ", "T") + "Z",
  };
}

router.get("/site", wrap((_req, res) => {
  const s = site(res);
  const counts = db
    .prepare(`SELECT status, flagged, COUNT(*) AS n FROM reviews WHERE site_id = ? GROUP BY status, flagged`)
    .all(s.site_id) as { status: string; flagged: number; n: number }[];
  res.json({
    siteId: s.site_id,
    publicKey: s.public_key,
    appUrl: APP_BASE_URL,
    reviewsCollectionId: s.reviews_collection_id,
    productsCollectionId: s.products_collection_id,
    pending: counts.filter((c) => c.status === "pending" && !c.flagged).reduce((a, c) => a + c.n, 0),
    flagged: counts.filter((c) => c.status === "pending" && c.flagged).reduce((a, c) => a + c.n, 0),
    approved: counts.filter((c) => c.status === "approved").reduce((a, c) => a + c.n, 0),
  });
}));

router.get("/collections", wrap(async (_req, res) => {
  res.json(await webflowClient.listCollections(site(res).site_id));
}));

router.post("/bootstrap", wrap(async (_req, res) => {
  await bootstrapReviewsCollection(site(res).site_id);
  res.json({ ok: true });
}));

router.post("/products-collection", wrap(async (req, res) => {
  const id = typeof req.body?.collectionId === "string" ? req.body.collectionId : "";
  if (!id) throw new HttpError(400, "collectionId is required");
  try {
    await ensureProductReference(site(res).site_id, id);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, e instanceof Error ? e.message : "Could not link products collection");
  }
  res.json({ ok: true, productsCollectionId: id });
}));

router.post("/sync", wrap(async (_req, res) => {
  res.json(await syncFromCms(site(res).site_id));
}));

// filter: all | pending | flagged
router.get("/queue", wrap((req, res) => {
  const filter = req.query.filter as string;
  const where = filter === "flagged" ? "AND r.flagged = 1" : filter === "pending" ? "AND r.flagged = 0" : "";
  const rows = db
    .prepare(
      `SELECT r.* FROM moderation_queue q JOIN reviews r ON r.id = q.review_id
       WHERE q.site_id = ? AND r.status = 'pending' ${where}
       ORDER BY r.flagged DESC, q.queued_at ASC LIMIT 200`
    )
    .all(site(res).site_id) as ReviewRow[];
  res.json({ reviews: rows.map(adminShape) });
}));

router.get("/reviews", wrap((req, res) => {
  const status = ["approved", "rejected", "removed"].includes(req.query.status as string) ? (req.query.status as string) : "approved";
  const rows = db
    .prepare(`SELECT * FROM reviews WHERE site_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200`)
    .all(site(res).site_id, status) as ReviewRow[];
  res.json({ reviews: rows.map(adminShape) });
}));

router.patch("/reviews/:id", wrap(async (req, res) => {
  const b = req.body || {};
  const updated = await editReview(site(res).site_id, req.params.id, {
    authorName: typeof b.authorName === "string" ? b.authorName : undefined,
    title: typeof b.title === "string" ? b.title : undefined,
    body: typeof b.body === "string" ? b.body : undefined,
    rating: b.rating !== undefined ? Number(b.rating) : undefined,
  });
  res.json({ review: adminShape(updated) });
}));

router.post("/reviews/:id/approve", wrap(async (req, res) => {
  const b = (req.body && req.body.edits) || {};
  const review = await approveReview(site(res), req.params.id, {
    authorName: typeof b.authorName === "string" ? b.authorName : undefined,
    title: typeof b.title === "string" ? b.title : undefined,
    body: typeof b.body === "string" ? b.body : undefined,
    rating: b.rating !== undefined ? Number(b.rating) : undefined,
  });
  res.json({ review: adminShape(review) });
}));

router.post("/reviews/:id/reject", wrap((req, res) => {
  res.json({ review: adminShape(rejectReview(site(res).site_id, req.params.id)) });
}));

router.put("/reviews/:id/reply", wrap(async (req, res) => {
  const reply = typeof req.body?.reply === "string" ? req.body.reply : "";
  const updated = await setOwnerReply(site(res).site_id, req.params.id, reply);
  res.json({ review: adminShape(updated) });
}));

router.get("/config", wrap((_req, res) => {
  res.json(getWidgetConfig(site(res).site_id));
}));

router.put("/config", wrap((req, res) => {
  const b = (req.body || {}) as Partial<WidgetConfig>;
  const patch: Partial<WidgetConfig> = {};
  if (b.preset !== undefined) patch.preset = String(b.preset);
  if (b.layout !== undefined) patch.layout = b.layout;
  if (b.starColor !== undefined) patch.starColor = String(b.starColor);
  if (b.cardsPerRow !== undefined) patch.cardsPerRow = Number(b.cardsPerRow);
  if (b.pageSize !== undefined) patch.pageSize = Number(b.pageSize);
  if (b.defaultSort !== undefined) patch.defaultSort = b.defaultSort;
  if (b.theme !== undefined) patch.theme = b.theme;
  if (b.showForm !== undefined) patch.showForm = !!b.showForm;
  res.json(saveWidgetConfig(site(res).site_id, patch));
}));

export default router;
