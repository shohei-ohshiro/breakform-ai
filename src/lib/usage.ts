import { SupabaseClient } from "@supabase/supabase-js";

const FREE_MONTHLY_LIMIT = 3;

/**
 * Get current month string in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Check if user can perform analysis (within free limit or has paid plan)
 */
export async function checkUsageLimit(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  // Check if user has paid subscription
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .single();

  if (
    subscription &&
    subscription.status === "active" &&
    subscription.plan !== "free"
  ) {
    return { allowed: true, remaining: -1, limit: -1 }; // unlimited
  }

  // Check free tier usage
  const month = getCurrentMonth();
  const { data: usage } = await supabase
    .from("usage_counts")
    .select("analysis_count")
    .eq("user_id", userId)
    .eq("month", month)
    .single();

  const currentCount = usage?.analysis_count ?? 0;
  const remaining = FREE_MONTHLY_LIMIT - currentCount;

  return {
    allowed: remaining > 0,
    remaining: Math.max(0, remaining),
    limit: FREE_MONTHLY_LIMIT,
  };
}

/**
 * Increment usage count for the current month
 */
export async function incrementUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const month = getCurrentMonth();

  const { data: existing } = await supabase
    .from("usage_counts")
    .select("id, analysis_count")
    .eq("user_id", userId)
    .eq("month", month)
    .single();

  if (existing) {
    await supabase
      .from("usage_counts")
      .update({ analysis_count: existing.analysis_count + 1 })
      .eq("id", existing.id);
  } else {
    await supabase.from("usage_counts").insert({
      user_id: userId,
      month,
      analysis_count: 1,
    });
  }
}
