// Hand-rolled typed client for Webflow Data API v2 (no SDK dependency).

import { db } from "../db";

const API_BASE = "https://api.webflow.com/v2";

export class WebflowApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`Webflow API error ${status}: ${JSON.stringify(body)}`);
  }
}

export interface WebflowCollectionSummary {
  id: string;
  displayName: string;
  slug: string;
}
export interface WebflowField {
  id: string;
  slug: string;
  displayName: string;
  type: string;
}
export interface WebflowCollection extends WebflowCollectionSummary {
  fields: WebflowField[];
}
export interface WebflowItem {
  id: string;
  isArchived?: boolean;
  isDraft?: boolean;
  fieldData: Record<string, unknown>;
}
export interface NewField {
  displayName: string;
  type: string;
  slug?: string;
  isRequired?: boolean;
  helpText?: string;
  metadata?: Record<string, unknown>;
}

function getAccessToken(siteId: string): string {
  const row = db
    .prepare(`SELECT access_token FROM installations WHERE site_id = ? AND uninstalled_at IS NULL`)
    .get(siteId) as { access_token: string } | undefined;
  if (!row) throw new Error(`No active installation for site ${siteId}`);
  return row.access_token;
}

/** Token-bucket limiter respecting Webflow's documented ~60 req/min per-site limit. */
class RateLimiter {
  private tokens = 60;
  private lastRefill = Date.now();

  private refill() {
    const now = Date.now();
    const elapsedMin = (now - this.lastRefill) / 60000;
    if (elapsedMin > 0) {
      this.tokens = Math.min(60, this.tokens + elapsedMin * 60);
      this.lastRefill = now;
    }
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = ((1 - this.tokens) / 60) * 60000;
    await new Promise((r) => setTimeout(r, waitMs));
    return this.acquire();
  }
}

const limiters = new Map<string, RateLimiter>();
function limiterFor(siteId: string): RateLimiter {
  if (!limiters.has(siteId)) limiters.set(siteId, new RateLimiter());
  return limiters.get(siteId)!;
}

async function request<T>(siteId: string, method: string, urlPath: string, body?: unknown, retryCount = 0): Promise<T> {
  await limiterFor(siteId).acquire();
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${getAccessToken(siteId)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && retryCount < 3) {
    const retryAfterSec = Number(res.headers.get("Retry-After") || "2");
    await new Promise((r) => setTimeout(r, retryAfterSec * 1000 * Math.pow(2, retryCount)));
    return request<T>(siteId, method, urlPath, body, retryCount + 1);
  }
  if (!res.ok) throw new WebflowApiError(res.status, await res.json().catch(() => ({})));
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export const webflowClient = {
  listCollections(siteId: string): Promise<{ collections: WebflowCollectionSummary[] }> {
    return request(siteId, "GET", `/sites/${siteId}/collections`);
  },
  getCollection(siteId: string, collectionId: string): Promise<WebflowCollection> {
    return request(siteId, "GET", `/collections/${collectionId}`);
  },
  createCollection(siteId: string, displayName: string, singularName: string, slug: string): Promise<WebflowCollection> {
    return request(siteId, "POST", `/sites/${siteId}/collections`, { displayName, singularName, slug });
  },
  createField(siteId: string, collectionId: string, field: NewField): Promise<WebflowField> {
    return request(siteId, "POST", `/collections/${collectionId}/fields`, field);
  },
  listItems(siteId: string, collectionId: string, limit = 100, offset = 0): Promise<{ items: WebflowItem[]; pagination?: { total: number } }> {
    return request(siteId, "GET", `/collections/${collectionId}/items?limit=${limit}&offset=${offset}`);
  },
  /** Creates the item and publishes it to the live site in one call. */
  createItemLive(siteId: string, collectionId: string, fieldData: Record<string, unknown>): Promise<{ id: string }> {
    return request(siteId, "POST", `/collections/${collectionId}/items/live`, { isArchived: false, isDraft: false, fieldData });
  },
  updateItemLive(siteId: string, collectionId: string, itemId: string, fieldData: Record<string, unknown>): Promise<{ id: string }> {
    return request(siteId, "PATCH", `/collections/${collectionId}/items/${itemId}/live`, { fieldData });
  },
  registerWebhook(siteId: string, triggerType: string, url: string): Promise<{ id: string }> {
    return request(siteId, "POST", `/sites/${siteId}/webhooks`, { triggerType, url });
  },
};
