# review-widget-webflow

A Webflow App for collecting, moderating and displaying customer reviews. Approved reviews are written to a native **Reviews** CMS collection, so they stay editable and queryable in Webflow. Visitors interact with a dependency-free embeddable widget; site owners moderate from a Designer Extension App Panel.

Stack: Node.js 20, TypeScript, Express, better-sqlite3, Webflow Data API v2 (no SDK), vanilla JS widget and panel.

## Layout

```
server/            Express app (routes/, services/)
designer-extension/ App Panel: moderation queue, replies, widget configurator, setup
widget/            reviews.js (embeddable), preview.html (panel live preview), review.html (review-request landing page)
db/schema.sql      installations, widget_configs, reviews, moderation_queue, vote_log, verifications, review_requests
shared/types.ts    shared type definitions
```

## CMS schema

On install the app creates (or attaches to an existing) **Reviews** collection and ensures these fields:

| Field | Slug | Type |
| --- | --- | --- |
| Author Name | `author-name` | PlainText |
| Rating (1-5) | `rating` | Number |
| Title | `title` | PlainText |
| Body | `body` | RichText |
| Status | `status` | PlainText (`approved` when published) |
| Helpful Vote Count | `helpful-vote-count` | Number |
| Verified Purchase Flag | `verified-purchase-flag` | Switch |
| Owner Reply | `owner-reply` | RichText |
| Product Reference | `product-reference` | Reference to the collection chosen in Setup (optional) |

Only approved reviews are written (via `POST /v2/collections/{id}/items/live`, i.e. published). Pending, flagged and rejected submissions live only in the local database. Owner edits or deletions in the CMS are reconciled into the local cache periodically (and on demand via Setup > Sync).

The Product Reference field is filled when `data-product-id` is a real CMS item ID (24 hex characters); otherwise the id is stored locally and only used to group reviews.

## Embedding the widget

```html
<div data-review-widget data-key="PUBLIC_KEY" data-product-id="CMS_ITEM_ID"></div>
<script src="https://YOUR-APP-HOST/widget/reviews.js" defer></script>
```

The panel's Widget style tab generates this snippet. On a Collection template page, bind `data-product-id` to the item's ID with the Embed editor's "Add field".

### Data attributes

| Attribute | Required | Description |
| --- | --- | --- |
| `data-review-widget` | yes | Marks the mount element. Multiple per page are allowed. |
| `data-key` | yes | Public site key (shown in the panel snippet). Scopes public API calls to your site. |
| `data-product-id` | yes | CMS item ID (or any stable string) of the product being reviewed. |
| `data-product-name` | no | Stored with new reviews for display in the panel. |
| `data-layout` | no | `list` or `carousel`. Overrides the site default. |
| `data-star-color` | no | Hex color, e.g. `#f5a623`. |
| `data-cards-per-row` | no | 1-4. |
| `data-page-size` | no | Reviews per page, 1-50. |
| `data-sort` | no | Initial sort: `newest`, `highest`, `helpful`. |
| `data-theme` | no | `light` or `dark`. |
| `data-show-form` | no | `true`/`false`: show the submission form. |
| `data-api` | no | Override the API origin (defaults to the origin the script is served from). |
| `data-preview` | no | `true` renders sample data without network calls (used by the panel preview). |

Any option omitted falls back to the site default saved in the panel (`GET /api/config`).

## Public API (CORS-enabled, scoped by `key`)

- `GET /api/config?key=` widget defaults.
- `GET /api/reviews?key=&product=&sort=&page=&pageSize=` approved reviews plus rating summary/distribution.
- `POST /api/reviews` submit `{ key, productId, productName?, authorName, email?, rating, title, body, website (honeypot), requestToken? }`.
- `POST /api/reviews/:id/helpful` body `{ key, clientToken }`.
- `GET /api/review-request?token=` resolves a signed review link (used by the widget when `?rw_request=` is in the page URL).

