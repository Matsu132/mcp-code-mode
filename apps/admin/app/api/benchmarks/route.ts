import type {NextRequest} from 'next/server';
import {forward} from '../_gateway';
export const dynamic='force-dynamic';
export const GET=(req:NextRequest)=>forward(req,'/admin/benchmarks',[],30000);
