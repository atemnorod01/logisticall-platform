import {useEffect,useRef,useState} from 'react';
import {ringtones,ringtoneUrl,saveRingtone,useRingtone} from './ringtones.js';
export function RingtoneSettings({user}:{user:string}) {
  const value=useRingtone(user),audio=useRef<HTMLAudioElement|null>(null);
  const [playing,setPlaying]=useState(false),[notice,setNotice]=useState('');
  function stop(){audio.current?.pause();audio.current=null;setPlaying(false);}
  useEffect(()=>()=>{audio.current?.pause();},[]);
  useEffect(()=>{stop();},[user,value.id,value.volume]);
  function save(next:typeof value){stop();try{saveRingtone(user,next);setNotice('Saved on this device.');}catch{setNotice('Could not save your ringtone.');}}
  async function preview(){
    if(playing){stop();return;}
    const next=new Audio(ringtoneUrl(value.id));audio.current=next;next.volume=value.volume;
    next.onended=()=>{if(audio.current===next)stop();};setPlaying(true);
    try{await next.play();}catch{if(audio.current===next){stop();setNotice('Could not play sound. Check your audio output.');}}
  }
  return <div className="lc-form lc-ringtone-settings"><h3>Incoming call ringtone</h3>
    <p>Choose the sound for incoming calls on this device.</p>
    <label>Ringtone<select value={value.id} onChange={e=>save({...value,id:e.target.value})}>
      {ringtones.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}<option value="silent">Silent</option>
    </select></label>
    <label>Ringtone volume · {Math.round(value.volume*100)}%<input aria-label="Ringtone volume" type="range" min="0" max="100" value={Math.round(value.volume*100)} onChange={e=>save({...value,volume:Number(e.target.value)/100})}/></label>
    <button className="button" disabled={value.id==='silent'||value.volume===0} onClick={()=>void preview()}>{playing?'Stop preview':'Preview ringtone'}</button>
    <p role="status">{notice}</p>
  </div>;
}
