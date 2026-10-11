import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { platformRecordKind,platformEdit,platformRecord,platformSection,platformQuery,platformCreate,platformResult,platformPage } from '../../../packages/types/src/platform-admin.js';
import { invitationLink } from '../../../packages/types/src/settings.js';
export function platformAdminRoutes(app:FastifyInstance,options:{authorize:(req:FastifyRequest)=>Promise<string>;request:(token:string,path:string,method?:string,body?:unknown)=>Promise<unknown>}) {
 app.get('/v1/platform/:section',async req=>{
  const token=await options.authorize(req),section=platformSection.parse((req.params as {section:string}).section),q=platformQuery.parse(req.query);
  return platformPage.parse(await options.request(token,`/platform/${section}?${new URLSearchParams({search:q.search,offset:String(q.offset)})}`));
 });
 const params=(value:unknown)=>z.object({kind:platformRecordKind,id:z.uuid()}).parse(value);
 app.get('/v1/platform/records/:kind/:id',async req=>{
  const token=await options.authorize(req),p=params(req.params);
  return platformRecord.parse(await options.request(token,`/platform/records/${p.kind}/${p.id}`));
 });
 app.patch('/v1/platform/records/:kind/:id',async req=>{
  const token=await options.authorize(req),p=params(req.params),body=platformEdit.parse(req.body);
  if((p.kind==='users')!==(body.kind==='user'))throw Object.assign(new Error('Invalid edit'),{statusCode:400});
  return platformRecord.parse(await options.request(token,`/platform/records/${p.kind}/${p.id}`,'PATCH',body));
 });
 app.post('/v1/platform/companies',async req=>{
  const token=await options.authorize(req),body=platformCreate.parse(req.body);
  return platformResult.parse(await options.request(token,'/platform/companies','POST',body));
 });
 app.post('/v1/platform/invitations/:id/link',async req=>{
  const token=await options.authorize(req),id=z.uuid().parse((req.params as {id:string}).id);z.object({}).strict().parse(req.body);
  return invitationLink.parse(await options.request(token,`/platform/invitations/${id}/link`,'POST',{}));
 });
}
