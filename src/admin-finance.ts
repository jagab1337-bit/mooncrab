import { escape, localDate, money, showError, workspaceUrl, type AdminFetch, type RecordIdentity } from './admin-workspace.ts';

type Kind = 'in' | 'out';
type Party = { name: string; cents: number };
type Transaction = RecordIdentity & { kind: Kind; name: string; category: string; cents: number; date: string; notes: string; parties: Party[] };
const endpoint = workspaceUrl('finance');
const categories: Record<Kind, string[]> = {
  in: ['Daily accommodation', 'Weekly accommodation', 'Monthly accommodation', 'Booking payment', 'Advance payment', 'Security deposit', 'Other income', 'Refund received'],
  out: ['Transportation', 'Rent & deposit', 'Furniture & decor', 'Utilities', 'Repairs & maintenance', 'Supplies', 'Property & garden', 'Other expense'],
};
const sum = (rows: Transaction[]) => rows.reduce((total, row) => total + row.cents, 0);
function parseCents(value: string): number {
  const parts = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return parts ? Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0')) : 0;
}

export async function renderFinance(container: HTMLElement, request: AdminFetch): Promise<void> {
  let records: Transaction[] = [];
  let kind: Kind = 'out';
  const today = localDate();
  container.innerHTML = `<h2>Finance Tracker</h2>
    <div class="workspace-grid" data-summary></div>
    <div class="workspace-actions"><button type="button" data-kind="in">Accounts Receivable · Money In</button><button type="button" data-kind="out">Accounts Payable · Money Out</button></div>
    <div class="workspace-form">
      <label>Month<input type="month" value="${today.slice(0, 7)}"></label>
      <label>Search<input type="search" placeholder="Search transactions"></label>
      <label>Category<select data-filter><option value="">All categories</option></select></label>
      <label>Paid by / received from<select data-party><option value="">All names</option></select></label>
      <label>Sort<select data-sort><option value="date">Date · newest first</option><option value="amount">Amount · highest first</option></select></label>
    </div>
    <div class="workspace-actions"><button type="button" data-add>Add transaction</button><button type="button" data-export>Export shown rows as CSV</button><button type="button" data-refresh>Refresh</button></div>
    <p data-status role="status" class="workspace-status">Loading transactions…</p>
    <div data-edit></div><div class="workspace-table-wrap" data-table></div><p data-payers class="owner-hint"></p>`;
  const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const month = find<HTMLInputElement>('[type=month]');
  const search = find<HTMLInputElement>('[type=search]');
  const filter = find<HTMLSelectElement>('[data-filter]');
  const partyFilter = find<HTMLSelectElement>('[data-party]');
  const sort = find<HTMLSelectElement>('[data-sort]');
  const status = find<HTMLElement>('[data-status]');
  const edit = find<HTMLElement>('[data-edit]');
  let shown: Transaction[] = [];
  let saving = false;
  let dirty = false;
  const locked = () => saving || (dirty && !window.confirm('Discard your unsaved transaction edits?'));
  function draw(): void {
    const monthly = records.filter(row => row.date.startsWith(month.value + '-'));
    const incoming = sum(monthly.filter(row => row.kind === 'in'));
    const outgoing = sum(monthly.filter(row => row.kind === 'out'));
    find('[data-summary]').innerHTML = [
      ['Total money in', incoming], ['Total money out', outgoing], ['Net cash flow', incoming - outgoing],
    ].map(([label, value]) => `<div class="workspace-stat">${label}<strong>${money(Number(value))}</strong></div>`).join('');
    const sheet = monthly.filter(row => row.kind === kind);
    const selected = filter.value;
    const options = [...new Set([...categories[kind], ...records.filter(row => row.kind === kind).map(row => row.category)])].sort();
    filter.innerHTML = '<option value="">All categories</option>' + options.map(value => `<option>${escape(value)}</option>`).join('');
    filter.value = options.includes(selected) ? selected : '';
    const people = [...new Set(sheet.flatMap(row => row.parties.map(party => party.name)))].sort();
    const selectedParty = partyFilter.value;
    partyFilter.replaceChildren(new Option('All names', ''), ...people.map(name => new Option(name)));
    partyFilter.value = people.includes(selectedParty) ? selectedParty : '';
    const query = search.value.trim().toLowerCase();
    shown = sheet.filter(row => (!filter.value || row.category === filter.value)
      && (!partyFilter.value || row.parties.some(party => party.name === partyFilter.value))
      && [row.name, row.category, row.notes, ...row.parties.map(party => party.name)].some(text => text.toLowerCase().includes(query)));
    shown.sort((a,b) => sort.value === 'amount' ? b.cents - a.cents : b.date.localeCompare(a.date));
    container.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kind === kind)));
    find('[data-table]').innerHTML = shown.length ? `<table class="workspace-table"><thead><tr><th>Transaction</th><th>Category</th><th>Amount</th><th>${kind === 'out' ? 'Paid by' : 'Received from'}</th><th>Date</th><th>Notes</th><th>Actions</th></tr></thead><tbody>
      ${shown.map(row => `<tr><td>${escape(row.name)}</td><td>${escape(row.category)}</td><td>${money(row.cents)}</td><td>${row.parties.map(party => `${escape(party.name)} · ${money(party.cents)}`).join('<br>')}</td><td>${escape(row.date)}</td><td>${escape(row.notes)}</td><td><button data-edit-id="${row.id}">Edit</button> <button data-delete-id="${row.id}">Delete</button></td></tr>`).join('')}
      </tbody></table>` : '<p>No transactions match this view.</p>';
    const contributions = new Map<string, number>();
    for (const row of sheet) for (const party of row.parties) contributions.set(party.name, (contributions.get(party.name) ?? 0) + party.cents);
    find('[data-payers]').textContent = `Sheet total ${money(sum(sheet))}${[...contributions].map(([name, cents]) => ` · ${name} ${money(cents)}`).join('')}`;
  }
  async function refresh(): Promise<void> {
    try { records = (await request(endpoint)).records as Transaction[]; draw(); status.textContent = 'Transactions loaded.'; }
    catch (error) { showError(status, error); }
  }
  function openEditor(row?: Transaction): void {
    if (locked()) return;
    dirty = false;
    edit.innerHTML = `<form class="workspace-form workspace-entry">
      <label>Transaction<input name="name" maxlength="120" required value="${escape(row?.name)}"></label>
      <label>Category<input name="category" list="finance-categories" required maxlength="80" value="${escape(row?.category)}"></label>
      <datalist id="finance-categories">${[...new Set([...categories[kind], ...records.map(record => record.category)])].map(value => `<option value="${escape(value)}"></option>`).join('')}</datalist>
      <label>Amount (PHP)<input name="amount" required type="number" step="0.01" min="0.01" value="${row ? (row.cents / 100).toFixed(2) : ''}"></label>
      <label>Date<input name="date" type="date" required value="${row?.date ?? (month.value === today.slice(0,7) ? today : month.value + '-01')}"></label>
      <label class="workspace-full">${kind === 'out' ? 'Paid by' : 'Received from'}<textarea name="parties" required rows="2" placeholder="One name, or one Name: amount entry per line">${escape(row?.parties.map(party => row.parties.length > 1 ? `${party.name}: ${(party.cents / 100).toFixed(2)}` : party.name).join('\n'))}</textarea></label>
      <label class="workspace-full">Notes<textarea name="notes" maxlength="1000" rows="2">${escape(row?.notes)}</textarea></label>
      <div class="workspace-actions workspace-full"><button class="owner-primary" type="submit">Save transaction</button><button type="button" data-cancel>Cancel</button></div>
    </form>`;
    const form = edit.querySelector('form')!;
    form.addEventListener('input', () => { dirty = true; });
    form.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = () => { if (!locked()) { edit.replaceChildren(); dirty = false; } };
    form.onsubmit = async event => {
      event.preventDefault();
      if (saving) return;
      const data = new FormData(form);
      const value = (key: string) => String(data.get(key) ?? '').trim();
      const cents = parseCents(value('amount'));
      const parties = value('parties').split(/\r?\n/).map(line => {
        const split = line.lastIndexOf(':');
        return split < 0 ? { name: line.trim(), cents } : { name: line.slice(0, split).trim(), cents: parseCents(line.slice(split + 1)) };
      });
      if (!cents || parties.some(party => !party.name || !party.cents) || parties.reduce((total, party) => total + party.cents, 0) !== cents) {
        status.textContent = 'Payer contributions must add up to the transaction amount.';
        return;
      }
      saving = true;
      form.querySelectorAll('input, textarea, button').forEach(el => { (el as HTMLInputElement).disabled = true; });
      try {
        const result = await request(endpoint, 'POST', { action: 'save', id: row?.id, revision: row?.revision, record: { kind, name: value('name'), category: value('category'), cents, date: value('date'), notes: value('notes'), parties } });
        records = result.records as Transaction[];
        month.value = value('date').slice(0, 7);
        edit.replaceChildren();
        dirty = false;
        draw();
        status.textContent = 'Transaction saved.';
      } catch (error) { showError(status, error); }
      finally {
        saving = false;
        form.querySelectorAll('input, textarea, button').forEach(el => { (el as HTMLInputElement).disabled = false; });
      }
    };
    form.addEventListener('focusout', event => {
      if (!row || !dirty || saving || !(event.relatedTarget instanceof HTMLElement)
        || form.contains(event.relatedTarget) || event.relatedTarget.closest('.workspace-nav')) return;
      if (form.checkValidity()) form.requestSubmit();
    });
    form.querySelector('input')!.focus();
  }
  find('[data-add]').onclick = () => openEditor();
  find('[data-refresh]').onclick = () => { if (!saving) void refresh(); };
  for (const field of [month, search, filter, partyFilter, sort]) field.addEventListener('input', draw);
  container.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.dataset.kind && !locked()) { kind = button.dataset.kind as Kind; edit.replaceChildren(); dirty = false; draw(); }
    const row = records.find(item => item.id === (button?.dataset.editId ?? button?.dataset.deleteId));
    if (!row) return;
    if (button?.dataset.editId) openEditor(row);
    else if (button && !saving && window.confirm(`Delete “${row.name}”?`)) {
      saving = true;
      try {
        records = (await request(endpoint, 'POST', { action: 'delete', id: row.id, revision: row.revision })).records as Transaction[];
        draw();
        status.textContent = 'Transaction deleted.';
      } catch (error) { showError(status, error); } finally { saving = false; }
    }
  });
  find('[data-export]').onclick = () => {
    const quote = (value: string) => '"' + (/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
    const csv = [['Transaction','Category','Amount (PHP)','Paid by / received from','Date','Notes'], ...shown.map(row => [
      row.name, row.category, (row.cents / 100).toFixed(2), row.parties.map(party => `${party.name}: ${(party.cents / 100).toFixed(2)}`).join('; '), row.date, row.notes,
    ])].map(line => line.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `mooncrab-${kind}-${month.value}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener('beforeunload', event => {
    if (container.isConnected && (dirty || saving)) { event.preventDefault(); event.returnValue = ''; }
  });
  await refresh();
}
