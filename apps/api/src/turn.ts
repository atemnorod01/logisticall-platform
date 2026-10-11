import {z} from "zod";
const responseSchema = z.object({iceServers:z.array(z.object({
  urls:z.union([z.string().regex(/^(stun|turn|turns):/),z.array(z.string().regex(/^(stun|turn|turns):/))]),
  username:z.string().optional(),credential:z.string().optional(),
})).min(1)});

/** The long-lived provider token stays server-side; browsers receive expiring ICE credentials. */
export function cloudflareTurn(keyId:string,token:string,fetcher:typeof fetch=fetch) {
  if (!/^[a-zA-Z0-9_-]+$/.test(keyId)||!token) throw Error("Invalid TURN configuration");
  const cache=new Map<string,{expires:number;servers:RTCIceServer[]}>();
  const pending=new Map<string,Promise<RTCIceServer[]>>();
  return async(userId:string):Promise<RTCIceServer[]>=>{
    const saved=cache.get(userId);
    if(saved && saved.expires>Date.now()) return saved.servers;
    const existing=pending.get(userId); if(existing)return existing;
    const task=(async()=>{
      const response=await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,{
        method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
        body:JSON.stringify({ttl:86400}),redirect:"error",signal:AbortSignal.timeout(8000),
      });
      if(!response.ok)throw Error("TURN service unavailable");
      const result=responseSchema.parse(await response.json());
      const servers=result.iceServers.map(s=>({urls:s.urls,...(s.username?{username:s.username}:{}),...(s.credential?{credential:s.credential}:{})}));
      if(cache.size>=512)cache.delete(cache.keys().next().value!);
      cache.set(userId,{expires:Date.now()+3600000,servers});
      return servers;
    })();
    pending.set(userId,task);
    try{return await task;}finally{pending.delete(userId);}
  };
}
