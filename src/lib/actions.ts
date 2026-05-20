"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { generateInviteCode } from "@/lib/utils";
import type { SessionVisibility, MemberRole } from "@/types/db";

// ============================================================
// SCHEMAS
// ============================================================

const openTableSchema = z.object({
  tableId: z.string().uuid(),
  title: z.string().min(1).max(80).optional(),
  visibility: z.enum(["public", "friends", "invite_only"]),
  vibeTags: z.array(z.string()).max(5).optional(),
  maxGuests: z.number().int().positive().optional(),
});

const addOrderItemSchema = z.object({
  sessionId: z.string().uuid(),
  menuItemId: z.string().uuid(),
  quantity: z.number().int().positive().max(20),
  notes: z.string().max(200).optional(),
});

const joinSchema = z.object({
  sessionId: z.string().uuid(),
});

const joinByCodeSchema = z.object({
  code: z.string().min(4).max(12),
});

// ============================================================
// OPEN TABLE
// ============================================================

export async function openTable(input: z.infer<typeof openTableSchema>) {
  const profile = await requireProfile();
  const data = openTableSchema.parse(input);
  const supabase = await createClient();

  // Verify table exists & is active
  const { data: table, error: tErr } = await supabase
    .from("tables")
    .select("id, capacity, is_active")
    .eq("id", data.tableId)
    .maybeSingle();
  if (tErr || !table) throw new Error("Table not found");
  if (!table.is_active) throw new Error("Table is not active");

  // Create session
  const { data: session, error: sErr } = await supabase
    .from("table_sessions")
    .insert({
      table_id: data.tableId,
      host_id: profile.id,
      status: "open",
      visibility: data.visibility,
      title: data.title ?? null,
      vibe_tags: data.vibeTags ?? [],
      max_guests: data.maxGuests ?? table.capacity,
    })
    .select()
    .single();
  if (sErr || !session) {
    throw new Error(
      sErr?.message?.includes("uniq_active_session_per_table")
        ? "Meja ini sudah ada session aktif"
        : sErr?.message ?? "Gagal membuka meja"
    );
  }

  // Add host as first member
  const { error: mErr } = await supabase.from("session_members").insert({
    session_id: session.id,
    profile_id: profile.id,
    role: "host" as MemberRole,
    status: "joined",
  });
  if (mErr) throw new Error(mErr.message);

  // Open an order for this session
  await supabase.from("orders").insert({
    session_id: session.id,
    status: "open",
  });

  // Generate first invite code
  await supabase.from("session_invites").insert({
    session_id: session.id,
    code: generateInviteCode(),
    created_by: profile.id,
  });

  revalidatePath("/bar/[slug]", "page");
  redirect(`/session/${session.id}`);
}

// ============================================================
// JOIN SESSION
// ============================================================

export async function joinSession(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("table_sessions")
    .select("id, status, visibility, host_id, table_id, tables(capacity)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session not found");
  if (session.status !== "open") throw new Error("Session sudah tidak terbuka");

  // Check current member count
  const { count } = await supabase
    .from("session_members")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "joined");

  const cap = Array.isArray(session.tables)
    ? session.tables[0]?.capacity
    : (session.tables as { capacity: number } | null)?.capacity;
  if (count !== null && cap && count >= cap) {
    throw new Error("Meja sudah penuh");
  }

  // Insert as member (idempotent via unique constraint)
  const { error } = await supabase.from("session_members").upsert(
    {
      session_id: sessionId,
      profile_id: profile.id,
      role: "member" as MemberRole,
      status: "joined",
    },
    { onConflict: "session_id,profile_id" }
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/session/${sessionId}`);
  return { ok: true, sessionId };
}

// Request join: insert member dengan status='pending'. Host harus approve dulu.
// Bedanya dengan joinSession (yang langsung joined) — request join dipakai saat
// user akses dari halaman preview tanpa invite code.
export async function requestJoinSession(input: z.infer<typeof joinSchema>) {
  const profile = await requireProfile();
  const { sessionId } = joinSchema.parse(input);
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("table_sessions")
    .select("id, status, host_id, table_id, tables(capacity)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session tidak ditemukan");
  if (session.status !== "open") throw new Error("Session sudah tidak terbuka");
  if (session.host_id === profile.id) {
    throw new Error("Kamu adalah host, tidak perlu request");
  }

  // Cek kapasitas (count yang joined saja)
  const { count } = await supabase
    .from("session_members")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "joined");

  const cap = Array.isArray(session.tables)
    ? session.tables[0]?.capacity
    : (session.tables as { capacity: number } | null)?.capacity;
  if (count !== null && cap && count >= cap) {
    throw new Error("Meja sudah penuh");
  }

  // Cek apakah sudah ada request/membership sebelumnya
  const { data: existing } = await supabase
    .from("session_members")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (existing) {
    if (existing.status === "joined") {
      return { status: "joined" as const };
    }
    if (existing.status === "pending") {
      return { status: "pending" as const };
    }
    if (existing.status === "kicked") {
      throw new Error("Kamu pernah dikeluarkan dari meja ini oleh host");
    }
    // status 'left' — boleh request lagi
    const { error } = await supabase
      .from("session_members")
      .update({ status: "pending", left_at: null })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("session_members").insert({
      session_id: sessionId,
      profile_id: profile.id,
      role: "member" as MemberRole,
      status: "pending",
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/session/${sessionId}`);
  revalidatePath(`/session/${sessionId}/preview`);
  return { status: "pending" as const };
}

