/* Cloud backup runs alongside the local app and can be disconnected at any time. */
(() => {
  const SESSION_KEY = 'jot-cloud-session.v1';
  const dialog = $('#cloud-dialog');
  const login = $('#cloud-login');
  const status = $('#cloud-status');
  let session = readSession();
  let timer, running = false, conflict = null, message = '', retry = 0, checked = false;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
    catch (error) { return null; }
  }
  function storeSession(next) {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
    session = next;
  }
  function refreshUI() {
    login.hidden = !!session;
    $('#cloud-logout').hidden = !session;
    $('#cloud-conflict').hidden = !conflict;
    $('#cloud-sync').hidden = !session || !!conflict;
    for (const button of dialog.querySelectorAll('button:not(.btns form button)')) {
      button.disabled = running;
    }
    const summary = $('#cloud-summary');
    if (summary) summary.textContent = conflict ? 'Review two changed copies'
      : session ? !navigator.onLine ? 'Offline' : running ? 'Syncing…' : message ? 'Check sync status'
        : localVersion.revision !== localVersion.synced ? 'Changes waiting to sync'
          : localVersion.base ? 'Up to date' : '' : '';
    status.textContent = message || (conflict ? 'Cloud backup is paused until you choose a copy.' : '') || (session
      ? !navigator.onLine ? 'Offline. Changes are saved on this device.'
        : localVersion.revision !== localVersion.synced ? 'Changes waiting to sync.'
          : localVersion.base ? 'Cloud backup is up to date.' : checked ? 'Ready. Your changes will back up automatically.' : 'Connecting to cloud backup…'
      : 'Sign in to enable automatic backup. Jot saves on this device as you work.');
  }
  function schedule(delay = 800) {
    clearTimeout(timer);
    timer = undefined;
    if (session && navigator.onLine && !conflict) timer = setTimeout(() => {
      timer = undefined;
      sync();
    }, delay);
  }
  async function request(config, path, { method = 'GET', body, token, prefer } = {}) {
    const headers = { apikey: config.key };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (prefer) headers.Prefer = prefer;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(config.url + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw Object.assign(new Error('Cloud request failed'), { status: response.status });
    return response.status === 204 ? null : response.json();
  }
  function credentials(config, data) {
    if (!data?.user?.id || !data.access_token || !data.refresh_token) throw new Error('Missing session');
    return {
      url: config.url, key: config.key, uid: data.user.id, email: data.user.email,
      access: data.access_token, refresh: data.refresh_token,
      expires: Date.now() + Number(data.expires_in || 3600) * 1000
    };
  }
  async function accessToken() {
    if (session.expires > Date.now() + 60000 && session.access) return session.access;
    try {
      const data = await request(session, '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refresh }
      });
      storeSession(credentials(session, data));
      return session.access;
    } catch (error) {
      if ([400, 401, 403].includes(error.status)) {
        const { url, key, email } = session;
        storeSession(null);
        login.elements.url.value = url;
        login.elements.key.value = key;
        login.elements.email.value = email || '';
        throw new Error('Sign in again to continue cloud backup.');
      }
      throw error;
    }
  }
  function locked(work) {
    return navigator.locks ? navigator.locks.request(SESSION_KEY, work) : work();
  }
  function owner(config) {
    return config.url + '/' + config.uid;
  }
  function remember(version, state = S) {
    if (!writeLocal(state, version)) throw new Error('Free up browser storage to continue syncing.');
    localVersion = version;
  }
  function canRestore() {
    const edit = document.activeElement;
    return (!document.querySelector('dialog[open]:not(#cloud-dialog)')
      && !edit?.matches('input, textarea, select, [contenteditable="true"]'));
  }
  function restore(row) {
    if (!Array.isArray(row.data?.projects) || !row.data.projects.length) {
      throw new Error('The cloud copy is not a valid Jot backup.');
    }
    const state = Object.assign(fresh(), row.data);
    for (const key of deviceFields) state[key] = S[key];
    state.car = { ...state.car, cur: S.car.cur };
    remember({ ...localVersion, revision: row.revision, synced: row.revision, base: row.revision, attempt: null }, state);
    S = state;
    migrateGoals();
    lastLocalData = JSON.stringify(cloudData(S));
    remember(localVersion);
    open = openDoc = openGoal = openBuild = null;
    renderAll();
  }
  async function sync(choice = '') {
    if (running || !session || !navigator.onLine || (conflict && !choice)) return;
    running = true;
    message = 'Syncing…';
    refreshUI();
    try {
      await locked(async () => {
        session = readSession();
        if (!session) return;
        const account = owner(session);
        if (localVersion.owner && localVersion.owner !== account) throw new Error('This device’s Jot data is linked to a different cloud account.');
        if (!save()) throw new Error('Could not read or update this tab’s local copy. Reopen Jot to sync.');
        if (!localVersion.owner) remember({ ...localVersion, owner: account });
        const token = await accessToken();
        const path = '/rest/v1/jot_backups';
        const filter = '?user_id=eq.' + encodeURIComponent(session.uid);
        const read = async () => (await request(session, path + filter + '&select=revision,data', { token }))[0] || null;
        const remote = await read();
        checked = true;
        if (choice && remote?.revision !== conflict?.revision) {
          conflict = remote;
          if (remote) return;
          if (choice === 'use') { schedule(0); return; }
        }
        if (remote && (remote.revision === localVersion.revision || remote.revision === localVersion.attempt)) {
          remember({ ...localVersion, base: remote.revision, synced: remote.revision, attempt: null });
        }
        if (remote && remote.revision !== localVersion.base) {
          const localChanged = localVersion.revision !== localVersion.synced;
          if (!choice && localChanged) {
            conflict = remote;
            toast('Cloud backup needs review. Open More → Cloud backup.');
            return;
          }
          if (choice !== 'keep') {
            if (!choice && !canRestore()) {
              schedule(2000);
              return;
            }
            restore(remote);
            conflict = null;
            return;
          }
        }
        const revision = localVersion.revision;
        if (!revision && !remote) return;
        if (remote && revision === localVersion.synced && !choice) return;
        const snapshot = cloudData(S);
        remember({ ...localVersion, attempt: revision });
        const body = { revision, data: snapshot };
        let rows;
        try {
          rows = await request(session, path + (remote ? filter + '&revision=eq.' + encodeURIComponent(remote.revision) : ''), {
            method: remote ? 'PATCH' : 'POST', token, prefer: 'return=representation',
            body: remote ? body : { user_id: session.uid, ...body }
          });
        } catch (error) {
          if (error.status !== 409) throw error;
        }
        if (!rows?.length) {
          conflict = null;
          schedule(250);
          return;
        }
        remember({ ...localVersion, base: revision, synced: revision, attempt: null });
        conflict = null;
        if (revision !== localVersion.revision) schedule();
      });
      retry = 0;
      message = '';
    } catch (error) {
      message = [401, 403].includes(error.status) ? 'Cloud access was denied. Check your Supabase setup.'
        : error.status === 404 ? 'Cloud backup table is missing. Run the setup SQL in Supabase.'
        : error.status || error.name !== 'Error' || error.message === 'Cloud request failed'
          ? 'Cloud unavailable. This device keeps its changes and will retry.' : error.message;
      if (session && navigator.onLine && !conflict) schedule(Math.min(60000, 2000 * 2 ** Math.min(5, retry++)));
    } finally {
      running = false;
      refreshUI();
    }
  }

  login.addEventListener('submit', async event => {
    event.preventDefault();
    if (running) return;
    if (!navigator.onLine) {
      message = 'Connect to the internet to sign in.';
      refreshUI();
      return;
    }
    const fields = new FormData(login);
    const key = fields.get('key').trim();
    let url;
    try {
      const parsed = new URL(fields.get('url').trim());
      if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.host)) throw new Error('URL');
      url = parsed.origin;
    } catch (error) {
      message = 'Enter the HTTPS project URL ending in .supabase.co.';
      refreshUI();
      return;
    }
    if (!key.startsWith('sb_publishable_')) {
      message = 'Enter the publishable key from your Supabase project.';
      refreshUI();
      return;
    }
    running = true;
    message = 'Signing in…';
    refreshUI();
    try {
      const next = credentials({ url, key }, await request({ url, key }, '/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: fields.get('email').trim(), password: fields.get('password') }
      }));
      if (localVersion.owner && localVersion.owner !== owner(next)) {
        message = 'This device’s Jot data is linked to a different cloud account. Use that account to reconnect.';
      } else {
        storeSession(next);
        message = '';
        schedule(0);
      }
    } catch (error) {
      message = [400, 401, 422].includes(error.status)
        ? 'Sign-in failed. Check the email, password and project settings.'
        : 'Could not sign in. Check the connection and Supabase project settings.';
    } finally {
      login.elements.password.value = '';
      running = false;
      refreshUI();
    }
  });
  $('#cloud-logout').onclick = () => {
    try { storeSession(null); }
    catch (error) { message = 'Could not disconnect. Check your browser storage.'; refreshUI(); return; }
    schedule();
    conflict = null;
    message = 'Disconnected. Jot still saves changes on this device.';
    refreshUI();
  };
  $('#cloud-sync').onclick = () => sync();
  $('#cloud-keep').onclick = () => sync('keep');
  $('#cloud-use').onclick = () => sync('use');
  cloud = {
    open() { refreshUI(); dialog.showModal(); },
    refreshUI,
    changed() { if (!running) message = ''; refreshUI(); schedule(); }
  };
  window.addEventListener('online', () => { message = ''; refreshUI(); schedule(0); });
  window.addEventListener('offline', () => { message = ''; refreshUI(); schedule(); });
  window.addEventListener('storage', event => {
    if (event.key === SESSION_KEY) {
      session = readSession();
      if (!session) conflict = null;
      message = '';
      refreshUI();
      schedule();
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  setInterval(() => { if (!document.hidden && !running && !timer) schedule(0); }, 30000);
  schedule(0);
})();
