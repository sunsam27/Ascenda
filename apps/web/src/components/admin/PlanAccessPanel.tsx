'use client';
import { useEffect,useState } from 'react';
import { api } from '@/lib/api';
import type { PlanAccessPolicy } from '@ascenda/types';
import StepUpDialog from '@/components/payroll/StepUpDialog';
import { FeatureCheckboxes } from './FeatureCheckboxes';
import styles from './admin.module.css';
type Row={planId:string;planName:string;isFree:boolean;isActive:boolean;policy:PlanAccessPolicy};
export default function PlanAccessPanel(){
  const [rows,setRows]=useState<Row[]>([]);const [selected,setSelected]=useState('');const [draft,setDraft]=useState<PlanAccessPolicy|null>(null);
  const [reason,setReason]=useState('');const [pending,setPending]=useState(false);const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [enabled,setEnabled]=useState(false);const [attempt,setAttempt]=useState(0);
  useEffect(()=>{const controller=new AbortController();setError('');api.get<{data:Row[];enforcementEnabled:boolean}>('/admin/access/plans',{signal:controller.signal}).then(({data})=>{if(controller.signal.aborted)return;setRows(data.data);setEnabled(data.enforcementEnabled);setSelected(data.data[0]?.planId??'');setDraft(data.data[0]?.policy??null);})
    .catch(()=>{if(!controller.signal.aborted)setError('Feature policies could not be loaded. Confirm migration 05 is installed.');});return()=>controller.abort();},[attempt]);
  async function save(token:string){if(!draft)return;setBusy(true);setError('');setNotice('');try{
    await api.patch(`/admin/access/plans/${draft.planId}`,{enabledFeatures:draft.enabledFeatures,trialDays:draft.trialDays,trialFeatures:draft.trialFeatures,defaultDemoDays:draft.defaultDemoDays,reason},{headers:{'x-step-up-token':token}});
    setRows(previous=>previous.map(row=>row.planId===draft.planId?{...row,policy:draft}:row));setNotice('Feature policy saved and audited. Existing demos keep their original expiry dates.');setReason('');
  }catch{setError('Policy could not be saved. Check the selected trial features, duration and administrator access.');}finally{setBusy(false);setPending(false);}}
  return <section className={`${styles.card} ${styles.accessForm}`}><h2>Feature access and trial settings</h2>
    <p>These switches control real API access, independently of the marketing feature bullet points above. Staff still need their normal role permissions.</p>
    {!enabled&&<p role="status">Access enforcement is OFF. Install migration 05, review these policies, then enable SUBSCRIPTION_ACCESS_ENABLED on the API.</p>}
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setAttempt(n=>n+1)}>Reload policies</button></p>}
    {notice&&<p role="status">{notice}</p>}
    {draft&&<><label>Plan<select value={selected} disabled={busy||pending} onChange={event=>{setSelected(event.target.value);setDraft(rows.find(row=>row.planId===event.target.value)?.policy??null);setReason('');setNotice('');}}>{rows.map(row=><option key={row.planId} value={row.planId}>{row.planName}{row.isFree?' · Free':''}{!row.isActive?' · Archived':''}</option>)}</select></label>
      <FeatureCheckboxes value={draft.enabledFeatures} legend="Permanent plan access" disabled={busy||pending} onChange={enabledFeatures=>setDraft({...draft,enabledFeatures})}/>
      <label>Automatic premium trial for new free signups (days; 0 disables)<input type="number" min={0} max={365} value={draft.trialDays} disabled={busy||pending} onChange={event=>setDraft({...draft,trialDays:Number(event.target.value)})}/></label>
      <FeatureCheckboxes value={draft.trialFeatures} legend="Extra features during the automatic trial" disabled={busy||pending} onChange={trialFeatures=>setDraft({...draft,trialFeatures})}/>
      <label>Default duration for manually granted demos (days)<input type="number" min={1} max={365} value={draft.defaultDemoDays} disabled={busy||pending} onChange={event=>setDraft({...draft,defaultDemoDays:Number(event.target.value)})}/></label>
      <p>Trial settings apply only to newly provisioned free organisations. When a trial ends, the organisation keeps its permanent free features. Existing customers are not assigned a new trial.</p>
      <label>Reason for change<input value={reason} minLength={5} maxLength={500} disabled={busy||pending} onChange={event=>setReason(event.target.value)}/></label>
      <button type="button" disabled={busy||pending||reason.trim().length<5} onClick={()=>setPending(true)}>Confirm and save feature access</button></>}
    <StepUpDialog open={pending} title="Confirm feature policy change" description="This changes access for organisations using this plan. Existing role permissions remain enforced. The change is audited." onCancel={()=>setPending(false)} onVerified={save}/>
  </section>;
}
