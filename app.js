const STORAGE_KEY = 'horizon-atlas-entries-v1';

const cfg = window.HORIZON_ATLAS_CONFIG || {};
const params = new URLSearchParams(window.location.search);
const gatewayUrl = String(params.get('gateway') || cfg.gatewayUrl || '').replace(/\/$/, '');
const secretName = String(cfg.secretName || 'HORIZON_WEATHER_KEY');

const els = {
  sessionChip: document.getElementById('session-chip'),
  signinBtn: document.getElementById('signin-btn'),
  signoutBtn: document.getElementById('signout-btn'),
  gate: document.getElementById('gate'),
  gateSigninBtn: document.getElementById('gate-signin-btn'),
  workspace: document.getElementById('workspace'),
  accountBtn: document.getElementById('account-btn'),
  destination: document.getElementById('destination'),
  entryDate: document.getElementById('entry-date'),
  entryBody: document.getElementById('entry-body'),
  saveEntryBtn: document.getElementById('save-entry-btn'),
  refreshWeatherBtn: document.getElementById('refresh-weather-btn'),
  secretStatus: document.getElementById('secret-status'),
  weatherCopy: document.getElementById('weather-copy'),
  entriesList: document.getElementById('entries-list'),
};

let antinode = null;
let cachedSecret = null;
let initError = null;

function showStatus(message) {
  if (els.sessionChip) els.sessionChip.textContent = message;
}

function showError(message) {
  showStatus('Needs attention');
  if (els.weatherCopy) els.weatherCopy.textContent = message;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function sessionLabel(session) {
  const user = session?.user || session || {};
  return user.name || user.email || user.sub || 'Explorer';
}

function setSessionUi(session) {
  const signedIn = !!(session && session.signed_in);
  els.sessionChip.textContent = signedIn ? `Signed in as ${sessionLabel(session)}` : 'Guest';
  els.signinBtn.classList.toggle('hidden', signedIn);
  els.signoutBtn.classList.toggle('hidden', !signedIn);
  els.gate.classList.toggle('hidden', signedIn);
  els.workspace.classList.toggle('hidden', !signedIn);
  els.accountBtn.classList.toggle('hidden', !signedIn);
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
    li.className = 'muted';
    li.textContent = 'No entries yet — add your first field note above.';
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

async function loadAntinode() {
  if (!gatewayUrl || gatewayUrl.includes('YOUR-GATEWAY')) {
    throw new Error('Set gatewayUrl in config.js (or ?gateway=) before running this demo.');
  }

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
    mountEl.innerHTML = `<p class="muted small" style="padding:16px;">AI embed unavailable: ${escapeHtml(err?.message || err)}</p>`;
  }
}

async function refreshWeather() {
  if (!antinode) return;
  const session = await antinode.session();
  if (!session?.signed_in) {
    els.secretStatus.textContent = 'Sign in required';
    els.secretStatus.className = 'pill muted';
    return;
  }

  els.secretStatus.textContent = 'Loading secret…';
  els.secretStatus.className = 'pill muted';

  try {
    const result = await antinode.getSecret(secretName);
    cachedSecret = result?.value ? String(result.value) : '';
    if (!cachedSecret) throw new Error(`Secret ${secretName} is empty`);
    els.secretStatus.textContent = 'Vault key loaded';
    els.secretStatus.className = 'pill ok';
  } catch (err) {
    cachedSecret = null;
    els.secretStatus.textContent = 'Secret missing';
    els.secretStatus.className = 'pill muted';
    els.weatherCopy.textContent = `Add ${secretName} in Antinode Manage → Secrets, then refresh. (${err?.message || err})`;
    return;
  }

  const place = String(els.destination?.value || 'Mount Tamalpais').trim();
  const summary = await fetchTrailWeather(place);
  els.weatherCopy.textContent = summary;
}

async function fetchTrailWeather(place) {
  // Open-Meteo is free and needs no API key — the secret proves vault wiring.
  const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`);
  const geo = await geoRes.json();
  const hit = geo?.results?.[0];
  if (!hit) return `Could not geocode “${place}”. Try another destination name.`;

  const { latitude, longitude, name, country } = hit;
  const wxRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`,
  );
  const wx = await wxRes.json();
  const current = wx?.current;
  if (!current) return `Weather unavailable for ${name}.`;

  const temp = current.temperature_2m;
  const wind = current.wind_speed_10m;
  const code = current.weather_code;
  const label = weatherLabel(code);
  const keyHint = cachedSecret ? `Vault key ${secretName} is active.` : '';
  return `${label} in ${name}${country ? `, ${country}` : ''} — ${temp}°C, wind ${wind} km/h. ${keyHint}`.trim();
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

async function handleSignIn() {
  if (!antinode) {
    if (initError) throw initError;
    await loadAntinode();
  }
  await antinode.login({ sessionScope: 'tenant' });
}

async function handleSignOut() {
  if (!antinode) return;
  if (typeof antinode.signout === 'function') {
    await antinode.signout();
    return;
  }
  if (typeof antinode.logout === 'function') {
    await antinode.logout();
  }
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
}

async function bootstrap() {
  if (els.entryDate) els.entryDate.value = todayIso();
  renderEntries();

  els.signinBtn?.addEventListener('click', () => {
    handleSignIn().catch((err) => showError(err?.message || String(err)));
  });
  els.gateSigninBtn?.addEventListener('click', () => {
    handleSignIn().catch((err) => showError(err?.message || String(err)));
  });
  els.signoutBtn?.addEventListener('click', () => {
    handleSignOut().catch((err) => showError(err?.message || String(err)));
  });
  els.saveEntryBtn?.addEventListener('click', handleSaveEntry);
  els.refreshWeatherBtn?.addEventListener('click', () => {
    refreshWeather().catch((err) => showError(err?.message || String(err)));
  });
  els.accountBtn?.addEventListener('click', () => {
    if (!antinode?.account_dashboard) {
      showError('Sign in first.');
      return;
    }
    antinode.account_dashboard().catch((err) => showError(err?.message || String(err)));
  });

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

  antinode.on_session_change((session) => {
    setSessionUi(session);
    if (session?.signed_in) {
      refreshWeather().catch(() => {});
      renderEntries();
    }
  });

  const session = await antinode.session().catch(() => null);
  setSessionUi(session);

  await mountAiChat();

  if (session?.signed_in) {
    await refreshWeather().catch(() => {});
  }
}

bootstrap().catch((err) => {
  console.error('[horizon-atlas]', err);
});
