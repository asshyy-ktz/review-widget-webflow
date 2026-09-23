-- review-widget-webflow: local persistence schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS installations (
  site_id                TEXT PRIMARY KEY,
  access_token           TEXT NOT NULL,
  scopes                 TEXT NOT NULL,
  public_key             TEXT NOT NULL UNIQUE,   -- embedded in the widget snippet (data-key); scopes public API calls
  admin_token            TEXT NOT NULL,          -- secret for the App Panel and server-to-server calls (verify-purchase, request-review)
  reviews_collection_id  TEXT,
  products_collection_id TEXT,                   -- optional collection the Reviews "product" reference points at
  field_map              TEXT NOT NULL DEFAULT '{}', -- JSON: logical field key -> CMS field slug
  installed_at           TEXT NOT NULL DEFAULT (datetime('now')),
  uninstalled_at         TEXT
);

CREATE TABLE IF NOT EXISTS widget_configs (
  site_id        TEXT PRIMARY KEY REFERENCES installations(site_id) ON DELETE CASCADE,
  preset         TEXT NOT NULL DEFAULT 'classic',
  layout         TEXT NOT NULL DEFAULT 'list' CHECK (layout IN ('list','carousel')),
  star_color     TEXT NOT NULL DEFAULT '#f5a623',
  cards_per_row  INTEGER NOT NULL DEFAULT 1 CHECK (cards_per_row BETWEEN 1 AND 4),
  page_size      INTEGER NOT NULL DEFAULT 6 CHECK (page_size BETWEEN 1 AND 50),
  default_sort   TEXT NOT NULL DEFAULT 'newest' CHECK (default_sort IN ('newest','highest','helpful')),
  theme          TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')),
  show_form      INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id                TEXT PRIMARY KEY,
  site_id           TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  product_id        TEXT NOT NULL,               -- CMS item id of the reviewed product (or any stable string)
  product_name      TEXT NOT NULL DEFAULT '',
  author_name       TEXT NOT NULL,
  email_hash        TEXT NOT NULL DEFAULT '',    -- HMAC of the lower-cased email; the raw email is never stored
  rating            INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title             TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','removed')),
  flagged           INTEGER NOT NULL DEFAULT 0,  -- "flagged" sub-status of pending
  spam_score        INTEGER NOT NULL DEFAULT 0,
  spam_reasons      TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  verified_purchase INTEGER NOT NULL DEFAULT 0,
  helpful_count     INTEGER NOT NULL DEFAULT 0,
  cms_item_id       TEXT,
  owner_reply       TEXT NOT NULL DEFAULT '',
  owner_reply_at    TEXT,
  ip_hash           TEXT NOT NULL DEFAULT '',
  body_hash         TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_reviews_site_product ON reviews(site_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(site_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_cms ON reviews(cms_item_id);
CREATE INDEX IF NOT EXISTS idx_reviews_body_hash ON reviews(site_id, body_hash);

-- Work queue for the moderation panel: one row per review awaiting a decision.
CREATE TABLE IF NOT EXISTS moderation_queue (
  review_id  TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
  site_id    TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  spam_score INTEGER NOT NULL DEFAULT 0,
  reasons    TEXT NOT NULL DEFAULT '[]',
  flagged    INTEGER NOT NULL DEFAULT 0,
  queued_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_queue_site ON moderation_queue(site_id, flagged, queued_at);

CREATE TABLE IF NOT EXISTS vote_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  review_id    TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  voter_id     TEXT NOT NULL,                  -- id from the signed rw_voter cookie
  client_token TEXT NOT NULL DEFAULT '',       -- localStorage token sent by the widget
  ip_hash      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(review_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_review_ip ON vote_log(review_id, ip_hash);

-- Pre-authorized verified purchases pushed by an external order system.
CREATE TABLE IF NOT EXISTS verifications (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  email_hash  TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  order_id    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  consumed_at TEXT,
  review_id   TEXT,
  UNIQUE(site_id, email_hash, product_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_verifications_lookup ON verifications(site_id, email_hash, product_id, consumed_at);

-- Signed, expiring review-request links (single use).
CREATE TABLE IF NOT EXISTS review_requests (
  id           TEXT PRIMARY KEY,
  site_id      TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  author_name  TEXT NOT NULL DEFAULT '',
  email_hash   TEXT NOT NULL DEFAULT '',
  order_id     TEXT NOT NULL DEFAULT '',
  verified     INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,                  -- ISO 8601 UTC
  used_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
