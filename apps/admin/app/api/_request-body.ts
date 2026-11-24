export class BodyTooLarge extends Error {}

export async function readBody(req:Request,limit:number) {
  const reader=req.body?.getReader();
  if(!reader)return '';
  try {
    const length=req.headers.get('content-length');
    if(length!==null&&Number(length)>limit)throw new BodyTooLarge();
    const chunks:Uint8Array[]=[];
    let size=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)return Buffer.concat(chunks,size).toString();
      size+=value.byteLength;
      if(size>limit)throw new BodyTooLarge();
      chunks.push(value);
    }
  }catch(error){
    void reader.cancel().catch(()=>{});
    throw error;
  }finally{
    reader.releaseLock();
  }
}
