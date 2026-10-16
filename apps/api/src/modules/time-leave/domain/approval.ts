// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL WORKFLOW MATH (PRD LVE-02 / LVE-04)
// Pure functions — no I/O. The leave-request service uses these to plan the
// ordered approval steps, decide when a step is final, and compute escalation
// deadlines. Keeping them pure makes the flow testable without a database.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovalPlanStep {
  stepOrder: number;
  approverId: string;
  /** Minutes the step may sit before it auto-escalates; null disables it. */
  escalateAfterMinutes: number | null;
}

export interface ApprovalPlanInput {
  /** The reporting manager's *user* id, when the worker has one with a login. */
  managerUserId: string | null;
  /** An organisation-level approver (HR admin / owner) *user* id. */
  hrUserId: string | null;
  /** When false the leave type needs no approval at all (auto-approve). */
  requiresApproval: boolean;
  /** Force the HR step even when a manager step is present. */
  requireHrApproval?: boolean;
  /** Default escalation window applied to each active step. */
  escalateAfterMinutes?: number | null;
}

const norm = (minutes: number | null | undefined): number | null =>
  minutes && minutes > 0 ? minutes : null;

/**
 * Build the ordered approval plan for a leave request (LVE-02):
 *   request → manager → (optional HR) → approved.
 *
 * The HR step is included when explicitly requested, or when the worker has no
 * manager (someone must still approve). Duplicate approvers are collapsed so a
 * single person is never asked twice. An empty plan means "auto-approve".
 */
export function buildApprovalPlan(input: ApprovalPlanInput): ApprovalPlanStep[] {
  if (!input.requiresApproval) return [];

  const ids: string[] = [];
  const add = (id: string | null) => {
    if (id && !ids.includes(id)) ids.push(id);
  };

  add(input.managerUserId);
  if (input.requireHrApproval || !input.managerUserId) add(input.hrUserId);

  const minutes = norm(input.escalateAfterMinutes);
  return ids.map((approverId, stepOrder) => ({
    stepOrder,
    approverId,
    escalateAfterMinutes: minutes,
  }));
}

/** True when `stepOrder` is the last step of `total` steps. */
export function isFinalStep(stepOrder: number, total: number): boolean {
  return total > 0 && stepOrder >= total - 1;
}

/** Deadline for a step that became active at `from`, or null when disabled. */
export function computeDueAt(
  from: Date,
  escalateAfterMinutes: number | null | undefined,
): Date | null {
  const minutes = norm(escalateAfterMinutes);
  if (!minutes) return null;
  return new Date(from.getTime() + minutes * 60_000);
}

/** True when a step's deadline has passed relative to `now`. */
export function isOverdue(
  dueAt: Date | null | undefined,
  now: Date,
): boolean {
  return !!dueAt && dueAt.getTime() < now.getTime();
}

/**
 * Who may act on a step: the assigned approver, their delegate once delegated,
 * or the escalation target once escalated.
 */
export function canActOnStep(
  step: {
    approverId: string;
    delegatedToId?: string | null;
    escalatedToId?: string | null;
    escalatedAt?: Date | null;
  },
  userId: string,
): boolean {
  if (step.escalatedAt && step.escalatedToId) {
    return step.escalatedToId === userId;
  }
  if (step.delegatedToId) return step.delegatedToId === userId;
  return step.approverId === userId;
}