Helpful votes are deduplicated by the signed `rw_voter` cookie (`SameSite=None; Secure`), a localStorage client token, and an IP-hash limit (max 3 votes per review from one IP, tolerating shared networks). Every vote is recorded in `vote_log`. Raw IPs and emails are never stored, only keyed HMACs.

## Owner / server-to-server API

Send `Authorization: Bearer <admin_token>`. The admin token is shown to the app after install (delivered in the URL fragment of the OAuth redirect and stored by the panel). Panel endpoints live under `/api/admin/*` (queue, approve, reject, edit, reply, config, setup).

## Spam heuristic

`server/services/moderation.ts` scores each submission 0-100 without any external service. Points add up (capped at 100):

| Signal | Points |
| --- | --- |
| Profanity word list | 15 per hit, max 45 |
| Spam phrases (casino, crypto, "click here", ...) | 20 per hit, max 40 |
| One link / two or more links | 15 / 25 + 5 per link (max 50) |
| Email address in body | 10 |
| Repeated characters (6+ in a row) / low word variety | 15 each |
| Mostly upper-case (>70% of 15+ letters) | 20 |
| 4+ consecutive `!`/`?` | 10 |
| Body under 10 characters | 10 |
| Duplicate of an earlier review body | 40 |
| Matches a previously **rejected** body | 60 |
| 3+ submissions from the same IP in the last hour | 25 |

A score at or above `SPAM_FLAG_THRESHOLD` (default 50) sets the review's `flagged` sub-status. Every submission starts as `pending`; nothing is published without approval. The panel shows flagged items first with the list of triggered signals. Rejecting is a soft delete: the row is kept (status `rejected`) purely so its body hash raises the score of repeat spam. The honeypot field silently discards bot posts, and more than 5 submissions per IP per hour are refused.

## Verified-purchase webhook contract

An external order system calls, with the admin token:

```
POST /api/verify-purchase
Authorization: Bearer <admin_token>
{ "email": "buyer@example.com", "productId": "<same value as data-product-id>", "orderId": "1001" }
```

Responses: `201 { ok, created: true }` (or `200 created: false` when the same email/product/order was already recorded). When a review is later submitted with that email for that product, `verified_purchase` is set at submission time and the verification is consumed (one review per verification record). Emails are stored only as keyed hashes.

## Review-request links

```
POST /api/request-review
Authorization: Bearer <admin_token>
{ "productId": "...", "productName": "Blue Mug", "authorName": "Sam", "email": "buyer@example.com", "orderId": "1001", "pageUrl": "https://yoursite.com/products/blue-mug" }
```

Returns `{ url, expiresAt }`. The URL is `pageUrl` (or the bundled `/widget/review.html`) plus a signed `rw_request` token that expires after 30 days and works once. When the page contains the widget, it reads the token, pre-fills the name and product, and reviews submitted through it are flagged verified if an `orderId` was supplied.

## Uninstall

`POST /webhooks/app-uninstalled` revokes the stored access token, disables the widget key, and purges pending/flagged reviews, the moderation queue, `vote_log`, verifications and review requests. Published reviews in the CMS are kept (they belong to the site).

## Local development

1. Copy `.env.example` to `.env` and fill in `WEBFLOW_CLIENT_ID`, `WEBFLOW_CLIENT_SECRET` and a strong `APP_SIGNING_SECRET`.
2. Install dependencies and start: `npm install`, then `npm run dev` (server on `PORT`, default 3000; SQLite database is created from `db/schema.sql`).
3. Expose the server over HTTPS (for example with a tunnel), set `APP_PUBLIC_URL` and `WEBFLOW_REDIRECT_URI` accordingly, and register the same redirect URI in your Webflow app.
4. Visit `/oauth/authorize` to install. You are redirected to the panel with credentials pre-filled.
5. Serve the Designer Extension from `/designer-extension/` (bundle `designer-extension/` per Webflow's extension tooling) and the widget from `/widget/reviews.js`.

The vote cookie requires HTTPS (`SameSite=None; Secure`); over plain HTTP the widget still dedupes through the localStorage token and IP limit.
