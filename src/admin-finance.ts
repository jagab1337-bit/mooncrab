import './admin-finance.css';
import { createPeopleDialog, type FinancePerson } from './admin-finance-people.ts';
import { escape, localDate, money, protectDraft, showError, workspaceUrl, type AdminFetch, type RecordIdentity } from './admin-workspace.ts';

type Kind = 'in' | 'out';
type Party = { personId: string; name: string; cents: number };
type Transaction = RecordIdentity & { kind: Kind; name: string; category: string; cents: number; date: string; notes: string; parties: Party[] };
const endpoint = workspaceUrl('finance');
const categories: Record<Kind, string[]> = {
  in: ['Daily accommodation', 'Weekly accommodation', 'Monthly accommodation', 'Booking payment', 'Advance payment', 'Security deposit', 'Other income', 'Refund received'],
  out: ['Transportation', 'Rent & deposit', 'Furniture & decor', 'Utilities', 'Repairs & maintenance', 'Supplies', 'Property & garden', 'Other expense'],
};
const customCategoryOption = ' '; // Stored categories are trimmed and nonempty.
const formatMonth = new Intl.DateTimeFormat('en-PH', { month:'long', year:'numeric', timeZone:'UTC' });
const monthNames = Array.from({ length:12 }, (_, index) =>
  new Intl.DateTimeFormat('en-PH', { month:'long', timeZone:'UTC' }).format(new Date(Date.UTC(2026, index, 1))));
const monthPattern = /^(?:19\d{2}|2\d{3})-(?:0[1-9]|1[0-2])$/;
const sum = (rows: Transaction[]) => rows.reduce((total, row) => total + row.cents, 0);

function parseCents(value: string): number {
  const parts = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return parts ? Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0')) : 0;
}

