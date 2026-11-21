import { MAX_REVIEW_IMAGE_BYTES, type Redaction, type ReviewRecord } from '../shared/reviews.ts';
import { showError, type AdminFetch } from './admin-workspace.ts';
import { reviewLabelMarkup } from './review-labels.ts';

const formats = ['image/jpeg','image/png','image/webp'];
const imageUrl = (record: ReviewRecord, size: 'original' | 'thumb' | 'full', asset = record.photo!.id) =>
  `/api/admin/workspace?section=reviews&reviewImage=${record.id}&asset=${asset}&size=${size}`;

async function fileData(file: File): Promise<string> {
  if (!formats.includes(file.type) || file.size > MAX_REVIEW_IMAGE_BYTES) throw new Error('Choose a JPG, PNG or WebP up to 2 MiB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function mountReviewUpload(
  root: HTMLElement, request: AdminFetch, record: ReviewRecord | undefined, uploads: boolean,
  status: HTMLElement, change: (modified?: boolean) => void,
) {
  root.innerHTML = `<fieldset class="review-upload"><legend>${reviewLabelMarkup('photo')}</legend>
    <div class="review-drop" data-review-drop><label>${reviewLabelMarkup('choose')}<input type="file" accept="image/jpeg,image/png,image/webp" ${uploads ? '' : 'disabled'}></label><p>Drop a JPG, PNG or WebP here, up to 2 MiB.</p></div>
    <img class="review-saved-image" alt="" hidden>
    <div class="workspace-actions">
      <button type="button" data-original hidden>${reviewLabelMarkup('original')}</button>
      ${record?.photo ? '<button type="button" data-download-original>Download original</button>' : ''}
      <button type="button" data-redact aria-pressed="false" hidden>${reviewLabelMarkup('redact')}</button>
      <button type="button" data-undo hidden>${reviewLabelMarkup('undo')}</button>
      <button type="button" data-remove hidden>${reviewLabelMarkup('removeImage')}</button>
    </div>
    <p class="owner-hint" data-redaction-help hidden>Drag over any private detail to cover it. The complete public image will include these redactions.</p>
    <canvas class="review-redaction-canvas" hidden aria-label="Image redaction preview"></canvas>
    ${record?.originals?.length ? `<details><summary>Earlier original images</summary><div class="workspace-actions">${record.originals.map((file,index) => `<button type="button" data-archived-original="${file.id}">Download original ${index + 1}</button>`).join('')}</div></details>` : ''}
    <p class="owner-hint" data-upload-status role="status"></p>
  </fieldset>`;
  const drop = root.querySelector<HTMLElement>('[data-review-drop]')!;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const stored = root.querySelector<HTMLImageElement>('.review-saved-image')!;
  const context = canvas.getContext('2d')!;
  const alert = root.querySelector<HTMLElement>('[data-upload-status]')!;
  const redact = root.querySelector<HTMLButtonElement>('[data-redact]')!;
  const undo = root.querySelector<HTMLButtonElement>('[data-undo]')!;
  const remove = root.querySelector<HTMLButtonElement>('[data-remove]')!;
  const original = root.querySelector<HTMLButtonElement>('[data-original]')!;
  const help = root.querySelector<HTMLElement>('[data-redaction-help]')!;
  let image: HTMLImageElement | undefined;
  let base64: string | undefined;
  let redactions: Redaction[] = [];
  let removed = false;
  let originalPending = false;
  let pending = false;
  let mode = false;
  let images: { thumb: string; full: string } | undefined;
  let start: { x: number; y: number } | undefined;

  function refreshButtons() {
    const saved = !!record?.photo && !removed;
    original.hidden = !saved || !!image || !uploads;
    remove.hidden = !saved && !image;
    redact.hidden = !image;
    undo.hidden = !image || !redactions.length;
    canvas.hidden = !image;
    stored.hidden = !images || !!image || removed;
    help.hidden = !image || !mode;
    canvas.classList.toggle('redacting', mode);
    redact.setAttribute('aria-pressed', String(mode));
  }
  if (!uploads) alert.textContent = 'Image uploads require the private workspace storage key.';
  refreshButtons();

  const painting = (extra?: Redaction) => {
    if (!image) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    for (const rect of redactions) {
      const left = Math.floor(rect.x * canvas.width);
      const top = Math.floor(rect.y * canvas.height);
      context.fillRect(left, top, Math.ceil((rect.x + rect.width) * canvas.width) - left, Math.ceil((rect.y + rect.height) * canvas.height) - top);
    }
    if (!extra) return;
    context.fillStyle = '#111111b0';
    context.fillRect(extra.x * canvas.width, extra.y * canvas.height, extra.width * canvas.width, extra.height * canvas.height);
  };
  async function loadImage(url: string, masks: Redaction[] = [], edit = true) {
    const decoded = new Image();
    decoded.src = url;
    await decoded.decode().catch(() => { throw new Error('This image could not be opened.'); });
    if (decoded.width * decoded.height > 20_000_000 || Math.max(decoded.width, decoded.height) > 12_000) throw new Error('Choose an image up to 20 megapixels.');
    image = decoded;
    base64 = url.split(',')[1];
    redactions = [...masks];
    removed = false;
    const factor = Math.min(1, 900 / Math.max(decoded.width, decoded.height));
    canvas.width = Math.max(1, Math.round(decoded.width * factor));
    canvas.height = Math.max(1, Math.round(decoded.height * factor));
    painting();
    refreshButtons();
    alert.textContent = '';
    if (edit) { originalPending = false; change(); }
  }
  async function choose(file?: File) {
    if (!file || !uploads || pending) return;
    pending = true;
    try { await loadImage(await fileData(file)); }
    catch (error) { showError(status, error); }
    finally { pending = false; input.value = ''; }
  }
  input.onchange = () => { void choose(input.files?.[0]); };
  drop.ondragover = event => { event.preventDefault(); if (uploads) drop.classList.add('is-dragging'); };
  drop.ondragleave = () => drop.classList.remove('is-dragging');
  drop.ondrop = event => {
    event.preventDefault();
    drop.classList.remove('is-dragging');
    void choose(event.dataTransfer?.files[0]);
  };
  async function download(id: string, mime: string) {
    if (!record) return;
    try {
      const { data } = await request(imageUrl(record, 'original', id));
      const bytes = Uint8Array.from(atob(String(data)), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type:mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `review-original.${mime.split('/')[1]}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showError(alert, error); }
  }
  root.querySelectorAll<HTMLButtonElement>('[data-archived-original]').forEach(button => {
    button.onclick = () => {
      const file = record?.originals?.find(photo => photo.id === button.dataset.archivedOriginal);
      if (file) void download(file.id, file.mime);
    };
  });
  if (record?.photo) {
    root.querySelector<HTMLButtonElement>('[data-download-original]')!.onclick = () => void download(record.photo!.id, record.photo!.mime);
    void Promise.all([request(imageUrl(record, 'thumb')), request(imageUrl(record, 'full'))]).then(([thumb,full]) => {
      images = { thumb:'data:image/webp;base64,' + thumb.data, full:'data:image/webp;base64,' + full.data };
      stored.alt = record.alt;
      stored.src = images.thumb;
      refreshButtons();
      change(false);
    }).catch(error => showError(alert, error));
    original.onclick = async () => {
      if (pending) return;
      pending = originalPending = true;
      original.disabled = true;
      try {
        const fetched = await request(imageUrl(record, 'original'));
        await loadImage(`data:${record.photo!.mime};base64,${fetched.data}`, record.photo!.redactions, false);
      } catch (error) { showError(alert, error); }
      finally { pending = false; original.disabled = false; }
    };
  }

  remove.onclick = () => {
    removed = true;
    image = base64 = undefined;
    originalPending = mode = false;
    redactions = [];
    refreshButtons();
    change();
  };
  redact.onclick = () => { mode = !mode; refreshButtons(); };
  undo.onclick = () => {
    redactions.pop(); originalPending = false;
    painting(); refreshButtons(); change();
  };
  const point = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    return { x:clamp((event.clientX - rect.left) / rect.width), y:clamp((event.clientY - rect.top) / rect.height) };
  };
  const rectangle = (event: PointerEvent): Redaction => {
    const end = point(event);
    return { x:Math.min(start!.x,end.x), y:Math.min(start!.y,end.y), width:Math.abs(start!.x-end.x), height:Math.abs(start!.y-end.y) };
  };
  canvas.onpointerdown = event => {
    if (!mode || redactions.length >= 20 || !event.isPrimary || event.button !== 0) return;
    start = point(event); canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => { if (start && event.isPrimary) painting(rectangle(event)); };
  canvas.onpointerup = event => {
    if (!start || !event.isPrimary) return;
    const rect = rectangle(event);
    start = undefined;
    const applied = rect.width > .003 && rect.height > .003;
    if (applied) { redactions.push(rect); originalPending = false; }
    painting(); refreshButtons();
    if (applied) change();
  };
  canvas.onpointercancel = () => { start = undefined; painting(); };

  return {
    loading: () => pending,
    hasPhoto: () => !!image || (!!record?.photo && !removed),
    attachment: () => base64 && !originalPending ? { data:base64, redactions } : undefined,
    removed: () => removed,
    images: () => {
      if (removed) return undefined;
      if (!image) return images;
      const preview = canvas.toDataURL('image/webp', .86);
      return { thumb:preview, full:preview };
    },
  };
}
