import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Experimental features (2026-08-14, André: "add app zone, intervals workout, smart sensor").
// Reworked 2026-08-17 (André: "make a toggle for each one of them, put experimental features on
// title") from ONE master switch to one persisted flag per feature, so each unproven feature can
// be enabled independently. All default OFF so nobody who never opens the section is exposed to
// an unproven flash write - these are cable-tested, community-feedback features. Same
// AsyncStorage/context pattern as ThemeModeContext. The three feature SCREENS are always
// registered in navigation; a flag only controls whether Settings offers its entry point.

export type ExpFeature = 'intervals' | 'smartSensor';
export const EXP_FEATURES: ExpFeature[] = ['intervals', 'smartSensor'];
const storageKey = (f: ExpFeature) => `ambitapp:experimental:${f}`;

type FeatureFlags = Record<ExpFeature, boolean>;
const ALL_OFF: FeatureFlags = { intervals: false, smartSensor: false };

interface ExperimentalContextValue {
  features: FeatureFlags;
  setFeature: (f: ExpFeature, v: boolean) => void;
  anyEnabled: boolean;
}

const ExperimentalContext = createContext<ExperimentalContextValue>({
  features: ALL_OFF,
  setFeature: () => {},
  anyEnabled: false,
});

export function ExperimentalProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<FeatureFlags>(ALL_OFF);

  useEffect(() => {
    (async () => {
      const loaded: FeatureFlags = { ...ALL_OFF };
      for (const f of EXP_FEATURES) {
        try {
          if ((await AsyncStorage.getItem(storageKey(f))) === '1') loaded[f] = true;
        } catch { /* ignore */ }
      }
      // One-time migration from the old single master toggle: if it was on, enable all three.
      try {
        if ((await AsyncStorage.getItem('ambitapp:experimental')) === '1') {
          for (const f of EXP_FEATURES) loaded[f] = true;
          await AsyncStorage.removeItem('ambitapp:experimental');
          for (const f of EXP_FEATURES) await AsyncStorage.setItem(storageKey(f), '1');
        }
      } catch { /* ignore */ }
      setFeatures(loaded);
    })();
  }, []);

  function setFeature(f: ExpFeature, v: boolean) {
    setFeatures(prev => ({ ...prev, [f]: v }));
    AsyncStorage.setItem(storageKey(f), v ? '1' : '0').catch(() => {});
  }

  const anyEnabled = EXP_FEATURES.some(f => features[f]);

  return (
    <ExperimentalContext.Provider value={{ features, setFeature, anyEnabled }}>
      {children}
    </ExperimentalContext.Provider>
  );
}

export function useExperimental(): ExperimentalContextValue {
  return useContext(ExperimentalContext);
}