export async function approveJoinRequest(memberId: string, sessionId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("table_sessions")
    .select("host_id, tables(capacity)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session tidak ditemukan");
  if (session.host_id !== profile.id) {
    throw new Error("Hanya host yang bisa approve");
  }

  const { count } = await supabase
    .from("session_members")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("status", "joined");

  const cap = Array.isArray(session.tables)
    ? session.tables[0]?.capacity
    : (session.tables as { capacity: number } | null)?.capacity;
  if (count !== null && cap && count >= cap) {
    throw new Error("Meja sudah penuh, request tidak bisa di-approve");
  }

  const { error } = await supabase
    .from("session_members")
    .update({ status: "joined", joined_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("session_id", sessionId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  revalidatePath(`/session/${sessionId}`);
}

export async function rejectJoinRequest(memberId: string, sessionId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("table_sessions")
    .select("host_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session tidak ditemukan");
  if (session.host_id !== profile.id) {
    throw new Error("Hanya host yang bisa reject");
  }

  const { error } = await supabase
    .from("session_members")
    .delete()
    .eq("id", memberId)
    .eq("session_id", sessionId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  revalidatePath(`/session/${sessionId}`);
}

export async function joinByCode(input: z.infer<typeof joinByCodeSchema>) {
  const profile = await requireProfile();
  const { code } = joinByCodeSchema.parse(input);
  const supabase = await createClient();

  const { data: invite } = await supabase
    .from("session_invites")
    .select("session_id, expires_at, max_uses, use_count")
    .eq("code", code)
    .maybeSingle();
  if (!invite) throw new Error("Kode undangan tidak valid");
  if (new Date(invite.expires_at) < new Date()) {
    throw new Error("Kode undangan sudah kedaluwarsa");
  }
  if (invite.max_uses && invite.use_count >= invite.max_uses) {
    throw new Error("Kode undangan sudah mencapai batas penggunaan");
  }

  await joinSession({ sessionId: invite.session_id });

  // Increment use count (best-effort)
  await supabase
    .from("session_invites")
    .update({ use_count: invite.use_count + 1 })
    .eq("code", code);

  redirect(`/session/${invite.session_id}`);
}

// ============================================================
// LEAVE SESSION
// ============================================================

export async function leaveSession(sessionId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  await supabase
    .from("session_members")
    .update({ status: "left", left_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("profile_id", profile.id);

  revalidatePath(`/session/${sessionId}`);
}

// ============================================================
// CLOSE SESSION (host only)
// ============================================================

export async function closeSession(sessionId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("table_sessions")
    .select("host_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session not found");
  if (session.host_id !== profile.id) throw new Error("Hanya host yang bisa menutup meja");

  await supabase
    .from("table_sessions")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", sessionId);

  await supabase
    .from("orders")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("session_id", sessionId);

  revalidatePath(`/session/${sessionId}`);
  // Host & member diarahkan ke halaman rate — kalau solo, page itu sendiri akan
  // tampilkan empty state dan tombol ke home.
  redirect(`/session/${sessionId}/rate`);
}

export async function leaveSessionAndRate(sessionId: string) {
  // Helper untuk member: leave + langsung ke halaman rate kalau session sudah closed.
  // (Untuk sekarang behavior cukup leave; rate page hanya tersedia setelah host close.)
  await leaveSession(sessionId);
  redirect("/");
}

// ============================================================
// ORDER ITEMS
// ============================================================

export async function addOrderItem(input: z.infer<typeof addOrderItemSchema>) {
  const profile = await requireProfile();
  const data = addOrderItemSchema.parse(input);
  const supabase = await createClient();

  // Find session member record
  const { data: member } = await supabase
    .from("session_members")
    .select("id")
    .eq("session_id", data.sessionId)
    .eq("profile_id", profile.id)
    .eq("status", "joined")
    .maybeSingle();
  if (!member) throw new Error("Kamu bukan anggota meja ini");

  // Find open order
  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("session_id", data.sessionId)
    .neq("status", "closed")
    .maybeSingle();
  if (!order) throw new Error("Order belum dibuka untuk session ini");

  // Get menu item current price (snapshot)
  const { data: item } = await supabase
    .from("menu_items")
    .select("price, is_available")
    .eq("id", data.menuItemId)
    .maybeSingle();
  if (!item) throw new Error("Menu item tidak ditemukan");
  if (!item.is_available) throw new Error("Menu item sedang tidak tersedia");

  const { error } = await supabase.from("order_items").insert({
    order_id: order.id,
    menu_item_id: data.menuItemId,
    added_by_member_id: member.id,
    quantity: data.quantity,
    unit_price: item.price,
    notes: data.notes ?? null,
    status: "sent",
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/session/${data.sessionId}`);
}

export async function removeOrderItem(itemId: string, sessionId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  // Verify ownership (member that added it OR host)
  const { data: item } = await supabase
    .from("order_items")
    .select("id, added_by_member_id, session_members!inner(profile_id)")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) throw new Error("Item tidak ditemukan");

  const { data: session } = await supabase
    .from("table_sessions")
    .select("host_id")
    .eq("id", sessionId)
    .maybeSingle();

  const addedBy = Array.isArray(item.session_members)
    ? item.session_members[0]?.profile_id
    : (item.session_members as { profile_id: string } | null)?.profile_id;

  if (addedBy !== profile.id && session?.host_id !== profile.id) {
    throw new Error("Hanya yang pesan atau host yang bisa hapus item");
  }

  await supabase
    .from("order_items")
    .update({ status: "void" })
    .eq("id", itemId);

  revalidatePath(`/session/${sessionId}`);
}

// ============================================================
// CREATE / REFRESH INVITE CODE
// ============================================================

export async function createInvite(sessionId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const code = generateInviteCode();
  const { data, error } = await supabase
    .from("session_invites")
    .insert({
      session_id: sessionId,
      code,
      created_by: profile.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  revalidatePath(`/session/${sessionId}`);
  return data;
}

// ============================================================
// PAYMENTS (mock for demo)
// ============================================================

const paySchema = z.object({
  sessionId: z.string().uuid(),
  amount: z.number().int().positive(),
  method: z.enum(["qris", "cash", "card", "gopay", "ovo", "mock"]),
  splitMode: z.enum(["equal", "itemized", "custom"]),
  splitMeta: z.record(z.string(), z.unknown()).optional(),
});

export async function payShare(input: z.infer<typeof paySchema>) {
  const profile = await requireProfile();
  const data = paySchema.parse(input);
  const supabase = await createClient();

  const { data: member } = await supabase
    .from("session_members")
    .select("id")
    .eq("session_id", data.sessionId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!member) throw new Error("Bukan member meja ini");

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("session_id", data.sessionId)
    .neq("status", "closed")
    .maybeSingle();
  if (!order) throw new Error("Order tidak terbuka");

  // Demo mode: auto-mark as paid so client sees the end-to-end flow.
  // For production, only 'mock' method auto-pays; real gateways stay pending.
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  const autoPaid = demoMode || data.method === "mock";

  const { error } = await supabase.from("payments").insert({
    order_id: order.id,
    paid_by_member_id: member.id,
    amount: data.amount,
    method: data.method,
    status: autoPaid ? "paid" : "pending",
    split_mode: data.splitMode,
    split_meta: data.splitMeta ?? {},
    paid_at: autoPaid ? new Date().toISOString() : null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/session/${data.sessionId}`);
}

// ============================================================
// AUTH
// ============================================================

export async function signInWithMagicLink(email: string, next?: string) {
  const supabase = await createClient();
  const headers = await import("next/headers").then((m) => m.headers());
  const host = headers.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${protocol}://${host}/auth/callback?next=${encodeURIComponent(next ?? "/")}`,
    },
  });
  if (error) throw new Error(error.message);
}

const signUpSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(6, "Password minimal 6 karakter").max(100),
  displayName: z.string().min(2, "Nama minimal 2 karakter").max(40),
  next: z.string().optional(),
});

const signInSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(6, "Password minimal 6 karakter").max(100),
  next: z.string().optional(),
});

