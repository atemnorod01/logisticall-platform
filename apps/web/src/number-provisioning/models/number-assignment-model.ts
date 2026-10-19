import {z} from 'zod';
export const assignNumberInput=z.object({number:z.string().regex(/^\+1[2-9]\d{9}$/),organizationId:z.string().min(1),confirmed:z.literal(true)}).strict();
export type NumberAssignment={
 id:string;number:string;accountId:string;siteId:string;peerId:string;organizationId:string;organizationName:string;
 customerId:string;domain:string;masterAccountId?:number;aliasId?:number;
 status:'running'|'failed'|'complete'|'unassigned'|'terminated';step:'checking'|'portaone'|'netsapiens'|'complete';
 portaone:'pending'|'complete';netsapiens:'pending'|'complete';pendingCreate?:'portaone'|'netsapiens';
 initialPbxDestination?:'9999'|null;
 unassignment?:import('./number-unassignment').NumberUnassignment;
 returnHistory?:{organizationId:string;organizationName:string;customerId:string;domain:string;returnedAt:string}[];
 source?:'existing';verifiedAt?:string;pbxDestination?:string;
 error?:string;createdAt:string;updatedAt:string;
};
export type AssignmentView=NumberAssignment&{active:boolean};
