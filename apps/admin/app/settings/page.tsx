'use client';

import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {Alert,Box,Button,LinearProgress,Paper,Snackbar,Stack,TextField,Typography} from '@mui/material';

const validation=z.object({
  concurrency:z.number().int().min(1).max(16),
  queueSize:z.number().int().min(0).max(32),
  queueWaitMs:z.number().int().min(100).max(15000),
  timeoutMs:z.number().int().min(100).max(15000),
});
type Settings=z.infer<typeof validation>;
const fields=[
  {name:'concurrency',label:'Maximum concurrent executions',min:1,max:16},
  {name:'queueSize',label:'Maximum queued executions',min:0,max:32},
  {name:'queueWaitMs',label:'Queue wait deadline (ms)',min:100,max:15000},
  {name:'timeoutMs',label:'Sandbox execution deadline (ms)',min:100,max:15000},
] as const;

export default function SettingsPage() {
  const [token,setToken]=useState('');
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState(false);
  const [error,setError]=useState('');
  const form=useForm<Settings>();

  async function request(values?:Settings) {
    setBusy(true);
    setError('');
    try {
      const settings=values?validation.parse(values):undefined;
      const res=await fetch('/api/settings',{
        method:settings?'PUT':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:settings?JSON.stringify(settings):undefined,cache:'no-store',
      });
      if(!res.ok)throw Error('設定の読み込みまたは保存に失敗しました。');
      form.reset(validation.parse(await res.json()));
      setLoaded(true);
      if(settings)setSaved(true);
    }catch{
      setError('設定の読み込みまたは保存に失敗しました。数値、権限、Gatewayの状態を確認してください。');
    }finally{setBusy(false);}
  }

  return <Box component="main" sx={{maxWidth:750,mx:'auto',p:{xs:2,sm:3}}}>
    <Stack spacing={3}>
      <Typography variant="h4">Settings</Typography>
      <Button href="/">Dashboard</Button>
      <TextField label="Administrator access token" type="password" autoComplete="off" value={token} disabled={busy}
        onChange={e=>{setToken(e.target.value);setLoaded(false);setError('');}}/>
      <Button disabled={!token||busy} onClick={()=>void request()}>実行設定を読み込む</Button>
      {busy&&<LinearProgress aria-label="実行設定を処理中"/>}
      {error&&<Alert severity="error">{error}</Alert>}
      {loaded&&<Paper variant="outlined" sx={{p:3}}>
        <Stack component="form" spacing={2} onSubmit={form.handleSubmit(values=>request(values))}>
          <Typography variant="h6">Sandbox</Typography>
          {fields.map(({name,label,min,max})=>{
            const {ref,...input}=form.register(name,{valueAsNumber:true,required:true,min,max,validate:Number.isInteger});
            const feedback=form.formState.errors[name];
            return <TextField key={name} {...input} inputRef={ref} label={label} type="number"
              slotProps={{inputLabel:{shrink:true},htmlInput:{min,max,step:1}}} disabled={busy}
              error={!!feedback} helperText={feedback?`${min}〜${max} の整数を入力してください。`:undefined}/>;
          })}
          <Typography variant="body2" color="text.secondary">QuickJSのヒープは32 MiB、1回の実行で呼び出せるツールは20件です。</Typography>
          <Button variant="contained" type="submit" disabled={busy}>保存</Button>
        </Stack>
      </Paper>}
    </Stack>
    <Snackbar open={saved} message="実行設定を保存しました。" autoHideDuration={4000} onClose={()=>setSaved(false)}/>
  </Box>;
}
