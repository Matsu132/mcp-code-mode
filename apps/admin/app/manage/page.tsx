'use client';

import {useState} from 'react';
import {
  Alert,Box,Button,Checkbox,Dialog,DialogActions,DialogTitle,FormControlLabel,LinearProgress,
  Paper,Snackbar,Stack,Table,TableBody,TableCell,TableHead,TablePagination,
  TableRow,TextField,Typography,
} from '@mui/material';

type Rule = {subject:string;allow:string[]};
type Role = {id:string;read:boolean;execute:boolean;manage:boolean;servers:string[];tools:string[]};
type Assignment = {subject:string;role:string;disabled:boolean;enrollmentAllow?:string[]};
type Audit = {sequence:number;requestId:string;startedAt:string;time:string;subject:string;serverId:string|null;id:string;status:string;durationMs:number;kind:string};
type State = {rules:Rule[];roles:Role[];assignments:Assignment[]};

const builtins = ['admin','operator','viewer'];
const split = (value:string) => value.split(',');
const clean = (values:string[]) => [...new Set(values.map(value=>value.trim()).filter(Boolean))];
const blank:State = {rules:[],roles:[],assignments:[]};

function replace<T>(items:T[], index:number, patch:Partial<T>) {
  return items.map((item,i) => i === index ? {...item,...patch} : item);
}

