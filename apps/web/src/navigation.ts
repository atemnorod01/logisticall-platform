import {useSyncExternalStore} from 'react';
import type {SettingPage} from './settings-ui.js';
import type {PlatformAdminPage} from './platform-admin.js';
export const settingsPaths: Record<SettingPage,string> = {
 'Install Apps':'/settings/install-apps', Profile:'/settings/profile', Notifications:'/settings/notifications', 'Audio & video':'/settings/audio-video', Voicemail:'/settings/voicemail', Appearance:'/settings/appearance',
 Overview:'/settings/organization/overview', Members:'/settings/organization/members', Teams:'/settings/organization/teams',
};
export const platformPaths: Record<PlatformAdminPage,string> = {
 organizations:'/platform/organizations',users:'/platform/users',directory:'/platform/industry-directory',phones:'/platform/phone-numbers',jambonz:'/platform/jambonz',devices:'/platform/devices',audit:'/platform/audit-history',
};
export const contactPaths = {corporate:'/contacts/company',personal:'/contacts/personal',industry:'/contacts/industry'} as const;
export type AppPage = 'Conversations'|'Calls'|'Contacts'|'Settings'|'Platform administration'|'Organization administration'|'Group inboxes'|'Network directory'|'Not found';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseAppPath(input:string) {
 const url=new URL(input,'https://local.invalid');
 const path=url.pathname.replace(/\/+$/,'') || '/';
 const base={page:'Not found' as AppPage,setting:'Profile' as SettingPage,platformPage:'organizations' as PlatformAdminPage,contactTab:'corporate' as keyof typeof contactPaths,inbox:'',conversationId:'',filter:['unread','done'].includes(url.searchParams.get('filter')??'')?url.searchParams.get('filter')!:'all'};
 if(path==='/settings/install-apps' && typeof window!=='undefined' && window.logisticallDesktop)return {...base,page:'Settings' as const};
 for(const [setting,p] of Object.entries(settingsPaths)) if(path===p)return {...base,page:'Settings' as const,setting:setting as SettingPage};
 for(const [platformPage,p] of Object.entries(platformPaths)) if(path===p)return {...base,page:'Platform administration' as const,platformPage:platformPage as PlatformAdminPage};
 for(const [contactTab,p] of Object.entries(contactPaths)) if(path===p)return {...base,page:'Contacts' as const,contactTab:contactTab as keyof typeof contactPaths};
 if(path==='/settings')return {...base,page:'Settings' as const};
 if(path==='/platform')return {...base,page:'Platform administration' as const};
 if(path==='/contacts')return {...base,page:'Contacts' as const};
 if(path==='/calls')return {...base,page:'Calls' as const};
 if(path==='/'||path==='/conversations'||path==='/conversations/my')return {...base,page:'Conversations' as const};
 const parts=path.split('/');
 if(parts[1]==='conversations') {
  if(parts[2]==='my' && parts.length===4 && uuid.test(parts[3]!))return {...base,page:'Conversations' as const,conversationId:parts[3]!};
  if(parts[2]==='teams' && (parts.length===4||parts.length===5) && uuid.test(parts[3]!) && (!parts[4]||uuid.test(parts[4])))return {...base,page:'Conversations' as const,inbox:parts[3]!,conversationId:parts[4]??''};
 }
 return base;
}
export function conversationPath(inbox='',id='',filter='all') {
 return `${inbox?`/conversations/teams/${encodeURIComponent(inbox)}`:'/conversations/my'}${id?'/'+encodeURIComponent(id):''}${filter==='unread'||filter==='done'?'?filter='+filter:''}`;
}
const changed='logisticall:navigation';
export const currentPath=()=>window.location.pathname+window.location.search;
export function navigate(path:string,replace=false) {
 if(currentPath()===path)return;
 window.history[replace?'replaceState':'pushState'](null,'',path);
 window.dispatchEvent(new Event(changed));
}
function subscribe(fn:()=>void) {
 window.addEventListener('popstate',fn);window.addEventListener(changed,fn);
 return()=>{window.removeEventListener('popstate',fn);window.removeEventListener(changed,fn);};
}
export const useAppPath=()=>useSyncExternalStore(subscribe,currentPath);
