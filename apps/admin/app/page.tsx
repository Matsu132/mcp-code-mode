'use client';

import {useRef,useState} from 'react';
import {
  Alert,AppBar,Box,Button,Card,CardContent,Chip,CircularProgress,Dialog,
  DialogActions,DialogContent,DialogTitle,Divider,Drawer,IconButton,List,ListItemButton,
  ListItemIcon,ListItemText,Paper,Stack,Table,TableBody,TableCell,TableContainer,TableHead,
  TablePagination,TableRow,TextField,Toolbar,Typography,useColorScheme,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/DashboardOutlined';
import BuildIcon from '@mui/icons-material/BuildOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';

type Tool = {id:string;description:string};
type Catalog = {
  subject:string;tools:Tool[];total:number;visibleTools:number;visibleServers:number;
  executions:{runs:number;successes:number;averageMs:number|null;retentionDays:number};
};
type Detail = {id:string;inputSchema:unknown;typescript:string};
const drawerWidth = 235;
const pageSize = 15;
const sections = [
  {id:'dashboard',label:'Dashboard',icon:<DashboardIcon/>},
  {id:'tools',label:'Tools',icon:<BuildIcon/>},
] as const;

export default function Page() {
  const {mode,systemMode,setMode}=useColorScheme();
  const dark=(mode==='system'?systemMode:mode)==='dark';
  const [mobile,setMobile] = useState(false);
  const [tab,setTab] = useState<'dashboard'|'tools'>('dashboard');
  const [token,setToken] = useState('');
  const [sessionToken,setSessionToken] = useState('');
  const [catalog,setCatalog] = useState<Catalog|null>(null);
  const [search,setSearch] = useState('');
  const [applied,setApplied] = useState('');
  const [page,setPage] = useState(0);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [detail,setDetail] = useState<Detail|null>(null);
  const [detailBusy,setDetailBusy] = useState(false);

  const catalogRequest=useRef<AbortController|null>(null);
  const detailRequest=useRef<AbortController|null>(null);

  function clearSession() {
    catalogRequest.current?.abort();
    detailRequest.current?.abort();
    catalogRequest.current=null;
    detailRequest.current=null;
    setBusy(false);
    setDetailBusy(false);
    setDetail(null);
    setCatalog(null);
    setToken('');
    setSessionToken('');
    setSearch('');
    setApplied('');
    setPage(0);
    setError('');
  }

  async function load(credential:string, query='', index=0, authenticate=false) {
    if(authenticate)clearSession();
    else if(catalogRequest.current)return;
    const request=new AbortController();
    catalogRequest.current=request;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({q:query,limit:String(pageSize),offset:String(index*pageSize)});
      const response = await fetch('/api/catalog?'+params,{
        headers:{Authorization:'Bearer '+credential},cache:'no-store',signal:request.signal,
      });
      const data = await response.json();
      if(request.signal.aborted)return;
      if (!response.ok) throw Error(data.error??'Request failed');
      setCatalog(data as Catalog);
      setSessionToken(credential);
      setApplied(query);
      setPage(index);
    } catch (err) {
      if(!request.signal.aborted)setError(err instanceof Error?err.message:'Request failed');
    } finally {
      if(catalogRequest.current===request){
        catalogRequest.current=null;
        setBusy(false);
      }
    }
  }

  async function inspect(id:string) {
    if(detailRequest.current||!sessionToken)return;
    const request=new AbortController();
    detailRequest.current=request;
    setError('');
    setDetailBusy(true);
    try {
      const response = await fetch('/api/catalog?'+new URLSearchParams({tool:id}),{
        headers:{Authorization:'Bearer '+sessionToken},cache:'no-store',signal:request.signal,
      });
      if (!response.ok) throw Error('ツールのスキーマを取得できませんでした。');
      const data=await response.json() as Detail;
      if(!request.signal.aborted)setDetail(data);
    } catch (err) {
      if(!request.signal.aborted)setError(err instanceof Error?err.message:'取得に失敗しました。');
    } finally {
      if(detailRequest.current===request){
        detailRequest.current=null;
        setDetailBusy(false);
      }
    }
  }

  const rate = catalog?.executions.runs
    ? 100*catalog.executions.successes/catalog.executions.runs
    : null;
  const cards = [
    {label:'Visible servers',value:catalog?.visibleServers},
    {label:'Visible tools',value:catalog?.visibleTools},
    {label:'Executions',value:catalog?.executions.runs},
    {label:'Success rate',value:rate===null?null:rate.toFixed(1)+'%'},
    {label:'Error rate',value:rate===null?null:(100-rate).toFixed(1)+'%'},
  ];
  const navigation = <Box sx={{p:2}}>
    <Typography variant="h6" fontWeight={700}>Code Mode</Typography>
    <Typography variant="caption" color="text.secondary">MCP Gateway</Typography>
    <Divider sx={{my:2}}/>
    <List>
      {sections.map(section=><ListItemButton key={section.id} selected={tab===section.id}
        onClick={()=>{setTab(section.id);setMobile(false);}} sx={{borderRadius:2,mb:1}}>
        <ListItemIcon>{section.icon}</ListItemIcon><ListItemText primary={section.label}/>
      </ListItemButton>)}
      <ListItemButton href="/servers"><ListItemText primary="MCP Servers"/></ListItemButton>
      <ListItemButton href="/oauth-connections"><ListItemText primary="OAuth Connections"/></ListItemButton>
      <ListItemButton href="/benchmarks"><ListItemText primary="Benchmarks"/></ListItemButton>
      <ListItemButton href="/manage#execution-logs"><ListItemText primary="Execution Logs"/></ListItemButton>
      <ListItemButton href="/settings"><ListItemText primary="Settings"/></ListItemButton>
    </List>
  </Box>;

  return (
    <>
      <Box sx={{display:'flex',minHeight:'100vh',bgcolor:'background.default'}}>
        <AppBar position="fixed" elevation={0} color="inherit" sx={{borderBottom:1,borderColor:'divider',zIndex:t=>t.zIndex.drawer+1}}>
          <Toolbar>
            <IconButton aria-label="Open navigation" onClick={()=>setMobile(true)} sx={{display:{md:'none'},mr:1}}><MenuIcon/></IconButton>
            <Typography variant="h6" sx={{flex:1}}>MCP Code Mode</Typography>
            <Button href="/manage">管理</Button>
            <IconButton aria-label="Toggle color mode" onClick={()=>setMode(dark?'light':'dark')}>{dark?<LightModeIcon/>:<DarkModeIcon/>}</IconButton>
            <Chip icon={<LockIcon/>} label={catalog?'Authenticated':'Locked'} color={catalog?'success':'default'} size="small"/>
          </Toolbar>
        </AppBar>
        <Box component="nav" aria-label="Main navigation" sx={{width:{md:drawerWidth},flexShrink:{md:0}}}>
          <Drawer variant="temporary" open={mobile} onClose={()=>setMobile(false)}
            sx={{display:{xs:'block',md:'none'},'& .MuiDrawer-paper':{width:drawerWidth}}}><Toolbar/>{navigation}</Drawer>
          <Drawer variant="permanent" sx={{display:{xs:'none',md:'block'},'& .MuiDrawer-paper':{width:drawerWidth}}}>
            <Toolbar/>{navigation}
          </Drawer>
        </Box>
        <Box component="main" sx={{flexGrow:1,minWidth:0,p:{xs:2,md:4}}}>
          <Toolbar/>
          <Stack spacing={3}>
            <Typography variant="h4" fontWeight={700}>{tab==='dashboard'?'Dashboard':'Tools'}</Typography>
            <Paper variant="outlined" sx={{p:3}}>
              <Stack spacing={2}>
                <Typography variant="h6">Gateway authentication</Typography>
                <Stack component="form" direction={{xs:'column',sm:'row'}} spacing={2}
                  onSubmit={event=>{event.preventDefault();if(token&&!busy)void load(token,'',0,true);}}>
                  <TextField fullWidth label="Access token" type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/>
                  <Button type="submit" variant="contained" disabled={!token||busy} sx={{whiteSpace:'nowrap'}}>Load catalog</Button>
                  <Button onClick={clearSession}>Clear</Button>
                </Stack>
                {catalog&&<Alert severity="success">Subject: {catalog.subject}</Alert>}
              </Stack>
            </Paper>
            {error&&<Alert severity="error">{error}</Alert>}
            {tab==='dashboard'&&<Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,1fr)',lg:'repeat(5,1fr)'},gap:2}}>
              {cards.map(card=><Card key={card.label} variant="outlined"><CardContent>
                <Typography color="text.secondary">{card.label}</Typography>
                <Typography variant="h5" fontWeight={700}>{card.value??'—'}</Typography>
              </CardContent></Card>)}
            </Box>}
            <Paper variant="outlined" sx={{p:2}}>
              <Stack spacing={2}>
                <Typography variant="h6">Authorized tools</Typography>
                <Stack component="form" direction="row" spacing={1}
                  onSubmit={event=>{event.preventDefault();if(sessionToken&&!busy)void load(sessionToken,search);}}>
                  <TextField size="small" fullWidth label="Search tools" value={search} onChange={e=>setSearch(e.target.value)} inputProps={{maxLength:200}}/>
                  <Button type="submit" disabled={!sessionToken||busy}>検索</Button>
                </Stack>
                {(busy||detailBusy)&&<CircularProgress size={22} aria-label="Loading Gateway data"/>}
                <TableContainer><Table size="small">
                  <TableHead><TableRow><TableCell>Tool ID</TableCell><TableCell>Description</TableCell></TableRow></TableHead>
                  <TableBody>
                    {catalog?.tools.map(tool=><TableRow key={tool.id}>
                      <TableCell sx={{overflowWrap:'anywhere'}}>
                        <Button disabled={detailBusy} onClick={()=>void inspect(tool.id)} sx={{textTransform:'none',textAlign:'left'}}>{tool.id}</Button>
                      </TableCell>
                      <TableCell sx={{overflowWrap:'anywhere'}}>{tool.description}</TableCell>
                    </TableRow>)}
                    {!catalog?.tools.length&&<TableRow><TableCell colSpan={2}>{catalog?'No matching tools':'Authenticate to view tools'}</TableCell></TableRow>}
                  </TableBody>
                </Table></TableContainer>
                {catalog&&<TablePagination component="div" count={catalog.total} page={page} rowsPerPage={pageSize}
                  rowsPerPageOptions={[pageSize]} disabled={busy} onPageChange={(_,index)=>void load(sessionToken,applied,index)}/>}
              </Stack>
            </Paper>
          </Stack>
        </Box>
      </Box>
      <Dialog open={detail!==null} onClose={()=>setDetail(null)} maxWidth="md" fullWidth>
        <DialogTitle>{detail?.id}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="subtitle1">JSON Schema</Typography>
          <Box component="pre" sx={{overflowX:'auto'}}>{JSON.stringify(detail?.inputSchema,null,2)}</Box>
          <Typography variant="subtitle1">TypeScript</Typography>
          <Box component="pre" sx={{overflowX:'auto'}}>{detail?.typescript}</Box>
        </DialogContent>
        <DialogActions><Button onClick={()=>setDetail(null)}>閉じる</Button></DialogActions>
      </Dialog>
    </>
  );
}
