'use client'

import React from 'react'
import { ThemeProvider } from 'next-themes'

type ProvidersProps = {
  children: React.ReactNode
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      forcedTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="warehouse-theme"
    >
      {children}
    </ThemeProvider>
  )
}