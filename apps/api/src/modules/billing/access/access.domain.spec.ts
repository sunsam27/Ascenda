import { defaultPolicy, evaluateAccess, extendDate, featureFlags, isHistoricalRead, routeFeature } from './access.domain';
const now = new Date('2026-11-17T12:00:00Z');
const input = { organisationId:'org-a',plan:{id:'p',name:'Free',isFree:true},status:'ACTIVE',periodEnd:null,
  policy:defaultPolicy('p',true),control:null,enforcementEnabled:true };
describe('plan capabilities and subscription access',()=>{
  it('defaults Free to core features without payroll, payments or analytics',()=>{
    expect(evaluateAccess(input,now).features).toEqual({people:true,timeLeave:true,documents:true,payroll:false,payments:false,analytics:false});
  });
  it('does not activate enforcement while deployment flag is disabled',()=>{
    expect(evaluateAccess({...input,enforcementEnabled:false},now).features.payroll).toBe(true);
  });
  it('grants only selected features and expires a demo exactly on its boundary',()=>{
    const control={organisationId:'org-a',manualState:'AUTO' as const,manualUntil:null,demoFeatures:{payroll:true},demoExpiresAt:now.toISOString(),trialStartedAt:null};
    expect(evaluateAccess({...input,control},new Date(now.getTime()-1)).features).toMatchObject({payroll:true,payments:false});
    expect(evaluateAccess({...input,control},now).features.payroll).toBe(false);
  });
  it('suspension overrides demos and manual activation',()=>{
    expect(evaluateAccess({...input,control:{organisationId:'org-a',manualState:'SUSPENDED',manualUntil:null,demoFeatures:{payments:true},demoExpiresAt:'2026-12-01T00:00:00Z',trialStartedAt:null}},now)).toMatchObject({state:'SUSPENDED',readOnly:true,features:featureFlags({people:true,timeLeave:true,documents:true})});
  });
  it('allows seven days of grace and restricts an expired paid plan without deleting anything',()=>{
    const paid={...input,plan:{...input.plan,isFree:false},policy:defaultPolicy('p',false),periodEnd:'2026-11-10T12:00:00Z'};
    expect(evaluateAccess(paid,new Date(now.getTime()-1)).state).toBe('GRACE');
    expect(evaluateAccess(paid,now).state).toBe('EXPIRED');
    expect(evaluateAccess(paid,now).readOnly).toBe(true);
  });
  it('never turns a missing or pending subscription into paid access',()=>{
    expect(evaluateAccess({...input,plan:null,policy:null},now).features.payroll).toBe(false);
    expect(evaluateAccess({...input,plan:{...input.plan,isFree:false},status:'PENDING',periodEnd:'2027-01-01',policy:defaultPolicy('p',false)},now).features.payroll).toBe(false);
  });
  it('extends from the later of now or the existing expiry',()=>{
    expect(extendDate(null,14,now).toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(extendDate('2026-12-01T12:00:00Z',7,now).toISOString()).toBe('2026-12-08T12:00:00.000Z');
    expect(()=>extendDate(null,0,now)).toThrow();
  });
  it('classifies nested routes and preserves historical access without bypassing RBAC',()=>{
    expect(routeFeature('/workers/id/compensation')).toBe('payroll');
    expect(routeFeature('/payments/employer-wallet/batches/id/pay')).toBe('payments');
    expect(routeFeature('/billing/access')).toBeNull();
    expect(isHistoricalRead('GET','/payslips/id/pdf')).toBe(true);
    expect(isHistoricalRead('POST','/payroll/runs')).toBe(false);
    expect(isHistoricalRead('GET','/payroll/preview')).toBe(false);
  });
});
