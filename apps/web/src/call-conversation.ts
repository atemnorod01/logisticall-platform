import type {AudioCall} from '../../../packages/types/src/calls.js';
import {conversationSchema} from '../../../packages/types/src/messaging.js';
import {conversationPath} from './navigation.js';

// Resolve from the viewer's inbox: the caller's source team is not necessarily
// the recipient's team. Every lookup uses the existing authorized detail API.
export async function callConversationPath(call:AudioCall,organizationId:string,userId:string,fetcher:typeof fetch=fetch) {
 if(!call.conversationId)throw new Error('This call has no conversation.');
 const base=`/v1/organizations/${organizationId}/messaging`;
 async function lookup(groupId:string) {
  const response=await fetcher(`${base}/${call.conversationId}${groupId?'?groupId='+encodeURIComponent(groupId):''}`,{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
  if(response.status===403||response.status===404)return null;
  if(!response.ok)throw new Error('Could not open the conversation. Please try again.');
  const {conversation}=await response.json();
  const row=conversationSchema.parse(conversation);
  return conversationPath(row.inbox.kind==='group'?row.inbox.id:'',row.id);
 }
 const preferred=call.caller.id===userId?call.sourceGroupId:call.team?.organizationId===organizationId?call.team.id:undefined;
 const direct=await lookup(preferred??'');
 if(direct)return direct;
 const response=await fetcher(`${base}/inboxes`,{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Could not open the conversation. Please try again.');
 const data=await response.json() as {inboxes:{id:string}[]};
 const paths=await Promise.all(data.inboxes.filter(inbox=>inbox.id!==(preferred??'')).map(inbox=>lookup(inbox.id)));
 const path=paths.find(Boolean);
 if(!path)throw new Error('This conversation is no longer available to you.');
 return path;
}
