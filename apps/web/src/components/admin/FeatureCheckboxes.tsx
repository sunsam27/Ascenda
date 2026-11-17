'use client';
import { PRODUCT_FEATURES, type FeatureAccess } from '@ascenda/types';
import styles from './admin.module.css';
export const FEATURE_LABELS:Record<keyof FeatureAccess,string>={people:'People',timeLeave:'Time and leave',documents:'Documents',payroll:'Payroll',payments:'Payments',analytics:'Analytics and reports'};
export function FeatureCheckboxes({value,onChange,legend,disabled=false}:{value:FeatureAccess;onChange:(value:FeatureAccess)=>void;legend:string;disabled?:boolean}){
  return <fieldset className={styles.featureFlags} disabled={disabled}><legend>{legend}</legend>{PRODUCT_FEATURES.map(key=><label key={key}><input type="checkbox" checked={value[key]} onChange={event=>onChange({...value,[key]:event.target.checked})}/>{FEATURE_LABELS[key]}</label>)}</fieldset>;
}
