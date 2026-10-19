/** Stop background-tab traffic and avoid overlapping asynchronous polling callbacks. */
export function visibleInterval(callback:()=>unknown,ms:number):number {
 let running=false;
 return window.setInterval(()=>{if(document.visibilityState==='hidden'||running)return;running=true;Promise.resolve().then(callback).catch(()=>{}).finally(()=>{running=false;});},ms);
}
