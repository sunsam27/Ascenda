import {
  buildApprovalPlan,
  canActOnStep,
  computeDueAt,
  isFinalStep,
  isOverdue,
} from './approval';

describe('approval', () => {
  describe('buildApprovalPlan', () => {
    it('plans manager then HR when HR is requested', () => {
      const plan = buildApprovalPlan({
        managerUserId: 'mgr',
        hrUserId: 'hr',
        requiresApproval: true,
        requireHrApproval: true,
        escalateAfterMinutes: 2880,
      });
      expect(plan).toEqual([
        { stepOrder: 0, approverId: 'mgr', escalateAfterMinutes: 2880 },
        { stepOrder: 1, approverId: 'hr', escalateAfterMinutes: 2880 },
      ]);
    });

    it('plans only the manager when HR is not requested (LVE-02 optional HR)', () => {
      const plan = buildApprovalPlan({
        managerUserId: 'mgr',
        hrUserId: 'hr',
        requiresApproval: true,
      });
      expect(plan.map((s) => s.approverId)).toEqual(['mgr']);
    });

    it('falls back to HR when the worker has no manager', () => {
      const plan = buildApprovalPlan({
        managerUserId: null,
        hrUserId: 'hr',
        requiresApproval: true,
      });
      expect(plan.map((s) => s.approverId)).toEqual(['hr']);
    });

    it('collapses a duplicate approver (manager is also HR)', () => {
      const plan = buildApprovalPlan({
        managerUserId: 'same',
        hrUserId: 'same',
        requiresApproval: true,
        requireHrApproval: true,
      });
      expect(plan).toHaveLength(1);
      expect(plan[0]?.approverId).toBe('same');
    });

    it('returns an empty plan when approval is not required (auto-approve)', () => {
      const plan = buildApprovalPlan({
        managerUserId: 'mgr',
        hrUserId: 'hr',
        requiresApproval: false,
      });
      expect(plan).toEqual([]);
    });
  });

  describe('isFinalStep', () => {
    it('is true for the last index only', () => {
      expect(isFinalStep(0, 1)).toBe(true);
      expect(isFinalStep(0, 2)).toBe(false);
      expect(isFinalStep(1, 2)).toBe(true);
      expect(isFinalStep(0, 0)).toBe(false);
    });
  });

  describe('computeDueAt / isOverdue', () => {
    it('adds the window in minutes', () => {
      const from = new Date('2026-01-01T09:00:00.000Z');
      expect(computeDueAt(from, 60)).toEqual(
        new Date('2026-01-01T10:00:00.000Z'),
      );
    });

    it('is null when no window is configured', () => {
      const from = new Date('2026-01-01T09:00:00.000Z');
      expect(computeDueAt(from, null)).toBeNull();
      expect(computeDueAt(from, 0)).toBeNull();
    });

    it('detects overdue deadlines', () => {
      const now = new Date('2026-01-01T12:00:00.000Z');
      expect(isOverdue(new Date('2026-01-01T11:00:00.000Z'), now)).toBe(true);
      expect(isOverdue(new Date('2026-01-01T13:00:00.000Z'), now)).toBe(false);
      expect(isOverdue(null, now)).toBe(false);
    });
  });

  describe('canActOnStep', () => {
    const step = {
      approverId: 'mgr',
      delegatedToId: null as string | null,
      escalatedToId: null as string | null,
      escalatedAt: null as Date | null,
    };

    it('lets the assigned approver act', () => {
      expect(canActOnStep(step, 'mgr')).toBe(true);
      expect(canActOnStep(step, 'someone')).toBe(false);
    });

    it('transfers authority to the delegate', () => {
      expect(canActOnStep({ ...step, delegatedToId: 'dep' }, 'mgr')).toBe(false);
      expect(canActOnStep({ ...step, delegatedToId: 'dep' }, 'dep')).toBe(true);
    });

    it('hands over to the escalation target once escalated', () => {
      const escalated = {
        ...step,
        escalatedToId: 'boss',
        escalatedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      expect(canActOnStep(escalated, 'mgr')).toBe(false);
      expect(canActOnStep(escalated, 'boss')).toBe(true);
    });
  });
});
