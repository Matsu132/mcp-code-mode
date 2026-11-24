export const adminPage = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP Code Mode</title>
<style>
body{font:16px system-ui;background:#f5f7fa;color:#172333;max-width:900px;margin:3rem auto;padding:0 1rem}
section{background:white;padding:1.5rem;border:1px solid #dce3ec;border-radius:12px}
input,button{font:inherit;padding:.7rem;margin:.3rem}input{max-width:90%}li{padding:.6rem;border-bottom:1px solid #eee}
</style>
<h1>Authorized tool catalog</h1>
<section>
<form id="login"><label>Access token <input id="token" type="password" autocomplete="off" required></label>
<button type="submit">Load catalog</button><button type="button" id="clear">Clear</button></form>
<form id="search"><label>Filter <input id="filter" maxlength="200"></label><button id="apply" disabled>Search</button></form>
<p id="status" role="status"></p><ul id="tools"></ul>
<button id="previous" disabled>Previous</button><button id="next" disabled>Next</button>
</section>
<script>
const el=id=>document.getElementById(id);
const limit=50;
let token='',query='',offset=0,total=0,active=null;
function controls(){
  el('apply').disabled=!token||!!active;
  el('previous').disabled=!token||!!active||offset===0;
  el('next').disabled=!token||!!active||offset+limit>=total;
}
function clear(){
  active?.abort();
  active=null;
  token='';query='';offset=0;total=0;
  el('token').value='';el('filter').value='';
  el('tools').replaceChildren();el('status').textContent='';
  controls();
}
async function load(nextQuery,nextOffset){
  if(!token||active)return;
  const request=new AbortController();
  active=request;
  controls();
  el('status').textContent='Loading';
  try{
    const params=new URLSearchParams({q:nextQuery,offset:String(nextOffset),limit:String(limit)});
    const response=await fetch('/admin/catalog?'+params,{
      headers:{Authorization:'Bearer '+token},cache:'no-store',signal:request.signal
    });
    if(!response.ok)throw Error('Access denied');
    const data=await response.json();
    if(active!==request)return;
    query=nextQuery;offset=nextOffset;total=data.total;
    el('tools').replaceChildren();
    for(const tool of data.tools){
      const li=document.createElement('li');
      const name=document.createElement('strong');
      const description=document.createElement('p');
      name.textContent=tool.id;description.textContent=tool.description;
      li.append(name,description);
      el('tools').append(li);
    }
    const range=data.tools.length?(offset+1)+'–'+(offset+data.tools.length):'0';
    el('status').textContent=data.subject+' — '+range+' of '+total+' tools';
  }catch{
    if(active===request){el('tools').replaceChildren();el('status').textContent='Unable to load catalog';}
  }finally{
    if(active===request){active=null;controls();}
  }
}
el('login').onsubmit=event=>{
  event.preventDefault();
  const credential=el('token').value;
  clear();
  token=credential;
  void load('',0);
};
el('search').onsubmit=event=>{event.preventDefault();void load(el('filter').value,0);};
el('previous').onclick=()=>void load(query,Math.max(0,offset-limit));
el('next').onclick=()=>void load(query,offset+limit);
el('clear').onclick=clear;
</script></html>`;
