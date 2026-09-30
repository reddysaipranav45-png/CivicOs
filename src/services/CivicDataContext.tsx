import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { civicApi, type CitizenRequest, type Hotspot } from './api';

type CivicData = {
  hotspots: Hotspot[];
  requests: CitizenRequest[];
  loading: boolean;
  error: string;
  refresh: () => void;
};

const CivicDataContext = createContext<CivicData | null>(null);

export function CivicDataProvider({ children }: PropsWithChildren) {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [requests, setRequests] = useState<CitizenRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([civicApi.hotspots(), civicApi.requests()])
      .then(([nextHotspots, nextRequests]) => {
        if (!active) return;
        setHotspots(nextHotspots);
        setRequests(nextRequests);
        setError('');
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load CivicOS data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [revision]);

  const value = { hotspots, requests, loading, error, refresh: () => setRevision((current) => current + 1) };
  return <CivicDataContext.Provider value={value}>{children}</CivicDataContext.Provider>;
}

export function useCivicData() {
  const value = useContext(CivicDataContext);
  if (!value) throw new Error('useCivicData must be used inside CivicDataProvider');
  return value;
}