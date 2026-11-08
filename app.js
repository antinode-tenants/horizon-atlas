const STORAGE_KEY = 'horizon-atlas-entries-v1';
const HORIZON_API_PREFIX = '/api/horizon-atlas';
const SKILL_DEMO_NOTE = 'Demo only — this skill returns illustrative data from the Horizon Atlas example site. Use it to learn Agentic Workflows; replace with your own API in production.';

const cfg = window.HORIZON_ATLAS_CONFIG || {};
const params = new URLSearchParams(window.location.search);
const gatewayUrl = String(params.get('gateway') || cfg.gatewayUrl || '').replace(/\/$/, '');
const dashboardBasePath = String(cfg.dashboardBasePath || '/dashboard').replace(/\/$/, '');
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
  driveHeader: document.getElementById('drive-header'),
  driveHeaderConnect: document.getElementById('drive-header-connect'),
  driveHeaderOpen: document.getElementById('drive-header-open'),
  driveHeaderStatusDot: document.getElementById('drive-header-status-dot'),
  driveEntryToast: document.getElementById('drive-entry-toast'),
};

let antinode = null;
let cachedSecret = null;
let googleDriveConnected = false;
let googleDriveStatus = 'idle';
let driveExportBusy = false;
let driveToastHideTimer = null;
let googleDriveRefreshPromise = null;
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
  els.driveHeader?.classList.toggle('hidden', !signedIn);
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

const ENTRY_DRIVE_EXPORT_ICON = `
  <svg class="entry-drive-btn-export-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 15V4m0 0 4 4m-4-4-4 4" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" />
  </svg>`;

const ENTRY_DRIVE_OPEN_ICON = `
  <svg class="entry-drive-open-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 5h6m0 0v6m0-6L10 15" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M20 13v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" />
  </svg>`;

function showDriveEntryToast(message, { isError = false } = {}) {
  if (!els.driveEntryToast || !message) return;
  if (driveToastHideTimer) {
    clearTimeout(driveToastHideTimer);
    driveToastHideTimer = null;
  }
  els.driveEntryToast.textContent = message;
  els.driveEntryToast.classList.toggle('is-error', !!isError);
  els.driveEntryToast.classList.remove('hidden');
  driveToastHideTimer = setTimeout(() => {
    els.driveEntryToast?.classList.add('hidden');
  }, isError ? 8000 : 5000);
}

function entryDriveActionsHtml(entry) {
  const entryId = escapeHtml(entry.id || '');
  const fileId = String(entry.drive_file_id || '').trim();
  const openUrl = fileId ? driveWebViewUrl(fileId) : '';
  const openControl = openUrl
    ? `<a
        class="entry-drive-btn entry-drive-open-btn"
        href="${escapeHtml(openUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        data-entry-id="${entryId}"
        aria-label="Open this entry in Google Drive"
        title="Open in Google Drive"
      >${ENTRY_DRIVE_OPEN_ICON}</a>`
    : `<button
        type="button"
        class="entry-drive-btn entry-drive-open-btn"
        data-entry-id="${entryId}"
        disabled
        aria-label="Open in Google Drive (export first)"
        title="Export to Drive first to enable Open"
      >${ENTRY_DRIVE_OPEN_ICON}</button>`;
  return `
    <div class="entry-drive-actions">
      ${openControl}
      <button
        type="button"
        class="entry-drive-btn entry-drive-export-btn"
        data-entry-id="${entryId}"
        aria-label="Export this entry to Google Drive"
        title="Export this entry to Google Drive"
      >
        <span class="entry-drive-btn-mark">
          <img
            src="assets/google_drive_logo.svg"
            alt=""
            width="18"
            height="18"
            class="entry-drive-btn-logo"
            decoding="async"
          />
          ${ENTRY_DRIVE_EXPORT_ICON}
        </span>
      </button>
    </div>`;
}

function persistEntryDriveFileId(entryId, fileId) {
  const entries = loadEntries().map((entry) => (
    String(entry.id) === String(entryId)
      ? { ...entry, drive_file_id: fileId }
      : entry
  ));
  saveEntries(entries);
}

