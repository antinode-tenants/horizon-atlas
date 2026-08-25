const STORAGE_KEY = 'horizon-atlas-entries-v1';
const HORIZON_API_PREFIX = '/api/horizon-atlas';
const SKILL_DEMO_NOTE = 'Demo only — this skill returns illustrative data from the Horizon Atlas example site. Use it to learn Agentic Workflows; replace with your own API in production.';

const cfg = window.HORIZON_ATLAS_CONFIG || {};
const params = new URLSearchParams(window.location.search);
const gatewayUrl = String(params.get('gateway') || cfg.gatewayUrl || '').replace(/\/$/, '');
const secretName = String(cfg.secretName || 'HORIZON_WEATHER_KEY');

function assertGatewayConfigured() {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const looksLocalGateway = !gatewayUrl || gatewayUrl.includes('localhost') || gatewayUrl.includes('127.0.0.1');
  if (!isLocal && looksLocalGateway) {
    throw new Error(
      'Horizon Atlas config.js still points at a local gateway. '
      + 'Set gatewayUrl to your Antinode gateway (https://….run.app) in config.js, '
      + 'or open this page with ?gateway=https://YOUR-GATEWAY-URL',
    );
  }
  if (!gatewayUrl || gatewayUrl.includes('YOUR-GATEWAY')) {
    throw new Error('Set gatewayUrl in config.js (or ?gateway=) before running this demo.');
  }
}

const els = {
  accountBtn: document.getElementById('account-btn'),
  gate: document.getElementById('gate'),
  gateSigninBtn: document.getElementById('gate-signin-btn'),
  workspace: document.getElementById('workspace'),
  destination: document.getElementById('destination'),
  entryDate: document.getElementById('entry-date'),
  entryBody: document.getElementById('entry-body'),
  saveEntryBtn: document.getElementById('save-entry-btn'),
  refreshWeatherBtn: document.getElementById('refresh-weather-btn'),
  secretStatus: document.getElementById('secret-status'),
  weatherCard: document.getElementById('weather-card'),
  weatherIcon: document.getElementById('weather-icon'),
  weatherCondition: document.getElementById('weather-condition'),
  weatherTemp: document.getElementById('weather-temp'),
  weatherCopy: document.getElementById('weather-copy'),
  entriesList: document.getElementById('entries-list'),
  aiFab: document.getElementById('ai-fab'),
  aiOverlay: document.getElementById('ai-overlay'),
  aiOverlayBackdrop: document.getElementById('ai-overlay-backdrop'),
};

let antinode = null;
let cachedSecret = null;
let initError = null;
let isSignedIn = false;
let weatherRefreshPromise = null;
let aiMountPromise = null;
let aiOverlayOpen = false;

function trackPageView() {
  if (typeof window.gtag !== 'function') return;
  const pagePath = `${window.location.pathname}${window.location.search}`;
  window.gtag('event', 'page_view', {
    page_path: pagePath,
    page_location: `${window.location.origin}${pagePath}`,
    page_title: document.title,
  });
}

