/** Keep the same write intent across a timeout, drawer close, or page reload.
 * No request is replayed automatically; the operator must confirm again. */
const storageKey='logisticall.number-console.intents';
type Intent={id:string;fingerprint:string};
function read():Intent[]{try{return JSON.parse(sessionStorage.getItem(storageKey)??'[]') as Intent[];}catch{return [];}}
export function numberIntent(kind:'purchase'|'release',organization:string|null,numbers:string[]){
 const fingerprint=JSON.stringify([kind,organization,[...numbers].sort()]);
 const saved=read(),existing=saved.find(i=>i.fingerprint===fingerprint);if(existing)return existing.id;
 const id=crypto.randomUUID();sessionStorage.setItem(storageKey,JSON.stringify([...saved,{id,fingerprint}].slice(-100)));return id;
}
export function completeNumberIntent(id:string){sessionStorage.setItem(storageKey,JSON.stringify(read().filter(i=>i.id!==id)));}
