'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ProductFeature, SubscriptionAccess } from '@ascenda/types';
import { api } from './api';
const Context=createContext<{access:SubscriptionAccess|null;loading:boolean;error:boolean}>({access:null,loading:true,error:false});
export const useSubscriptionAccess=()=>useContext(Context);
export function SubscriptionAccessProvider({children}:{children:React.ReactNode}) {
  const [access,setAccess]=useState<SubscriptionAccess|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState(false);
  useEffect(()=>{
    let active=true;let pending:AbortController|null=null;
    const load=()=>{pending?.abort();pending=new AbortController();const controller=pending;
      api.get<{data:SubscriptionAccess}>('/billing/access',{signal:controller.signal}).then(({data})=>{if(active&&!controller.signal.aborted){setAccess(data.data);setError(false);}})
        .catch(()=>{if(active&&!controller.signal.aborted)setError(true);}).finally(()=>{if(active&&!controller.signal.aborted)setLoading(false);});};
    load();const timer=window.setInterval(load,60000);window.addEventListener('focus',load);
    return()=>{active=false;pending?.abort();window.clearInterval(timer);window.removeEventListener('focus',load);};
  },[]);
  return <Context.Provider value={{access,loading,error}}>{children}</Context.Provider>;
}
export function WorkspaceAccessBoundary({children}:{children:React.ReactNode}) {
  const {access,loading,error}=useSubscriptionAccess();const path=usePathname();
  const features:Record<string,ProductFeature>={people:'people','time-leave':'timeLeave',documents:'documents',payroll:'payroll',payments:'payments',analytics:'analytics'};
  const feature=features[path.split('/')[1]??''];
  if(!feature)return <>{children}</>;
  if(loading)return <p role="status">Checking workspace access…</p>;
  if(error||!access)return <section><h1>Access could not be verified</h1><p>Please refresh or contact your organisation Owner.</p><Link href="/settings/subscription">Subscription details</Link></section>;
  if(!access.features[feature])return <section><h1>Feature unavailable</h1><p>Your current subscription or demo does not include this feature. Ask your organisation Owner about upgrading or requesting a demo.</p><Link href="/settings/subscription">Subscription details</Link><p><Link href="/me/payslips">Historical payslips</Link></p></section>;
  return <>{children}</>;
}
export function SubscriptionStatusBanner() {
  const {access}=useSubscriptionAccess();if(!access?.enforcementEnabled)return null;
  if(!access.readOnly&&access.state!=='GRACE'&&!access.demoExpiresAt)return null;
  return <div role="status" className="subscription-notice">
    {access.readOnly?'This workspace is read-only. Contact your Owner to renew or restore access.':access.state==='GRACE'?`Renewal is overdue. Grace access ends ${new Date(access.graceEndsAt!).toLocaleString()}.`:`Temporary feature access ends ${new Date(access.demoExpiresAt!).toLocaleString()}.`}
    {' '}<Link href="/settings/subscription">Subscription details</Link>{' · '}<Link href="/me/payslips">Historical payslips</Link>
  </div>;
}
