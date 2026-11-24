import type {Metadata} from 'next';
import {AppRouterCacheProvider} from '@mui/material-nextjs/v15-appRouter';
export const metadata:Metadata={title:'MCP Code Mode | Administration',description:'Authorized MCP tool catalog'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body style={{margin:0}}><AppRouterCacheProvider>{children}</AppRouterCacheProvider></body></html>;}
