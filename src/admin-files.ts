import { escape, showError, workspaceUrl, type AdminFetch } from './admin-workspace.ts';

type FileRow = { id: string; name: string; folder: string; mime: string; bytes: number };
const endpoint = workspaceUrl('files');
const byteLimit = 2 * 1024 * 1024;
const previewImages = new Set(['image/jpeg', 'image/png', 'image/webp']);
type Attachments = { fileIds: string[]; onChange: (ids: string[]) => void };

export async function renderFiles(container: HTMLElement, request: AdminFetch, attachment?: Attachments): Promise<void> {
  let rows: FileRow[] = [];
  let selected = new Set(attachment?.fileIds ?? []);
  let busy = false;
  container.innerHTML = `<h3>${attachment ? 'Attachments' : 'Documents & files'}</h3>
    <p class="owner-hint">Original files are stored privately. Up to 2 MiB per file.</p>
    <form class="workspace-form"><label>File<input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt"></label>
    <label>Folder<input name="folder" maxlength="80" placeholder="Optional"></label>
    <button class="owner-primary" type="submit">Upload original</button></form>
    <div class="workspace-form"><label>Find a file<input type="search" placeholder="Search name or folder"></label></div>
    <p data-status class="workspace-status" role="status">Loading files…</p><div data-files></div><div data-preview></div>`;
  const form = container.querySelector('form')!;
  const list = container.querySelector<HTMLElement>('[data-files]')!;
  const status = container.querySelector<HTMLElement>('[data-status]')!;
  const search = container.querySelector<HTMLInputElement>('[type=search]')!;
  const preview = container.querySelector<HTMLElement>('[data-preview]')!;
  let previewUrl = '';
  function draw(): void {
    const results = rows.filter(file => (file.name + ' ' + file.folder).toLowerCase().includes(search.value.toLowerCase()));
    list.innerHTML = results.length ? results.map(file => `<article class="workspace-entry">
      <strong>${escape(file.name)}</strong><p class="owner-hint">${escape(file.folder || 'Unfiled')} · ${Math.ceil(file.bytes / 1024)} KiB</p>
      <div class="workspace-actions">
      ${attachment ? `<label><input type="checkbox" data-attach="${file.id}" ${selected.has(file.id) ? 'checked' : ''}> Attach</label>` : ''}
      ${previewImages.has(file.mime) || file.mime === 'application/pdf' ? `<button type="button" data-file-action="preview" data-id="${file.id}">Preview</button>` : ''}
      <button type="button" data-file-action="download" data-id="${file.id}">Download original</button>
      ${attachment ? '' : `<button type="button" data-file-action="rename" data-id="${file.id}">Rename or move</button><button type="button" data-file-action="delete" data-id="${file.id}">Delete</button>`}
      </div></article>`).join('') : '<p>No matching files.</p>';
  }
  try { rows = (await request(endpoint)).files as FileRow[]; draw(); status.textContent = ''; }
  catch (error) { showError(status, error); form.querySelector('button')!.disabled = true; return; }
  search.oninput = draw;
  list.onchange = event => {
    const input = event.target as HTMLInputElement;
    const id = input.dataset.attach;
    if (!id) return;
    if (input.checked && selected.size >= 50) { input.checked = false; status.textContent = 'A record can have up to 50 attachments.'; return; }
    if (input.checked) selected.add(id);
    else selected.delete(id);
    attachment?.onChange([...selected]);
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const file = form.querySelector<HTMLInputElement>('[type=file]')!.files?.[0];
    if (!file || file.size > byteLimit) { status.textContent = 'Choose a file up to 2 MiB.'; return; }
    const folder = String(new FormData(form).get('folder') ?? '');
    busy = true;
    status.textContent = 'Uploading original…';
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('File could not be read.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(file);
      });
      const result = await request(endpoint, 'POST', { action: 'upload', name: file.name, folder, data });
      rows = result.files as FileRow[];
      if (attachment && selected.size < 50) { selected.add(String(result.id)); attachment.onChange([...selected]); }
      form.reset();
      draw();
      status.textContent = 'Original uploaded.';
    } catch (error) { showError(status, error); }
    finally { busy = false; }
  };
  list.onclick = async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-file-action]');
    const file = rows.find(row => row.id === button?.dataset.id);
    if (!file || busy) return;
    const action = button?.dataset.fileAction;
    busy = true;
    status.textContent = '';
    try {
      if (action === 'delete' || action === 'rename') {
        let name = file.name;
        let folder = file.folder;
        if (action === 'delete' && !confirm(`Delete “${name}” from the library and its attachments?`)) return;
        if (action === 'rename') {
          const newName = prompt('File name', name);
          if (newName === null) return;
          const newFolder = prompt('Folder', folder);
          if (newFolder === null) return;
          name = newName;
          folder = newFolder;
        }
        rows = (await request(endpoint, 'POST', { action, id: file.id, name, folder })).files as FileRow[];
        draw();
        status.textContent = 'File library updated.';
        return;
      }
      const result = await request(endpoint + '&file=' + file.id);
      const bytes = Uint8Array.from(atob(String(result.data)), character => character.charCodeAt(0));
      const supportedPreview = previewImages.has(file.mime) || file.mime === 'application/pdf';
      const url = URL.createObjectURL(new Blob([bytes], { type: action === 'preview' && supportedPreview ? file.mime : 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      if (action !== 'preview' || !supportedPreview) {
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = file.mime === 'application/pdf' ? 'Open PDF with page and zoom controls' : 'View original image and zoom';
      const close = document.createElement('button');
      close.textContent = 'Close preview';
      close.onclick = () => { URL.revokeObjectURL(url); previewUrl = ''; preview.replaceChildren(); };
      preview.replaceChildren(link, ' ', close);
      if (previewImages.has(file.mime)) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = file.name;
        image.className = 'workspace-file-preview';
        preview.append(image);
      }
      preview.scrollIntoView({ block: 'nearest' });
    } catch (error) { showError(status, error); }
    finally { busy = false; }
  };
}
