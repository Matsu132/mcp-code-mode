import {forward} from '../_gateway';
import {NextRequest,NextResponse} from 'next/server';

export const dynamic = 'force-dynamic';

async function proxy(req:NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  if ((req.method==='POST' && action!=='test' && action!=='refresh') || (req.method!=='POST' && action)) {
    return NextResponse.json({error:'Unknown management action'},{status:400});
  }
  return forward(req,action?'/admin/upstreams/'+action:'/admin/upstreams',[],13000,req.method==='PUT'||action==='test');
}

export const GET = proxy;
export const PUT = proxy;
export const POST = proxy;
