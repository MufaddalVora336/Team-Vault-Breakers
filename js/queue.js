/**
 * QueueLess — Core Queue Engine & State Management
 * Server-Backed Single Source of Truth with Real-Time Polling Sync
 * and Web Audio desk chime.
 */

const QueueEngine = (function () {
  const STORAGE_KEY = 'queueless_state_v1';
  const ACTIVE_CITIZEN_TOKEN_KEY = 'queueless_active_citizen_token';
  const AVG_SERVICE_MINUTES = 5;

  // Default fallback seed state
  const DEFAULT_STATE = {
    currentServing: {
      id: 'A-40',
      type: 'ONLINE',
      service: 'Income Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Priya Sharma',
      mobile: '9812345678',
      status: 'SERVING',
      counter: 'Counter 2',
      calledAt: new Date(Date.now() - 3 * 60000).toISOString()
    },
    tokens: [
      {
        id: 'A-41',
        type: 'ONLINE',
        service: 'Income Certificate',
        office: 'Rajkot District Service Center',
        customerName: 'Amit Verma',
        mobile: '9823456789',
        status: 'WAITING',
        createdAt: new Date(Date.now() - 15 * 60000).toISOString()
      },
      {
        id: 'A-42',
        type: 'WALK-IN',
        service: 'Residence Certificate',
        office: 'Rajkot District Service Center',
        customerName: 'Suresh Mehta',
        mobile: '9834567890',
        status: 'WAITING',
        createdAt: new Date(Date.now() - 10 * 60000).toISOString()
      },
      {
        id: 'A-43',
        type: 'ONLINE',
        service: 'Birth Certificate',
        office: 'Rajkot District Service Center',
        customerName: 'Neha Gupta',
        mobile: '9845678901',
        status: 'WAITING',
        createdAt: new Date(Date.now() - 5 * 60000).toISOString()
      }
    ],
    completedTokens: [
      { id: 'A-38', type: 'ONLINE', service: 'Income Certificate', status: 'COMPLETED' },
      { id: 'A-39', type: 'WALK-IN', service: 'Caste Certificate', status: 'COMPLETED' }
    ],
    nextTokenNum: 44,
    completedCount: 24,
    walkinCount: 1,
    soundEnabled: true
  };

  let state = loadCachedState();
  let pollTimer = null;

  function loadCachedState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.tokens)) {
          return parsed;
        }
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function saveCachedState(newState) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    } catch (e) {}
  }

  function stateFingerprint(s) {
    if (!s) return '';
    const tokensStr = (s.tokens || []).map(t => `${t.id}:${t.status}`).join('|');
    const servingStr = s.currentServing ? `${s.currentServing.id}:${s.currentServing.status}:${s.currentServing.counter || ''}` : 'none';
    return `${s.nextTokenNum}_${s.completedCount}_${s.walkinCount}_${servingStr}_${tokensStr}`;
  }

  function applyState(newState, forceEvent = false) {
    if (!newState) return;
    const oldFp = stateFingerprint(state);
    const newFp = stateFingerprint(newState);
    state = newState;
    saveCachedState(state);

    if (forceEvent || oldFp !== newFp) {
      window.dispatchEvent(new CustomEvent('queueless:updated', { detail: state }));
    }
  }

  // Real-time synchronization: fetch authoritative state from server
  async function fetchState() {
    if (typeof fetch !== 'function') return state;
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        const data = await res.json();
        if (data && data.state) {
          applyState(data.state);
          return data.state;
        }
      }
    } catch (e) {
      // Offline fallback: keep cached state
    }
    return state;
  }

  // Start background polling every 1.5 seconds
  function startPolling() {
    if (pollTimer) return;
    fetchState();
    pollTimer = setInterval(fetchState, 1500);
  }

  if (typeof window !== 'undefined') {
    startPolling();
    // Cross-tab sync listener
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          applyState(parsed);
        } catch (err) {}
      }
    });
  }

  // Audio chime using Web Audio API
  function playChime() {
    if (!state.soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';

      // Airport/desk announcement double-tone chime
      osc1.frequency.setValueAtTime(698.46, ctx.currentTime);
      osc2.frequency.setValueAtTime(880.00, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.18);

      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.7);
    } catch (e) {}
  }

  function getArrivalWindow(waitMinutes) {
    if (waitMinutes <= 0) {
      return 'Proceed Immediately to Counter';
    }
    const now = new Date();
    const startMins = Math.max(0, waitMinutes - 5);
    const endMins = waitMinutes + 5;

    const startTime = new Date(now.getTime() + startMins * 60000);
    const endTime = new Date(now.getTime() + endMins * 60000);

    const fmt = (d) => {
      let h = d.getHours();
      const m = d.getMinutes().toString().padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m} ${ampm}`;
    };

    return `Arrive between ${fmt(startTime)} – ${fmt(endTime)}`;
  }

  function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const token = localStorage.getItem('queueless_auth_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (e) {}
    return headers;
  }

  return {
    getState() {
      return state;
    },

    async fetchState() {
      return await fetchState();
    },

    setAuthToken(token) {
      try {
        if (token) {
          localStorage.setItem('queueless_auth_token', token);
        } else {
          localStorage.removeItem('queueless_auth_token');
        }
      } catch (e) {}
    },

    getAuthToken() {
      try {
        return localStorage.getItem('queueless_auth_token');
      } catch (e) {
        return null;
      }
    },

    clearAuthToken() {
      try {
        localStorage.removeItem('queueless_auth_token');
      } catch (e) {}
    },

    setActiveCitizenTokenId(id) {
      try {
        localStorage.setItem(ACTIVE_CITIZEN_TOKEN_KEY, id);
      } catch (e) {}
    },

    getActiveCitizenTokenId() {
      try {
        return localStorage.getItem(ACTIVE_CITIZEN_TOKEN_KEY);
      } catch (e) {
        return null;
      }
    },

    clearActiveCitizenTokenId() {
      try {
        localStorage.removeItem(ACTIVE_CITIZEN_TOKEN_KEY);
      } catch (e) {}
    },

    hasActiveTokenForService(mobile, service) {
      if (!mobile) return false;
      const cleanMobile = String(mobile).replace(/\D/g, '');
      if (!cleanMobile) return false;

      const inWaiting = state.tokens.some(t => {
        const tMobile = String(t.mobile || '').replace(/\D/g, '');
        return tMobile === cleanMobile && t.service === service && (t.status === 'WAITING' || t.status === 'CALLED');
      });

      const inServing = state.currentServing &&
        String(state.currentServing.mobile || '').replace(/\D/g, '') === cleanMobile &&
        state.currentServing.service === service &&
        state.currentServing.status === 'SERVING';

      return inWaiting || inServing;
    },

    // Citizen or Walk-in adds token to server
    async addToken(params) {
      const {
        type = 'ONLINE',
        service = 'Income Certificate',
        office = 'Rajkot District Service Center',
        customerName = 'Citizen',
        mobile = '',
        idToken = null
      } = params;

      const isWalkin = type.toUpperCase() === 'WALK-IN';
      const endpoint = isWalkin ? '/api/officer/walk-in' : '/api/token';
      const payload = isWalkin
        ? { name: customerName, mobile, service, office }
        : { service, office, mobile, customerName, idToken };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to issue token.');
      }

      applyState(data.state, true);

      if (!isWalkin) {
        this.setActiveCitizenTokenId(data.token.id);
      }

      return data.token;
    },

    // Officer calls next customer (or specific token)
    async callNext(counter = 'Counter 2', tokenId = null) {
      const res = await fetch('/api/queue/call-next', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ counter, tokenId })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'No waiting customers in queue.');
      }

      applyState(data.state, true);
      playChime();
      return data.calledToken;
    },

    // Officer completes current serving customer
    async completeCurrent() {
      const res = await fetch('/api/queue/complete', {
        method: 'POST',
        headers: getAuthHeaders()
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'No customer currently being served.');
      }

      applyState(data.state, true);
      return data.completedToken;
    },

    // Mark No-Show
    async markNoShow(tokenId) {
      const res = await fetch('/api/queue/noshow', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ tokenId })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || `Token ${tokenId} not found.`);
      }

      applyState(data.state, true);
      return data.token;
    },

    // Cancel token
    async cancelToken(tokenId) {
      const res = await fetch('/api/queue/cancel', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ tokenId })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || `Token ${tokenId} not found.`);
      }

      if (this.getActiveCitizenTokenId() === tokenId) {
        this.clearActiveCitizenTokenId();
      }

      applyState(data.state, true);
      return data.token;
    },

    // Dynamic metrics calculation for a token
    getTokenMetrics(tokenId) {
      if (state.currentServing && state.currentServing.id === tokenId) {
        return {
          token: state.currentServing,
          peopleAhead: 0,
          estimatedMinutes: 0,
          status: 'SERVING',
          arrivalWindow: 'Please proceed to ' + (state.currentServing.counter || 'Counter 2'),
          isNext: true
        };
      }

      const waitingTokens = state.tokens.filter(t => t.status === 'WAITING');
      const tokenIndex = waitingTokens.findIndex(t => t.id === tokenId);
      if (tokenIndex === -1) {
        return null;
      }

      const token = waitingTokens[tokenIndex];
      const peopleAhead = tokenIndex;
      const estimatedMinutes = (peopleAhead + 1) * AVG_SERVICE_MINUTES;

      return {
        token,
        peopleAhead,
        estimatedMinutes,
        status: token.status,
        arrivalWindow: getArrivalWindow(estimatedMinutes),
        isNext: peopleAhead === 0
      };
    },

    // Advance queue for quick live demos
    async simulateQueueUpdate() {
      if (state.currentServing && state.currentServing.status === 'SERVING') {
        await this.completeCurrent();
      }
      if (state.tokens.some(t => t.status === 'WAITING')) {
        return await this.callNext();
      }
      return null;
    },

    // Reset demo back to clean initial state
    async resetDemoData() {
      const res = await fetch('/api/queue/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data && data.state) {
        applyState(data.state, true);
        return data.state;
      }
      return state;
    },

    getStats() {
      const waiting = state.tokens.filter(t => t.status === 'WAITING').length;
      const serving = (state.currentServing && state.currentServing.status === 'SERVING') ? 1 : 0;
      return {
        waiting,
        serving,
        completed: state.completedCount,
        walkins: state.walkinCount,
        currentServingId: state.currentServing ? state.currentServing.id : 'None',
        currentServingToken: state.currentServing
      };
    },

    getArrivalWindow
  };
})();
