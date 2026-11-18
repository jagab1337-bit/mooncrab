import { escape, showError } from './admin-workspace.ts';

export type FinancePerson = { id: string; name: string; revision: string; archived: boolean };
type SavePerson = (operation: 'save' | 'archive' | 'restore', name: string, person?: FinancePerson) => Promise<FinancePerson | undefined>;

export function createPeopleDialog(dialog: HTMLDialogElement, people: () => FinancePerson[], save: SavePerson) {
  dialog.innerHTML = `<div class="finance-heading"><h3>People directory</h3>
    <button type="button" class="finance-text-button" data-close>Close</button></div>
    <form class="workspace-form finance-people-add" data-add-person>
      <label>New person<input name="name" placeholder="Full name" maxlength="80" required></label>
      <button type="submit" class="owner-primary">Add Person</button>
    </form>
    <div class="workspace-form"><label>Search people<input type="search" placeholder="Find a name"></label></div>
    <p class="workspace-status" data-people-status role="status"></p>
    <div data-directory-list></div>`;
  const form = dialog.querySelector<HTMLFormElement>('[data-add-person]')!;
  const name = form.querySelector<HTMLInputElement>('input')!;
  const search = dialog.querySelector<HTMLInputElement>('[type=search]')!;
  const status = dialog.querySelector<HTMLElement>('[data-people-status]')!;
  const list = dialog.querySelector<HTMLElement>('[data-directory-list]')!;
  let choose: ((person: FinancePerson) => void) | undefined;
  let busy = false;

  function draw(): void {
    const query = search.value.trim().toLowerCase();
    const rows = people().filter(person => person.name.toLowerCase().includes(query));
    list.innerHTML = rows.length ? rows.map(person => `<form class="workspace-form finance-person-row" data-person="${person.id}">
      <label>${person.archived ? 'Archived name' : 'Name'}<input name="name" value="${escape(person.name)}" maxlength="80" required></label>
      <div class="workspace-actions">
        <button type="submit" aria-label="Save name for ${escape(person.name)}">Save name</button>
        <button type="button" data-operation="${person.archived ? 'restore' : 'archive'}">${person.archived ? 'Restore' : 'Archive'}</button>
      </div>
    </form>`).join('') : '<p>No matching people.</p>';
  }

  async function change(operation: 'save' | 'archive' | 'restore', nextName: string, person?: FinancePerson): Promise<void> {
    if (busy) return;
    busy = true;
    status.textContent = 'Saving person…';
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const result = await save(operation, nextName, person);
      if (operation === 'save' && !person) {
        form.reset();
        if (choose && result) { choose(result); dialog.close(); return; }
      }
      draw();
      status.textContent = operation === 'archive' ? 'Person archived. Their transactions remain linked.'
        : operation === 'restore' ? 'Person restored.' : 'Name saved.';
    } catch (error) { showError(status, error); }
    finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
  }

  form.onsubmit = event => {
    event.preventDefault();
    void change('save', name.value.trim());
  };
  list.onsubmit = event => {
    event.preventDefault();
    const row = event.target as HTMLFormElement;
    const person = people().find(item => item.id === row.dataset.person);
    if (person) void change('save', String(new FormData(row).get('name') ?? '').trim(), person);
  };
  list.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-operation]');
    const person = people().find(item => item.id === button?.closest<HTMLFormElement>('form')?.dataset.person);
    if (!person) return;
    const operation = person.archived ? 'restore' : 'archive';
    if (operation === 'archive' && !confirm(`Archive “${person.name}”? Existing transactions will remain linked.`)) return;
    void change(operation, person.name, person);
  };
  search.oninput = draw;
  dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { choose = undefined; });

  return (onAdd?: (person: FinancePerson) => void): void => {
    if (dialog.open) return;
    choose = onAdd;
    form.reset();
    search.value = '';
    status.textContent = '';
    draw();
    dialog.showModal();
    name.focus();
  };
}
