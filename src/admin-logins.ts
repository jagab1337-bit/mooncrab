import { escape, protectDraft, showError, workspaceUrl, type AdminFetch } from './admin-workspace.ts';

type Login = { id:string; revision:string; name:string; username:string; url:string };
type VaultState = { enrolled:boolean; unlockedUntil:number | null; logins:Login[] };
const endpoint = workspaceUrl('logins');
const masked = '••••••••••••';

export async function renderLogins(section: HTMLElement, request: AdminFetch): Promise<void> {
  section.innerHTML = `<h3>Logins</h3><p data-login-status class="workspace-status" role="status">Checking vault access…</p><div data-login-content></div>`;
  const status = section.querySelector<HTMLElement>('[data-login-status]')!;
  const content = section.querySelector<HTMLElement>('[data-login-content]')!;
  const workspace = section.closest<HTMLElement>('#workspace-page')?.firstElementChild as HTMLElement | null;
  let state: VaultState = {enrolled:false,unlockedUntil:null,logins:[]};
  let dirty = false;
  let busy = false;
  let expiry: ReturnType<typeof setTimeout>;
  const send = (body: Record<string, unknown>) => request(endpoint, 'POST', body);

  function showLocked(message: string): void {
    state = { ...state, unlockedUntil:null, logins:[] };
    dirty = false;
    clearTimeout(expiry);
    draw();
    status.textContent = message;
  }

  function scheduleLock(): void {
    clearTimeout(expiry);
    if (state.unlockedUntil) {
      expiry = setTimeout(() => {
        if (section.isConnected) showLocked('Vault locked. Enter your password and a fresh authenticator code to continue.');
      }, Math.max(0, state.unlockedUntil - Date.now()));
    }
  }

  function apply(result: Record<string, unknown>): void {
    state = result as VaultState;
    scheduleLock();
    draw();
  }

  function handleError(error: unknown): void {
    if (state.unlockedUntil && state.unlockedUntil <= Date.now()) showLocked('Vault unlock expired.');
    showError(status, error);
  }

  async function submit(form: HTMLFormElement, body: Record<string, unknown>, onSuccess: (result: Record<string, unknown>) => void): Promise<void> {
    if (busy) return;
    busy = true;
    const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')];
    controls.forEach(control => { control.disabled = true; });
    status.textContent = 'Checking vault access…';
    try {
      const result = await send(body);
      if (section.isConnected) onSuccess(result);
    } catch (error) { if (section.isConnected) handleError(error); }
    finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
      for (const field of form.querySelectorAll<HTMLInputElement>('input[type=password], input[name=code]')) field.value = '';
    }
  }

  function drawUnlock(): void {
    const enrolled = state.enrolled;
    content.innerHTML = `<p class="owner-hint">${enrolled
      ? 'Unlock Logins for five minutes with your admin password and authenticator code.'
      : 'Set up your authenticator before saving your first login.'}</p>
      <form class="workspace-form">
        <label>Administrator password<input type="password" name="adminPassword" autocomplete="current-password" maxlength="128" required></label>
        ${enrolled ? '<label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>' : ''}
        <button type="submit" class="owner-primary">${enrolled ? 'Unlock Logins' : 'Set Up Authenticator'}</button>
      </form>`;
    const form = content.querySelector('form')!;
    form.onsubmit = event => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(form));
      void submit(form, { action:enrolled ? 'unlock' : 'setup', ...fields }, result => {
        if (enrolled) {
          apply(result);
          status.textContent = 'Logins unlocked.';
        } else drawEnrollment(String(result.secret));
      });
    };
  }

  function drawEnrollment(secret: string): void {
    content.innerHTML = `<p>Add a time-based entry named <strong>Mooncrab Siargao</strong> in your authenticator app. Choose manual setup and enter this key. Keep a recovery copy in a secure place.</p>
      <p class="vault-setup-key"><code data-setup-key></code></p>
      <form class="workspace-form">
      <label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <div class="workspace-actions"><button type="submit" class="owner-primary">Verify and Unlock</button><button type="button" data-cancel-setup>Cancel</button></div>
      </form>`;
    content.querySelector<HTMLElement>('[data-setup-key]')!.textContent = secret;
    status.textContent = 'Enter a current six-digit code.';
    const form = content.querySelector('form')!;
    form.onsubmit = event => {
      event.preventDefault();
      void submit(form, {action:'enroll', code:new FormData(form).get('code')}, result => {
        apply(result);
        status.textContent = 'Authenticator set up. Logins unlocked.';
      });
    };
    content.querySelector<HTMLButtonElement>('[data-cancel-setup]')!.onclick = () => { void lock(); };
  }

  async function lock(): Promise<void> {
    showLocked('Logins locked.');
    try { await send({action:'lock'}); } catch (error) { showError(status,error); }
  }

  function draw(): void {
    hidePasswords();
    if (!state.unlockedUntil) { drawUnlock(); return; }
    content.innerHTML = `<div class="workspace-actions"><button type="button" data-add-login>Add Login</button><button type="button" data-lock-login>Lock Logins</button></div>
      <div data-login-editor></div>
      <div class="workspace-table-wrap"><table class="workspace-table vault-login-table">
        <thead><tr><th scope="col">Login</th><th scope="col">Username / email</th><th scope="col">Password</th><th scope="col">Actions</th></tr></thead>
        <tbody>${state.logins.length ? state.logins.map(login => `<tr data-login-id="${login.id}">
          <td><strong>${escape(login.name)}</strong>${login.url ? `<br><a href="${escape(login.url)}" target="_blank" rel="noopener noreferrer">Open login link ↗</a>` : ''}</td>
          <td>${escape(login.username)}</td>
          <td><button class="vault-password-mask" type="button" aria-label="Reveal password for ${escape(login.name)}" title="Hover to reveal. Keyboard users can press Enter.">${masked}</button></td>
          <td><div class="vault-row-actions"><button type="button" data-copy-password>Copy Password</button><button type="button" data-edit-login>Edit</button><button type="button" data-delete-login>Delete</button></div></td>
        </tr>`).join('') : '<tr><td colspan="4">No saved logins yet.</td></tr>'}</tbody>
      </table></div>`;
    content.querySelector<HTMLButtonElement>('[data-add-login]')!.onclick = () => openEditor();
    content.querySelector<HTMLButtonElement>('[data-lock-login]')!.onclick = () => {
      if (!busy && (!dirty || confirm('Lock Logins and discard your unsaved changes?'))) void lock();
    };
    for (const row of content.querySelectorAll<HTMLTableRowElement>('[data-login-id]')) bindRow(row);
  }

  function openEditor(login?: Login): void {
    if (busy || (dirty && !confirm('Discard your unsaved login changes?'))) return;
    const editor = content.querySelector<HTMLElement>('[data-login-editor]')!;
    dirty = false;
    editor.innerHTML = `<form class="workspace-form workspace-entry vault-login-editor" autocomplete="off">
      <h4 class="workspace-full">${login ? 'Edit login' : 'Add login'}</h4>
      <label>Name<input name="name" maxlength="120" required value="${escape(login?.name)}"></label>
      <label>Username or email<input name="username" maxlength="254" required value="${escape(login?.username)}"></label>
      <label>Login link<input name="url" type="url" maxlength="1000" placeholder="https://" value="${escape(login?.url)}"></label>
      <label>${login ? 'New password' : 'Password'}<input name="password" type="password" autocomplete="new-password" maxlength="1024" ${login ? 'placeholder="Leave blank to keep current password"' : 'required'}></label>
      <div class="workspace-actions workspace-full"><button class="owner-primary" type="submit">Save Login</button><button type="button" data-close-editor>Cancel</button></div>
    </form>`;
    const form = editor.querySelector('form')!;
    form.oninput = () => { dirty = true; };
    form.onsubmit = event => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(form));
      if (login && !fields.password) delete fields.password;
      void submit(form, {action:'save', id:login?.id, revision:login?.revision, ...fields}, result => {
        dirty = false;
        apply(result);
        status.textContent = 'Login saved.';
      });
    };
    form.querySelector<HTMLButtonElement>('[data-close-editor]')!.onclick = () => {
      if (!busy && (!dirty || confirm('Discard your unsaved login changes?'))) { dirty = false; editor.replaceChildren(); }
    };
    form.querySelector('input')?.focus();
  }

  function bindRow(row: HTMLTableRowElement): void {
    const login = state.logins.find(item => item.id === row.dataset.loginId)!;
    const mask = row.querySelector<HTMLButtonElement>('.vault-password-mask')!;
    let hoverTimer: ReturnType<typeof setTimeout>;
    let revealTimer: ReturnType<typeof setTimeout>;
    let revealVersion = 0;
    const hide = () => {
      ++revealVersion;
      clearTimeout(hoverTimer);
      clearTimeout(revealTimer);
      mask.textContent = masked;
    };
    const fetchPassword = async (reason: 'hover' | 'copy') => {
      const result = await send({action:'reveal', id:login.id, reason});
      if (!row.isConnected || !state.unlockedUntil || state.unlockedUntil <= Date.now() || typeof result.password !== 'string') {
        throw new Error('Unlock Logins again before using this password.');
      }
      return result.password;
    };
    async function reveal(): Promise<void> {
      const version = ++revealVersion;
      try {
        const password = await fetchPassword('hover');
        if (version !== revealVersion) return;
        mask.textContent = password;
        revealTimer = setTimeout(hide, 8000);
      } catch (error) { if (version === revealVersion && row.isConnected) handleError(error); }
    }
    mask.onpointerenter = event => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') hoverTimer = setTimeout(() => { void reveal(); }, 200); };
    mask.onpointerleave = hide;
    mask.onpointercancel = hide;
    mask.onblur = hide;
    mask.onclick = event => { if (event.detail === 0) { hide(); void reveal(); } };
    row.addEventListener('vault-hide-password', hide);
    const copy = row.querySelector<HTMLButtonElement>('[data-copy-password]')!;
    copy.onclick = async () => {
      hide();
      copy.disabled = true;
      try {
        if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
          const blob = fetchPassword('copy').then(password => new Blob([password], {type:'text/plain'}));
          void blob.catch(() => {}); // The clipboard may reject before consuming the blob.
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
        } else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(await fetchPassword('copy'));
        else throw new Error('Clipboard access is unavailable in this browser.');
        status.textContent = 'Password copied.';
      } catch (error) { handleError(error); }
      finally { copy.disabled = false; }
    };
    row.querySelector<HTMLButtonElement>('[data-edit-login]')!.onclick = () => openEditor(login);
    row.querySelector<HTMLButtonElement>('[data-delete-login]')!.onclick = async () => {
      if (busy || (dirty && !confirm('Discard your unsaved login changes?')) || !confirm(`Delete “${login.name}” from Logins?`)) return;
      busy = true;
      try {
        apply(await send({action:'delete', id:login.id, revision:login.revision}));
        dirty = false;
        status.textContent = 'Login deleted.';
      } catch (error) { handleError(error); }
      finally { busy = false; }
    };
  }

  function hidePasswords(): void {
    section.querySelectorAll('[data-login-id]').forEach(row => row.dispatchEvent(new Event('vault-hide-password')));
  }
  const lifecycle = new AbortController();
  const stop = new MutationObserver(() => {
    if (!section.isConnected) {
      hidePasswords();
      clearTimeout(expiry);
      lifecycle.abort();
      stop.disconnect();
    }
  });
  if (workspace?.parentElement) {
    stop.observe(workspace.parentElement, { childList:true });
    protectDraft(workspace, () => dirty || busy);
  }
  window.addEventListener('blur', hidePasswords, {signal:lifecycle.signal});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hidePasswords();
    else if (state.unlockedUntil && state.unlockedUntil <= Date.now()) showLocked('Vault unlock expired.');
  }, {signal:lifecycle.signal});
  window.addEventListener('pagehide', hidePasswords, {signal:lifecycle.signal});

  try {
    const result = await request(endpoint);
    if (section.isConnected) { apply(result); status.textContent = ''; }
  } catch (error) { if (section.isConnected) showError(status,error); }
}
