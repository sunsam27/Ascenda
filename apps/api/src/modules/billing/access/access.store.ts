import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ascenda/db';
import type { PlanAccessPolicy, OrganisationAccessControl, AdminOrganisationSubscription } from '@ascenda/types';
import { defaultPolicy } from './access.domain';
type Tx=Prisma.TransactionClient;
@Injectable()
export class SubscriptionAccessStore {
  async policy(tx:Tx,planId:string,isFree:boolean):Promise<PlanAccessPolicy> {
    const [row]=await tx.$queryRaw<PlanAccessPolicy[]>`SELECT "planId","enabledFeatures","trialDays","trialFeatures","defaultDemoDays" FROM plan_feature_policies WHERE "planId"=${planId}`;
    return row ?? defaultPolicy(planId,isFree);
  }
  async control(tx:Tx,organisationId:string):Promise<OrganisationAccessControl|null> {
    const [row]=await tx.$queryRaw<(Omit<OrganisationAccessControl,'manualUntil'|'demoExpiresAt'|'trialStartedAt'> & {manualUntil:Date|null;demoExpiresAt:Date|null;trialStartedAt:Date|null})[]>`SELECT "organisationId","manualState","manualUntil","demoFeatures","demoExpiresAt","trialStartedAt" FROM organisation_access_controls WHERE "organisationId"=${organisationId}`;
    return row ? {...row,manualUntil:row.manualUntil?.toISOString()??null,demoExpiresAt:row.demoExpiresAt?.toISOString()??null,trialStartedAt:row.trialStartedAt?.toISOString()??null}:null;
  }
  async savePolicy(tx:Tx,policy:PlanAccessPolicy,actor:string) {
    await tx.$executeRaw`INSERT INTO plan_feature_policies("planId","enabledFeatures","trialDays","trialFeatures","defaultDemoDays","updatedBy")
      VALUES(${policy.planId},${JSON.stringify(policy.enabledFeatures)}::jsonb,${policy.trialDays},${JSON.stringify(policy.trialFeatures)}::jsonb,${policy.defaultDemoDays},${actor})
      ON CONFLICT("planId") DO UPDATE SET "enabledFeatures"=EXCLUDED."enabledFeatures","trialDays"=EXCLUDED."trialDays","trialFeatures"=EXCLUDED."trialFeatures","defaultDemoDays"=EXCLUDED."defaultDemoDays","updatedBy"=EXCLUDED."updatedBy","updatedAt"=now()`;
  }
  async saveControl(tx:Tx,control:OrganisationAccessControl,actor:string) {
    await tx.$executeRaw`INSERT INTO organisation_access_controls("organisationId","manualState","manualUntil","demoFeatures","demoExpiresAt","updatedBy")
      VALUES(${control.organisationId},${control.manualState},${control.manualUntil?new Date(control.manualUntil):null},${JSON.stringify(control.demoFeatures)}::jsonb,${control.demoExpiresAt?new Date(control.demoExpiresAt):null},${actor})
      ON CONFLICT("organisationId") DO UPDATE SET "manualState"=EXCLUDED."manualState","manualUntil"=EXCLUDED."manualUntil","demoFeatures"=EXCLUDED."demoFeatures","demoExpiresAt"=EXCLUDED."demoExpiresAt","updatedBy"=EXCLUDED."updatedBy","updatedAt"=now()`;
  }
  initialiseTrial(tx:Tx) {return tx.$executeRaw`SELECT initialise_organisation_trial()`;}
  async organisations(tx:Tx,search:string,page:number,pageSize:number) {
    const rows=await tx.$queryRaw<(AdminOrganisationSubscription&{total:bigint})[]>`SELECT * FROM subscription_admin_organisations(${search},${pageSize},${(page-1)*pageSize})`;
    const total=Number(rows[0]?.total??0);
    return {data:rows.map(({total:_total,...row})=>row),meta:{page,pageSize,total,totalPages:Math.ceil(total/pageSize)}};
  }
}