function showError(message) {
  setWeatherUi({
    icon: '!',
    condition: 'Unavailable',
    temp: '—',
    detail: message,
    ready: false,
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function setAiFabVisible(visible) {
  els.aiFab?.classList.toggle('hidden', !visible);
  if (!visible) closeAiOverlay();
}

function setSessionUi(session) {
  const signedIn = !!(session && session.signed_in);
  isSignedIn = signedIn;
  els.accountBtn?.classList.toggle('hidden', !signedIn);
  els.gate.classList.toggle('hidden', signedIn);
  els.workspace.classList.toggle('hidden', !signedIn);
  setAiFabVisible(signedIn);
}

function weatherEmoji(code) {
  const map = {
    0: '☀️',
    1: '🌤️',
    2: '⛅',
    3: '☁️',
    45: '🌫️',
    61: '🌦️',
    63: '🌧️',
    65: '🌧️',
    71: '🌨️',
    95: '⛈️',
  };
  return map[code] || '🌡️';
}

function weatherLabel(code) {
  const map = {
    0: 'Clear skies',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    71: 'Snow',
    95: 'Thunderstorms',
  };
  return map[code] || 'Mixed conditions';
}

function setWeatherUi({ icon, condition, temp, detail, ready = false }) {
  if (els.weatherIcon) els.weatherIcon.textContent = icon || '◎';
  if (els.weatherCondition) els.weatherCondition.textContent = condition || '—';
  if (els.weatherTemp) els.weatherTemp.textContent = temp || '—';
  if (els.weatherCopy) els.weatherCopy.textContent = detail || '';
  if (els.weatherCard) els.weatherCard.classList.toggle('is-ready', !!ready);
}

function setVaultStatus(text, ok = false) {
  if (!els.secretStatus) return;
  els.secretStatus.textContent = text;
  els.secretStatus.className = `vault-chip${ok ? ' ok' : ' muted'}`;
  els.secretStatus.title = ok
    ? `${secretName} loaded from vault`
    : 'Vault secret status';
}

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function renderEntries() {
  const entries = loadEntries().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  els.entriesList.innerHTML = '';
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'entry-empty muted';
    li.textContent = 'No entries yet — save your first ridge note.';
    els.entriesList.appendChild(li);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'entry-item';
    li.innerHTML = `
      <strong>${escapeHtml(entry.destination)}</strong>
      <div class="entry-meta">${escapeHtml(entry.date)}</div>
      <div>${escapeHtml(entry.body)}</div>
    `;
    els.entriesList.appendChild(li);
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function withSkillDemoNote(payload) {
  return { ...payload, note: SKILL_DEMO_NOTE };
}

function buildSessionSnapshot() {
  const destination = String(els.destination?.value || '').trim() || 'Mount Tamalpais';
  const tempText = String(els.weatherTemp?.textContent || '').trim();
  const tempMatch = tempText.match(/(-?\d+(?:\.\d+)?)/);
  return {
    destination,
    entry_date: String(els.entryDate?.value || todayIso()),
    entry_count: loadEntries().length,
    vault_ready: !!cachedSecret,
    signed_in: isSignedIn,
    weather: {
      condition: String(els.weatherCondition?.textContent || '').trim() || null,
      temp_c: tempMatch ? Number(tempMatch[1]) : null,
      detail: String(els.weatherCopy?.textContent || '').trim() || null,
    },
  };
}

function horizonApiJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleHorizonAtlasApi(requestUrl, init) {
  const path = requestUrl.pathname;
  const method = String(init?.method || 'GET').toUpperCase();
  if (!isSignedIn) {
    return horizonApiJson({ error: 'Sign in required' }, 401);
  }
  if (method === 'GET' && path === `${HORIZON_API_PREFIX}/describe-session`) {
    return horizonApiJson(withSkillDemoNote(buildSessionSnapshot()));
  }
  if (method === 'GET' && path === `${HORIZON_API_PREFIX}/entries`) {
    const entries = loadEntries()
      .slice(0, 10)
      .map(({ destination, date, body, id }) => ({ destination, date, body, id }));
    return horizonApiJson(withSkillDemoNote({ entries }));
  }
  return horizonApiJson({ error: 'Not found' }, 404);
}

function installHorizonAtlasApiShim() {
  if (window.__horizonAtlasApiShimInstalled) return;
  window.__horizonAtlasApiShimInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function horizonAtlasFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (url) {
      try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.origin === window.location.origin && parsed.pathname.startsWith(HORIZON_API_PREFIX)) {
          return handleHorizonAtlasApi(parsed, init);
        }
      } catch (e) {
        /* fall through to native fetch */
      }
    }
    return nativeFetch(input, init);
  };
}

function notifyProductContextChanged() {
  if (!antinode?.ai?.notifyContextChanged) return;
  try {
    antinode.ai.notifyContextChanged('#antinode-ai');
  } catch (e) {
    /* optional until amAIra is mounted */
  }
}

function wireAccountBtn() {
  els.accountBtn?.addEventListener('click', () => {
    if (!antinode?.account_dashboard) {
      showError('Sign in first.');
      return;
    }
    antinode.account_dashboard().catch((err) => showError(err?.message || String(err)));
  });
}

function openAiOverlay() {
  if (!els.aiOverlay || aiOverlayOpen) return;
  aiOverlayOpen = true;
  els.aiOverlay.classList.remove('hidden');
  els.aiFab?.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  scheduleAiMount().catch(() => {});
}

function closeAiOverlay() {
  if (!els.aiOverlay || !aiOverlayOpen) return;
  aiOverlayOpen = false;
  els.aiOverlay.classList.add('hidden');
  els.aiFab?.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  els.aiFab?.focus();
}

function wireAiOverlay() {
  els.aiFab?.addEventListener('click', () => openAiOverlay());
  els.aiOverlayBackdrop?.addEventListener('click', () => closeAiOverlay());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && aiOverlayOpen) closeAiOverlay();
  });
}

