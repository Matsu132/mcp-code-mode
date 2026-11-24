import type {Metadata} from 'next';
import {AppRouterCacheProvider} from '@mui/material-nextjs/v15-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import Providers from './providers';

export const metadata:Metadata={title:'MCP Code Mode | Administration',description:'Manage upstream MCP connections and tool access'};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="ja" suppressHydrationWarning>
    <body style={{margin:0}}>
      <InitColorSchemeScript attribute="class" defaultMode="system"/>
      <AppRouterCacheProvider><Providers>{children}</Providers></AppRouterCacheProvider>
    </body>
  </html>;
}
