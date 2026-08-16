import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Experimental features flag (2026-08-14, André: "add app zone, intervals workout, smart
// sensor ... enable it with a toggle on experimental. this way I can test all at once and I
// launch to the community they can also test"). One persisted boolean, mirrored on the same
// AsyncStorage/context pattern as ThemeModeContext, gating a whole "Experimental" section in
// Settings and the three unproven features behind it (App-Zone install, Intervals builder,
// Smart Sensor). Default OFF so nobody who never opens the toggle is exposed to an unproven
// flash write - these are cable-tested, community-feedback features, not shipped-on behaviour.

const STORAGE_KEY = 'ambitapp:experimental';

interface ExperimentalContextValue {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

const ExperimentalContext = createContext<ExperimentalContextValue>({
  enabled: false,
  setEnabled: () => {},
});

export function ExperimentalProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(v => {
      if (v === '1') setEnabledState(true);
    }).catch(() => {});
  }, []);

  function setEnabled(v: boolean) {
    setEnabledState(v);
    AsyncStorage.setItem(STORAGE_KEY, v ? '1' : '0').catch(() => {});
  }

  return (
    <ExperimentalContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </ExperimentalContext.Provider>
  );
}

export function useExperimental(): ExperimentalContextValue {
  return useContext(ExperimentalContext);
}
