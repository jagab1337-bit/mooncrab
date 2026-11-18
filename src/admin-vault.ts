import { renderLogins } from './admin-logins.ts';
import { renderFiles } from './admin-files.ts';
import { protectDraft, escape, showError, workspaceUrl, type AdminFetch, type RecordIdentity } from './admin-workspace.ts';

type Note = RecordIdentity & {
  title:string; body:string; fileIds:string[]; links:{label:string;url:string}[];
};
const endpoint = workspaceUrl('notes');

export async function renderVault(container: HTMLElement, request: AdminFetch): Promise<void> {
  container.innerHTML = `<h2>Logins &amp; Notes</h2>
    <section class="workspace-entry" data-logins></section>
    <section class="workspace-entry"><h3>Notes</h3>
      <div class="workspace-actions"><button type="button" data-create>Add Note</button></div>
      <div class="workspace-form"><label>Find notes<input type="search" placeholder="Search title or note text"></label></div>
      <p data-status role="status" class="workspace-status">Loading notes…</p>
      <div data-editor></div><div data-notes class="workspace-grid vault-notes-grid"></div>
    </section>
    <section class="workspace-entry" data-library></section>`;
  const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const editor = find('[data-editor]');
  const status = find('[data-status]');
  const notes = find('[data-notes]');
  void renderLogins(find('[data-logins]'), request);
  const search = find<HTMLInputElement>('[type=search]');
  const library = find('[data-library]');
  let records: Note[] = [];
  let dirty = false;
  let busy = false;
  void renderFiles(library, request);
  function draw(): void {
    const query = search.value.trim().toLowerCase();
    const shown = records.filter(row => [row.title, row.body].some(text => text.toLowerCase().includes(query)));
    notes.innerHTML = shown.length ? shown.map(row => `<article class="workspace-entry">
      <h4>${escape(row.title)}</h4><p class="workspace-prewrap vault-note-body">${escape(row.body)}</p>
      ${row.links.map(link => `<p><a href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">${escape(link.label)}</a></p>`).join('')}
      ${row.fileIds.length ? `<p class="owner-hint">${row.fileIds.length} attached ${row.fileIds.length === 1 ? 'file' : 'files'}</p>` : ''}
      <div class="workspace-actions"><button type="button" data-note="${row.id}">View or Edit Note</button></div></article>`).join('') : '<p>No matching notes.</p>';
  }
  function open(row?: Note): void {
    if (busy || (dirty && !confirm('Discard your unsaved note changes?'))) return;
    dirty = false;
    let fileIds = row?.fileIds ?? [];
    editor.innerHTML = `<form class="workspace-form workspace-entry"><h4 class="workspace-full">${row ? 'Edit note' : 'Add note'}</h4>
      <label class="workspace-full">Title<input name="title" required maxlength="120" value="${escape(row?.title)}"></label>
      <label class="workspace-full">Note<textarea name="body" maxlength="12000" rows="6">${escape(row?.body)}</textarea></label>
      <label class="workspace-full">Links, one HTTPS URL per line<textarea name="links" rows="2">${escape(row?.links.map(link => link.url).join('\n'))}</textarea></label>
      <div class="workspace-actions workspace-full"><button class="owner-primary" type="submit">Save Note</button><button type="button" data-close>Close</button>${row ? '<button type="button" data-delete>Delete Note</button>' : ''}</div>
      </form><details><summary>Manage attached files</summary><div data-note-files></div></details>`;
    const form = editor.querySelector('form')!;
    void renderFiles(editor.querySelector('[data-note-files]')!, request, { fileIds, onChange: ids => { fileIds = ids; dirty = true; } });
    form.oninput = () => { dirty = true; };
    async function save(action: 'save' | 'delete', record?: unknown): Promise<void> {
      if (busy) return;
      busy = true;
      const controls = form.querySelectorAll<HTMLInputElement>('input, textarea, button');
      controls.forEach(control => control.disabled = true);
      try {
        records = (await request(endpoint, 'POST', { action, id: row?.id, revision: row?.revision, record })).records as Note[];
        editor.replaceChildren(); dirty = false; draw();
        status.textContent = action === 'save' ? 'Note saved.' : 'Note deleted.';
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
      if (!busy && (!dirty || confirm('Discard your unsaved note changes?'))) { dirty = false; editor.replaceChildren(); }
    };
    const remove = form.querySelector<HTMLButtonElement>('[data-delete]');
    if (remove) remove.onclick = () => { if (confirm(`Delete “${row!.title}”?`)) void save('delete'); };
  }
  find('[data-create]').onclick = () => open();
  search.oninput = draw;
  notes.onclick = event => {
    const id = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-note]')?.dataset.note;
    const found = records.find(row => row.id === id);
    if (found) open(found);
  };
  protectDraft(container, () => dirty || busy);
  try { records = (await request(endpoint)).records as Note[]; draw(); status.textContent = ''; }
  catch (error) { showError(status, error); }
}
