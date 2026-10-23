import { showStartupFailure } from './startup.ts'

// Catch initialization errors from the app or its connection modules before mounting React.
void import('./mount.tsx').catch(showStartupFailure)
