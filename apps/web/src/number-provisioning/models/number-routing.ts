export type NumberAssignedUser={id:string;name:string;email:string};
export type NumberRouting={
 users?:NumberAssignedUser[];
 usersUnavailable?:boolean;
 portaone:{account:string|null;error?:string;warning?:string};
 netsapiens:{destinationName?:string;nameUnavailable?:boolean;domain:string|null;destination:string|null;application:string|null;host:string|null;error?:string;warning?:string};
};
