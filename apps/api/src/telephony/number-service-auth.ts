import {createHash} from 'node:crypto';
import {importSPKI,jwtVerify} from 'jose';
import {z} from 'zod';
export const numberServicePath='/internal/number-providers';
/** The reverse bridge has its own key and audience; user access tokens and the
 * forward carrier key are never accepted as provider-execution authority. */
export function numberServiceVerifier(publicKey:string){
 const key=importSPKI(publicKey,'ES256');
 return async(header:string|undefined,method:string,path:string,body:unknown)=>{
  try{
   if(!header||header.length>8192||!/^Bearer [\w.-]+$/.test(header))throw Error();
   const {payload}=await jwtVerify(header.slice(7),await key,{issuer:'logisticall-provisioning',audience:'logisticall-platform-number-providers',subject:'number-worker',algorithms:['ES256'],typ:'JWT',maxTokenAge:60,clockTolerance:5,requiredClaims:['iat','exp','jti']});
   if(payload.exp!-payload.iat!>60||payload.iat!>Date.now()/1000+5||payload.method!==method||payload.path!==path||payload.bodyHash!==createHash('sha256').update(body===undefined?'':JSON.stringify(body)).digest('hex'))throw Error();
   return z.uuid().parse(payload.jti);
  }catch{throw Object.assign(Error('Service authentication required'),{statusCode:401});}
 };
}
