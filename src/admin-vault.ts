import { renderFiles } from './admin-files.ts';
import { escape, showError, workspaceUrl, type AdminFetch, type RecordIdentity } from './admin-workspace.ts';

type Property = RecordIdentity & {
  name: string; address: string; mapsUrl: string; description: string; contacts: string; notes: string;
  folder: string; fileIds: string[]; links: { label: string; url: string }[];
};
const endpoint = workspaceUrl('properties');

export async function renderVault(container: HTMLElement, request: AdminFetch): Promise<void> {
  container.innerHTML = `<h2>Credentials &amp; Properties</h2>
    <section class="workspace-entry"><h3>Credentials</h3>
    <p>Use a business password vault with multifactor authentication for confidential account details.</p>
    <div class="workspace-actions"><a href="https://start.1password.com/" rel="noopener noreferrer" target="_blank">Open 1Password</a><a href="https://vault.bitwarden.com/" rel="noopener noreferrer" target="_blank">Open Bitwarden</a></div></section>
    <section><h3>Properties &amp; information</h3>
    <div class="workspace-actions"><button type="button" data-create>Add property</button></div>
    <label class="workspace-form">Find a property<input type="search" placeholder="Search name, address, or folder"></label>
    <p data-status role="status" class="workspace-status">Loading properties…</p>
    <div data-editor></div><div data-properties class="workspace-grid"></div></section>
    <section class="workspace-entry" data-library></section>`;
  const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const editor = find('[data-editor]');
  const status = find('[data-status]');
  const properties = find('[data-properties]');
  const search = find<HTMLInputElement>('[type=search]');
  const library = find('[data-library]');
  let records: Property[] = [];
  let dirty = false;
  let busy = false;
  void renderFiles(library, request);
  function draw(): void {
    const query = search.value.trim().toLowerCase();
    const shown = records.filter(row => [row.name, row.folder, row.address].some(text => text.toLowerCase().includes(query)));
    properties.innerHTML = shown.length ? shown.map(row => `<article class="workspace-entry">
      <h3>${escape(row.name)}</h3><p>${escape(row.address)}</p><p class="owner-hint">${escape(row.folder)} · ${row.fileIds.length} attachments</p>
      ${row.mapsUrl ? `<a href="${escape(row.mapsUrl)}" target="_blank" rel="noopener noreferrer">Open map</a>` : ''}
      <div class="workspace-actions"><button type="button" data-property="${row.id}">View or edit</button></div></article>`).join('') : '<p>No matching properties.</p>';
  }
  function open(row?: Property): void {
    if (busy || (dirty && !confirm('Discard your unsaved property changes?'))) return;
    dirty = false;
    let fileIds = row?.fileIds ?? [];
    editor.innerHTML = `<form class="workspace-form workspace-entry"><h3 class="workspace-full">${row ? 'Edit property' : 'Add property'}</h3>
      <label>Property name<input name="name" required maxlength="120" value="${escape(row?.name)}"></label>
      <label>Folder<input name="folder" maxlength="80" value="${escape(row?.folder)}"></label>
      <label>Address<input name="address" maxlength="500" value="${escape(row?.address)}"></label>
      <label>Google Maps link<input name="mapsUrl" type="url" value="${escape(row?.mapsUrl)}"></label>
      <label class="workspace-full">Description<textarea name="description" maxlength="4000">${escape(row?.description)}</textarea></label>
      <label class="workspace-full">Contacts<textarea name="contacts" maxlength="1000">${escape(row?.contacts)}</textarea></label>
      <label class="workspace-full">Notes<textarea name="notes" maxlength="5000">${escape(row?.notes)}</textarea></label>
      <label class="workspace-full">Important links, one HTTPS URL per line<textarea name="links" rows="3">${escape(row?.links.map(link => link.url).join('\n'))}</textarea></label>
      <div class="workspace-actions workspace-full"><button class="owner-primary" type="submit">Save property</button><button type="button" data-close>Close</button>${row ? '<button type="button" data-delete>Delete property</button>' : ''}</div>
      </form><details><summary>Manage attached originals</summary><div data-property-files></div></details>`;
    const form = editor.querySelector('form')!;
    void renderFiles(editor.querySelector('[data-property-files]')!, request, { fileIds, onChange: ids => { fileIds = ids; dirty = true; } });
    form.oninput = () => { dirty = true; };
    async function save(action: 'save' | 'delete', record?: unknown): Promise<void> {
      if (busy) return;
      busy = true;
      const controls = form.querySelectorAll<HTMLInputElement>('input, textarea, button');
      controls.forEach(control => control.disabled = true);
      try {
        records = (await request(endpoint, 'POST', { action, id: row?.id, revision: row?.revision, record })).records as Property[];
        editor.replaceChildren(); dirty = false; draw();
        status.textContent = action === 'save' ? 'Property saved.' : 'Property deleted.';
      } catch (error) { showError(status, error); }
      finally { busy = false; controls.forEach(control => control.disabled = false); }
    }
    form.onsubmit = event => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(form));
      const links = String(fields.links ?? '').split(/\r?\n/).map(url => url.trim()).filter(Boolean).map(url => row?.links.find(link => link.url === url) ?? { label: url.slice(0,120), url });
      void save('save', { ...fields, links, fileIds });
    };
    form.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => {
      if (!busy && (!dirty || confirm('Discard your unsaved property changes?'))) { dirty = false; editor.replaceChildren(); }
    };
    const remove = form.querySelector<HTMLButtonElement>('[data-delete]');
    if (remove) remove.onclick = () => { if (confirm(`Delete “${row!.name}”?`)) void save('delete'); };
  }
  find('[data-create]').onclick = () => open();
  search.oninput = draw;
  properties.onclick = event => {
    const id = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-property]')?.dataset.property;
    const found = records.find(row => row.id === id);
    if (found) open(found);
  };
  window.addEventListener('beforeunload', event => {
    if (container.isConnected && (dirty || busy)) { event.preventDefault(); event.returnValue = ''; }
  });
  try { records = (await request(endpoint)).records as Property[]; draw(); status.textContent = ''; }
  catch (error) { showError(status, error); }
}
