import {useInboxSummary} from './inbox-summary.js';
export function useUnreadMessages(org:string|undefined,user:string|undefined){return useInboxSummary(org,user).messages;}
