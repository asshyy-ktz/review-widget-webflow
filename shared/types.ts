// Types shared by the server (and mirrored by hand in the vanilla-JS widget and panel).

export type ReviewStatus = "pending" | "approved" | "rejected" | "removed";
export type WidgetLayout = "list" | "carousel";
export type ReviewSort = "newest" | "highest" | "helpful";

export interface InstallationRow {
  site_id: string;
  access_token: string;
  scopes: string;
  public_key: string;
  admin_token: string;
  reviews_collection_id: string | null;
  products_collection_id: string | null;
  field_map: string;
  installed_at: string;
  uninstalled_at: string | null;
}

export interface ReviewRow {
  id: string;
  site_id: string;
  product_id: string;
  product_name: string;
  author_name: string;
  email_hash: string;
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
  flagged: number;
  spam_score: number;
  spam_reasons: string;
  verified_purchase: number;
  helpful_count: number;
  cms_item_id: string | null;
  owner_reply: string;
  owner_reply_at: string | null;
  ip_hash: string;
  body_hash: string;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
}

/** Review shape returned by the public API (no PII, no moderation internals). */
export interface PublicReview {
  id: string;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  helpfulCount: number;
  ownerReply: string;
  ownerReplyAt: string | null;
  createdAt: string;
}

export interface ReviewSummary {
  count: number;
  average: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export interface WidgetConfig {
  preset: string;
  layout: WidgetLayout;
  starColor: string;
  cardsPerRow: number;
  pageSize: number;
  defaultSort: ReviewSort;
  theme: "light" | "dark";
  showForm: boolean;
}

export interface SpamResult {
  score: number;
  flagged: boolean;
  reasons: string[];
}

export interface ReviewSubmission {
  productId: string;
  productName?: string;
  authorName: string;
  email?: string;
  rating: number;
  title: string;
  body: string;
}

export interface ReviewRequestPayload {
  r: string; // review_requests.id
  s: string; // site id
  exp: number; // epoch ms
}

export type FieldKey =
  | "authorName" | "rating" | "title" | "body" | "product"
  | "status" | "helpfulCount" | "verifiedPurchase" | "ownerReply";
export type FieldMap = Partial<Record<FieldKey, string>>;
