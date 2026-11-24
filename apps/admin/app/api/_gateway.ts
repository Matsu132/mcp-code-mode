import {NextRequest,NextResponse} from 'next/server';

export async function forward(req:NextRequest,path:string,query:string[] = [],timeout=20000) {
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length>16384) {
    return NextResponse.json({error:'Authentication required'},{status:401});
  }
  try {
    const url = new URL(path,process.env.GATEWAY_URL??'http://127.0.0.1:3000');
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid gateway URL');
    for (const key of query) {
      const value=req.nextUrl.searchParams.get(key);
      if (value!==null) url.searchParams.set(key,value);
    }
    const body = req.method==='PUT' ? await req.text() : undefined;
    if (body && Buffer.byteLength(body)>65536) return NextResponse.json({error:'Too large'},{status:413});
    const upstream = await fetch(url,{
      method:req.method,body,headers:{Authorization:authorization,'Content-Type':'application/json'},
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeout),
    });
    return NextResponse.json(upstream.ok?await upstream.json():{error:'Gateway request denied or failed'},{
      status:upstream.status,headers:{'Cache-Control':'no-store'},
    });
  } catch {
    return NextResponse.json({error:'Gateway unavailable'},{status:502});
  }
}
