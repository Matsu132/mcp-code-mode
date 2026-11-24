import {browserCookieName} from '../browser-cookie';
import {NextRequest,NextResponse} from 'next/server';

export const dynamic = 'force-dynamic';


export async function GET(req:NextRequest) {
  const {searchParams} = req.nextUrl;
  const state = searchParams.get('state');
  const code = searchParams.get('code');
  const cookie=state?browserCookieName(state):undefined;
  const browser=cookie?req.cookies.get(cookie)?.value:undefined;
  let ok = false;
  if (browser && state && code && code.length<=4096 && state.length<=100) {
    try {
      const callback = new URL('/oauth/callback',process.env.GATEWAY_URL??'http://127.0.0.1:3000');
      const res = await fetch(callback,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({browser,state,code}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
  }
  const res = new NextResponse(null,{
    status:303,headers:{Location:'/oauth-connections?result='+(ok?'connected':'failed'),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'},
  });
  if(cookie&&browser)res.cookies.set(cookie,'',{
    maxAge:0,httpOnly:true,sameSite:'lax',secure:!['127.0.0.1','localhost'].includes(req.nextUrl.hostname),
    path:'/api/oauth/callback',
  });
  return res;
}