function downloadCsv(rows: Transaction[], kind: Kind, month: string): void {
  const quote = (value: string) => '"' + (/^\s*[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
  const lines = [
    ['Transaction', 'Category', 'Amount (PHP)', kind === 'in' ? 'Received from' : 'Paid by', 'Date', 'Notes'],
    ...rows.map(row => [
      row.name, row.category, (row.cents / 100).toFixed(2),
      row.parties.map(party => `${party.name}: ${(party.cents / 100).toFixed(2)}`).join('; '), row.date, row.notes,
    ]),
  ];
  const url = URL.createObjectURL(new Blob(['\uFEFF', lines.map(line => line.map(quote).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `mooncrab-${kind === 'in' ? 'receivable' : 'payable'}-${month}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function renderFinance(container: HTMLElement, request: AdminFetch): Promise<void> {
  const today = localDate();
  const initial = new URLSearchParams(location.search).get('month') ?? '';
  let month = monthPattern.test(initial) ? initial : today.slice(0, 7);
  let records: Transaction[] = [];
  let directory: FinancePerson[] = [];
  let people = new Map<string, FinancePerson>();
  const partyName = (party: Party) => people.get(party.personId)?.name ?? party.name;
  let saving = false;
  let loaded = false;

  container.innerHTML = `<div class="finance-heading"><h2>Finance Tracker</h2>
    <div class="workspace-actions"><button type="button" data-people>Manage People</button><button type="button" class="finance-text-button" data-refresh>Refresh records</button></div></div>
    <div class="workspace-grid finance-summary" data-summary aria-label="Monthly cash flow"></div>
    <div class="finance-month-navigation" aria-label="Finance month">
      <button type="button" data-month-step="-1" aria-label="Previous month">‹</button>
      <details data-month-picker>
        <summary data-month-label></summary>
        <form class="workspace-form finance-month-picker">
          <label>Month<select name="month">${monthNames.map((name, index) => `<option value="${String(index + 1).padStart(2, '0')}">${name}</option>`).join('')}</select></label>
          <label>Year<input name="year" type="number" min="1900" max="2999" required></label>
          <div class="workspace-actions workspace-full">
            <button type="button" data-year-step="-1" aria-label="Previous year">‹ Year</button>
            <button type="button" data-year-step="1" aria-label="Next year">Year ›</button>
            <button type="button" data-current-month>This month</button>
            <button type="submit" class="owner-primary">Show month</button>
          </div>
        </form>
      </details>
      <button type="button" data-month-step="1" aria-label="Next month">›</button>
    </div>
    <p data-load-status class="workspace-status" role="status">Loading transactions…</p>
    <div class="finance-sheets"><section data-sheet="in"></section><section data-sheet="out"></section></div>
    <dialog class="owner-card workspace-panel finance-people-dialog" aria-label="People directory"></dialog>`;
  const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const loadStatus = find<HTMLElement>('[data-load-status]');
  const monthPicker = find<HTMLDetailsElement>('[data-month-picker]');
  const picker = monthPicker.querySelector('form')!;
  const monthSelect = picker.elements.namedItem('month') as HTMLSelectElement;
  const year = picker.elements.namedItem('year') as HTMLInputElement;
  const sheets = (['in', 'out'] as const).map(kind => createSheet(kind));
  function apply(result: Record<string, unknown>): void {
    records = result.records as Transaction[];
    directory = (result.people ?? []) as FinancePerson[];
    people = new Map(directory.map(person => [person.id, person]));
    sheets.forEach(sheet => sheet.updatePeople());
  }
  const showPeople = createPeopleDialog(find('dialog'), () => directory, async (operation, name, person) => {
    if (saving) throw new Error('Wait for the current save to finish.');
    saving = true;
    const before = new Set(people.keys());
    try {
      apply(await request(endpoint, 'POST', { action:'person', id:person?.id, revision:person?.revision, record:{ operation, name } }));
      draw();
      return directory.find(candidate => !before.has(candidate.id) && candidate.name === name.trim().replace(/\s+/g, ' '));
    } finally { saving = false; }
  });
  find('[data-people]').onclick = () => { if (loaded && !saving) showPeople(); };

  function draw(): void {
    const monthly = records.filter(row => row.date.startsWith(month + '-'));
    const incoming = sum(monthly.filter(row => row.kind === 'in'));
    const outgoing = sum(monthly.filter(row => row.kind === 'out'));
    find('[data-summary]').innerHTML = [
      ['Total Money In', incoming], ['Total Money Out', outgoing], ['Net Cash Flow', incoming - outgoing],
    ].map(([label, value]) => `<div class="workspace-stat">${label}<strong>${loaded ? money(Number(value)) : '—'}</strong></div>`).join('');
    find('[data-month-label]').textContent = formatMonth.format(new Date(month + '-01T00:00:00Z'));
    monthSelect.value = month.slice(5);
    year.value = month.slice(0, 4);
    sheets.forEach(sheet => sheet.draw(monthly));
  }

  function setMonth(value: string): void {
    if (value === month) { monthPicker.open = false; return; }
    if (!monthPattern.test(value) || saving || (sheets.some(sheet => sheet.dirty()) && !confirm('Change the month and discard unsaved transaction edits?'))) return;
    sheets.forEach(sheet => sheet.close());
    month = value;
    const url = new URL(location.href);
    url.searchParams.set('month', month);
    history.replaceState(history.state, '', url);
    monthPicker.open = false;
    draw();
  }

  function createSheet(kind: Kind) {
    const panel = find<HTMLElement>(`[data-sheet="${kind}"]`);
    const title = kind === 'in' ? 'Accounts Receivable' : 'Accounts Payable';
    const direction = kind === 'in' ? 'Money In' : 'Money Out';
    const partyLabel = kind === 'in' ? 'Received from' : 'Paid by';
    let shown: Transaction[] = [];
    let dirty = false;
    let updatePeople = () => {};
    panel.className = 'finance-sheet';
    panel.setAttribute('aria-labelledby', 'finance-' + kind + '-title');
    panel.innerHTML = `<header class="finance-sheet-heading">
      <div><p class="finance-direction">${direction}</p><h3 id="finance-${kind}-title">${title}</h3></div>
      <div class="finance-total"><small>Monthly total</small><strong data-sheet-total>—</strong></div>
    </header>
    <div class="workspace-actions"><button type="button" class="owner-primary" data-add>Add Transaction</button><button type="button" data-export>Export CSV</button></div>
    <div class="workspace-form finance-filters">
      <label class="finance-search">Search<input type="search" placeholder="Search transactions"></label>
      <label>Category<select data-category></select></label>
      <label>${partyLabel}<select data-party></select></label>
      <label>Sort<select data-sort><option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option><option value="amount-desc">Highest amount</option><option value="amount-asc">Lowest amount</option></select></label>
    </div>
    <p data-status class="workspace-status" role="status"></p>
    <div data-editor></div><div class="workspace-table-wrap finance-table-wrap" tabindex="0" aria-label="${title} rows" data-table></div>`;
    const get = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
    const status = get<HTMLElement>('[data-status]');
    const editor = get<HTMLElement>('[data-editor]');
    const search = get<HTMLInputElement>('[type=search]');
    const category = get<HTMLSelectElement>('[data-category]');
    const partyFilter = get<HTMLSelectElement>('[data-party]');
    const sort = get<HTMLSelectElement>('[data-sort]');
    const availableCategories = () => [...new Set([...categories[kind], ...records.filter(row => row.kind === kind).map(row => row.category)])].sort();
    function updateOptions(select: HTMLSelectElement, values: string[], placeholder: string): void {
      const selected = select.value;
      select.replaceChildren(new Option(placeholder, ''), ...values.map(value => new Option(value)));
      select.value = values.includes(selected) ? selected : '';
    }

    function drawSheet(monthly: Transaction[]): void {
      const rows = monthly.filter(row => row.kind === kind);
      get('[data-sheet-total]').textContent = loaded ? money(sum(rows)) : '—';
      updateOptions(category, availableCategories(), 'All categories');
      const historical = new Set(rows.flatMap(row => row.parties.map(party => party.personId)));
      const availablePeople = directory.filter(person => !person.archived || historical.has(person.id));
      const selectedParty = partyFilter.value;
      partyFilter.replaceChildren(new Option('All people', ''), ...availablePeople.map(person => new Option(person.name + (person.archived ? ' (archived)' : ''), person.id)));
      partyFilter.value = availablePeople.some(person => person.id === selectedParty) ? selectedParty : '';
      const query = search.value.trim().toLowerCase();
      shown = rows.filter(row => (!category.value || row.category === category.value)
        && (!partyFilter.value || row.parties.some(party => party.personId === partyFilter.value))
        && [row.name, row.category, row.notes, ...row.parties.map(partyName)].some(value => value.toLowerCase().includes(query)));
      shown.sort((a, b) => {
        if (sort.value === 'amount-desc') return b.cents - a.cents;
        if (sort.value === 'amount-asc') return a.cents - b.cents;
        return sort.value === 'date-asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      });
      get<HTMLButtonElement>('[data-export]').disabled = !shown.length;
      get<HTMLButtonElement>('[data-add]').disabled = !loaded;
      const empty = !loaded ? 'Waiting for transactions…' : rows.length ? 'No transactions match these filters.' : `No ${kind === 'in' ? 'money in' : 'money out'} recorded for this month.`;
      get('[data-table]').innerHTML = `<table class="workspace-table finance-table"><thead><tr><th scope="col">Transaction</th><th scope="col">${partyLabel}</th><th scope="col">Date</th><th scope="col" class="finance-amount">Amount</th><th scope="col">Actions</th></tr></thead><tbody>
        ${shown.length ? shown.map(row => `<tr><td><strong>${escape(row.name)}</strong><span class="finance-category">${escape(row.category)}</span>${row.notes ? `<small class="finance-note">${escape(row.notes)}</small>` : ''}</td>
          <td>${row.parties.map(party => `<span class="finance-contributor">${escape(partyName(party))}${row.parties.length > 1 ? ` <small>${money(party.cents)}</small>` : ''}</span>`).join('')}</td>
          <td><time datetime="${row.date}">${new Date(row.date + 'T00:00:00Z').toLocaleDateString('en-PH', { month:'short', day:'numeric', timeZone:'UTC' })}</time></td>
          <td class="finance-amount">${money(row.cents)}</td><td><div class="finance-row-actions"><button type="button" data-edit-id="${row.id}">Edit</button><button type="button" data-delete-id="${row.id}">Delete</button></div></td></tr>`).join('') : `<tr><td colspan="5" class="finance-empty">${empty}</td></tr>`}
      </tbody></table>`;
    }

    function close(): void { editor.replaceChildren(); dirty = false; updatePeople = () => {}; }

    function open(row?: Transaction): void {
      if (saving || (dirty && !confirm('Discard your unsaved transaction edits?'))) return;
      dirty = false;
      editor.innerHTML = `<form class="workspace-form workspace-entry finance-editor">
        <h4 class="workspace-full">${row ? 'Edit transaction' : 'New transaction'}</h4>
        <label>Transaction<input name="name" maxlength="120" required value="${escape(row?.name)}"></label>
        <label>Category<select name="category" required></select></label>
        <label class="workspace-full" hidden>Custom category<input name="customCategory" maxlength="80" required disabled></label>
        <label>Amount (PHP)<input name="amount" required type="number" step="0.01" min="0.01" value="${row ? (row.cents / 100).toFixed(2) : ''}"></label>
        <label>Date<input name="date" type="date" required value="${row?.date ?? (month === today.slice(0, 7) ? today : month + '-01')}"></label>
        <fieldset class="workspace-full finance-people-fieldset">
          <legend>${partyLabel}</legend>
          <label>Search existing names<input type="search" data-name-search placeholder="Filter names"></label>
          <div data-contributors></div>
          <div class="workspace-actions"><button type="button" data-split>Add Contributor</button></div>
          <p class="owner-hint" data-contribution-message></p>
        </fieldset>
        <label class="workspace-full">Notes<textarea name="notes" maxlength="1000" rows="2">${escape(row?.notes)}</textarea></label>
        <div class="workspace-actions workspace-full"><button class="owner-primary" type="submit">Save transaction</button><button type="button" data-cancel>Cancel</button></div>
      </form>`;
      const form = editor.querySelector('form')!;
      const categorySelect = form.querySelector<HTMLSelectElement>('[name=category]')!;
      const customCategory = form.querySelector<HTMLInputElement>('[name=customCategory]')!;
      updateOptions(categorySelect, availableCategories(), 'Choose a category');
      categorySelect.add(new Option('Add custom category…', customCategoryOption));
      categorySelect.value = row?.category ?? '';
      categorySelect.onchange = () => {
        const custom = categorySelect.value === customCategoryOption;
        customCategory.disabled = !custom;
        customCategory.parentElement!.hidden = !custom;
        if (custom) customCategory.focus();
        dirty = true;
      };
      const contributions = row?.parties.map(party => ({ personId:party.personId, amount:(party.cents / 100).toFixed(2) }))
        ?? [{ personId:'', amount:'' }];
      const names = form.querySelector<HTMLInputElement>('[data-name-search]')!;
      const fields = form.querySelector<HTMLElement>('[data-contributors]')!;
      const amount = form.querySelector<HTMLInputElement>('[name=amount]')!;
      const contributionMessage = form.querySelector<HTMLElement>('[data-contribution-message]')!;
      const split = form.querySelector<HTMLButtonElement>('[data-split]')!;
      const updateContributionMessage = () => {
        const total = parseCents(amount.value);
        if (contributions.length === 1) contributionMessage.textContent = 'One contributor receives the full transaction amount.';
        else {
          const allocated = contributions.reduce((result, entry) => result + parseCents(entry.amount), 0);
          contributionMessage.textContent = `Allocated ${money(allocated)} of ${money(total)}.`;
        }
      };
      function refreshChoices(): void {
        const keyword = names.value.trim().toLowerCase();
        fields.querySelectorAll<HTMLSelectElement>('select').forEach((select, index) => {
          const selected = contributions[index].personId;
          const otherIds = new Set(contributions.filter((_, rowIndex) => rowIndex !== index).map(entry => entry.personId));
          const choices = directory.filter(person => person.id === selected
            || (!person.archived && !otherIds.has(person.id) && person.name.toLowerCase().includes(keyword)));
          select.replaceChildren(new Option('Choose a person', ''),
            ...choices.map(person => new Option(person.name + (person.archived ? ' (archived)' : ''), person.id)),
            new Option('Add New Person…', 'new'));
          select.value = selected;
        });
      }
      function drawContributors(): void {
        const multiple = contributions.length > 1;
        fields.innerHTML = contributions.map((entry, index) => `<div class="finance-contribution">
          <label>Person ${index + 1}<select required data-contributor="${index}"></select></label>
          ${multiple ? `<label>Contribution (PHP)<input data-share="${index}" type="number" min="0.01" step="0.01" value="${escape(entry.amount)}" required></label>
          <button type="button" data-remove-contributor="${index}" aria-label="Remove contributor ${index + 1}">Remove</button>` : ''}
        </div>`).join('');
        split.disabled = contributions.length >= 12;
        refreshChoices();
        updateContributionMessage();
      }
      fields.onchange = event => {
        const select = event.target as HTMLSelectElement;
        if (select.dataset.contributor === undefined) return;
        const entry = contributions[Number(select.dataset.contributor)];
        if (select.value === 'new') {
          select.value = entry.personId;
          showPeople(person => { entry.personId = person.id; dirty = true; refreshChoices(); });
        } else {
          entry.personId = select.value;
          refreshChoices();
        }
      };
      fields.oninput = event => {
        const input = event.target as HTMLInputElement;
        if (input.dataset.share !== undefined) {
          contributions[Number(input.dataset.share)].amount = input.value;
          updateContributionMessage();
        }
      };
      fields.onclick = event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-contributor]');
        if (!button) return;
        contributions.splice(Number(button.dataset.removeContributor), 1);
        dirty = true;
        drawContributors();
      };
      split.onclick = () => {
        if (contributions.length === 1) contributions[0].amount = amount.value;
        contributions.push({ personId:'', amount:'' });
        dirty = true;
        drawContributors();
      };
      amount.addEventListener('input', updateContributionMessage);
      names.oninput = refreshChoices;
      updatePeople = refreshChoices;
      drawContributors();
      form.oninput = event => { if (event.target !== names) dirty = true; };
      form.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = () => {
        if (!saving && (!dirty || confirm('Discard your unsaved transaction edits?'))) close();
      };
      form.onsubmit = async event => {
        event.preventDefault();
        if (saving) return;
        const data = new FormData(form);
        const value = (key: string) => String(data.get(key) ?? '').trim();
        const selectedCategory = value(categorySelect.value === customCategoryOption ? 'customCategory' : 'category');
        const cents = parseCents(value('amount'));
        if (!selectedCategory) {
          status.textContent = 'Enter a category.';
          customCategory.focus();
          return;
        }
        const parties = contributions.map(entry => ({
          personId:entry.personId, name:people.get(entry.personId)?.name ?? '',
          cents:contributions.length === 1 ? cents : parseCents(entry.amount),
        }));
        if (parties.some(party => !party.name) || new Set(parties.map(party => party.personId)).size !== parties.length) {
          status.textContent = 'Select a different person for each contribution.';
          return;
        }
        if (!cents || parties.some(party => !party.cents) || parties.reduce((total, party) => total + party.cents, 0) !== cents) {
          status.textContent = 'Contributions must add up to the transaction amount.';
          return;
        }
        saving = true;
        const buttons = [...form.querySelectorAll('button')];
        buttons.forEach(button => { button.disabled = true; });
        try {
          const date = value('date');
          const result = await request(endpoint, 'POST', { action:'save', id:row?.id, revision:row?.revision, record:{ kind, name:value('name'), category:selectedCategory, cents, date, notes:value('notes'), parties } });
          apply(result);
          close();
          draw();
          status.textContent = date.startsWith(month + '-') ? 'Transaction saved.' : `Saved in ${formatMonth.format(new Date(date + 'T00:00:00Z'))}.`;
        } catch (error) { showError(status, error); }
        finally { saving = false; buttons.forEach(button => { button.disabled = false; }); }
      };
      form.querySelector('input')!.focus();
    }

    get('[data-add]').onclick = () => open();
    get('[data-export]').onclick = () => downloadCsv(shown.map(row => ({
      ...row, parties:row.parties.map(party => ({ ...party, name:partyName(party) })),
    })), kind, month);
    category.addEventListener('change', draw);
    for (const control of [search, partyFilter, sort]) control.addEventListener('input', draw);
    get('[data-table]').onclick = async event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      const row = records.find(item => item.id === (button?.dataset.editId ?? button?.dataset.deleteId));
      if (!row || !button || saving) return;
      if (button.dataset.editId) { open(row); return; }
      if (dirty && !confirm('Discard your unsaved transaction edits?')) return;
      if (!confirm(`Delete “${row.name}”?`)) return;
      saving = true;
      try {
        apply(await request(endpoint, 'POST', { action:'delete', id:row.id, revision:row.revision }));
        close();
        draw();
        status.textContent = 'Transaction deleted.';
      } catch (error) { showError(status, error); }
      finally { saving = false; }
    };
    return { draw:drawSheet, close, dirty:() => dirty, updatePeople:() => updatePeople() };
  }

  picker.onsubmit = event => {
    event.preventDefault();
    setMonth(`${year.value}-${monthSelect.value}`);
  };
  find('[data-current-month]').onclick = () => setMonth(today.slice(0, 7));
  container.querySelectorAll<HTMLButtonElement>('[data-year-step]').forEach(button => button.onclick = () => {
    year.value = String(Math.max(1900, Math.min(2999, Number(year.value) + Number(button.dataset.yearStep))));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-month-step]').forEach(button => button.onclick = () => {
    const date = new Date(month + '-01T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth() + Number(button.dataset.monthStep));
    setMonth(date.toISOString().slice(0, 7));
  });

  async function refresh(): Promise<void> {
    if (saving) return;
    saving = true;
    loadStatus.textContent = 'Loading transactions…';
    try {
      apply(await request(endpoint));
      loaded = true;
      draw();
      loadStatus.textContent = '';
    } catch (error) { showError(loadStatus, error); }
    finally { saving = false; }
  }

  find('[data-refresh]').onclick = () => { void refresh(); };
  protectDraft(container, () => saving || sheets.some(sheet => sheet.dirty()));
  draw();
  await refresh();
}
