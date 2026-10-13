import {useEffect, useState} from 'react';
export const ringtones = [
  {id:'chime',name:'Chime'}, {id:'ripple',name:'Ripple'},
  {id:'marimba',name:'Marimba'}, {id:'classic',name:'Classic Bell'},
] as const;
export type RingPreference={id:string;volume:number};
const fallback:RingPreference={id:'chime',volume:0.65};
export function normalizeRingtone(value:unknown):RingPreference {
  const v=value as Partial<RingPreference>|null;
  return {id:ringtones.some(r=>r.id===v?.id)||v?.id==='silent'?v!.id!:fallback.id,
    volume:typeof v?.volume==='number'&&Number.isFinite(v.volume)?Math.max(0,Math.min(1,v.volume)):fallback.volume};
}
const key=(user:string)=>`logisticall.ringtone.${user}`;
export function readRingtone(user:string):RingPreference {
  try{return normalizeRingtone(JSON.parse(localStorage.getItem(key(user))||'null'));}catch{return {...fallback};}
}
export function saveRingtone(user:string,value:RingPreference) {
  localStorage.setItem(key(user),JSON.stringify(normalizeRingtone(value)));
  window.dispatchEvent(new Event('logisticall-ringtone'));
}
export function useRingtone(user='') {
  const [value,setValue]=useState(()=>readRingtone(user));
  useEffect(()=>{const refresh=()=>setValue(readRingtone(user));refresh();
    window.addEventListener('storage',refresh);window.addEventListener('logisticall-ringtone',refresh);
    return()=>{window.removeEventListener('storage',refresh);window.removeEventListener('logisticall-ringtone',refresh);};
  },[user]);
  return value;
}
export function ringtoneUrl(id:string){return `/ringtones/${normalizeRingtone({id}).id}.wav`;}
