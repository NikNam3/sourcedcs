import React, { createContext, useContext, useEffect, useState } from 'react';
import type { RuntimeConfig } from '../types';

const defaults: RuntimeConfig = {
  casdoorClientId: '',
  casdoorEndpoint: '',
  discordUrl: '',
  wikiUrl: '',
  atoUrl: '',
  olympusUrl: '',
  asacsUrl: '',
  githubUrl: '',
  skillAdminRoles: ['admin'],
};

const ConfigContext = createContext<RuntimeConfig>(defaults);
export const useConfig = () => useContext(ConfigContext);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<RuntimeConfig>(defaults);

  useEffect(() => {
    fetch('/api/runtime-config')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}
