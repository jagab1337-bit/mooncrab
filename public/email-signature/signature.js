const status = document.querySelector('#copy-status');
async function loadTable(file) {
  const response = await fetch(`./${file}`);
  if (!response.ok) throw new Error('Signature unavailable');
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const table = doc.querySelector('table');
  if (!table) throw new Error('Signature unavailable');
  return table;
}
for (const preview of document.querySelectorAll('[data-file]')) {
  loadTable(preview.dataset.file).then(table => preview.replaceChildren(table)).catch(() => { preview.textContent = 'Open the standalone signature below to preview it.'; });
}
for (const button of document.querySelectorAll('[data-copy]')) button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const table = await loadTable(button.dataset.copy);
    const text = await (await fetch('./mooncrab-email-signature.txt')).text();
    await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([table.outerHTML],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]);
    status.textContent = 'Copied. Paste into your email signature editor with the original formatting.';
  } catch { status.textContent = 'Open the standalone signature, select the visible design, and copy it. Then paste into your email signature editor.'; }
  finally { button.disabled = false; }
});
