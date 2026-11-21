import { EMAIL_WORKFLOWS, TOGGLEABLE_WORKFLOWS } from '../shared/email-workflows.ts';
import type { EmailWorkflow } from '../shared/email-workflows.ts';
import { escape, showError, type AdminFetch } from './admin-workspace.ts';
import { mountNotificationEditor } from './admin-notifications.ts';

export const emailEndpoint = '/api/admin/email-outbox';
const activityPageSize = 10;
const manilaTimestamp = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
const dateLabel = (value: string) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? manilaTimestamp.format(timestamp) : '—';
};
const states: Record<string, string> = { queued:'Queued', sending:'Submitting', accepted:'Accepted by Spacemail', failed:'Failed', unknown:'Outcome uncertain', suppressed:'Suppressed' };

export type Communication = { id: string; bookingId: string; workflow: EmailWorkflow; status: string; createdAt: string; lastAttempt?: string; acceptedAt?: string;
  kind: string; updatedAt: string; recipient?: string; delivery: number; lastError?: string; safeToRetry: boolean;
  history?: Array<{at:string;finishedAt:string;state:string;to:string;subject:string;details?:string}> };

export async function previewBookingEmail(request: AdminFetch, workflow: EmailWorkflow, id?: string) {
  const query = new URLSearchParams({ preview:workflow, ...(id ? {booking:id} : {}) });
  const message = await request(emailEndpoint + '?' + query);
  if (typeof message.html !== 'string' || typeof message.subject !== 'string') throw new Error('Email preview is unavailable.');
  const dialog = document.createElement('dialog');
  dialog.className = 'owner-card workspace-panel email-preview-dialog';
  dialog.setAttribute('aria-label', 'Email preview');
  const subject = document.createElement('h3'); subject.textContent = message.subject;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close preview'; close.onclick = () => dialog.close();
  const frame = document.createElement('iframe'); frame.title = 'Branded email template'; frame.setAttribute('sandbox',''); frame.srcdoc = message.html;
  dialog.append(close, subject, frame);
  document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove(), {once:true});
}

