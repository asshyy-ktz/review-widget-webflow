import { Router } from "express";
import { db } from "../db";

const router = Router();

/**
 * On uninstall: revoke the stored token, disable the public key, and purge the pending/flagged
 * queue, vote-log, verifications and review requests. CMS-published (approved) reviews are kept
 * because they are owned by the site.
 */
router.post("/app-uninstalled", (req, res) => {
  const siteId = (req.body?.payload?.siteId || req.body?.siteId) as string | undefined;
  if (!siteId || typeof siteId !== "string") return void res.status(400).json({ error: "Missing siteId" });

  db.transaction(() => {
    db.prepare(`UPDATE installations SET access_token = '', uninstalled_at = datetime('now') WHERE site_id = ?`).run(siteId);
    db.prepare(`DELETE FROM moderation_queue WHERE site_id = ?`).run(siteId);
    db.prepare(`DELETE FROM vote_log WHERE site_id = ?`).run(siteId);
    db.prepare(`DELETE FROM verifications WHERE site_id = ?`).run(siteId);
    db.prepare(`DELETE FROM review_requests WHERE site_id = ?`).run(siteId);
    db.prepare(`DELETE FROM reviews WHERE site_id = ? AND status = 'pending'`).run(siteId);
  })();
  res.status(200).json({ ok: true });
});

export default router;
