// ─────────────────────────────────────────────────────────────────────────────
// TEAM-SIZE HELPERS
// Pure functions for parsing the signup "team size" value and describing a
// plan's headcount band. Dependency-free so they can be unit-tested in
// isolation. The `Plan` shape is intentionally structural (no package import)
// so this module stays importable without a package graph.
// ─────────────────────────────────────────────────────────────────────────────

export interface TeamSizeBand {
  min: number;
  max: number;
}

/** Structural subset of a plan that describePlanBand needs. */
export interface PlanHeadcount {
  minHeadcount?: number | null;
  maxHeadcount?: number | null;
  maxSeats?: number | null;
}

/** Parse the signup "team size" value (e.g. "1", "21–100", "501+"). */
export function parseTeamSize(value: string): TeamSizeBand {
  const trimmed = value.trim();
  const single = /^(\d+)$/.exec(trimmed);
  if (single) {
    const n = Number(single[1]);
    return { min: n, max: n };
  }
  const range = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(trimmed);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return { min, max: Math.max(min, max) };
  }
  const open = /^(\d+)\s*\+$/.exec(trimmed);
  if (open) {
    return { min: Number(open[1]), max: Number.MAX_SAFE_INTEGER };
  }
  // Unknown format: don't block, treat as unbounded.
  return { min: 1, max: Number.MAX_SAFE_INTEGER };
}

/** Human-readable headcount band for a plan. */
export function describePlanBand(plan: PlanHeadcount): string {
  if (
    plan.minHeadcount != null &&
    plan.maxHeadcount != null &&
    plan.minHeadcount === plan.maxHeadcount
  ) {
    return `${plan.minHeadcount} ${plan.minHeadcount === 1 ? 'person' : 'people'}`;
  }
  if (plan.minHeadcount != null && plan.maxHeadcount != null) {
    return `${plan.minHeadcount}–${plan.maxHeadcount} people`;
  }
  if (plan.minHeadcount != null) {
    return `${plan.minHeadcount}+ people`;
  }
  if (plan.maxHeadcount != null) {
    return `up to ${plan.maxHeadcount} people`;
  }
  if (plan.maxSeats != null) {
    return `up to ${plan.maxSeats} people`;
  }
  return 'any team size';
}