export async function renderEmailAutomations(container: HTMLElement, request: AdminFetch) {
  container.innerHTML = `<div class="email-automations">
    <header class="workspace-heading email-automation-heading">
      <div><h2>Email Automations</h2><p class="owner-hint" data-connection>Loading email workflows…</p></div>
      <a href="/admin/settings/notifications">Notification Settings</a>
    </header>
    <p class="workspace-status email-action-status" role="status" data-status></p>
    <details class="email-recipients" hidden>
      <summary>Manage owner alert recipients</summary>
      <div data-owner-recipients></div>
    </details>
    <section aria-labelledby="email-workflows-heading">
      <h3 id="email-workflows-heading">Workflows</h3>
      <div class="email-workflow-grid" data-workflows></div>
    </section>
    <section class="email-activity" aria-labelledby="email-activity-heading">
      <div class="email-activity-heading">
        <div><h3 id="email-activity-heading">Email activity</h3><p class="owner-hint">Spacemail acceptance records submission. Inbox delivery is a separate check.</p></div>
        <div class="workspace-form"><label>Search activity<input type="search" placeholder="Recipient, subject, or booking reference" disabled></label></div>
      </div>
      <div class="workspace-table-wrap" data-activity></div>
      <nav class="workspace-actions email-pagination" aria-label="Email activity pages" hidden>
        <span data-page aria-live="polite"></span>
        <button type="button" data-previous>Previous</button>
        <button type="button" data-next>Next</button>
      </nav>
    </section>
  </div>`;
  const status = container.querySelector<HTMLElement>('[data-status]')!;
  const connection = container.querySelector<HTMLElement>('[data-connection]')!;
  const search = container.querySelector<HTMLInputElement>('input[type=search]')!;
  const pagination = container.querySelector<HTMLElement>('.email-pagination')!;
  const previous = container.querySelector<HTMLButtonElement>('[data-previous]')!;
  const next = container.querySelector<HTMLButtonElement>('[data-next]')!;
  const ownerEditor = container.querySelector<HTMLElement>('[data-owner-recipients]')!;
  let editorMounted = false;
  let page = 0;
  let jobs: Communication[] = [];
  function activity() {
    const query = search.value.trim().toLowerCase();
    const rows = jobs.flatMap(job => {
      const attempts = job.history ?? [];
      const records = attempts.map(attempt => ({...attempt, job, current:false}));
      const last = records.findLast(record => record.state === job.status && record.at === job.lastAttempt);
      if (last) last.current = true;
      else records.push({ at:job.lastAttempt ?? job.updatedAt, finishedAt:job.updatedAt, state:job.status, to:job.recipient ?? '', subject:'', details:job.lastError, job, current:true });
      return records;
    }).filter(row => [EMAIL_WORKFLOWS[row.job.workflow]?.name, row.to, row.subject, row.job.bookingId, row.state].join(' ').toLowerCase().includes(query))
      .sort((a,b) => b.at.localeCompare(a.at));
    const pages = Math.max(1, Math.ceil(rows.length / activityPageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    const from = page * activityPageSize;
    const to = Math.min(from + activityPageSize, rows.length);
    previous.disabled = page === 0;
    next.disabled = page === pages - 1;
    pagination.hidden = rows.length === 0;
    container.querySelector('[data-page]')!.textContent = `${from + 1}–${to} of ${rows.length} · Page ${page + 1} of ${pages}`;
    container.querySelector('[data-activity]')!.innerHTML = rows.length
      ? `<table class="workspace-table email-activity-table" role="table" aria-labelledby="email-activity-heading">
        <thead role="rowgroup"><tr role="row"><th scope="col">Email</th><th scope="col">Recipient</th><th scope="col">Status</th><th scope="col">Date <small>Manila time</small></th></tr></thead>
        <tbody role="rowgroup">${rows.slice(from, to).map(({job,current,...row}) => {
          const label = EMAIL_WORKFLOWS[job.workflow]?.name;
          const action = current && job.safeToRetry ? 'Retry'
            : current && job.status === 'accepted' && ['confirmation','decline','cancellation'].includes(job.kind) ? 'Resend' : '';
          return `<tr role="row">
            <td class="email-activity-summary" role="cell"><strong>${escape(row.subject || label)}</strong>
              <small>${row.subject ? `${escape(label)} · ` : ''}<a href="/admin#request-${encodeURIComponent(job.bookingId)}" title="${escape(job.bookingId)}">Booking ${escape(job.bookingId.slice(0,8))}</a></small></td>
            <td role="cell">${escape(row.to || 'Not recorded')}</td>
            <td role="cell"><span class="email-state" data-state="${escape(row.state)}">${states[row.state] ?? escape(row.state)}</span>
              ${row.details ? `<small class="workspace-error-text">${escape(row.details)}</small>` : ''}
              ${action ? `<button type="button" data-job="${escape(job.id)}" data-action="${action.toLowerCase()}">${action}</button>` : ''}</td>
            <td role="cell"><time datetime="${escape(row.at)}">${dateLabel(row.at)}</time></td></tr>`;
        }).join('')}</tbody></table>`
      : '<p class="email-activity-empty">No matching email activity.</p>';
  }
  async function load() {
    const state = await request(emailEndpoint+'?automations=1');
    jobs = state.jobs as Communication[];
    const enabled = state.enabled as Record<string, boolean>;
    const smtp = state.smtp as { configured:boolean; reason:string|null };
    const lastTest = state.lastTest as { at:string; status:string } | null;
    connection.textContent = smtp.configured ? 'Spacemail configured · bookings@mooncrabsiargao.com' : smtp.reason ?? 'Spacemail needs configuration.';
    status.textContent = '';
    container.querySelector('[data-workflows]')!.innerHTML = Object.entries(EMAIL_WORKFLOWS).map(([key, workflow]) => {
      const latest = jobs.filter(job => job.workflow === key)
        .sort((a,b) => (b.lastAttempt ?? b.updatedAt).localeCompare(a.lastAttempt ?? a.updatedAt))[0];
      const lastExecution = key === 'test' ? lastTest : latest && {at:latest.lastAttempt ?? latest.updatedAt,status:latest.status};
      return `<article class="workspace-entry email-workflow">
        <div class="email-workflow-heading"><h4>${workflow.name}</h4><span class="email-state" data-state="${enabled[key] ? 'enabled' : 'disabled'}" ${key === 'owner' ? 'data-owner-state' : ''}>${enabled[key] ? 'Enabled' : 'Disabled'}</span></div>
        <p class="owner-hint">${workflow.trigger} · ${workflow.recipient}</p>
        <p class="email-workflow-latest">${lastExecution ? `${states[lastExecution.status] ?? escape(lastExecution.status)} <time datetime="${escape(lastExecution.at)}">${dateLabel(lastExecution.at)}</time>` : 'No recent activity'}${latest ? `<a href="/admin#request-${encodeURIComponent(latest.bookingId)}">Open booking</a>` : ''}</p>
        <div class="workspace-actions"><button type="button" data-workflow="${key}" data-action="preview">Preview template</button><button type="button" data-workflow="${key}" data-action="test">Send test</button>
        ${TOGGLEABLE_WORKFLOWS.some(value=>value===key) ? `<button type="button" data-workflow="${key}" data-action="toggle" data-enabled="${!enabled[key]}">${enabled[key] ? 'Disable' : 'Enable'}</button>` : ''}</div></article>`;
    }).join('');
    if (!editorMounted) {
      const settings = (state.ownerNotifications ?? await request(emailEndpoint + '?settings=1')) as Record<string, unknown>;
      mountNotificationEditor(ownerEditor, request, settings, {
        onSave: active => {
          const ownerState = container.querySelector<HTMLElement>('[data-owner-state]')!;
          ownerState.textContent = active ? 'Enabled' : 'Disabled';
          ownerState.dataset.state = active ? 'enabled' : 'disabled';
        },
      });
      ownerEditor.closest('details')!.hidden = false;
      editorMounted = true;
    }
    search.disabled = false;
    activity();
  }
  search.oninput = () => { page=0; activity(); };
  previous.onclick = () => { page--; activity(); };
  next.onclick = () => { page++; activity(); };
  container.onclick = async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    const { action, workflow, job: id } = button.dataset;
    const job = jobs.find(candidate=>candidate.id===id);
    if (['retry','resend','test'].includes(action ?? '') && !confirm(action === 'test' ? 'Send a sample email to all saved owner alert recipients?' : job?.kind === 'owner' ? 'Retry the owner alert for saved addresses that still need it?' : 'Submit this booking email to its recorded recipient?')) return;
    button.disabled=true;
    try {
      if (action === 'preview') await previewBookingEmail(request, workflow as EmailWorkflow);
      else {
        if (action === 'test') await request(emailEndpoint+'?settings=1','POST',{action:'test',workflow});
        else if (action === 'toggle') await request(emailEndpoint,'POST',{action:'set-automation',workflow,enabled:button.dataset.enabled==='true'});
        else if (job) await request(emailEndpoint,'POST',{action,id,delivery:job.delivery});
        await load();
      }
    } catch (error) { showError(status,error); }
    finally { button.disabled=false; }
  };
  try { await load(); }
  catch (error) { connection.textContent = 'Email workflows unavailable.'; showError(status, error); }
}
