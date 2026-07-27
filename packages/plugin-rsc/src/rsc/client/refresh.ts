import { createContext, useContext } from 'react';

export type RscRefresh = () => Promise<void>;

export const RscRefreshContext = createContext<RscRefresh | null>(null);

export function useRscRefresh(): RscRefresh {
  const refresh = useContext(RscRefreshContext);
  if (!refresh) {
    throw new Error('useRscRefresh() must be used inside a rendered RSC root.');
  }
  return refresh;
}
