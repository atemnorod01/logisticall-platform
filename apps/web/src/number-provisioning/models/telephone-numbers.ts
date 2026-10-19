import {z} from 'zod';
const reference=z.object({id:z.string().regex(/^\d+$/),name:z.string().nullable()});
export const telephoneInventorySchema=z.object({account:reference,site:reference,location:reference,syncedAt:z.string().datetime(),numbers:z.array(z.object({number:z.string().regex(/^\+[1-9]\d{6,14}$/),callingNameDisplay:z.boolean().nullable()}))});
export type TelephoneInventory=z.infer<typeof telephoneInventorySchema>;
export type TelephoneScope={accountId:string;siteId:string;peerId:string};
export const telephoneScopeKey=(scope:TelephoneScope)=>[scope.accountId,scope.siteId,scope.peerId].join(':');
