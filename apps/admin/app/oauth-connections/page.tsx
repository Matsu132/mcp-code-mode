'use client';

import {Suspense,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {Alert,Box,Button,Chip,Dialog,DialogActions,DialogTitle,Paper,Stack,TextField,Typography} from '@mui/material';

type Connection = {id:string;canConnect:boolean;status:'connected'|'disconnected'|'expired'|'unavailable'};
const labels = {connected:'接続済み',disconnected:'未接続',expired:'期限切れ',unavailable:'読み込み不可'};

export default function OAuthConnections() {
  return <Suspense fallback={<Box component="main" sx={{p:3}}>接続画面を読み込み中です。</Box>}><Connections/></Suspense>;
}
function Connections() {
  const [token,setToken] = useState('');
  const [connections,setConnections] = useState<Connection[]|null>(null);
  const [pending,setPending] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState<{error:boolean;text:string}|null>(null);
  const callback = useSearchParams().get('result');
  async function request(action?:'connect'|'disconnect',id?:string) {
    setBusy(true);
    setMessage(null);
    try {
      const headers = {Authorization:'Bearer '+token,'Content-Type':'application/json'};
      if (action) {
        const result = await fetch('/api/oauth',{method:'POST',headers,body:JSON.stringify({action,id})});
        if (!result.ok) throw Error('OAuth接続の変更に失敗しました。');
        if (action==='connect') {
          const {authorizationUrl} = await result.json() as {authorizationUrl:string};
          const url = new URL(authorizationUrl);
          if (url.protocol!=='https:') throw Error('OAuth認可URLが不正です。');
          window.location.assign(url.href);
          return;
        }
        const {revoked} = await result.json() as {revoked:boolean};
        setMessage({error:false,text:revoked?'接続を解除し、上流でトークンを失効しました。':'Gatewayに保存した認証情報を削除しました。'});
      }
      const result = await fetch('/api/oauth',{headers,cache:'no-store'});
      if (!result.ok) throw Error('接続を読み込めませんでした。');
      setConnections(await result.json() as Connection[]);
    } catch (err) {
      setMessage({error:true,text:err instanceof Error?err.message:'操作に失敗しました。'});
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box component="main" sx={{maxWidth:850,mx:'auto',p:{xs:2,sm:3}}}>
      <Stack spacing={3}>
        <Typography variant="h4">OAuth Connections</Typography>
        <Button href="/">Dashboard</Button>
        {callback==='connected'&&<Alert severity="success">上流MCPへのOAuth接続を保存しました。</Alert>}
        {callback==='failed'&&<Alert severity="error">認可を完了できませんでした。接続を開始したブラウザーでやり直してください。</Alert>}
        <TextField label="Gateway access token" type="password" autoComplete="off" value={token} disabled={busy}
          onChange={e=>{setToken(e.target.value);setConnections(null);setMessage(null);}}/>
        <Button disabled={!token||busy} onClick={()=>void request()}>接続状況を読み込む</Button>
        {message&&<Alert severity={message.error?'error':'success'}>{message.text}</Alert>}
        {connections?.map(connection=><Paper key={connection.id} variant="outlined" sx={{p:2}}>
          <Stack direction={{xs:'column',sm:'row'}} spacing={2} alignItems={{sm:'center'}}>
            <Typography sx={{flex:1}}>{connection.id}</Typography>
            <Chip label={labels[connection.status]} color={connection.status==='connected'?'success':'default'}/>
            <Button disabled={busy||!connection.canConnect} onClick={()=>void request('connect',connection.id)}>
              {connection.status==='connected'?'再認可':'接続'}
            </Button>
            <Button color="error" disabled={busy||connection.status==='disconnected'} onClick={()=>setPending(connection.id)}>解除</Button>
          </Stack>
        </Paper>)}
        {connections?.length===0&&<Alert severity="info">このユーザーが利用できるOAuth接続先はありません。</Alert>}
      </Stack>
      <Dialog open={pending!==null} onClose={()=>setPending(null)}>
        <DialogTitle>このOAuth接続を解除しますか？</DialogTitle>
        <DialogActions>
          <Button onClick={()=>setPending(null)}>キャンセル</Button>
          <Button color="error" onClick={()=>{const id=pending;setPending(null);if(id)void request('disconnect',id);}}>解除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