export async function signUpWithPassword(input: z.infer<typeof signUpSchema>) {
  const supabase = await createClient();
  const data = parseOrThrow(signUpSchema, input);

  const { data: result, error } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: { display_name: data.displayName },
    },
  });
  if (error) throw new Error(translateAuthError(error.message));
  if (!result.user) throw new Error("Signup gagal — tidak ada user dibuat");

  // Update profile display_name (trigger sudah set, tapi pastikan)
  await supabase
    .from("profiles")
    .update({ display_name: data.displayName })
    .eq("id", result.user.id);

  // Kalau confirm email OFF, session langsung aktif → redirect.
  // Kalau ON, session null → return info ke caller.
  if (result.session) {
    redirect(data.next ?? "/");
  }
  return { needsEmailConfirm: true };
}

export async function signInWithPassword(input: z.infer<typeof signInSchema>) {
  const supabase = await createClient();
  const data = parseOrThrow(signInSchema, input);

  const { error } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });
  if (error) throw new Error(translateAuthError(error.message));

  redirect(data.next ?? "/");
}

function parseOrThrow<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(first?.message ?? "Input tidak valid");
  }
  return result.data;
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email atau password salah";
  if (m.includes("user already registered")) return "Email sudah terdaftar — coba sign in";
  if (m.includes("email not confirmed")) return "Cek inbox kamu untuk konfirmasi email";
  if (m.includes("password should be at least")) return "Password minimal 6 karakter";
  if (m.includes("rate limit")) return "Terlalu banyak percobaan, coba lagi nanti";
  // Zod validation errors come as JSON arrays — extract first message
  if (msg.startsWith("[") && msg.includes("message")) {
    try {
      const parsed = JSON.parse(msg) as Array<{ message?: string }>;
      const first = parsed[0]?.message;
      if (first) return first;
    } catch {
      /* fallthrough */
    }
  }
  return msg;
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

