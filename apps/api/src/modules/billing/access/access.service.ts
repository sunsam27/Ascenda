import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, type Prisma } from '@ascenda/db';
import { PRODUCT_FEATURES, type SubscriptionAccess, type OrganisationAccessControl, type ProductFeature } from '@ascenda/types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { getRequestContext } from '../../../common/context/request-context';
import { SubscriptionAccessStore } from './access.store';
import { PlanNotificationStore } from '../../plans/plan-notification.store';
import { defaultPolicy, evaluateAccess, extendDate, featureFlags } from './access.domain';
import { OrganisationAccessDto, PlanAccessDto } from './access.dto';

@Injectable()
export class SubscriptionAccessService {
  constructor(private readonly prisma:PrismaService,private readonly store:SubscriptionAccessStore,
    private readonly config:ConfigService,private readonly audit:PlanNotificationStore) {}
  enabled() {return this.config.get<string>('SUBSCRIPTION_ACCESS_ENABLED','false').trim().toLowerCase()==='true';}
  private async storage<T>(fn:()=>Promise<T>):Promise<T> {
    try{return await fn();}catch(error){const e=error as {code?:string;meta?:{code?:string}};
      if(['42P01','42883','42703'].includes(e.meta?.code??'')||['P2021','P2022'].includes(e.code??'')) throw new ServiceUnavailableException('Subscription access storage requires migration 05');
      throw error;
    }
  }
  async snapshot(organisationId:string,userId?:string):Promise<SubscriptionAccess> {
    return this.storage(()=>this.prisma.withContext({organisationId,userId},tx=>this.snapshotIn(tx,organisationId)));
  }
  async snapshotIn(tx:Prisma.TransactionClient,organisationId:string):Promise<SubscriptionAccess> {
    const sub=await tx.subscription.findUnique({where:{organisationId},include:{plan:true}});
    const plan=sub?{id:sub.plan.id,name:sub.plan.name,isFree:sub.plan.isFree||sub.plan.priceMinorUnits===0}:null;
    const policy=plan ? this.enabled()?await this.store.policy(tx,plan.id,plan.isFree):defaultPolicy(plan.id,plan.isFree):null;
    const control=this.enabled()?await this.store.control(tx,organisationId):null;
    return evaluateAccess({organisationId,plan,policy,control,status:sub?.status??null,periodEnd:sub?.currentPeriodEnd?.toISOString()??null,enforcementEnabled:this.enabled()});
  }
  async canUse(organisationId:string,feature:ProductFeature,userId?:string) {return !this.enabled()||(await this.snapshot(organisationId,userId)).features[feature];}
  async initialiseTrial(tx:Prisma.TransactionClient) {if(this.enabled()) await this.store.initialiseTrial(tx);}
  async planPolicies() {
    return this.storage(()=>this.prisma.withRequestContext(async tx=>{
      const plans=await tx.plan.findMany({orderBy:[{sortOrder:'asc'},{id:'asc'}]});
      const data=[];
      for(const p of plans) data.push({planId:p.id,planName:p.name,isFree:p.isFree,isActive:p.isActive,policy:await this.store.policy(tx,p.id,p.isFree||p.priceMinorUnits===0)});
      return {data,enforcementEnabled:this.enabled()};
    }));
  }
  async updatePolicy(planId:string,dto:PlanAccessDto) {
    if(dto.trialDays>0&&!PRODUCT_FEATURES.some(k=>dto.trialFeatures[k]))throw new BadRequestException('Select at least one feature for the automatic trial');
    const actor=getRequestContext()?.userId;if(!actor)throw new ForbiddenException('Platform administrator context required');
    return this.storage(()=>this.prisma.withRequestContext(async tx=>{
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(144113,1)`;
      const plan=await tx.plan.findUnique({where:{id:planId}});if(!plan)throw new NotFoundException('Plan not found');
      const before=await this.store.policy(tx,planId,plan.isFree||plan.priceMinorUnits===0);
      const policy={planId,enabledFeatures:featureFlags(dto.enabledFeatures),trialDays:dto.trialDays,trialFeatures:featureFlags(dto.trialFeatures),defaultDemoDays:dto.defaultDemoDays};
      await this.store.savePolicy(tx,policy,actor);
      await this.audit.append(tx,{actorId:actor,planId,action:'PLAN_UPDATED',details:{planName:plan.name,kind:'ACCESS_POLICY_CHANGED',reason:dto.reason,before,after:policy}});
      return {data:policy};
    }));
  }
  async organisations(search:string,page:number,pageSize:number) {
    return this.storage(()=>this.prisma.withRequestContext(tx=>this.store.organisations(tx,search,page,pageSize)));
  }
  async adminDetail(organisationId:string) {
    const actor=getRequestContext()?.userId;
    return this.storage(()=>this.prisma.withContext({organisationId,userId:actor},async tx=>{
      const org=await tx.organisation.findUnique({where:{id:organisationId},select:{id:true,name:true}});
      if(!org)throw new NotFoundException('Organisation not found');
      // Admin inspection remains usable while enforcement is switched off.
      const snapshot=await this.snapshotIn(tx,organisationId);
      if(snapshot.plan){ snapshot.policy=await this.store.policy(tx,snapshot.plan.id,snapshot.plan.isFree);snapshot.control=await this.store.control(tx,organisationId); }
      return {organisation:org,access:snapshot};
    }));
  }
  async updateOrganisation(organisationId:string,dto:OrganisationAccessDto) {
    const ctx=getRequestContext();if(!ctx?.userId)throw new ForbiddenException('Platform administrator context required');
    if(['activate','extend'].includes(dto.action)&&!dto.days)throw new BadRequestException('A finite duration in days is required');
    if(dto.action==='demo'&&(!dto.features||!PRODUCT_FEATURES.some(k=>dto.features![k])))throw new BadRequestException('Select at least one demo feature');
    return this.storage(()=>this.prisma.withContext({organisationId,userId:ctx.userId},async tx=>{
      const found=await tx.$queryRaw<{id:string}[]>`SELECT id FROM organisations WHERE id=${organisationId} FOR UPDATE`;
      if(!found.length)throw new NotFoundException('Organisation not found');
      const sub=await tx.subscription.findUnique({where:{organisationId},include:{plan:true}});
      if(!sub)throw new BadRequestException('Assign a subscription before managing access');
      const before=await this.store.control(tx,organisationId);
      const control:OrganisationAccessControl=before?{...before}:{organisationId,manualState:'AUTO',manualUntil:null,demoFeatures:{},demoExpiresAt:null,trialStartedAt:null};
      let periodEnd=sub.currentPeriodEnd;
      if(dto.action==='suspend'){control.manualState='SUSPENDED';control.manualUntil=null;}
      if(dto.action==='resume'){control.manualState='AUTO';control.manualUntil=null;}
      if(dto.action==='activate'){control.manualState='ACTIVE';control.manualUntil=extendDate(null,dto.days!).toISOString();}
      if(dto.action==='extend'){
        if(sub.plan.isFree||sub.plan.priceMinorUnits===0)throw new BadRequestException('Free plans do not have paid expiry; grant a temporary feature demo instead');
        periodEnd=extendDate(sub.currentPeriodEnd,dto.days!);
        await tx.subscription.update({where:{organisationId},data:{currentPeriodEnd:periodEnd,status:'ACTIVE'}});
      }
      if(dto.action==='demo'){
        const policy=await this.store.policy(tx,sub.planId,sub.plan.isFree||sub.plan.priceMinorUnits===0);
        control.demoFeatures=Object.fromEntries(PRODUCT_FEATURES.filter(k=>dto.features![k]).map(k=>[k,true]));
        control.demoExpiresAt=extendDate(null,dto.days??policy.defaultDemoDays).toISOString();
      }
      if(dto.action==='revoke-demo'){control.demoFeatures={};control.demoExpiresAt=null;}
      await this.store.saveControl(tx,control,ctx.userId!);
      await tx.auditLog.create({data:{organisationId,actorId:ctx.userId!,actorEmail:ctx.userEmail??'',action:AuditAction.PERMISSION_CHANGED,
        targetType:'subscription_access',targetId:organisationId,previousValue:{control:before,periodEnd:sub.currentPeriodEnd?.toISOString()??null} as Prisma.InputJsonValue,
        newValue:{action:dto.action,reason:dto.reason,control,periodEnd:periodEnd?.toISOString()??null,manual:true,noPaymentRecorded:true} as unknown as Prisma.InputJsonValue,
        ipAddress:ctx.ipAddress??'',userAgent:ctx.userAgent??''}});
      return {data:{control,periodEnd:periodEnd?.toISOString()??null}};
    }));
  }
}
