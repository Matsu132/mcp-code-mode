import {NextRequest,NextResponse} from 'next/server';

export const dynamic = 'force-dynamic';

async function proxy(req:NextRequest) {
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length>16384) {
    return NextResponse.json({error:'Authentication required'},{status:401});
  }
  const action = req.nextUrl.searchParams.get('action');
  if ((req.method==='POST' && action!=='test' && action!=='refresh') || (req.method!=='POST' && action)) {
    return NextResponse.json({error:'Unknown management action'},{status:400});
  }
  try {
    const path = action ? '/admin/upstreams/'+action : '/admin/upstreams';
    const url = new URL(path,process.env.GATEWAY_URL??'http://127.0.0.1:3000');
    const body = req.method==='PUT' || action==='test' ? await req.text() : undefined;
    if (body && Buffer.byteLength(body)>65536) return NextResponse.json({error:'Too large'},{status:413});
    const upstream = await fetch(url,{
      method:req.method,
      headers:{Authorization:authorization,'Content-Type':'application/json'},
      body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(13000),
    });
    return NextResponse.json(upstream.ok?await upstream.json():{error:'Request denied or rejected'},{
      status:upstream.status,headers:{'Cache-Control':'no-store'},
    });
  } catch {
    return NextResponse.json({error:'Gateway unavailable'},{status:502});
  }
}

export const GET = proxy;
export const PUT = proxy;
export const POST = proxy;
