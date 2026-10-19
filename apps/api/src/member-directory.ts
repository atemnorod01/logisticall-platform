import {z} from 'zod';
import {managedMember} from '../../../packages/types/src/settings';
export const memberDirectoryQuery=z.object({
 limit:z.coerce.number().int().min(1).max(50).default(10),
 offset:z.coerce.number().int().min(0).max(100000).default(0),
 search:z.string().max(100).default(''),
 sort:z.enum(['name','extension','phone']).default('name'),
 direction:z.enum(['asc','desc']).default('asc'),
 role:z.enum(['all','owner','admin','member']).default('all'),
 status:z.enum(['all','pending','active','suspended','archived']).default('all'),
}).strict();
export function sortMembers(rows:z.infer<typeof managedMember>[],q:z.infer<typeof memberDirectoryQuery>){
 const compare=(a:string,b:string)=>a.localeCompare(b,'en',{numeric:true,sensitivity:'base'});
 const value=(m:z.infer<typeof managedMember>)=>q.sort==='name'?m.name:q.sort==='extension'?m.extensions?.[0]??'':(m.phone_numbers?.[0]??'').replace(/\D/g,'');
 return rows.filter(m=>(q.role==='all'||m.role_id===q.role)&&(q.status==='all'?m.status!=='archived':m.status===q.status)).sort((a,b)=>{
  const av=value(a),bv=value(b);
  // Unassigned entries always follow assigned entries, in either direction.
  if(!av!==!bv)return av? -1:1;
  return (q.direction==='asc'?1:-1)*compare(av,bv)||compare(a.name,b.name)||a.user_id.localeCompare(b.user_id);
 });
}
