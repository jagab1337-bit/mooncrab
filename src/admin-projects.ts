import { renderFiles } from './admin-files.ts';
import { escape, localDate, showError, workspaceUrl, type AdminFetch, type RecordIdentity } from './admin-workspace.ts';

const statuses = ['Planned', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const priorities = ['Low', 'Medium', 'High', 'Urgent'];
const endpoint = workspaceUrl('projects');
type Link = { label: string; url: string };
type Basics = { title: string; description: string; status: string; priority: string; startDate: string; dueDate: string; fileIds: string[]; links: Link[] };
type Task = Basics & { id: string; notes: string; checklist: { text: string; done: boolean }[] };
type Note = { id: string; text: string; at?: string };
type Milestone = { id: string; title: string; date: string; done: boolean };
type Project = Basics & RecordIdentity & { completionDate: string; coverId: string; tasks: Task[]; notes: Note[]; milestones: Milestone[]; history: { text: string; at: string }[] };
const options = (values: string[], selected: string) => values.map(value => `<option${value === selected ? ' selected' : ''}>${value}</option>`).join('');
const blank = (): Basics => ({ title: '', description: '', status: 'Planned', priority: 'Medium', startDate: '', dueDate: '', fileIds: [], links: [] });
const progress = (project: Project) => {
  const complete = project.tasks.filter(task => task.status === 'Completed').length;
  return project.tasks.length ? `${complete}/${project.tasks.length} tasks complete · ${Math.round(complete / project.tasks.length * 100)}%` : 'No tasks yet';
};
const terminal = (state: string) => ['Completed', 'Cancelled'].includes(state);
const localTime = (at: string) => new Date(at).toLocaleString('en-PH', {timeZone:'Asia/Manila', dateStyle:'medium', timeStyle:'short'});

function basicFields(project: Basics): string {
  return `<label>Title<input name="title" required maxlength="120" value="${escape(project.title)}"></label>
    <label>Status<select name="status">${options(statuses, project.status)}</select></label>
    <label>Priority<select name="priority">${options(priorities, project.priority)}</select></label>
    <label>Start date<input name="startDate" type="date" value="${project.startDate}"></label>
    <label>Due date<input name="dueDate" type="date" value="${project.dueDate}"></label>
    <label class="workspace-full">Description<textarea name="description" maxlength="2000">${escape(project.description)}</textarea></label>
    <label class="workspace-full">Reference links, one HTTPS URL per line<textarea name="links">${escape(project.links.map(link => link.url).join('\n'))}</textarea></label>`;
}

function readBasics(form: HTMLFormElement, previous: Basics): Basics {
  const data = new FormData(form);
  const get = (key: string) => String(data.get(key) ?? '').trim();
  const links = get('links').split(/\r?\n/).map(url => url.trim()).filter(Boolean).map(url => previous.links.find(link => link.url === url) ?? { label: url.slice(0,120), url });
  return { ...previous, title: get('title'), status: get('status'), priority: get('priority'), description: get('description'), startDate: get('startDate'), dueDate: get('dueDate'), links };
}

function dates(project: Project) {
  return [
    ...(project.startDate ? [{ date: project.startDate, title: 'Project start', type: 'Start' }] : []),
    ...(project.dueDate ? [{ date: project.dueDate, title: 'Project deadline', type: 'Deadline' }] : []),
    ...project.tasks.filter(task => task.dueDate).map(task => ({ date: task.dueDate, title: task.title, type: 'Task' })),
    ...project.milestones.map(item => ({ date: item.date, title: item.title, type: item.done ? 'Completed milestone' : 'Milestone' })),
  ].sort((a,b) => a.date.localeCompare(b.date));
}

export async function renderProjects(container: HTMLElement, request: AdminFetch): Promise<void> {
  let records: Project[] = [];
  let project: Project | undefined;
  let dirty = false;
  let busy = false;
  let section = 'Details';
  const coverUrls = new Map<string, Promise<string>>();
  const coverObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target as HTMLImageElement;
      coverObserver.unobserve(image);
      const id = image.dataset.projectCover!;
      if (!coverUrls.has(id)) coverUrls.set(id, request(workspaceUrl('files') + '&file=' + id).then(result => {
        const file = result.file as { mime: string };
        if (!/^image\/(jpeg|png|webp)$/.test(file.mime)) return '';
        const bytes = Uint8Array.from(atob(String(result.data)), character => character.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type:file.mime }));
      }).catch(() => ''));
      void coverUrls.get(id)!.then(url => {
        if (url && image.isConnected) { image.src = url; image.hidden = false; }
      });
    }
  });
  function releaseCovers(): void {
    coverObserver.disconnect();
    for (const result of coverUrls.values()) void result.then(url => { if (url) URL.revokeObjectURL(url); });
    coverUrls.clear();
  }
  window.addEventListener('pagehide', releaseCovers, { once:true });
  new MutationObserver((_, observer) => {
    if (!container.isConnected) { releaseCovers(); observer.disconnect(); }
  }).observe(container.parentElement!, {childList:true});
  container.innerHTML = `<h2>Project Management</h2><p class="workspace-status" data-status role="status">Loading projects…</p>
    <div data-dashboard><div class="workspace-grid" data-stats></div>
    <div class="workspace-actions"><button type="button" data-new>Create new project</button></div>
    <div class="workspace-form"><label>Find a project<input type="search" placeholder="Search projects"></label>
    <label>View<select data-view><option>Board</option><option>List</option><option>Calendar</option></select></label></div>
    <div data-projects></div></div><div data-editor hidden></div>`;
  const find = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const editor = find('[data-editor]');
  const dashboard = find('[data-dashboard]');
  const status = find('[data-status]');
  const search = find<HTMLInputElement>('[type=search]');
  const view = find<HTMLSelectElement>('[data-view]');
  const canDiscard = () => !busy && (!dirty || confirm('Discard unsaved project changes?'));
  function draw(): void {
    const today = localDate();
    const due = records.filter(row => !terminal(row.status) && row.dueDate).sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    find('[data-stats]').innerHTML = [
      ['Total projects', records.length],
      ['Active', records.filter(row => row.status === 'In Progress').length],
      ['Planned', records.filter(row => row.status === 'Planned').length],
      ['Completed', records.filter(row => row.status === 'Completed').length],
      ['Overdue', due.filter(row => row.dueDate < today).length],
      ['Upcoming', due.filter(row => row.dueDate >= today).length],
    ].map(([label, count]) => `<div class="workspace-stat">${label}<strong>${count}</strong></div>`).join('');
    const query = search.value.trim().toLowerCase();
    const results = records.filter(row => (row.title + ' ' + row.description).toLowerCase().includes(query));
    const open = (row: Project) => `<button type="button" data-open="${row.id}">${escape(row.title)}</button>`;
    const timeline = results.flatMap(row => dates(row).map(item => ({ row, ...item }))).sort((a,b) => a.date.localeCompare(b.date));
    const list = find('[data-projects]');
    coverObserver.disconnect();
    if (!results.length) { list.innerHTML = '<p>No projects match this view.</p>'; return; }
    if (view.value === 'Calendar') {
      list.innerHTML = timeline.length ? timeline.map(item => `<p class="workspace-actions"><time>${item.date}</time> ${open(item.row)} <span>${escape(item.title)} · ${item.type}</span></p>`).join('') : '<p>No dates or milestones scheduled.</p>';
    } else if (view.value === 'List') {
      list.innerHTML = `<div class="workspace-table-wrap"><table class="workspace-table"><thead><tr><th>Project</th><th>Status</th><th>Priority</th><th>Due date</th><th>Progress</th></tr></thead><tbody>${results.map(row => `<tr><td>${open(row)}</td><td>${row.status}</td><td>${row.priority}</td><td>${row.dueDate || '—'}</td><td>${progress(row)}</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      list.innerHTML = statuses.map(state => {
        const group = results.filter(row => row.status === state);
        return group.length ? `<section><h3>${state}</h3><div class="workspace-grid">${group.map(row => `<article class="workspace-entry">${row.coverId ? `<img data-project-cover="${row.coverId}" alt="" class="workspace-project-cover" hidden>` : ''}<div class="workspace-actions">${open(row)}</div><p>${escape(row.description)}</p><p>${row.priority} priority · ${progress(row)}</p><p class="owner-hint">${row.startDate || 'No start date'} → ${row.dueDate || 'No deadline'}</p></article>`).join('')}</div></section>` : '';
      }).join('');
    }
    list.querySelectorAll('[data-project-cover]').forEach(image => coverObserver.observe(image));
  }
  function syncUrl(id?: string): void {
    const url = new URL(location.href);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    history.replaceState(null, '', url);
  }
  async function save(data: Project, action = 'save'): Promise<void> {
    if (busy) return;
    busy = true;
    status.textContent = 'Saving project…';
    const controls = [...editor.querySelectorAll<HTMLInputElement>('button,input,select,textarea')].filter(el => !el.disabled);
    controls.forEach(el => { el.disabled = true; });
    try {
      const result = await request(endpoint, 'POST', { action, id: project?.id || undefined, revision: project?.revision, record: data });
      records = result.records as Project[];
      dirty = false;
      if (action === 'delete') close();
      else {
        project = result.record as Project;
        syncUrl(project.id);
        drawEditor();
      }
      draw();
      status.textContent = action === 'delete' ? 'Project deleted.' : 'Project saved.';
    } catch (error) { showError(status, error); }
    finally { busy = false; controls.forEach(el => { el.disabled = false; }); }
  }
  function close(): void {
    project = undefined; dirty = false;
    editor.replaceChildren(); editor.hidden = true; dashboard.hidden = false;
    syncUrl();
  }
  function open(row?: Project): void {
    if (!canDiscard()) return;
    project = row ?? { ...blank(), id:'', revision:'', createdAt:'', updatedAt:'', completionDate:'', coverId:'', tasks:[], notes:[], milestones:[], history:[] };
    section = 'Details'; dirty = false; syncUrl(row?.id);
    dashboard.hidden = true; editor.hidden = false; drawEditor();
  }
  function drawEditor(): void {
    if (!project) return;
    const current = project;
    editor.innerHTML = `<div class="workspace-actions"><button type="button" data-back>← All projects</button></div>
      <h3>${escape(current.title || 'New project')}</h3><p class="owner-hint">${progress(current)}</p>
      ${current.id ? `<div class="workspace-actions">${['Details','Tasks','Timeline','Notes','Files','Activity'].map(label => `<button type="button" data-section="${label}" aria-pressed="${label === section}">${label}</button>`).join('')}</div>` : ''}
      <div data-content></div>`;
    const content = editor.querySelector<HTMLElement>('[data-content]')!;
    if (section === 'Details') {
      content.innerHTML = `<form class="workspace-form workspace-entry">${basicFields(current)}
        <label>Completion date<input type="date" name="completionDate" value="${current.completionDate}"></label>
        <div class="workspace-actions workspace-full"><button type="submit" class="owner-primary">Save project</button>${current.id ? '<button type="button" data-remove>Delete project</button>' : ''}</div></form>`;
      const form = content.querySelector('form')!;
      form.onsubmit = event => {
        event.preventDefault();
        void save({ ...current, ...readBasics(form,current), completionDate: String(new FormData(form).get('completionDate') || '') });
      };
    } else if (section === 'Tasks') {
      content.innerHTML = `<div class="workspace-actions"><button type="button" data-task="new">Add task</button></div><div data-task-form></div>${current.tasks.map((task, index) => `<article class="workspace-entry">
        <strong>${escape(task.title)}</strong><p>${task.status} · ${task.priority} · ${task.dueDate || 'No deadline'}</p>
        <ul>${task.checklist.map(item => `<li>${item.done ? '✓ ' : ''}${escape(item.text)}</li>`).join('')}</ul>
        <div class="workspace-actions"><button type="button" data-task="${task.id}">Edit task</button>${task.status !== 'Completed' ? `<button type="button" data-done="${task.id}">Complete</button>` : ''}
        ${index ? `<button type="button" data-up="${task.id}">Move up</button>` : ''}<button type="button" data-delete-task="${task.id}">Delete task</button></div></article>`).join('')}`;
    } else if (section === 'Timeline') {
      content.innerHTML = `<h3>Timeline</h3>
        <div class="workspace-table-wrap"><table class="workspace-table"><thead><tr><th>Date</th><th>Event</th><th>Type</th></tr></thead><tbody>
        ${dates(current).map(item => `<tr><td>${item.date}</td><td>${escape(item.title)}</td><td>${item.type}</td></tr>`).join('')}</tbody></table></div>
        <p class="owner-hint">${current.startDate && current.dueDate ? `${Math.round((Date.parse(current.dueDate) - Date.parse(current.startDate)) / 86400000) + 1} calendar days` : 'Set project dates to see overall duration.'}</p>
        <h3>Milestones</h3>${current.milestones.map(item => `<div class="workspace-actions"><span>${escape(item.title)} · ${item.date}${item.done ? ' · Completed' : ''}</span><button type="button" data-milestone="${item.id}">Edit</button><button type="button" data-delete-milestone="${item.id}">Delete</button></div>`).join('')}
        <button class="owner-primary" type="button" data-milestone="new">Add milestone</button><div data-milestone-form></div>`;
    } else if (section === 'Notes') {
      content.innerHTML = `<div class="workspace-actions"><button type="button" data-note="new">Add note</button></div><div data-note-form></div>
        ${[...current.notes].reverse().map(note => `<article class="workspace-entry"><p class="owner-hint">${note.at ? localTime(note.at) : ''}</p><p class="workspace-prewrap">${escape(note.text)}</p>
        <div class="workspace-actions"><button type="button" data-note="${note.id}">Edit note</button><button type="button" data-delete-note="${note.id}">Delete note</button></div></article>`).join('')}`;
    } else if (section === 'Files') {
      content.innerHTML = '<div data-files></div><div class="workspace-form"><label>Cover image<select data-cover><option value="">No cover image</option></select></label><button class="owner-primary" type="button" data-save-files>Save attachments</button></div>';
      let fileIds = current.fileIds;
      const cover = content.querySelector<HTMLSelectElement>('[data-cover]')!;
      let library: { id: string; name: string; mime: string }[] = [];
      function drawCovers(): void {
        const id = cover.value || current.coverId;
        cover.replaceChildren(new Option('No cover image', ''), ...library.filter(file => fileIds.includes(file.id) && /^image\/(jpeg|png|webp)$/.test(file.mime)).map(file => new Option(file.name,file.id)));
        if (Array.from(cover.options).some(option => option.value === id)) cover.value = id;
      }
      void request(workspaceUrl('files')).then(result => { library = result.files as typeof library; drawCovers(); }).catch(() => {});
      void renderFiles(content.querySelector('[data-files]')!, request, { fileIds, onChange: ids => {
        fileIds = ids; dirty = true; drawCovers();
        void request(workspaceUrl('files')).then(result => { library = result.files as typeof library; drawCovers(); }).catch(() => {});
      } });
      content.querySelector<HTMLButtonElement>('[data-save-files]')!.onclick = () => { void save({ ...current, fileIds, coverId: cover.value }); };
    } else {
      content.innerHTML = current.history.length ? current.history.map(item => `<p>${escape(item.text)} <small>${localTime(item.at)}</small></p>`).join('') : '<p>No recorded activity.</p>';
    }
  }
  function editTask(current: Project, id: string): void {
    if (!canDiscard()) return;
    dirty = false;
    const task = current.tasks.find(item => item.id === id) ?? { ...blank(), id:crypto.randomUUID(), checklist:[], notes:'' };
    let fileIds = task.fileIds;
    const area = editor.querySelector<HTMLElement>('[data-task-form]')!;
    area.innerHTML = `<form class="workspace-form workspace-entry">${basicFields(task)}<label class="workspace-full">Notes<textarea name="notes" maxlength="3000">${escape(task.notes)}</textarea></label>
      <label class="workspace-full">Checklist, one item per line. Mark completed items with [x].<textarea name="checklist">${escape(task.checklist.map(item => `${item.done ? '[x] ' : ''}${item.text}`).join('\n'))}</textarea></label>
      <button type="submit" class="owner-primary">Save task</button></form><details><summary>Task attachments</summary><div data-task-files></div></details>`;
    void renderFiles(area.querySelector('[data-task-files]')!,request,{fileIds,onChange: ids => { fileIds = ids; dirty = true; }});
    const form = area.querySelector('form')!;
    form.onsubmit = event => {
      event.preventDefault();
      const data = new FormData(form);
      const checklist = String(data.get('checklist') || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        .map(text => ({ text:text.replace(/^\[x\]\s*/i,''), done:/^\[x\]\s*/i.test(text) }));
      const updated: Task = { ...task, ...readBasics(form,task), notes:String(data.get('notes') || ''), checklist, fileIds };
      const tasks = id === 'new' ? [...current.tasks, updated] : current.tasks.map(item => item.id === id ? updated : item);
      void save({ ...current, tasks });
    };
  }
  function editMilestone(current: Project, id: string): void {
    if (!canDiscard()) return;
    dirty = false;
    const old = current.milestones.find(item => item.id === id);
    const area = editor.querySelector<HTMLElement>('[data-milestone-form]')!;
    area.innerHTML = `<form class="workspace-form workspace-entry"><label>Name<input name="title" required maxlength="120" value="${escape(old?.title)}"></label><label>Date<input type="date" name="date" required value="${old?.date ?? localDate()}"></label>
      <label><span><input type="checkbox" name="done" ${old?.done ? 'checked' : ''}> Completed</span></label><button type="submit" class="owner-primary">Save milestone</button></form>`;
    const form = area.querySelector('form')!;
    form.onsubmit = event => {
      event.preventDefault();
      const values = new FormData(form);
      const item = { id: old?.id ?? crypto.randomUUID(), title: String(values.get('title')), date: String(values.get('date')), done: values.has('done') };
      void save({ ...current, milestones: old ? current.milestones.map(existing => existing.id === id ? item : existing) : [...current.milestones, item] });
    };
  }
  function editNote(current: Project, id: string): void {
    if (!canDiscard()) return;
    dirty = false;
    const old = current.notes.find(item => item.id === id);
    const area = editor.querySelector<HTMLElement>('[data-note-form]')!;
    area.innerHTML = `<form class="workspace-form workspace-entry"><label class="workspace-full">Note<textarea name="note" required maxlength="6000" rows="5">${escape(old?.text)}</textarea></label><button class="owner-primary" type="submit">Save note</button></form>`;
    const form = area.querySelector('form')!;
    form.onsubmit = event => {
      event.preventDefault();
      const item = { ...old, id:old?.id ?? crypto.randomUUID(), text:String(new FormData(form).get('note')) };
      void save({ ...current, notes: old ? current.notes.map(note => note.id === id ? item : note) : [...current.notes, item] });
    };
  }
  editor.addEventListener('input', () => { dirty = true; });
  editor.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    const current = project;
    if (!button || !current || busy) return;
    const data = button.dataset;
    if ('back' in data && canDiscard()) close();
    if (data.section && canDiscard()) { dirty = false; section = data.section; drawEditor(); }
    if ('remove' in data && confirm(`Delete “${current.title}” and its tasks and notes?`)) void save(current, 'delete');
    if (data.task) editTask(current, data.task);
    if (data.milestone) editMilestone(current, data.milestone);
    if (data.note) editNote(current, data.note);
    if (data.done && canDiscard()) void save({ ...current, tasks:current.tasks.map(task => task.id === data.done ? { ...task, status:'Completed' } : task) });
    if (data.up && canDiscard()) {
      const tasks = [...current.tasks];
      const index = tasks.findIndex(task => task.id === data.up);
      if (index > 0) { [tasks[index - 1], tasks[index]] = [tasks[index], tasks[index - 1]]; void save({ ...current,tasks }); }
    }
    if (data.deleteTask && canDiscard() && confirm('Delete this task?')) void save({ ...current, tasks:current.tasks.filter(task => task.id !== data.deleteTask) });
    if (data.deleteMilestone && canDiscard() && confirm('Delete this milestone?')) void save({ ...current, milestones:current.milestones.filter(item => item.id !== data.deleteMilestone) });
    if (data.deleteNote && canDiscard() && confirm('Delete this note?')) void save({ ...current, notes:current.notes.filter(note => note.id !== data.deleteNote) });
  };
  find('[data-new]').onclick = () => open();
  find('[data-projects]').onclick = event => {
    const id = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-open]')?.dataset.open;
    const row = records.find(item => item.id === id);
    if (row) open(row);
  };
  search.oninput = draw; view.onchange = draw;
  window.addEventListener('beforeunload', event => {
    if (container.isConnected && (dirty || busy)) { event.preventDefault(); event.returnValue = ''; }
  });
  try {
    records = (await request(endpoint)).records as Project[];
    draw(); status.textContent = '';
    const requested = new URLSearchParams(location.search).get('project');
    const matching = records.find(item => item.id === requested);
    if (matching) open(matching);
  } catch (error) { showError(status, error); }
}
