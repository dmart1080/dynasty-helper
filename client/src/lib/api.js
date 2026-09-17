/** Thin API client. Every call returns { data, meta } or throws an Error with the server's message. */

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Server returned ${res.status} with a non-JSON body.`);
  }
  if (!res.ok || payload.ok === false) {
    const err = new Error(payload.error || `Request failed with ${res.status}`);
    err.status = res.status;
    err.needsSync = payload.needsSync;
    throw err;
  }
  return { data: payload.data, meta: payload.meta ?? {} };
}

const qs = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const api = {
  health: () => request('/health'),
  leagues: () => request('/leagues'),
  league: (id) => request(`/leagues/${id}`),
  teams: (id, params = {}) => request(`/leagues/${id}/teams${qs(params)}`),
  team: (id, rosterId, params = {}) => request(`/leagues/${id}/teams/${rosterId}${qs(params)}`),
  picks: (id, params = {}) => request(`/leagues/${id}/picks${qs(params)}`),
  sync: (id, params = {}) => request(`/leagues/${id}/sync${qs(params)}`, { method: 'POST' }),

  search: (params) => request(`/players/search${qs(params)}`),
  history: (playerId, params) => request(`/players/${playerId}/history${qs(params)}`),
  overrides: () => request('/players/overrides/list'),
  setOverride: (playerId, body) => request(`/players/overrides/${playerId}`, { method: 'PUT', body }),
  clearOverride: (playerId) => request(`/players/overrides/${playerId}`, { method: 'DELETE' }),

  evaluateTrade: (body) => request('/trades/evaluate', { method: 'POST', body }),
  findTrades: (body) => request('/finder/search', { method: 'POST', body }),

  managers: (id) => request(`/intel/${id}/managers`),
  watchlist: (id) => request(`/intel/${id}/watchlist`),
  addWatch: (id, body) => request(`/intel/${id}/watchlist`, { method: 'POST', body }),
  removeWatch: (id, playerId) => request(`/intel/${id}/watchlist/${playerId}`, { method: 'DELETE' }),
};

export default api;