export default function Manage() {
  const [token,setToken] = useState('');
  const [data,setData] = useState<State>(blank);
  const [busy,setBusy] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const [error,setError] = useState('');
  const [saved,setSaved] = useState(false);
  const [remove,setRemove] = useState<{section:'rules'|'roles'|'assignments';index:number}|null>(null);
  const [auditQuery,setAuditQuery] = useState('');
  const [page,setPage] = useState(0);
  const [audit,setAudit] = useState<Audit[]>([]);
  const [auditCount,setAuditCount] = useState(0);
  const [auditBusy,setAuditBusy] = useState(false);
  const [appliedQuery,setAppliedQuery] = useState('');
  const roles = [...builtins,...data.roles.map(role=>role.id).filter(Boolean)];
  const pageSize = 15;
  async function auditPage(index:number,query:string) {
    setAuditBusy(true);
    try {
      const params=new URLSearchParams({q:query,offset:String(index*pageSize),limit:String(pageSize)});
      const res=await fetch('/api/audit?'+params,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      if (!res.ok) throw Error('監査ログを取得できませんでした。');
      const data=await res.json() as {total:number;events:Audit[]};
      setAudit(data.events);
      setAuditCount(data.total);
      setPage(index);
      setAppliedQuery(query);
    }catch{
      setError('監査ログを取得できませんでした。');
    }finally{
      setAuditBusy(false);
    }
  }

  async function request(save = false) {
    setBusy(true);
    setError('');
    try {
      const payload = {
        rules:data.rules.map(rule=>({subject:rule.subject.trim(),allow:clean(rule.allow)})),
        roles:data.roles.map(role=>({...role,id:role.id.trim(),servers:clean(role.servers),tools:clean(role.tools)})),
        assignments:data.assignments.map(assignment=>({
          ...assignment,subject:assignment.subject.trim(),
          enrollmentAllow:assignment.enrollmentAllow===undefined?undefined:clean(assignment.enrollmentAllow),
        })),
      };
      if (save && (payload.rules.some(rule=>!rule.subject) || payload.roles.some(role=>!/^[a-z][a-z0-9_-]{0,63}$/.test(role.id)) ||
        payload.assignments.some(assignment=>!assignment.subject || !roles.includes(assignment.role)))) {
        throw Error('Subject とロールIDを確認してください。');
      }
      const res = await fetch('/api/state',{
        method:save?'PUT':'GET',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:save?JSON.stringify(payload):undefined,
      });
      if (!res.ok) throw Error('管理者認証または更新に失敗しました。重複する Subject とロールIDも確認してください。');
      setData(await res.json() as State);
      setLoaded(true);
      setAuditQuery('');
      await auditPage(0,'');
      if (save) setSaved(true);
    } catch (err) {
      setError(err instanceof Error?err.message:'更新に失敗しました。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box component="main" sx={{maxWidth:1100,mx:'auto',p:{xs:2,sm:3}}}>
      <Stack spacing={3}>
        <Typography variant="h4">権限管理・監査ログ</Typography>
        <Button href="/">Dashboard</Button>
        <TextField label="Administrator access token" type="password" autoComplete="off" value={token}
          disabled={busy||auditBusy} onChange={e=>{setToken(e.target.value);setLoaded(false);setData(blank);setAudit([]);setAuditCount(0);setError('');}}/>
        <Button disabled={!token||busy} onClick={()=>void request()}>読み込み</Button>
        {error && <Alert severity="error">{error}</Alert>}
        {loaded && <>
          <Paper sx={{p:2}}>
            <Stack spacing={2}>
              <Typography variant="h6">ユーザーとロール</Typography>
              <Alert severity="info">信頼済み発行元の Subject を登録し、ロールを割り当てます。環境変数に登録済みのユーザーには、元のツール許可リストも適用されます。</Alert>
              {data.assignments.map((assignment,i)=><Paper key={i} variant="outlined" sx={{p:2}}><Stack spacing={1}>
                <Stack spacing={1} direction={{xs:'column',sm:'row'}}>
                <TextField label="User subject" value={assignment.subject} disabled={busy}
                  onChange={e=>setData(old=>({...old,assignments:replace(old.assignments,i,{subject:e.target.value})}))}/>
                <TextField select slotProps={{select:{native:true}}} label="Role" value={roles.includes(assignment.role)?assignment.role:''} disabled={busy}
                  sx={{minWidth:150}} onChange={e=>setData(old=>({...old,assignments:replace(old.assignments,i,{role:e.target.value})}))}>
                  {roles.map((role,index)=><option key={index} value={role}>{role}</option>)}
                </TextField>
                <FormControlLabel label="無効" control={<Checkbox checked={assignment.disabled} disabled={busy}
                  onChange={e=>setData(old=>({...old,assignments:replace(old.assignments,i,{disabled:e.target.checked})}))}/>}/>
                <Button color="error" disabled={busy} onClick={()=>setRemove({section:'assignments',index:i})}>削除</Button>
                </Stack>
                <FormControlLabel label="ユーザーをGatewayに登録" control={<Checkbox checked={assignment.enrollmentAllow!==undefined} disabled={busy}
                  onChange={e=>setData(old=>({...old,assignments:replace(old.assignments,i,{enrollmentAllow:e.target.checked?[]:undefined})}))}/>}/>
                {assignment.enrollmentAllow!==undefined&&<TextField label="Enrollment tool IDs" value={assignment.enrollmentAllow.join(',')}
                  helperText="この画面で新規登録したSubjectに許可するツールIDをカンマで区切ります。"
                  disabled={busy} onChange={e=>setData(old=>({...old,assignments:replace(old.assignments,i,{enrollmentAllow:split(e.target.value)})}))}/>}
              </Stack></Paper>)}
              <Button disabled={busy} onClick={()=>setData(old=>({...old,assignments:[...old.assignments,{subject:'',role:'viewer',disabled:false}]}))}>ユーザーを追加</Button>
              <Typography variant="h6">カスタムロール</Typography>
              {data.roles.map((role,i)=><Paper key={i} variant="outlined" sx={{p:2}}>
                <Stack spacing={2}>
                  <TextField label="Role ID" value={role.id} disabled={busy||data.assignments.some(item=>item.role===role.id)}
                    onChange={e=>setData(old=>({...old,roles:replace(old.roles,i,{id:e.target.value})}))}/>
                  <Stack direction={{xs:'column',sm:'row'}}>
                    {(['read','execute','manage'] as const).map(operation=><FormControlLabel key={operation} label={operation}
                      control={<Checkbox checked={role[operation]} disabled={busy}
                        onChange={e=>setData(old=>({...old,roles:replace(old.roles,i,{[operation]:e.target.checked})}))}/>}/>)}
                  </Stack>
                  <TextField label="Allowed server IDs" value={role.servers.join(',')} disabled={busy} helperText="カンマ区切り。全件を許可する場合は * を入力します。"
                    onChange={e=>setData(old=>({...old,roles:replace(old.roles,i,{servers:split(e.target.value)})}))}/>
                  <TextField label="Role tool IDs" value={role.tools.join(',')} disabled={busy} helperText="形式は server.tool。全件を許可する場合は * を入力します。"
                    onChange={e=>setData(old=>({...old,roles:replace(old.roles,i,{tools:split(e.target.value)})}))}/>
                  <Button color="error" disabled={busy||data.assignments.some(item=>item.role===role.id)} onClick={()=>setRemove({section:'roles',index:i})}>削除</Button>
                </Stack>
              </Paper>)}
              <Button disabled={busy} onClick={()=>setData(old=>({...old,roles:[...old.roles,{id:'',read:true,execute:false,manage:false,servers:[],tools:[]}]}))}>ロールを追加</Button>
              <Typography variant="h6">追加のユーザー別制限</Typography>
              {data.rules.map((rule,i)=><Stack key={i} spacing={1} direction={{xs:'column',sm:'row'}}>
                <TextField label="Subject" value={rule.subject} disabled={busy}
                  onChange={e=>setData(old=>({...old,rules:replace(old.rules,i,{subject:e.target.value})}))}/>
                <TextField fullWidth label="Allowed tool IDs (comma separated)" value={rule.allow.join(',')} disabled={busy}
                  onChange={e=>setData(old=>({...old,rules:replace(old.rules,i,{allow:split(e.target.value)})}))}/>
                <Button color="error" disabled={busy} onClick={()=>setRemove({section:'rules',index:i})}>削除</Button>
              </Stack>)}
              <Button disabled={busy} onClick={()=>setData(old=>({...old,rules:[...old.rules,{subject:'',allow:[]}]}))}>追加</Button>
              <Button variant="contained" disabled={busy} onClick={()=>void request(true)}>保存</Button>
            </Stack>
          </Paper>
          <Paper id="execution-logs" sx={{p:2,overflowX:'auto'}}>
            <Typography variant="h6" gutterBottom>実行履歴・監査ログ</Typography>
            <Stack component="form" direction="row" spacing={2} sx={{mb:2}}
              onSubmit={event=>{event.preventDefault();if(!auditBusy&&!busy){setError('');void auditPage(0,auditQuery);}}}>
              <TextField label="監査ログを検索" size="small" value={auditQuery} onChange={e=>setAuditQuery(e.target.value)} slotProps={{htmlInput:{maxLength:200}}}/>
              <Button type="submit" disabled={auditBusy||busy}>検索</Button>
            </Stack>
            {auditBusy&&<LinearProgress aria-label="監査ログを読み込み中"/>}
            <Table size="small" aria-label="監査ログ">
              <TableHead>
                <TableRow>{['End','Start','Request','Subject','Server','Tool','Event','Status','ms'].map(label=><TableCell key={label}>{label}</TableCell>)}</TableRow>
              </TableHead>
              <TableBody>
                {audit.map(event=><TableRow key={event.sequence}>
                  {[event.time,event.startedAt,event.requestId,event.subject,event.serverId,event.id,event.kind,event.status,event.durationMs]
                    .map((value,i)=><TableCell key={i}>{value??'—'}</TableCell>)}
                </TableRow>)}
                {!audit.length && <TableRow><TableCell colSpan={9}>表示できる監査ログがありません。</TableCell></TableRow>}
              </TableBody>
            </Table>
            <TablePagination component="div" count={auditCount} rowsPerPage={pageSize} rowsPerPageOptions={[pageSize]} page={page}
              onPageChange={(_,next)=>{if(!auditBusy&&!busy){setError('');void auditPage(next,appliedQuery);}}}/>
          </Paper>
        </>}
      </Stack>
      <Dialog open={remove!==null} onClose={()=>setRemove(null)}>
        <DialogTitle>この項目を削除しますか？</DialogTitle>
        <DialogActions>
          <Button onClick={()=>setRemove(null)}>キャンセル</Button>
          <Button color="error" onClick={()=>{
            if (remove) setData(old=>({...old,[remove.section]:old[remove.section].filter((_,i)=>i!==remove.index)}));
            setRemove(null);
          }}>削除</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={saved} message="権限設定を保存しました。" autoHideDuration={4000} onClose={()=>setSaved(false)}/>
    </Box>
  );
}
