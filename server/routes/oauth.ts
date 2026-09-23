import { Router } from "express";
import { db } from "../db";
import { webflowClient } from "../services/webflow-client";
import { newAdminToken, newPublicKey } from "../services/signing";
import { bootstrapReviewsCollection } from "../services/cms";

const router = Router();

const CLIENT_ID = process.env.WEBFLOW_CLIENT_ID || "";
const CLIENT_SECRET = process.env.WEBFLOW_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.WEBFLOW_REDIRECT_URI || "http://localhost:3000/oauth/callback";
const SCOPES = process.env.WEBFLOW_SCOPES || "sites:read,cms:read,cms:write";
const APP_BASE_URL = process.env.APP_PUBLIC_URL || "http://localhost:3000";

router.get("/authorize", (_req, res) => {
  const params = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT_URI, scope: SCOPES });
  res.redirect(`https://webflow.com/oauth/authorize?${params.toString()}`);
});

router.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) return void res.status(400).send("Missing authorization code");

  try {
    const tokenRes = await fetch("https://api.webflow.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: "authorization_code", redirect_uri: REDIRECT_URI }),
    });
    if (!tokenRes.ok) return void res.status(502).send(`Token exchange failed: ${await tokenRes.text()}`);
    const tokenJson = (await tokenRes.json()) as { access_token: string; scope?: string };

    const sitesRes = await fetch("https://api.webflow.com/v2/sites", { headers: { Authorization: `Bearer ${tokenJson.access_token}` } });
    const sitesJson = (await sitesRes.json()) as { sites: Array<{ id: string }> };
    const site = sitesJson.sites?.[0];
    if (!site) return void res.status(502).send("No site returned for this installation");

    // A reinstall keeps the existing public key / admin token so embedded snippets keep working.
    db.prepare(
      `INSERT INTO installations (site_id, access_token, scopes, public_key, admin_token, installed_at, uninstalled_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), NULL)
       ON CONFLICT(site_id) DO UPDATE SET access_token = excluded.access_token, scopes = excluded.scopes, uninstalled_at = NULL`
    ).run(site.id, tokenJson.access_token, tokenJson.scope || SCOPES, newPublicKey(), newAdminToken());
    db.prepare(`INSERT OR IGNORE INTO widget_configs (site_id) VALUES (?)`).run(site.id);

    await bootstrapReviewsCollection(site.id);
    try {
      await webflowClient.registerWebhook(site.id, "app_uninstall", `${APP_BASE_URL}/webhooks/app-uninstalled`);
    } catch {
      // Already registered on a previous install.
    }

    const inst = db.prepare(`SELECT admin_token FROM installations WHERE site_id = ?`).get(site.id) as { admin_token: string };
    // Credentials travel in the URL fragment so they never reach server logs or Referer headers.
    res.redirect(`/designer-extension/index.html#site=${encodeURIComponent(site.id)}&token=${encodeURIComponent(inst.admin_token)}`);
  } catch (err) {
    res.status(500).send(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

export default router;
