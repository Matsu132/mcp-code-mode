import {NextRequest,NextResponse} from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
  const authorization=req.headers.get('authorization');
  if(!authorization?.startsWith('Bearer ')||authorization.length>16384)return NextResponse.json({error:'Authentication required'},{status:401});
  try{
    const base=new URL(process.env.GATEWAY_URL??'http://127.0.0.1:3000');
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Invalid gateway configuration');
    const url=new URL('/admin/catalog',base);
    const upstream=await fetch(url,{headers:{Authorization:authorization},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!upstream.ok)return NextResponse.json({error:upstream.status===401?'Authentication failed':'Gateway unavailable'},{status:upstream.status===401?401:502});
    const data=await upstream.json();
    return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Gateway unavailable'},{status:502});}
}
