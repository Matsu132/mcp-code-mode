import {timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet,customFetch,jwtVerify} from 'jose';
import {z} from 'zod';
export type Principal={id:string;allow:string[];admin?:boolean};
const settings=z.object({issuer:z.string().url(),jwks:z.string().url(),resource:z.string().url(),users:z.array(z.object({sub:z.string(),allow:z.array(z.string())}))});
export function createAuth(env:NodeJS.ProcessEnv){
  const oauth=env.OAUTH_CONFIG?settings.parse(JSON.parse(env.OAUTH_CONFIG)):undefined;
  if(oauth){
    for(const u of [oauth.issuer,oauth.jwks,oauth.resource])if(new URL(u).protocol!=='https:')throw Error('OAuth URLs must use HTTPS');
    const keys=createRemoteJWKSet(new URL(oauth.jwks),{[customFetch]:(url,init)=>fetch(url,{...init,redirect:'error'})});
    const principalFor=(subject:string):Principal|null=>{
      const user=oauth.users.find(u=>u.sub===subject);
      return user?{id:user.sub,allow:user.allow,admin:(env.ADMIN_SUBJECTS??'').split(',').includes(user.sub)}:null;
    };
    return {principalFor,metadata:{resource:oauth.resource,authorization_servers:[oauth.issuer],bearer_methods_supported:['header']},async authenticate(header:string):Promise<Principal|null>{
      if(!header.startsWith('Bearer '))return null;
      try{const {payload}=await jwtVerify(header.slice(7),keys,{issuer:oauth.issuer,audience:oauth.resource,requiredClaims:['exp','sub'],algorithms:['RS256','ES256']});
        return payload.sub?principalFor(payload.sub):null;
      }catch{return null;}
    }};
  }
  const token=env.GATEWAY_TOKEN;if(!token||token.length<32)throw Error('GATEWAY_TOKEN must be at least 32 characters');
  const principalFor=(subject:string):Principal|null=>subject==='operator'?{id:'operator',allow:['*'],admin:true}:null;
  return {principalFor,metadata:undefined,async authenticate(header:string):Promise<Principal|null>{const a=Buffer.from(header),b=Buffer.from('Bearer '+token);return a.length===b.length&&timingSafeEqual(a,b)?principalFor('operator'):null;}};
}
export function permitted(p:Principal,id:string){return p.allow.includes('*')||p.allow.includes(id);}
