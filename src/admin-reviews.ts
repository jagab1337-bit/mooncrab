import { REVIEW_SOURCES, REVIEW_STATUSES, type PublicReview, type ReviewRecord, type ReviewSource, type ReviewStatus } from '../shared/reviews.ts';
import { escape, protectDraft, showError, workspaceUrl, type AdminFetch } from './admin-workspace.ts';
import { reviewCard } from './guest-reviews.ts';
import { reviewLabel, reviewLabelMarkup as label, translateReviewLabels } from './review-labels.ts';
import { mountReviewUpload } from './review-upload.ts';
import { startPhotoViewer } from './lightbox.ts';

const endpoint = workspaceUrl('reviews');
const options = (values: readonly string[]) => values.map(value => `<option>${value}</option>`).join('');
const statuses = () => REVIEW_STATUSES.map(value => `<option value="${value}" data-review-label="${value}">${reviewLabel(value)}</option>`).join('');

export async function renderAdminReviews(container: HTMLElement, request: AdminFetch) {
  container.innerHTML = `<div class="workspace-heading"><h2>${label('admin')}</h2><a href="/#reviews" target="_blank" rel="noopener noreferrer">View homepage reviews ↗</a></div>
    <div class="workspace-actions"><button type="button" class="owner-primary" data-add disabled>${label('add')}</button></div>
    <p class="workspace-status" data-list-status role="status">${label('loading')}</p>
    <div data-editor></div>
    <div class="workspace-form review-filters">
      <label>${label('search')}<input type="search" name="search"></label>
      <label>${label('status')}<select name="status"><option value="" data-review-label="all">${reviewLabel('all')}</option>${statuses()}</select></label>
      <label>${label('source')}<select name="source"><option value="" data-review-label="all">${reviewLabel('all')}</option>${options(REVIEW_SOURCES)}</select></label>
    </div>
    <div class="review-admin-list" data-list></div>`;
  const list = container.querySelector<HTMLElement>('[data-list]')!;
  const status = container.querySelector<HTMLElement>('[data-list-status]')!;
  const editor = container.querySelector<HTMLElement>('[data-editor]')!;
  const add = container.querySelector<HTMLButtonElement>('[data-add]')!;
  const search = container.querySelector<HTMLInputElement>('input[type=search]')!;
  const filter = container.querySelector<HTMLSelectElement>('select[name=status]')!;
  const sourceFilter = container.querySelector<HTMLSelectElement>('select[name=source]')!;
  let records: ReviewRecord[] = [];
  let uploads = false;
  let dirty = false;
  let busy = false;
  let opened: HTMLButtonElement | undefined;
  const languageChanged = () => translateReviewLabels(container);
  // The workspace can replace this route without reloading the outer document.
  const labels = new AbortController();
  const detach = new MutationObserver(() => {
    if (!container.isConnected) { labels.abort(); detach.disconnect(); }
  });
  detach.observe(container.parentNode!, { childList:true });
  document.addEventListener('mooncrab-language-change', languageChanged, { signal: labels.signal });
  protectDraft(container, () => dirty || busy);

  function setBusy(value: boolean) { busy = value; add.disabled = value; }
  function update(data: Record<string, unknown>) {
    records = data.reviews as ReviewRecord[];
    uploads = data.imageUploads === true;
    drawList();
  }
  function drawList() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = records.filter(review => (!filter.value || review.status === filter.value)
      && (!sourceFilter.value || review.source === sourceFilter.value)
      && [review.name,review.text,review.source,review.sourceName ?? '',review.notes,review.alt].some(field => field.toLocaleLowerCase().includes(query)));
    list.innerHTML = visible.length ? visible.map(review => {
      const group = records.filter(item => item.status !== 'Archived' && item.featured === review.featured);
      const position = group.findIndex(item => item.id === review.id);
      const button = (action: string, caption: Parameters<typeof label>[0], disabled = false) =>
        `<button type="button" data-action="${action}" ${disabled ? 'disabled' : ''}>${label(caption)}</button>`;
      return `<article class="workspace-entry review-admin-row" data-id="${review.id}">
        <div><h3 dir="auto">${escape(review.name || review.alt || review.text.trim().slice(0, 50))}</h3>
        <p class="owner-hint">${escape(review.sourceName ?? review.source)}${review.date ? ` · <time datetime="${escape(review.date)}">${escape(review.date)}</time>` : ''}${review.rating === null ? '' : ` · ${review.rating}/${review.scale}`}</p>
        ${review.text ? `<p class="review-admin-excerpt" dir="auto">${escape(review.text)}</p>` : ''}</div>
        <div><p class="review-admin-status">${label(review.status)}${review.featured ? ` · ${label('featured')}` : ''}</p>
        <div class="workspace-actions">${button('edit','edit')}${review.status === 'Archived'
          ? button('restore','restore') : `${review.status === 'Published' ? button('hide','hide') : button('publish','publish')}
          ${button('archive','archive')}${button('up','up',position <= 0)}${button('down','down',position >= group.length - 1)}`}</div></div>
      </article>`;
    }).join('') : `<p>${label('noResults')}</p>`;
  }
  const clearEditor = () => {
    editor.replaceChildren(); dirty = false;
    if (opened?.isConnected) opened.focus();
    else add.focus();
  };

  function openEditor(previous?: ReviewRecord, publishing = false) {
    if (busy || (dirty && !confirm('Discard unsaved changes?'))) return;
    dirty = false;
    const id = previous?.id ?? crypto.randomUUID();
    editor.innerHTML = `<form class="workspace-entry review-editor">
      <div class="workspace-heading"><h3>${label(previous ? 'edit' : 'add')}</h3><button type="button" data-close>${label('close')}</button></div>
      <div class="workspace-form">
        <label>${label('name')}<input name="name" maxlength="100"></label>
        <label>${label('source')}<select name="source">${options(REVIEW_SOURCES)}</select></label>
        <label data-source-name hidden>${label('sourceName')}<input name="sourceName" maxlength="80"></label>
        <label>${label('date')}<input type="date" name="date"></label>
        <label>${label('rating')}<input type="number" name="rating" step="any" min="0.01" max="10"></label>
        <label>${label('scale')}<select name="scale"><option value="5">/5</option><option value="10">/10</option></select></label>
        <label class="workspace-full">${label('text')}<textarea name="text" maxlength="4000" rows="5"></textarea></label>
        <label class="workspace-full">${label('sourceLink')}<input type="url" name="url" maxlength="400" placeholder="https://"></label>
        <label class="workspace-full">${label('notes')}<textarea name="notes" maxlength="1500" rows="2"></textarea></label>
        <label class="workspace-full"><span><input type="checkbox" name="featured"> ${label('featured')}</span></label>
      </div>
      <div data-upload></div>
      <div class="workspace-form" data-photo-options hidden>
        <label class="workspace-full">${label('alt')}<input name="alt" maxlength="180"></label>
        <label>${label('cropX')}<input type="range" name="cropX" min="0" max="100" value="50"></label>
        <label>${label('cropY')}<input type="range" name="cropY" min="0" max="100" value="50"></label>
      </div>
      <div class="workspace-actions"><button type="button" data-preview>${label('preview')}</button></div>
      <div data-review-results class="review-admin-preview" hidden></div>
      <label class="owner-request-agreement"><input type="checkbox" name="approved"> ${label('approved')}</label>
      <div class="workspace-actions">
        ${previous?.status === 'Published' ? '' : `<button type="submit" value="save">${label(previous ? 'save' : 'draft')}</button>`}
        ${previous?.status === 'Archived' ? '' : `<button type="submit" class="owner-primary" value="publish">${label(previous?.status === 'Published' ? 'save' : 'publish')}</button>`}
      </div>
      <p class="workspace-status" role="status" data-save-status></p>
    </form>`;
    const form = editor.querySelector('form')!;
    const feedback = form.querySelector<HTMLElement>('[data-save-status]')!;
    const photoOptions = form.querySelector<HTMLElement>('[data-photo-options]')!;
    const preview = form.querySelector<HTMLElement>('[data-review-results]')!;
    const approved = form.querySelector<HTMLInputElement>('[name=approved]')!;
    const pick = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (previous) {
      for (const name of ['name','source','sourceName','date','rating','scale','text','url','notes','alt','cropX','cropY'] as const)
        pick(name).value = String(previous[name] ?? '');
      (pick('featured') as HTMLInputElement).checked = previous.featured;
    } else pick('source').value = 'Direct';
    const refreshSource = () => { form.querySelector<HTMLElement>('[data-source-name]')!.hidden = pick('source').value !== 'Other'; };
    (pick('source') as HTMLSelectElement).onchange = refreshSource;
    refreshSource();
    const upload = mountReviewUpload(form.querySelector<HTMLElement>('[data-upload]')!, request, previous, uploads, feedback, (modified = true) => {
      if (modified) { dirty = true; approved.checked = false; }
      refreshPhoto();
      if (!preview.hidden) drawPreview();
    });
    function refreshPhoto() { photoOptions.hidden = !upload.hasPhoto(); }
    refreshPhoto();
    const read = () => ({
      id, source:pick('source').value as ReviewSource, sourceName:pick('source').value === 'Other' ? pick('sourceName').value.trim() : '',
      name:pick('name').value.trim(), text:pick('text').value.trim(),
      date:pick('date').value, rating:pick('rating').value ? Number(pick('rating').value) : null, scale:Number(pick('scale').value) as 5 | 10,
      url:pick('url').value.trim(), featured:(pick('featured') as HTMLInputElement).checked, notes:pick('notes').value.trim(),
      alt:pick('alt').value.trim(), cropX:Number(pick('cropX').value), cropY:Number(pick('cropY').value),
    });
    const drawPreview = () => {
      const review: PublicReview = read();
      // Match server URL checks at the preview boundary so draft links cannot execute code.
      if (!/^https:\/\//i.test(review.url)) review.url = '';
      try {
        preview.innerHTML = reviewCard(review, upload.images());
        preview.hidden = false;
        startPhotoViewer();
      } catch { feedback.textContent = 'Check the review date before previewing.'; }
    };
    form.addEventListener('input', event => {
      const field = event.target as HTMLInputElement;
      dirty = true;
      if (['name','text','alt','source','sourceName','url'].includes(field.name)) approved.checked = false;
      if (!preview.hidden) drawPreview();
    });
    form.querySelector<HTMLButtonElement>('[data-preview]')!.onclick = drawPreview;
    form.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => {
      if (!busy && (!dirty || confirm('Discard unsaved changes?'))) clearEditor();
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || upload.loading()) return;
      const publishing = (event.submitter as HTMLButtonElement | null)?.value === 'publish';
      const nextStatus = publishing ? 'Published' : previous?.status ?? 'Draft';
      const record = read();
      if (!record.text && !upload.hasPhoto()) { feedback.textContent = 'Add review text or a photo.'; return; }
      if (upload.hasPhoto() && !record.alt) { feedback.textContent = 'Add a description of the image.'; pick('alt').focus(); return; }
      if (publishing && !approved.checked) { feedback.textContent = 'Confirm permission and privacy before publishing.'; approved.focus(); return; }
      const payload = { action:previous ? 'save' : 'create', id, revision:previous?.revision,
        status:nextStatus, approved:approved.checked, record, image:upload.attachment(), removeImage:upload.removed() };
      setBusy(true);
      form.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach(button => { button.disabled = true; });
      try {
        update(await request(endpoint, 'POST', payload));
        clearEditor();
        status.textContent = publishing ? 'Review published. It now appears on the homepage.' : 'Review saved.';
      } catch (error) { showError(feedback, error); }
      finally {
        setBusy(false);
        form.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach(button => { button.disabled = false; });
      }
    };
    pick('name').focus();
    if (publishing) drawPreview();
  }

  search.oninput = drawList;
  filter.onchange = sourceFilter.onchange = drawList;
  add.onclick = () => { opened = add; openEditor(); };
  list.onclick = async event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const record = records.find(review => review.id === button?.closest<HTMLElement>('[data-id]')?.dataset.id);
    if (!button || !record || busy) return;
    const action = button.dataset.action;
    if (action === 'edit' || action === 'publish') { opened = button; openEditor(record, action === 'publish'); return; }
    if (dirty) { status.textContent = 'Save or close the review you are editing first.'; return; }
    if (editor.firstChild) clearEditor();
    const identity = { id:record.id, revision:record.revision };
    const target: ReviewStatus = action === 'archive' ? 'Archived' : action === 'hide' ? 'Hidden' : 'Draft';
    const body = action === 'up' || action === 'down'
      ? { ...identity, action:'move', direction:action === 'up' ? -1 : 1 }
      : { ...identity, action:'status', status:target };
    setBusy(true);
    button.disabled = true;
    try {
      update(await request(endpoint, 'POST', body));
      status.textContent = body.action === 'move' ? 'Review order saved.' : `Review ${target.toLowerCase()}.`;
      const row = list.querySelector<HTMLElement>(`[data-id="${record.id}"]`);
      (row?.querySelector<HTMLButtonElement>(`[data-action="${action}"]:enabled`)
        ?? row?.querySelector<HTMLButtonElement>('[data-action="edit"]') ?? add).focus();
    } catch (error) { showError(status, error); }
    finally { button.disabled = false; setBusy(false); }
  };
  try { update(await request(endpoint)); status.textContent = ''; add.disabled = false; }
  catch (error) { showError(status, error); }
}
