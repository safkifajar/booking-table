// Type definitions reflecting Postgres schema (snake_case).
// Mirror dari src/lib/db/schema/* (Drizzle camelCase fields) — translation
// layer di queries.ts & admin.ts maps Drizzle → snake_case match these types.

export type SessionStatus =
  | "reserved"
  | "open"
  | "locked"
  | "closed"
  | "cancelled";
export type SessionVisibility = "public" | "friends" | "invite_only";
export type MemberRole = "host" | "member" | "guest";
export type MemberStatus = "pending" | "joined" | "left" | "kicked";
export type TableShape = "round" | "square" | "rect" | "booth";
export type OrderStatus = "open" | "submitted" | "preparing" | "served" | "closed";
export type OrderItemStatus = "draft" | "sent" | "preparing" | "served" | "void";
export type PaymentMethod = "qris" | "cash" | "card" | "gopay" | "ovo" | "mock";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";
export type SplitMode = "equal" | "itemized" | "custom";
export type StaffRole = "waiter" | "manager" | "admin";

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  phone: string | null;
  hobbies: string[];
  created_at: string;
}

export interface Bar {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  address: string | null;
  logo_url: string | null;
  cover_url: string | null;
  theme: Record<string, string>;
  opening_hours: Record<string, string>;
  created_at: string;
}

export interface FloorArea {
  id: string;
  bar_id: string;
  name: string;
  slug: string;
  canvas_width: number;
  canvas_height: number;
  background_url: string | null;
  sort_order: number;
  created_at: string;
}

export interface BarTable {
  id: string;
  area_id: string;
  label: string;
  shape: TableShape;
  capacity: number;
  pos_x: number;
  pos_y: number;
  /** Draft posisi (floor editor, belum publish). Hanya diisi di query editor. */
  draft_pos_x?: number | null;
  draft_pos_y?: number | null;
  width: number;
  height: number;
  rotation: number;
  is_active: boolean;
  min_spend: number | null;
  created_at: string;
}

export interface TableSession {
  id: string;
  table_id: string;
  host_id: string;
  status: SessionStatus;
  visibility: SessionVisibility;
  title: string | null;
  vibe_tags: string[];
  max_guests: number | null;
  started_at: string;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface SessionMember {
  id: string;
  session_id: string;
  profile_id: string;
  role: MemberRole;
  status: MemberStatus;
  joined_at: string;
  left_at: string | null;
}

export interface SessionInvite {
  id: string;
  session_id: string;
  code: string;
  created_by: string;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  created_at: string;
}

export interface MenuCategory {
  id: string;
  bar_id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  tags: string[];
  is_available: boolean;
  prep_minutes: number;
  sort_order: number;
  created_at: string;
}

export interface Order {
  id: string;
  session_id: string;
  status: OrderStatus;
  created_at: string;
  closed_at: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  added_by_member_id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  status: OrderItemStatus;
  created_at: string;
  served_at: string | null;
}

export interface Payment {
  id: string;
  order_id: string;
  paid_by_member_id: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  split_mode: SplitMode;
  split_meta: Record<string, unknown>;
  paid_at: string | null;
  external_ref: string | null;
  created_at: string;
}

// View shapes
export interface ActiveSessionView {
  id: string;
  table_id: string;
  table_label: string;
  area_id: string;
  area_name: string;
  status: SessionStatus;
  visibility: SessionVisibility;
  title: string | null;
  vibe_tags: string[];
  host_id: string;
  host_name: string;
  host_avatar: string | null;
  started_at: string;
  /** Waktu mulai reservasi (ISO). Hanya terisi saat status 'reserved'. */
  reservation_at: string | null;
  /** Waktu selesai reservasi (ISO). Hanya terisi saat status 'reserved'. */
  reservation_end_at: string | null;
  member_count: number;
  table_capacity: number;
}

// Ratings
export interface MemberRating {
  id: string;
  session_id: string;
  rater_id: string;
  ratee_id: string;
  stars: number;
  tags: string[];
  created_at: string;
}

export interface UserRatingSummary {
  avg_stars: number;
  rating_count: number;
  top_tags: string[] | null;
}

export interface RatableMember {
  member_id: string;
  profile_id: string;
  display_name: string;
  avatar_url: string | null;
  already_rated: boolean;
}

// Composite types used in UI
export interface TableWithSession extends BarTable {
  active_session: ActiveSessionView | null;
}

export interface SessionMemberWithProfile extends SessionMember {
  profile: Profile;
}

export interface OrderItemWithDetails extends OrderItem {
  menu_item: MenuItem;
  added_by: SessionMemberWithProfile;
}
