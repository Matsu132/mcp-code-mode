import {randomBytes} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';

export const dynamic = 'force-dynamic';
const browserCookie = 'mcp_oauth_browser';

async function proxy(req:NextRequest) {
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length>16384) {
    return NextResponse.json({error:'Authentication required'},{status:401});
  }
  try {
    const url = new URL('/oauth/connections',process.env.GATEWAY_URL??'http://127.0.0.1:3000');
    let browser:string|undefined;
    let body:string|undefined;
    if (req.method==='POST') {
      const raw = await req.text();
      if (Buffer.byteLength(raw)>1024) return NextResponse.json({error:'Too large'},{status:413});
      const {action,id} = JSON.parse(raw) as {action:unknown;id:unknown};
      if (action!=='connect' && action!=='disconnect') return NextResponse.json({error:'Unknown OAuth action'},{status:400});
      if (action==='connect') browser = randomBytes(32).toString('base64url');
      body = JSON.stringify({action,id,browser});
    }
    const upstream = await fetch(url,{
      method:req.method,body,headers:{Authorization:authorization,'Content-Type':'application/json'},
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000),
    });
    const result = NextResponse.json(upstream.ok?await upstream.json():{error:'OAuth request failed'},{
      status:upstream.status,headers:{'Cache-Control':'no-store'},
    });
    if (upstream.ok && browser) {
      result.cookies.set(browserCookie,browser,{
        httpOnly:true,sameSite:'lax',secure:!['127.0.0.1','localhost'].includes(req.nextUrl.hostname),
        path:'/api/oauth/callback',maxAge:600,
      });
    }
    return result;
  } catch {
    return NextResponse.json({error:'Gateway unavailable'},{status:502});
  }
}

export const GET = proxy;
export const POST = proxy;
