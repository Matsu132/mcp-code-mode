import {timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {z} from 'zod';
export type Principal={id:string;allow:string[]};
const settings=z.object({issuer:z.string().url(),jwks:z.string().url(),resource:z.string().url(),users:z.array(z.object({sub:z.string(),allow:z.array(z.string())}))});
export function createAuth(env:NodeJS.ProcessEnv){
  const oauth=env.OAUTH_CONFIG?settings.parse(JSON.parse(env.OAUTH_CONFIG)):undefined;
  if(oauth){
    for(const u of [oauth.issuer,oauth.jwks,oauth.resource])if(new URL(u).protocol!=='https:')throw Error('OAuth URLs must use HTTPS');
    const keys=createRemoteJWKSet(new URL(oauth.jwks));
    return {metadata:{resource:oauth.resource,authorization_servers:[oauth.issuer],bearer_methods_supported:['header']},async authenticate(header:string):Promise<Principal|null>{
      if(!header.startsWith('Bearer '))return null;
      try{const {payload}=await jwtVerify(header.slice(7),keys,{issuer:oauth.issuer,audience:oauth.resource,requiredClaims:['exp','sub'],algorithms:['RS256','ES256']});
        const user=oauth.users.find(u=>u.sub===payload.sub);return user?{id:user.sub,allow:user.allow}:null;
      }catch{return null;}
    }};
  }
  const token=env.GATEWAY_TOKEN;if(!token||token.length<32)throw Error('GATEWAY_TOKEN must be at least 32 characters');
  return {metadata:undefined,async authenticate(header:string):Promise<Principal|null>{const a=Buffer.from(header),b=Buffer.from('Bearer '+token);return a.length===b.length&&timingSafeEqual(a,b)?{id:'operator',allow:['*']}:null;}};
}
export function permitted(p:Principal,id:string){return p.allow.includes('*')||p.allow.includes(id);}
