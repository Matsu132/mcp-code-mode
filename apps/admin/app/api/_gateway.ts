import {BodyTooLarge,readBody} from './_request-body';
import {NextRequest,NextResponse} from 'next/server';

export async function forward(req:NextRequest,path:string,query:string[] = [],timeout=20000,hasBody=req.method==='PUT') {
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
    const body = hasBody?await readBody(req,65536):undefined;
    const upstream = await fetch(url,{
      method:req.method,body,headers:{Authorization:authorization,'Content-Type':'application/json'},
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeout),
    });
    return NextResponse.json(upstream.ok?await upstream.json():{error:'Gateway request denied or failed'},{
      status:upstream.status,headers:{'Cache-Control':'no-store'},
    });
  } catch(error) {
    if(error instanceof BodyTooLarge)return NextResponse.json({error:'Too large'},{status:413});
    return NextResponse.json({error:'Gateway unavailable'},{status:502});
  }
}
