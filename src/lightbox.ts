import './lightbox.css';

const photoNames = new Set(['bedroom', 'room-entry', 'room-greenery', 'bedroom-wide', 'kitchen', 'workspace', 'dining', 'bathroom', 'exterior', 'pickup', 'pickup-detail']);

type Photo = { link: HTMLAnchorElement; source: string; caption: string };

/** Enhance the real property photos while retaining a direct full-image link. */
export function startPhotoViewer(): void {
  if (document.querySelector('.photo-viewer')) return;
  const photos: Photo[] = [];
  document.querySelectorAll<HTMLImageElement>('main img').forEach(image => {
    const name = image.getAttribute('src')?.match(/^\/images\/([\w-]+)\.webp$/)?.[1];
    if (!name || !photoNames.has(name) || image.closest('a')) return;
    const parent = image.parentElement!;
    const position = getComputedStyle(image).objectPosition;
    const link = document.createElement('a');
    link.href = `/images/full/${name}.webp`;
    link.className = 'photo-link';
    link.setAttribute('aria-label', `View full photo: ${image.alt}`);
    link.setAttribute('aria-haspopup', 'dialog');
    if (parent.matches('.hero-art, .room-photo, .pickup-photo, .booking-room-photo')) {
      parent.classList.add('photo-frame');
      link.style.setProperty('--photo-position', position);
    }
    image.replaceWith(link);
    link.append(image);
    const hint = document.createElement('span');
    hint.className = 'photo-link-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg><span>View full photo</span>';
    link.append(hint);
    photos.push({ link, source: link.href, caption: image.alt });
  });
  document.querySelectorAll<HTMLAnchorElement>('main a[data-photo-viewer]').forEach(link => {
    const image = link.querySelector<HTMLImageElement>('img');
    if (!image) return;
    link.setAttribute('aria-haspopup', 'dialog');
    link.setAttribute('aria-label', `View full photo: ${image.alt}`);
    photos.push({ link, source: link.href, caption: link.dataset.caption || image.alt });
  });
  if (!photos.length) return;
  const triggers = [...photos];
  const unique = photos.filter((photo, index) => photos.findIndex(other => other.source === photo.source) === index);
  photos.splice(0, photos.length, ...unique);

  const dialog = document.createElement('dialog');
  dialog.className = 'photo-viewer';
  dialog.setAttribute('aria-labelledby', 'photo-viewer-title');
  dialog.innerHTML = `<div class="photo-viewer-panel">
    <div class="photo-viewer-toolbar"><div><p id="photo-viewer-title">A closer look at Mooncrab</p><span class="photo-viewer-count" aria-live="polite"></span></div><button class="photo-viewer-close" type="button" aria-label="Close photo viewer" autofocus><span aria-hidden="true">×</span></button></div>
    <div class="photo-viewer-stage"><button class="photo-viewer-previous" type="button" aria-label="Previous photo"><span aria-hidden="true">←</span></button><div class="photo-viewer-image-area"><img class="photo-viewer-image" alt="" decoding="async"><p class="photo-viewer-status" role="status"></p></div><button class="photo-viewer-next" type="button" aria-label="Next photo"><span aria-hidden="true">→</span></button></div>
    <div class="photo-viewer-bottom"><p class="photo-viewer-caption"></p><a class="photo-viewer-original" target="_blank" rel="noopener noreferrer">Open full-resolution image <span aria-hidden="true">↗</span></a></div>
  </div>`;
  document.body.append(dialog);
  const image = dialog.querySelector<HTMLImageElement>('.photo-viewer-image')!;
  const count = dialog.querySelector<HTMLElement>('.photo-viewer-count')!;
  const caption = dialog.querySelector<HTMLElement>('.photo-viewer-caption')!;
  const original = dialog.querySelector<HTMLAnchorElement>('.photo-viewer-original')!;
  const status = dialog.querySelector<HTMLElement>('.photo-viewer-status')!;
  let current = 0;
  let opener: HTMLAnchorElement | null = null;

  function show(index: number): void {
    current = (index + photos.length) % photos.length;
    const photo = photos[current];
    count.textContent = `${current + 1} / ${photos.length}`;
    caption.textContent = photo.caption;
    original.href = photo.source;
    status.textContent = 'Loading full photo…';
    image.alt = photo.caption;
    image.src = photo.source;
    if (image.complete && image.naturalWidth) status.textContent = '';
  }

  image.addEventListener('load', () => { status.textContent = ''; });
  image.addEventListener('error', () => { status.textContent = 'This photo could not load. You can try opening the full image below.'; });
  triggers.forEach(photo => {
    const index = photos.findIndex(other => other.source === photo.source);
    photo.link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      opener = photo.link;
      show(index);
      dialog.showModal();
      document.documentElement.classList.add('photo-viewer-open');
    });
  });
  function restorePage(): void {
    document.documentElement.classList.remove('photo-viewer-open');
    opener?.focus({ preventScroll: true });
  }
  function closeViewer(): void { dialog.close(); restorePage(); }
  dialog.querySelector('.photo-viewer-close')!.addEventListener('click', closeViewer);
  dialog.querySelector('.photo-viewer-previous')!.addEventListener('click', () => show(current - 1));
  dialog.querySelector('.photo-viewer-next')!.addEventListener('click', () => show(current + 1));
  dialog.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
  });
  // A click outside the panel is a click on the native dialog backdrop.
  dialog.addEventListener('click', event => { if (event.target === dialog) closeViewer(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
  dialog.addEventListener('close', restorePage);
}
