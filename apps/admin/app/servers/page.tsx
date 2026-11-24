'use client';

import {useState} from 'react';
import {
  Alert,Box,Button,Checkbox,Chip,Dialog,DialogActions,DialogTitle,
  FormControlLabel,Paper,Snackbar,Stack,TextField,Typography,
} from '@mui/material';

type Server = {id:string;url:string;tokenEnv?:string;allow:string[];enabled:boolean};
type Managed = Server & {status:'ready'|'checking'|'error'|'disabled';tools:string[]};
const empty:Managed = {id:'',url:'',allow:[],enabled:true,status:'checking',tools:[]};
const labels = {ready:'接続済み',checking:'確認中',error:'接続エラー',disabled:'無効'};

function config({id,url,tokenEnv,allow,enabled}:Managed):Server {
  return {id:id.trim(),url:url.trim(),tokenEnv:tokenEnv?.trim()||undefined,allow:[...new Set(allow.map(t=>t.trim()).filter(Boolean))],enabled};
}

export default function Servers() {
  const [token,setToken] = useState('');
  const [servers,setServers] = useState<Managed[]|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [remove,setRemove] = useState<number|null>(null);
  const edit = (i:number,fields:Partial<Managed>) => setServers(items => items?.map((item,index)=>index===i?{...item,...fields}:item)??null);

  async function request(method:'GET'|'PUT'|'POST',action?:'test'|'refresh',index?:number) {
    setBusy(true);
    setError('');
    try {
      const entries = servers?.map(config)??[];
      const payload = method==='PUT' ? entries : index===undefined ? undefined : entries[index];
      if (payload && (Array.isArray(payload)?payload:[payload]).some(item=>
        !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || !/^https?:\/\//.test(item.url),
      )) throw Error('サーバーIDと接続先URLを確認してください。');
      const res = await fetch('/api/upstreams'+(action?'?action='+action:''),{
        method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:payload===undefined?undefined:JSON.stringify(payload),
      });
      if (!res.ok) throw Error('接続設定の読み込みまたは保存に失敗しました。URL、権限、認証設定を確認してください。');
      if (action==='test' && index!==undefined) {
        const test = await res.json() as {status:'ready'|'error';tools:string[]};
        edit(index,test);
        if (test.status==='error') setError('接続テストに失敗しました。URLと認証情報を確認してください。');
        else setNotice('接続テストに成功しました。');
        return;
      }
      setServers(await res.json() as Managed[]);
      if (method==='PUT') setNotice('接続設定を保存しました。');
    } catch (err) {
      setError(err instanceof Error?err.message:'操作に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box component="main" sx={{maxWidth:1050,mx:'auto',p:{xs:2,sm:3}}}>
      <Stack spacing={3}>
        <Typography variant="h4">MCP Servers</Typography>
        <Stack direction="row" spacing={2}><Button href="/">Dashboard</Button><Button href="/manage">権限管理</Button></Stack>
        <TextField label="Administrator access token" type="password" autoComplete="off" value={token} disabled={busy}
          onChange={e=>{setToken(e.target.value);setServers(null);setError('');}}/>
        <Button disabled={!token||busy} onClick={()=>void request('GET')}>保存済み設定を読み込む</Button>
        {error&&<Alert severity="error">{error}</Alert>}
        {servers&&<>
          {!servers.length&&<Alert severity="info">登録済みのMCPサーバーはありません。</Alert>}
          {servers.map((server,i)=><Paper variant="outlined" key={i} sx={{p:2}}>
            <Stack spacing={2}>
              <Stack direction={{xs:'column',sm:'row'}} spacing={2} alignItems={{sm:'center'}}>
                <TextField label="Server ID" value={server.id} disabled={busy} onChange={e=>edit(i,{id:e.target.value})}/>
                <Chip label={labels[server.enabled?server.status:'disabled']} color={server.status==='ready'&&server.enabled?'success':'default'}/>
                <FormControlLabel label="有効" control={<Checkbox checked={server.enabled} disabled={busy} onChange={e=>edit(i,{enabled:e.target.checked})}/>}/>
              </Stack>
              <TextField label="MCP endpoint URL" value={server.url} disabled={busy} onChange={e=>edit(i,{url:e.target.value})}/>
              <TextField label="Bearer token environment variable" value={server.tokenEnv??''} disabled={busy}
                helperText="認証なしの場合は空欄にします。Bearer認証の場合はGatewayで接続先に紐付けた環境変数名を指定します。"
                onChange={e=>edit(i,{tokenEnv:e.target.value})}/>
              <TextField label="Allowed tool names" value={server.allow.join(',')} disabled={busy} helperText="実行を許可するツール名をカンマで区切ります。"
                onChange={e=>edit(i,{allow:e.target.value.split(',')})}/>
              {!!server.tools.length && <Typography sx={{overflowWrap:'anywhere'}}>検出したツール　{server.tools.join(', ')}</Typography>}
              <Stack direction="row" spacing={2}>
                <Button disabled={busy} onClick={()=>void request('POST','test',i)}>接続テスト</Button>
                <Button color="error" disabled={busy} onClick={()=>setRemove(i)}>削除</Button>
              </Stack>
            </Stack>
          </Paper>)}
          <Stack direction={{xs:'column',sm:'row'}} spacing={2}>
            <Button disabled={busy||servers.length>=32} onClick={()=>setServers([...servers,{...empty}])}>サーバーを追加</Button>
            <Button disabled={busy} onClick={()=>void request('POST','refresh')}>保存済みサーバーのツール再取得</Button>
            <Button disabled={busy} variant="contained" onClick={()=>void request('PUT')}>保存</Button>
          </Stack>
        </>}
      </Stack>
      <Dialog open={remove!==null} onClose={()=>setRemove(null)}>
        <DialogTitle>このサーバーを削除しますか？</DialogTitle>
        <DialogActions>
          <Button onClick={()=>setRemove(null)}>キャンセル</Button>
          <Button color="error" onClick={()=>{setServers(items=>items?.filter((_,i)=>i!==remove)??null);setRemove(null);}}>削除</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!notice} message={notice} autoHideDuration={4000} onClose={()=>setNotice('')}/>
    </Box>
  );
}
