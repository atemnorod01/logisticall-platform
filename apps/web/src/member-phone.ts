export function formatMemberPhone(value:string){
 const n=value.replace(/\D/g,'');
 return /^1\d{10}$/.test(n)?`+1 (${n.slice(1,4)}) ${n.slice(4,7)}-${n.slice(7)}`:value;
}
