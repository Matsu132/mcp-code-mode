import {NextRequest,NextResponse} from 'next/server';
export const dynamic='force-dynamic';
async function proxy(req:NextRequest){
 const authorization=req.headers.get('authorization');if(!authorization?.startsWith('Bearer ')||authorization.length>16384)return NextResponse.json({error:'Authentication required'},{status:401});
 try{const url=new URL('/admin/state',process.env.GATEWAY_URL??'http://127.0.0.1:3000');const body=req.method==='PUT'?await req.text():undefined;if(body&&Buffer.byteLength(body)>65536)return NextResponse.json({error:'Too large'},{status:413});const r=await fetch(url,{method:req.method,headers:{Authorization:authorization,'Content-Type':'application/json'},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});return NextResponse.json(r.ok?await r.json():{error:'Request denied or failed'},{status:r.status,headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Gateway unavailable'},{status:502});}
}
export const GET=proxy;export const PUT=proxy;