function updateEntryDriveButtons() {
  if (!els.entriesList) return;
  const connected = googleDriveConnected && googleDriveStatus !== 'disabled';
  els.entriesList.querySelectorAll('.entry-drive-export-btn').forEach((btn) => {
    const busy = btn.classList.contains('is-busy');
    btn.disabled = !connected || busy || driveExportBusy;
    btn.title = connected
      ? 'Export this entry to Google Drive'
      : 'Connect Google Drive in the header to export entries';
  });
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
      <div class="entry-item-body">${escapeHtml(entry.body)}</div>
      ${entryDriveActionsHtml(entry)}
    `;
    els.entriesList.appendChild(li);
  }
  updateEntryDriveButtons();
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
    google_drive: {
      connected: googleDriveConnected,
      status: googleDriveStatus,
      entries_on_drive: loadEntries().filter((e) => e.drive_file_id).length,
    },
    weather: {
      condition: String(els.weatherCondition?.textContent || '').trim() || null,
      temp_c: tempMatch ? Number(tempMatch[1]) : null,
      detail: String(els.weatherCopy?.textContent || '').trim() || null,
    },
  };
}

function googleTenantPath(tenantId, suffix) {
  return `${dashboardBasePath}/tenants/${encodeURIComponent(tenantId)}/integrations/google${suffix}`;
}

async function parseGatewayError(res) {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    return json.message || json.error || text || res.statusText;
  } catch (e) {
    return text || res.statusText;
  }
}

async function fetchWithTenantCreds(path, init = {}) {
  return fetch(`${gatewayUrl}${path}`, { credentials: 'include', ...init });
}

async function requireTenantId() {
  if (!antinode) throw new Error('Antinode SDK not loaded');
  const session = await antinode.session();
  if (!session?.signed_in) throw new Error('Sign in required');
  const tenantId = String(session?.tenant?.tenant_id || '').trim();
  if (!tenantId) throw new Error('Tenant id missing from session');
  return tenantId;
}

function driveWebViewUrl(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return '';
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

function sanitizeEntryFilenamePart(value) {
  return String(value || 'trip')
    .trim()
    .replace(/[^\w\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'trip';
}

function buildEntryExportFile(entry) {
  const destination = String(entry?.destination || 'Trail note').trim();
  const date = String(entry?.date || todayIso()).trim();
  const lines = [
    'Horizon Atlas — trail note',
    `Destination: ${destination}`,
    `Date: ${date}`,
    '',
    String(entry?.body || '').trim(),
  ];
  const name = `horizon-atlas-${sanitizeEntryFilenamePart(destination)}-${date}.txt`;
  return new File([lines.join('\n')], name, { type: 'text/plain' });
}

async function uploadFileToDrive(file) {
  const tenantId = await requireTenantId();
  const body = new FormData();
  body.append('file', file);
  body.append('name', file.name);
  const res = await fetchWithTenantCreds(googleTenantPath(tenantId, '/drive/upload'), {
    method: 'POST',
    body,
  });
  if (!res.ok) throw new Error(await parseGatewayError(res));
  const payload = await res.json();
  const fileId = String(payload?.file?.drive_file_id || '').trim();
  if (!fileId) throw new Error('Upload succeeded but file id was missing');
  return { payload, fileId };
}

const DRIVE_HEADER_TOOLTIPS = {
  off: 'Google Drive not connected. Click to link your account and back up journal entries.',
  on: 'Google Drive connected. Click to open Google Drive.',
  loading: 'Checking Google Drive connection…',
  error: 'Could not verify Google Drive. Click to try connecting again.',
};

function setDriveHeaderTooltip(target, message) {
  if (!target || !message) return;
  target.title = message;
  target.setAttribute('aria-label', message);
}

function setDriveHeaderUi() {
  if (!els.driveHeader || !isSignedIn) return;

  const showHeaderChrome = googleDriveStatus !== 'disabled';
  els.driveHeader.classList.toggle('hidden', !showHeaderChrome);

  if (!showHeaderChrome) {
    els.driveHeaderConnect?.classList.add('hidden');
    els.driveHeaderOpen?.classList.add('hidden');
    return;
  }

  const showLinked = googleDriveConnected && googleDriveStatus !== 'loading';
  els.driveHeaderConnect?.classList.toggle('hidden', showLinked);
  els.driveHeaderOpen?.classList.toggle('hidden', !showLinked);

  const dot = els.driveHeaderStatusDot;
  if (dot) {
    dot.classList.toggle('is-on', showLinked);
    dot.classList.toggle('is-off', !showLinked);
  }

  if (googleDriveStatus === 'loading') {
    els.driveHeaderConnect && (els.driveHeaderConnect.disabled = true);
    setDriveHeaderTooltip(els.driveHeaderConnect, DRIVE_HEADER_TOOLTIPS.loading);
    return;
  }

  els.driveHeaderConnect && (els.driveHeaderConnect.disabled = false);

  if (showLinked) {
    setDriveHeaderTooltip(els.driveHeaderOpen, DRIVE_HEADER_TOOLTIPS.on);
    return;
  }

  const tip = googleDriveStatus === 'error'
    ? DRIVE_HEADER_TOOLTIPS.error
    : DRIVE_HEADER_TOOLTIPS.off;
  setDriveHeaderTooltip(els.driveHeaderConnect, tip);
}

function setDriveUi() {
  setDriveHeaderUi();
  updateEntryDriveButtons();
}

function stripGoogleConnectedQuery() {
  const u = new URL(window.location.href);
  if (u.searchParams.get('google_connected') !== '1') return false;
  u.searchParams.delete('google_connected');
  const next = `${u.pathname}${u.search}${u.hash}`;
  window.history.replaceState({}, '', next);
  return true;
}

function scheduleGoogleDriveRefresh(options = {}) {
  if (!isSignedIn) return Promise.resolve();
  if (googleDriveRefreshPromise) return googleDriveRefreshPromise;
  googleDriveRefreshPromise = refreshGoogleDriveStatus(options).finally(() => {
    googleDriveRefreshPromise = null;
  });
  return googleDriveRefreshPromise;
}

async function refreshGoogleDriveStatus({ forceLoading = false } = {}) {
  if (!isSignedIn) {
    googleDriveConnected = false;
    googleDriveStatus = 'idle';
    setDriveUi();
    return;
  }

  const showLoading = forceLoading || googleDriveStatus === 'idle';
  if (showLoading) {
    googleDriveStatus = 'loading';
    setDriveUi();
  }

  try {
    const tenantId = await requireTenantId();
    const res = await fetchWithTenantCreds(googleTenantPath(tenantId, '/connection'));
    if (res.status === 403) {
      const err = await res.json().catch(() => ({}));
      if (err.error === 'google_integration_disabled') {
        googleDriveConnected = false;
        googleDriveStatus = 'disabled';
        setDriveUi();
        showDriveEntryToast(
          'Google services are off for this site. Enable them in Antinode Manage → Google.',
          { isError: true },
        );
        notifyProductContextChanged();
        return;
      }
    }
    if (!res.ok) {
      googleDriveConnected = false;
      googleDriveStatus = 'error';
      setDriveUi();
      return;
    }
    const body = await res.json();
    googleDriveConnected = !!body.connected;
    googleDriveStatus = googleDriveConnected ? 'ready' : 'idle';
    setDriveUi();
    notifyProductContextChanged();
  } catch (err) {
    googleDriveConnected = false;
    googleDriveStatus = 'error';
    setDriveUi();
  }
}

async function startGoogleDriveConnect() {
  try {
    const tenantId = await requireTenantId();
    const returnTo = window.location.href.split('#')[0];
    const qs = new URLSearchParams({ return_to: returnTo });
    const res = await fetchWithTenantCreds(
      `${googleTenantPath(tenantId, '/oauth/authorize')}?${qs}`,
    );
    if (!res.ok) throw new Error(await parseGatewayError(res));
    const { url } = await res.json();
    if (!url) throw new Error('Authorize URL missing from gateway');
    window.location.href = url;
  } catch (err) {
    showDriveEntryToast(err?.message || String(err), { isError: true });
  }
}

async function exportEntryToDrive(entry, triggerBtn) {
  if (!googleDriveConnected) {
    showDriveEntryToast('Connect Google Drive from the header before exporting.', { isError: true });
    return;
  }
  if (driveExportBusy) return;
  driveExportBusy = true;
  triggerBtn?.classList.add('is-busy');
  setDriveUi();
  try {
    const file = buildEntryExportFile(entry);
    const { payload, fileId } = await uploadFileToDrive(file);
    persistEntryDriveFileId(entry.id, fileId);
    renderEntries();
    showDriveEntryToast(`Uploaded “${payload.file?.name || file.name}” for ${entry.destination}.`);
    notifyProductContextChanged();
  } catch (err) {
    showDriveEntryToast(err?.message || String(err), { isError: true });
  } finally {
    triggerBtn?.classList.remove('is-busy');
    driveExportBusy = false;
    setDriveUi();
  }
}

function wireEntryDriveExports() {
  els.entriesList?.addEventListener('click', (event) => {
    const btn = event.target.closest?.('.entry-drive-export-btn');
    if (!btn || btn.disabled) return;
    const entryId = String(btn.getAttribute('data-entry-id') || '').trim();
    if (!entryId) return;
    const entry = loadEntries().find((item) => String(item.id) === entryId);
    if (!entry) return;
    exportEntryToDrive(entry, btn).catch(() => {});
  });
}

function wireDriveHeader() {
  els.driveHeaderConnect?.addEventListener('click', () => {
    startGoogleDriveConnect().catch((err) => {
      showDriveEntryToast(err?.message || String(err), { isError: true });
    });
  });
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
    await antinode.ai.mount('#antinode-ai', {
      theme: document.documentElement.getAttribute('data-theme') || 'glass',
    });
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
      scheduleGoogleDriveRefresh({ forceLoading: true }).catch(() => {});
      renderEntries();
    }
    if (!signedIn) {
      cachedSecret = null;
      googleDriveConnected = false;
      googleDriveStatus = 'idle';
      closeAiOverlay();
      setDriveUi();
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

  if (stripGoogleConnectedQuery()) {
    await scheduleGoogleDriveRefresh({ forceLoading: true }).catch(() => {});
  } else if (signedInOnLoad) {
    await scheduleGoogleDriveRefresh({ forceLoading: true }).catch(() => {});
  } else {
    setDriveUi();
  }

  wireDriveHeader();
  wireEntryDriveExports();
}

bootstrap().catch((err) => {
  console.error('[horizon-atlas]', err);
});
