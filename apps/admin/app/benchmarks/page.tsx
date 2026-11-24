'use client';

import {useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import {
  Alert,Box,Button,LinearProgress,Paper,Stack,Table,TableBody,TableCell,TableContainer,
  TableHead,TableRow,TextField,Typography,
} from '@mui/material';

type Comparison = {encoding:string;tools:number;directTokens:number;codeModeTokens:number;reduction:number};
type Estimate = {comparisons:Comparison[]};
type Result = {
  synthetic:Estimate;catalog:(Estimate&{sampledTools:number;totalTools:number})|null;
  latency:{runs:number;averageMs:number|null;retentionDays:number};
};

function Chart({estimate,label}:{estimate:Estimate;label:string}) {
  return <Paper variant="outlined" sx={{p:2}}>
    <Typography variant="h6" gutterBottom>{label}</Typography>
    <TableContainer><Table size="small" aria-label={label}>
      <TableHead><TableRow>{['Encoding','Tools','通常方式','Code Mode','削減率'].map(column=><TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead>
      <TableBody>
        {estimate.comparisons.map(row=>{
          const max=Math.max(row.directTokens,row.codeModeTokens);
          return <TableRow key={row.encoding+String(row.tools)}>
            <TableCell>{row.encoding}</TableCell>
            <TableCell>{row.tools}</TableCell>
            {[row.directTokens,row.codeModeTokens].map((value,i)=><TableCell key={i} sx={{minWidth:90}}>
              <Typography variant="body2">{value.toLocaleString()}</Typography>
              <Box aria-hidden="true" sx={{height:5,borderRadius:1,width:`${100*value/max}%`,bgcolor:i===0?'text.secondary':'primary.main'}}/>
            </TableCell>)}
            <TableCell>{(row.reduction*100).toFixed(1)}%</TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table></TableContainer>
  </Paper>;
}

export default function Benchmarks() {
  const [token,setToken] = useState('');
  const request = useMutation({
    mutationFn:async () => {
      const res = await fetch('/api/benchmarks',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      if (!res.ok) throw Error('ベンチマークを取得できませんでした。管理権限とGatewayを確認してください。');
      return await res.json() as Result;
    },
  });
  const data = request.data;

  return <Box component="main" sx={{maxWidth:1000,mx:'auto',p:{xs:2,sm:3}}}>
    <Stack spacing={3}>
      <Typography variant="h4">Benchmarks</Typography>
      <Button href="/">Dashboard</Button>
      <TextField label="Administrator access token" type="password" autoComplete="off" value={token} disabled={request.isPending}
        onChange={e=>{setToken(e.target.value);request.reset();}}/>
      <Button variant="contained" disabled={!token||request.isPending} onClick={()=>request.mutate()}>比較を計算</Button>
      {request.isPending&&<LinearProgress aria-label="ベンチマークを計算中"/>}
      {request.error&&<Alert severity="error">{request.error.message}</Alert>}
      {data&&<>
        <Typography color="text.secondary">1回の操作に含まれるツール定義、検索、スキーマ取得、実行のJSONトークン推定値です。</Typography>
        <Chart estimate={data.synthetic} label="合成ツールカタログ"/>
        {data.catalog?<Chart estimate={data.catalog} label={`実カタログ（${data.catalog.sampledTools} / ${data.catalog.totalTools} ツール）`}/>
          :<Alert severity="info">計算対象となるツールがありません。</Alert>}
        <Paper variant="outlined" sx={{p:2}}>
          <Typography variant="h6">Gateway 実測レイテンシ</Typography>
          <Typography color="text.secondary">
            {data.latency.runs
              ? `過去 ${data.latency.retentionDays} 日間の自分の実行 ${data.latency.runs} 件。平均 ${Math.round(data.latency.averageMs??0)} ms。`
              : 'このユーザーの実行履歴がありません。'}
          </Typography>
        </Paper>
      </>}
    </Stack>
  </Box>;
}