async function loadAntinode() {
  assertGatewayConfigured();
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = `${gatewayUrl}/tenant/loader.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Antinode SDK loader'));
    document.head.appendChild(script);
  });

  antinode = await window.antinodeReady;
  return antinode;
}

async function mountAiChat() {
  if (!antinode?.ai?.mount) return;
  const mountEl = document.getElementById('antinode-ai');
  if (!mountEl) return;
  try {
    await antinode.ai.mount('#antinode-ai');
  } catch (err) {
    mountEl.innerHTML = `<p class="muted" style="padding:16px;">AI embed unavailable: ${escapeHtml(err?.message || err)}</p>`;
  }
}

function scheduleAiMount() {
  if (aiMountPromise) return aiMountPromise;
  aiMountPromise = mountAiChat().finally(() => {
    aiMountPromise = null;
  });
  return aiMountPromise;
}

async function refreshWeather({ reloadSecret = false } = {}) {
  if (!antinode || !isSignedIn) {
    setVaultStatus('Sign in required');
    setWeatherUi({
      icon: '◎',
      condition: 'Waiting',
      temp: '—',
      detail: 'Sign in to load weather via your vault secret.',
      ready: false,
    });
    return;
  }

  if (!reloadSecret && cachedSecret) {
    const place = String(els.destination?.value || 'Mount Tamalpais').trim();
    await applyTrailWeather(place);
    return;
  }

  setVaultStatus('Loading…');

  try {
    const result = await antinode.getSecret(secretName);
    cachedSecret = typeof result === 'string' ? result.trim() : String(result?.value || '').trim();
    if (!cachedSecret) throw new Error(`Secret ${secretName} is empty`);
    setVaultStatus('Vault ready', true);
  } catch (err) {
    cachedSecret = null;
    setVaultStatus('Missing');
    const message = err?.message || String(err);
    setWeatherUi({
      icon: '!',
      condition: 'Vault needed',
      temp: '—',
      detail: message.includes('rate limit')
        ? 'Rate limited — wait a minute, then refresh.'
        : `Add ${secretName} in Manage → Secrets, then refresh.`,
      ready: false,
    });
    return;
  }

  const place = String(els.destination?.value || 'Mount Tamalpais').trim();
  await applyTrailWeather(place);
}

async function applyTrailWeather(place) {
  const snapshot = await fetchTrailWeather(place);
  if (!snapshot.ok) {
    setWeatherUi({
      icon: '!',
      condition: 'Unavailable',
      temp: '—',
      detail: snapshot.message,
      ready: !!cachedSecret,
    });
    return;
  }

  setWeatherUi({
    icon: weatherEmoji(snapshot.code),
    condition: snapshot.label,
    temp: `${snapshot.temp}°C`,
    detail: `${snapshot.place}${snapshot.country ? `, ${snapshot.country}` : ''} · Wind ${snapshot.wind} km/h · Vault key ${secretName} active.`,
    ready: !!cachedSecret,
  });
  notifyProductContextChanged();
}

function scheduleWeatherRefresh(opts = {}) {
  if (!isSignedIn) return Promise.resolve();
  if (weatherRefreshPromise) return weatherRefreshPromise;
  weatherRefreshPromise = refreshWeather(opts).finally(() => {
    weatherRefreshPromise = null;
  });
  return weatherRefreshPromise;
}

async function fetchTrailWeather(place) {
  const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`);
  const geo = await geoRes.json();
  const hit = geo?.results?.[0];
  if (!hit) {
    return { ok: false, message: `Could not geocode “${place}”. Try another destination name.` };
  }

  const { latitude, longitude, name, country } = hit;
  const wxRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`,
  );
  const wx = await wxRes.json();
  const current = wx?.current;
  if (!current) return { ok: false, message: `Weather unavailable for ${name}.` };

  return {
    ok: true,
    place: name,
    country,
    temp: current.temperature_2m,
    wind: current.wind_speed_10m,
    code: current.weather_code,
    label: weatherLabel(current.weather_code),
  };
}

async function handleSignIn() {
  if (!antinode) {
    if (initError) throw initError;
    await loadAntinode();
  }
  await antinode.login({ sessionScope: 'tenant' });
}

function handleSaveEntry() {
  const destination = String(els.destination?.value || '').trim();
  const body = String(els.entryBody?.value || '').trim();
  const date = String(els.entryDate?.value || todayIso());
  if (!destination || !body) return;

  const entries = loadEntries();
  entries.unshift({ destination, body, date, id: `${Date.now()}` });
  saveEntries(entries.slice(0, 20));
  if (els.entryBody) els.entryBody.value = '';
  renderEntries();
  notifyProductContextChanged();
}

async function bootstrap() {
  installHorizonAtlasApiShim();
  trackPageView();
  wireAiOverlay();
  wireAccountBtn();

  if (els.entryDate) els.entryDate.value = todayIso();
  renderEntries();

  els.gateSigninBtn?.addEventListener('click', () => {
    handleSignIn().catch((err) => showError(err?.message || String(err)));
  });
  els.saveEntryBtn?.addEventListener('click', handleSaveEntry);
  els.refreshWeatherBtn?.addEventListener('click', () => {
    scheduleWeatherRefresh({ reloadSecret: true }).catch((err) => showError(err?.message || String(err)));
  });
  els.destination?.addEventListener('change', () => notifyProductContextChanged());

  try {
    await loadAntinode();
  } catch (err) {
    initError = err;
    showError(err?.message || String(err));
    return;
  }

  if (typeof antinode.on_session_change !== 'function') {
    initError = new Error('Antinode SDK did not load session helpers.');
    showError(initError.message);
    return;
  }

  let wasSignedIn = false;
  antinode.on_session_change((session) => {
    const signedIn = !!(session && session.signed_in);
    setSessionUi(session);
    if (signedIn && !wasSignedIn) {
      scheduleWeatherRefresh().catch(() => {});
      scheduleAiMount().catch(() => {});
      renderEntries();
    }
    if (!signedIn) {
      cachedSecret = null;
      closeAiOverlay();
    }
    wasSignedIn = signedIn;
  });

  const session = await antinode.session().catch(() => null);
  setSessionUi(session);
  const signedInOnLoad = !!(session && session.signed_in);
  wasSignedIn = signedInOnLoad;

  if (signedInOnLoad) {
    await scheduleAiMount();
    await scheduleWeatherRefresh().catch(() => {});
  }
}

bootstrap().catch((err) => {
  console.error('[horizon-atlas]', err);
});
