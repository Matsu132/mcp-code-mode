import type {NextRequest} from 'next/server';
import {forward} from '../_gateway';

export const dynamic='force-dynamic';
export const GET=(req:NextRequest)=>forward(req,'/admin/state',[],10000);
export const PUT=GET;
