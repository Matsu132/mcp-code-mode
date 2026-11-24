'use client';

import {useState,type ReactNode} from 'react';
import {CssBaseline,ThemeProvider,createTheme} from '@mui/material';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';

const theme=createTheme({
  colorSchemes:{light:true,dark:true},
  cssVariables:{colorSchemeSelector:'class'},
  shape:{borderRadius:12},
});

export default function Providers({children}:{children:ReactNode}) {
  const [queryClient]=useState(()=>new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme} defaultMode="system" disableTransitionOnChange>
        <CssBaseline/>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
