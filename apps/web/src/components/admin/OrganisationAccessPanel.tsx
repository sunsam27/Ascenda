'use client';
import { useEffect,useState } from 'react';
import { api } from '@/lib/api';
import { PRODUCT_FEATURES,type AdminOrganisationSubscription,type FeatureAccess,type SubscriptionAccess } from '@ascenda/types';
import StepUpDialog from '@/components/payroll/StepUpDialog';
import { FeatureCheckboxes } from './FeatureCheckboxes';
import styles from './admin.module.css';
type Action='suspend'|'activate'|'extend'|'demo'|'revoke-demo'|'resume';
export default function OrganisationAccessPanel(){
  const [rows,setRows]=useState<AdminOrganisationSubscription[]>([]);const [page,setPage]=useState(1);const [total,setTotal]=useState(0);const [search,setSearch]=useState('');const [filter,setFilter]=useState('');
  const [selected,setSelected]=useState('');const [detail,setDetail]=useState<SubscriptionAccess|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [attempt,setAttempt]=useState(0);
  const [action,setAction]=useState<Action>('demo');const [days,setDays]=useState(14);const [features,setFeatures]=useState<FeatureAccess>({people:false,timeLeave:false,documents:false,payroll:true,payments:false,analytics:false});
  const [reason,setReason]=useState('');const [pending,setPending]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');api.get<{data:AdminOrganisationSubscription[];meta:{total:number}}>('/admin/access/organisations',{params:{page,pageSize:25,search:filter},signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted){setRows(data.data);setTotal(data.meta.total);}}).catch(()=>{if(!controller.signal.aborted)setError('Organisation subscriptions could not be loaded. Confirm migration 05 is installed.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[page,filter,attempt]);
  useEffect(()=>{if(!selected)return;const controller=new AbortController();setDetail(null);api.get<{access:SubscriptionAccess}>(`/admin/access/organisations/${selected}`,{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted){setDetail(data.access);setDays(data.access.policy?.defaultDemoDays??14);}}).catch(()=>{if(!controller.signal.aborted)setError('The selected organisation could not be loaded.');});return()=>controller.abort();},[selected,attempt]);
  async function save(token:string){setBusy(true);setError('');setNotice('');try{
    await api.patch(`/admin/access/organisations/${selected}`,{action,reason,...(['demo','activate','extend'].includes(action)?{days}:{}),...(action==='demo'?{features}:{})},{headers:{'x-step-up-token':token}});
    setNotice('Organisation access updated and audited. No payment or automatic charge was recorded.');setReason('');setAttempt(n=>n+1);
  }catch{setError('Access could not be changed. Check the duration, subscription and administrator permissions. Free plans have no paid expiry to extend.');}finally{setBusy(false);setPending(false);}}
  return <div className={styles.page}><header><h1>Organisation subscriptions</h1><p className={styles.subtitle}>Finite demo grants, manual activation/suspension and paid-expiry extensions. No automatic charges.</p></header>
    <form className={styles.accessForm} onSubmit={event=>{event.preventDefault();setPage(1);setFilter(search);setSelected('');setDetail(null);}}><label>Search organisations<input value={search} maxLength={100} onChange={event=>setSearch(event.target.value)}/></label><button type="submit">Search</button></form>
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setAttempt(n=>n+1)}>Try again</button></p>}{notice&&<p role="status">{notice}</p>}
    {loading?<p role="status">Loading subscriptions…</p>:<><div className={styles.table}><table><thead><tr><th scope="col">Organisation</th><th scope="col">Plan</th><th scope="col">Stored billing status</th><th scope="col">Paid period end</th><th scope="col">Manage</th></tr></thead><tbody>{rows.map(row=><tr key={row.organisationId}><td>{row.organisationName}</td><td>{row.planName??'None'}</td><td>{row.status??'None'}</td><td>{row.currentPeriodEnd?new Date(row.currentPeriodEnd).toLocaleDateString():'Not applicable'}</td><td><button type="button" disabled={pending||busy} onClick={()=>{setSelected(row.organisationId);setNotice('');setReason('');}}>Manage access</button></td></tr>)}</tbody></table></div><div className={styles.pagination}><button type="button" disabled={page===1||pending||busy} onClick={()=>setPage(n=>n-1)}>Previous</button><span>Page {page} · {total} organisations</span><button type="button" disabled={page*25>=total||pending||busy} onClick={()=>setPage(n=>n+1)}>Next</button></div></>}
    {selected&&!detail&&!error&&<p role="status">Loading selected organisation…</p>}
    {detail&&<section className={`${styles.card} ${styles.accessForm}`}><h2>{rows.find(row=>row.organisationId===selected)?.organisationName??'Organisation access'}</h2><p>Effective state: {detail.state}. Manual control: {detail.control?.manualState??'AUTO'}.</p>
      {!detail.enforcementEnabled&&<p>Enforcement is OFF. Changes are stored but customer restrictions require SUBSCRIPTION_ACCESS_ENABLED=true after migration 05.</p>}
      {detail.control?.demoExpiresAt&&<p>Recorded demo expiry: {new Date(detail.control.demoExpiresAt).toLocaleString()}</p>}
      {detail.control?.manualUntil&&<p>Manual activation expiry: {new Date(detail.control.manualUntil).toLocaleString()}</p>}
      <label>Action<select value={action} disabled={busy||pending} onChange={event=>setAction(event.target.value as Action)}><option value="demo">Grant selected features temporarily</option><option value="revoke-demo">Revoke temporary feature access</option><option value="suspend">Turn off: suspend new activity</option><option value="activate">Turn on: activate current plan temporarily</option><option value="resume">Restore normal plan and expiry rules</option><option value="extend">Extend paid subscription expiry</option></select></label>
      {['demo','activate','extend'].includes(action)&&<label>Duration in fixed days<input type="number" min={1} max={3650} value={days} disabled={busy||pending} onChange={event=>setDays(Number(event.target.value))}/></label>}
      {action==='demo'&&<FeatureCheckboxes value={features} onChange={setFeatures} disabled={busy||pending} legend="Extra features for this organisation only"/>}
      <p>Suspension takes precedence over demos. Activation enables only the current plan's features; grant a demo to unlock extra modules. Extending a paid period does not lift a manual suspension. Trials/demos expire automatically at their exact timestamp.</p>
      <label>Reason<input value={reason} minLength={5} maxLength={500} disabled={busy||pending} onChange={event=>setReason(event.target.value)}/></label>
      <button type="button" disabled={busy||pending||reason.trim().length<5||(action==='demo'&&!PRODUCT_FEATURES.some(k=>features[k]))} onClick={()=>setPending(true)}>Confirm access change</button>
    </section>}
    <StepUpDialog open={pending} title="Confirm organisation access change" description="This changes one organisation's subscription access and is audited. It does not record a payment or initiate a charge." onCancel={()=>setPending(false)} onVerified={save}/>
  </div>;
}
