import {useState} from 'react';
type SortValue=string|number|null|undefined;
export function useTableSort<T>(items:readonly T[],columns:Record<string,(item:T)=>SortValue>,initialField:string,initialDirection:'asc'|'desc'='asc'){
 const [sort,setSort]=useState({field:initialField,direction:initialDirection});
 const sorted=[...items].sort((a,b)=>{
  const left=columns[sort.field]!(a),right=columns[sort.field]!(b);
  if(left==null||left==='')return right==null||right===''?0:1;
  if(right==null||right==='')return -1;
  const result=typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right),undefined,{numeric:true,sensitivity:'base'});
  return sort.direction==='asc'?result:-result;
 });
 function header(field:string,label:string){
  const active=sort.field===field;
  return <th key={field} aria-sort={active?(sort.direction==='asc'?'ascending':'descending'):'none'}><button className="column-sort" aria-label={`Sort by ${label.toLowerCase()}`} onClick={()=>setSort({field,direction:active&&sort.direction==='asc'?'desc':'asc'})}>{label}<span aria-hidden="true">{active?(sort.direction==='asc'?'↑':'↓'):'↕'}</span></button></th>;
 }
 return {items:sorted,header,field:sort.field,direction:sort.direction,key:`${sort.field}:${sort.direction}`};
}
