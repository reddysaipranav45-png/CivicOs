const base = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export type Hotspot = {
  id: string;
  city: string;
  state: string;
  sector: string;
  requests: number;
  priority: number;
  critical_requests: number;
  high_requests: number;
  moderate_requests: number;
  low_requests: number;
  lat: number | null;
  lng: number | null;
  latest_request_at: string;
};

export type CitizenRequest = {
  id: string;
  message: string;
  language: string;
  location: string;
  sector: string;
  severity: string;
  source: string;
  ai_status: string;
  created_at: string;
  has_recording: boolean;
  has_coordinates: boolean;
};

export type NewCitizenRequest = Omit<CitizenRequest, 'id' | 'ai_status' | 'created_at' | 'has_recording' | 'has_coordinates'>;
type PulseResponse = { answer: string; hotspot: Hotspot; disclaimer: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${base}${path}`, {
    headers,
    ...init,
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const civicApi = {
  health: () => request<{ status: string }>('/health'),
  hotspots: () => request<Hotspot[]>('/api/hotspots'),
  requests: () => request<CitizenRequest[]>('/api/requests'),
  deleteAllRequests: () => request<void>('/api/requests', { method: 'DELETE' }),
  addRequest: (input: NewCitizenRequest, recording?: Blob) => {
    const body = new FormData();
    Object.entries(input).forEach(([key, value]) => body.append(key, String(value)));
    if (recording) body.append('recording', recording, 'citizen-request.webm');
    return request<CitizenRequest>('/api/requests', { method: 'POST', body });
  },
  recordingUrl: (id: string) => `${base}/api/requests/${encodeURIComponent(id)}/recording`,
  civicPulse: (query: string) => request<PulseResponse>('/api/civicpulse', { method: 'POST', body: JSON.stringify({ query }) }),
};

export const getHotspots = () => civicApi.hotspots();
export const getRequests = () => civicApi.requests();
export const queryCivicPulse = (query: string) => civicApi.civicPulse(query);