// ============================================================
// STAFF / WAITER ACTIONS
// ============================================================

async function requireStaff() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("staff_roles")
    .select("role, bar_id")
    .eq("profile_id", profile.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!staff) {
    throw new Error("Akses staff diperlukan");
  }
  return { profile, staff };
}

export async function markOrderItemStatus(
  itemId: string,
  newStatus: "preparing" | "served"
) {
  await requireStaff();
  const supabase = await createClient();

  const patch: { status: "preparing" | "served"; served_at?: string } = {
    status: newStatus,
  };
  if (newStatus === "served") {
    patch.served_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("order_items")
    .update(patch)
    .eq("id", itemId);
  if (error) throw new Error(error.message);

  revalidatePath("/staff");
}

// ============================================================
// RATINGS (member-to-member after session closed)
// ============================================================

const submitRatingSchema = z.object({
  sessionId: z.string().uuid(),
  rateeId: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(30)).max(5).optional(),
});

export async function submitRating(input: z.infer<typeof submitRatingSchema>) {
  const profile = await requireProfile();
  const data = submitRatingSchema.parse(input);

  if (data.rateeId === profile.id) {
    throw new Error("Tidak bisa rate diri sendiri");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("member_ratings").upsert(
    {
      session_id: data.sessionId,
      rater_id: profile.id,
      ratee_id: data.rateeId,
      stars: data.stars,
      tags: data.tags ?? [],
    },
    { onConflict: "session_id,rater_id,ratee_id" }
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/session/${data.sessionId}/rate`);
}

// Demo helper: sign in as anonymous user with a display name
// Useful when client tidak punya email setup, atau untuk demo cepat.
export async function signInAnonymous(displayName: string, next?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInAnonymously({
    options: {
      data: { display_name: displayName },
    },
  });
  if (error) throw new Error(error.message);

  // Update profile display_name (trigger may have set it from metadata already)
  if (data.user) {
    await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", data.user.id);
  }

  redirect(next ?? "/");
}
