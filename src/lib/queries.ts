// Server-side data fetching helpers
import { createClient } from "@/lib/supabase/server";
import type {
  Bar,
  FloorArea,
  BarTable,
  ActiveSessionView,
  MenuCategory,
  MenuItem,
} from "@/types/db";

export async function getBarBySlug(slug: string): Promise<Bar | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bars")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function getFloorAreas(barId: string): Promise<FloorArea[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("floor_areas")
    .select("*")
    .eq("bar_id", barId)
    .order("sort_order");
  return data ?? [];
}

export async function getTablesByArea(areaId: string): Promise<BarTable[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tables")
    .select("*")
    .eq("area_id", areaId)
    .eq("is_active", true)
    .order("label");
  return data ?? [];
}

export async function getActiveSessionsByBar(
  barId: string
): Promise<ActiveSessionView[]> {
  const supabase = await createClient();
  // Use the view v_active_sessions, joined by bar via floor_areas
  const { data } = await supabase
    .from("v_active_sessions")
    .select("*, tables!inner(area_id, floor_areas!inner(bar_id))")
    .eq("tables.floor_areas.bar_id", barId);
  return (data ?? []) as ActiveSessionView[];
}

export async function getActiveSessionsForArea(
  areaId: string
): Promise<ActiveSessionView[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_active_sessions")
    .select("*")
    .eq("area_id", areaId);
  return (data ?? []) as ActiveSessionView[];
}

export async function getMenuByBar(
  barId: string
): Promise<Array<MenuCategory & { items: MenuItem[] }>> {
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("menu_categories")
    .select("*")
    .eq("bar_id", barId)
    .eq("is_active", true)
    .order("sort_order");

  if (!categories) return [];

  const { data: items } = await supabase
    .from("menu_items")
    .select("*")
    .in(
      "category_id",
      categories.map((c) => c.id)
    )
    .order("sort_order");

  return categories.map((cat) => ({
    ...cat,
    items: (items ?? []).filter((i) => i.category_id === cat.id),
  }));
}
