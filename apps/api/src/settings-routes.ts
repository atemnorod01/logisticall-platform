import {memberDirectoryQuery,sortMembers} from "./member-directory";
import type {TelephonyService} from "./telephony/service";
import {MemberInviteError,type MemberInvitation} from './telephony/member-invitation';
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  membershipRemoval,
  managedMember,
  passwordResetLink,
  memberEdit,
  memberArchivePreview,
  memberRemovalAction,
  memberRemovalRequest,
  profileEdit,
  organizationEdit,
  organizationProfile,
  inviteEdit,
  memberInviteInput,
  invitationRows,
  invitationLink,
} from "../../../packages/types/src/settings.js";
export function settingsRoutes(
  app: FastifyInstance,
  options: {
    telephony?: TelephonyService | undefined;
    memberExtensions?: ((id:string,emails:string[])=>Promise<Record<string,string[]>>) | undefined;
    profileChanged?: ((id: string, name: string) => Promise<void>) | undefined;
    organizationChanged?: ((id: string, name: string) => Promise<void>) | undefined;
    presence?:
      | ((org: string, ids: string[]) => Promise<Record<string, string>>)
      | undefined;
    authorize: (req: FastifyRequest, org?: string) => Promise<string>;
    request: (
      token: string,
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<unknown>;
  },
) {
  const params = (req: FastifyRequest) =>
    z
      .object({ organizationId: z.uuid(), invitationId: z.uuid().optional() })
      .parse(req.params);
  app.patch("/v1/me/profile", async (req) => {
    const token = await options.authorize(req);
    const profile = z
      .object({ user_id: z.uuid(), display_name: z.string().max(100) })
      .parse(
        await options.request(
          token,
          "/me",
          "PATCH",
          profileEdit.parse(req.body),
        ),
      );
    await options.profileChanged?.(profile.user_id, profile.display_name);
    return profile;
  });
  const prefix = "/v1/organizations/:organizationId";
  app.get(prefix + "/members", async (req) => {
    const p = params(req),
      token = await options.authorize(req, p.organizationId);
    const q=memberDirectoryQuery.parse(req.query);
    const all:z.infer<typeof managedMember>[]=[];
    // Global ordering and filters must run before page slicing, including PBX fields.
    const full=Object.keys(req.query as object).some(k=>['sort','direction','role','status','limit'].includes(k));
    const seen=new Set<string>();
    for(let start=full?0:q.offset;start<=100000;){
      const page=z.array(managedMember).max(50).parse(await options.request(token,
        `/organizations/${p.organizationId}/members?offset=${start}&search=${encodeURIComponent(q.search)}`));
      for(const m of page){if(seen.has(m.user_id))throw Error('Member pagination repeated a record');seen.add(m.user_id);all.push(m);}
      if(!full||page.length<50)break;
      start+=page.length;if(start>100000)throw Error('Member directory limit exceeded');
    }
    let enriched=all;
    try{
      if(options.telephony?.memberDirectory){
        const details=await options.telephony.memberDirectory(p.organizationId,all.filter(m=>m.status!=='archived').map(m=>m.email));
        enriched=all.map(m=>({...m,...(m.status==='archived'?{extensions:[],phone_numbers:[]}:details[m.email])}));
      }else{
        const ext=await options.memberExtensions?.(p.organizationId,all.slice(0,10).map(m=>m.email))??{};
        enriched=all.map(m=>({...m,...(ext[m.email]?.length?{extensions:ext[m.email]}:{})}));
      }
    }catch{
      // Sorting on a failed PBX read would imply that missing data means unassigned.
      if(q.sort!=='name')throw Object.assign(Error('Phone assignments are unavailable. Try again.'),{statusCode:503});
    }
    const ordered=full?sortMembers(enriched,q):enriched;
    const start=full?q.offset:0,page=ordered.slice(start,start+q.limit);
    let statuses:Record<string,string>={};
    try{statuses=await options.presence?.(p.organizationId,page.filter(m=>m.status==='active').map(m=>m.user_id))??{};}catch{}
    return {members:page.map(m=>({...m,presence:m.status==='active'?statuses[m.user_id]??'unknown':'offline'})),
      nextOffset:ordered.length>start+q.limit&&q.offset+q.limit<=100000?q.offset+q.limit:null};
  });
  for (const method of ["GET", "PATCH"] as const)
    app.route({
      method,
      url: prefix + "/members/:userId",
      handler: async (req) => {
        const p = z
            .object({ organizationId: z.uuid(), userId: z.uuid() })
            .parse(req.params),
          token = await options.authorize(req, p.organizationId);
        const member=managedMember.parse(await options.request(token,
          `/organizations/${p.organizationId}/members/${p.userId}`,method,
          method==='PATCH'?memberEdit.parse(req.body):undefined));
        if(member.status==='archived')return {...member,can_edit_name:false,can_edit_access:false,can_edit_role:false,extensions:[],phone_numbers:[]};
        try{const details=await options.telephony?.memberDirectory?.(p.organizationId,[member.email]);return {...member,...details?.[member.email]};}catch{return member;}
      },
    });
  const removal=async(req:FastifyRequest,userId?:string)=>{
    const p=z.object({organizationId:z.uuid(),userId:z.uuid()}).parse({...req.params as object,...(userId?{userId}:{})});
    const token=await options.authorize(req,p.organizationId);
    const path=`/organizations/${p.organizationId}/members/${p.userId}`;
    const access=membershipRemoval.parse(await options.request(token,path+'/removal'));
    const member=managedMember.parse(await options.request(token,path));
    if(!memberRemovalAction(member.status)) {
      access.can_remove=false;
      access.reason=member.status==='active'?'Suspend this member before deleting them.':'This membership is already archived.';
    }
    return {p,token,path,access,member,target:{organizationId:p.organizationId,userId:p.userId,email:member.email,membershipKey:access.membership_key}};
  };
  app.get(prefix+'/members/:userId/removal',async req=>{
    const r=await removal(req);
    if(!r.access.archive_supported)throw Object.assign(Error('Archiving requires the member archive migration.'),{statusCode:503});
    if(!r.access.can_remove)return {...r.access,action:memberRemovalAction(r.member.status),preview_hash:'',extensions:[],phone_numbers:[],resume:false};
    if(!options.telephony?.previewMemberArchive)throw Object.assign(Error('Archiving is unavailable.'),{statusCode:503});
    return memberArchivePreview.parse({...r.access,action:memberRemovalAction(r.member.status),...await options.telephony.previewMemberArchive(r.target)});
  });
  const removeMember=async(req:FastifyRequest,userId?:string)=>{
    const body=memberRemovalRequest.parse(req.body);
    const r=await removal(req,userId);
    if(!r.access.archive_supported)throw Object.assign(Error('Archiving requires the member archive migration.'),{statusCode:503});
    if(!r.access.can_remove||body.membership_key!==r.access.membership_key||body.expected_status!==r.member.status)throw Object.assign(Error('Member changed. Review the removal again.'),{statusCode:409});
    if(!options.telephony?.archiveMember)throw Object.assign(Error('Archiving is unavailable.'),{statusCode:503});
    await options.telephony.archiveMember(r.target,body.preview_hash,async()=>{
      z.object({removed:z.literal(true)}).parse(await options.request(r.token,r.path,'DELETE',{membership_key:body.membership_key}));
    },async()=>{
      z.object({started:z.literal(true)}).parse(await options.request(r.token,r.path+'/archive','POST',{
        membership_key:body.membership_key,expected_status:body.expected_status,
      }));
    });
    return {removed:true,archived:true};
  };
  app.delete(prefix+'/members/:userId',req=>removeMember(req));
  app.post(prefix + "/members/:userId/password-reset-link", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const p = z.object({ organizationId: z.uuid(), userId: z.uuid() }).parse(req.params);
    z.object({}).strict().parse(req.body);
    const token = await options.authorize(req, p.organizationId);
    const member=managedMember.parse(await options.request(token,`/organizations/${p.organizationId}/members/${p.userId}`));
    if(member.status==='pending'||member.status==='archived')throw Object.assign(Error('Account security actions are unavailable for this membership.'),{statusCode:403});
    return passwordResetLink.parse(await options.request(token,
      `/organizations/${p.organizationId}/members/${p.userId}/password-reset-link`, "POST", {}));
  });
  app.get(prefix + "/profile", async (req) => {
    const p = params(req),
      token = await options.authorize(req, p.organizationId);
    return organizationProfile.parse(
      await options.request(
        token,
        `/organizations/${p.organizationId}/profile`,
      ),
    );
  });
  app.patch(prefix + "/profile", async (req) => {
    const p = params(req),
      token = await options.authorize(req, p.organizationId);
    const profile = z
      .object({
        organization_id: z.uuid(),
        name: z.string().max(120),
        organization_type:
          organizationProfile.shape.organization_type.optional(),
        description: organizationProfile.shape.description.optional(),
      })
      .parse(
        await options.request(
          token,
          `/organizations/${p.organizationId}`,
          "PATCH",
          organizationEdit.parse(req.body),
        ),
      );
    await options.organizationChanged?.(p.organizationId, profile.name);
    return profile;
  });
  const invitationMembers=async(token:string,organizationId:string,rows:z.infer<typeof invitationRows>)=>{
    if(rows.every(row=>row.user_id))return rows;
    const byEmail=new Map<string,string>();
    for(let offset=0;offset<=100000;offset+=50){
      const members=z.array(managedMember).max(50).parse(await options.request(token,`/organizations/${organizationId}/members?offset=${offset}&search=`));
      for(const member of members)if(member.status==='pending')byEmail.set(member.email.toLowerCase(),member.user_id);
      if(members.length<50)break;
    }
    return rows.map(row=>({...row,user_id:row.user_id??byEmail.get(row.email.toLowerCase())??null}));
  };
  app.get(prefix + "/invitations", async (req) => {
    const p = params(req),
      page = z
        .object({
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        })
        .strict()
        .parse(req.query),
      token = await options.authorize(req, p.organizationId);
    const invitations = invitationRows.parse(
      await options.request(
        token,
        `/organizations/${p.organizationId}/invitations?offset=${page.offset}`,
      ),
    );
    return {
      invitations:await invitationMembers(token,p.organizationId,invitations),
      nextOffset:
        invitations.length === 50 && page.offset + 50 <= 100000
          ? page.offset + 50
          : null,
    };
  });
  app.get(prefix+'/invitations/extension',async(req,reply)=>{
    const p=params(req),token=await options.authorize(req,p.organizationId);
    // IAM's invitation permission is checked before accessing any PBX data.
    await options.request(token,`/organizations/${p.organizationId}/invitations?offset=0`);
    if(!await options.telephony?.canAccessTelephony?.(p.organizationId))throw new MemberInviteError('Telephony is not enabled for this organization.',403);
    if(!options.telephony?.memberExtensionSuggestion)throw Object.assign(Error('Extension selection is unavailable.'),{statusCode:503});
    try{return await options.telephony.memberExtensionSuggestion(p.organizationId);}
    catch(e){if(e instanceof MemberInviteError)return reply.code(e.statusCode).send({message:e.message});throw e;}
  });
  app.post(prefix + "/invitations", async (req,reply) => {
    const p = params(req),
      token = await options.authorize(req, p.organizationId);
    const input=memberInviteInput.parse(req.body),path=`/organizations/${p.organizationId}/invitations`;
    const result=z.object({id:z.uuid(),user_id:z.uuid(),link:invitationLink.optional()});
    const create=async()=>result.parse(await options.request(token,path,'POST',inviteEdit.parse({name:input.name,email:input.email})));
    const enabled=await options.telephony?.canAccessTelephony?.(p.organizationId)??false;
    if(!enabled){
      if(input.extension!==undefined)throw new MemberInviteError('Telephony is not enabled for this organization.',403);
      return create();
    }
    // This read enforces tenant administrator permission before touching the provider.
    const first=invitationRows.parse(await options.request(token,path+'?offset=0'));
    if(!options.telephony?.inviteMember)throw Object.assign(Error('PBX invitations are unavailable.'),{statusCode:503});
    const requestId=z.uuid().parse(input.request_id);
    const ensureMember=async(previous?:MemberInvitation)=>{
      let rows=first;
      for(let offset=0;offset<=100000;offset+=50){
        if(offset)rows=invitationRows.parse(await options.request(token,path+`?offset=${offset}`));
        const row=rows.find(r=>previous?r.id===previous.id:r.email.toLowerCase()===input.email.toLowerCase());
        if(row){
          const [linked]=await invitationMembers(token,p.organizationId,[row]);
          if(Date.parse(row.expires_at)<=Date.now())throw new MemberInviteError('The pending invitation is unavailable.');
          // IAM invitation creation is idempotent. Resume a lost Auth/binding response
          // instead of leaving an invitation without its pending membership.
          if(!linked?.user_id){
            if(previous||row.display_name!==input.name)throw new MemberInviteError('The pending invitation is unavailable.');
            return create();
          }
          const member=managedMember.parse(await options.request(token,`/organizations/${p.organizationId}/members/${linked.user_id}`));
          if(member.status!=='pending'||member.role_id!=='member'||member.name!==input.name||member.email.toLowerCase()!==input.email.toLowerCase()||!member.can_edit_name)
            throw new MemberInviteError('The member changed or is no longer pending. Review their membership.');
          return result.parse({id:row.id,user_id:linked.user_id});
        }
        if(rows.length<50)break;
      }
      if(previous)throw new MemberInviteError('The invitation was revoked or removed. No PBX user was created.');
      return create();
    };
    try{return await options.telephony.inviteMember({organizationId:p.organizationId,requestId,name:input.name,email:input.email,...(input.extension?{extension:input.extension}:{})},ensureMember);}
    catch(e){if(e instanceof MemberInviteError)return reply.code(e.statusCode).send({message:e.message});throw e;}
  });
  for (const action of ["link", "revoke"] as const)
    app.post(prefix + "/invitations/:invitationId/" + action, async (req) => {
      const p = params(req),
        token = await options.authorize(req, p.organizationId);
      if(action==='revoke'){
        const body=memberRemovalRequest.parse(req.body);
        if(body.expected_status!=='pending')throw Object.assign(Error('Only pending invitations can be revoked.'),{statusCode:409});
        for(let offset=0;offset<=100000;offset+=50){
          const rows=invitationRows.parse(await options.request(token,`/organizations/${p.organizationId}/invitations?offset=${offset}`));
          const invitation=rows.find(row=>row.id===p.invitationId);
          if(invitation){
            const [linked]=await invitationMembers(token,p.organizationId,[invitation]);
            if(!linked?.user_id)throw Object.assign(Error('Pending membership is unavailable.'),{statusCode:409});
            await removeMember(req,linked.user_id);
            return {revoked:true};
          }
          if(rows.length<50)break;
        }
        throw Object.assign(Error('Invitation unavailable.'),{statusCode:404});
      }
      z.object({}).strict().parse(req.body);
      const value = await options.request(
        token,
        `/organizations/${p.organizationId}/invitations/${p.invitationId}/${action}`,
        "POST",
        {},
      );
      return invitationLink.parse(value);
    });
}
