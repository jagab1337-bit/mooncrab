import { EMAIL_WORKFLOWS, TOGGLEABLE_WORKFLOWS } from '../shared/email-workflows.ts';
import type { EmailWorkflow } from '../shared/email-workflows.ts';
import { escape, showError, type AdminFetch } from './admin-workspace.ts';
import { mountNotificationEditor } from './admin-notifications.ts';

export const emailEndpoint = '/api/admin/email-outbox';
const dateLabel = (value?: string) => value ? new Date(value).toLocaleString('en-PH', { timeZone:'Asia/Manila' }) : '—';
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
  container.innerHTML = `<div class="workspace-heading"><h2>Email Automations</h2><a href="/admin/settings/notifications">Notification Settings</a></div>
    <p class="workspace-status" role="status" data-status>Loading email workflows…</p><div class="workspace-grid" data-workflows></div>
    <h3>Email activity</h3><p class="owner-hint">Spacemail acceptance records submission. Inbox delivery is a separate check.</p>
    <label class="workspace-form">Search activity<input type="search" placeholder="Workflow, recipient, subject, or booking reference"></label>
    <div class="workspace-table-wrap" data-activity></div><div class="workspace-actions"><button type="button" data-previous>Previous</button><span data-page></span><button type="button" data-next>Next</button></div>`;
  const status = container.querySelector<HTMLElement>('[data-status]')!;
  const search = container.querySelector<HTMLInputElement>('input[type=search]')!;
  const previous = container.querySelector<HTMLButtonElement>('[data-previous]')!;
  const next = container.querySelector<HTMLButtonElement>('[data-next]')!;
  const ownerEditor = document.createElement('div');
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
    const size = 15;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    page = Math.min(page,pages-1);
    previous.disabled = page===0; next.disabled = page>=pages-1;
    container.querySelector('[data-page]')!.textContent = `Page ${page+1} of ${pages} · ${rows.length} entries`;
    container.querySelector('[data-activity]')!.innerHTML = rows.length ? `<table class="workspace-table"><thead><tr><th>Date</th><th>Workflow</th><th>Reference</th><th>Sender</th><th>Recipient</th><th>Subject</th><th>Status</th><th>Last attempt</th><th>Actions</th></tr></thead><tbody>${rows.slice(page*size,(page+1)*size).map(({job,current,...row}) => `<tr><td>${dateLabel(row.at)}</td><td>${EMAIL_WORKFLOWS[job.workflow]?.name}</td><td><a href="/admin#request-${encodeURIComponent(job.bookingId)}">${escape(job.bookingId)}</a></td><td>bookings@mooncrabsiargao.com</td><td>${escape(row.to || 'Not recorded')}</td><td>${escape(row.subject || '—')}</td><td>${states[row.state] ?? escape(row.state)}${row.details ? `<small class="workspace-error-text">${escape(row.details)}</small>` : ''}</td><td>${dateLabel(job.lastAttempt)}</td><td>${current && job.safeToRetry ? `<button data-job="${job.id}" data-action="retry">Retry</button>` : current && job.status==='accepted' && ['confirmation','decline'].includes(job.kind) ? `<button data-job="${job.id}" data-action="resend">Resend</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p>No matching email activity is retained.</p>';
  }
  async function load() {
    const state = await request(emailEndpoint+'?automations=1');
    jobs = state.jobs as Communication[];
    const enabled = state.enabled as Record<string, boolean>;
    const smtp = state.smtp as { configured:boolean; reason:string|null };
    const lastTest = state.lastTest as { at:string; status:string } | null;
    status.textContent = smtp.configured ? 'Spacemail connection configured.' : smtp.reason ?? 'Spacemail needs configuration.';
    container.querySelector('[data-workflows]')!.innerHTML = Object.entries(EMAIL_WORKFLOWS).map(([key, workflow]) => {
      const latest = jobs.find(job=>job.workflow===key);
      const lastExecution = key === 'test' ? lastTest : latest && {at:latest.lastAttempt ?? latest.updatedAt,status:latest.status};
      return `<section class="workspace-entry email-workflow"><h3>${workflow.name}</h3><p>${workflow.trigger} → ${workflow.recipient}</p><p class="owner-hint">bookings@mooncrabsiargao.com · <span ${key === 'owner' ? 'data-owner-state' : ''}>${enabled[key] ? 'Enabled' : 'Disabled'}</span></p>
        <p>${lastExecution ? `${states[lastExecution.status] ?? escape(lastExecution.status)} · ${dateLabel(lastExecution.at)}` : 'No retained execution'}${latest ? ` · <a href="/admin#request-${encodeURIComponent(latest.bookingId)}">Open booking</a>` : ''}</p>
        <div class="workspace-actions"><button type="button" data-workflow="${key}" data-action="preview">Preview template</button><button type="button" data-workflow="${key}" data-action="test">Send test</button>
        ${TOGGLEABLE_WORKFLOWS.some(value=>value===key) ? `<button type="button" data-workflow="${key}" data-action="toggle" data-enabled="${!enabled[key]}">${enabled[key] ? 'Disable' : 'Enable'}</button>` : ''}</div>
        ${key === 'owner' ? '<div data-owner-recipients></div>' : ''}</section>`;
    }).join('');
    container.querySelector('[data-owner-recipients]')!.append(ownerEditor);
    if (!editorMounted) {
      const settings = (state.ownerNotifications ?? await request(emailEndpoint + '?settings=1')) as Record<string, unknown>;
      mountNotificationEditor(ownerEditor, request, settings, {
        onSave: active => { container.querySelector('[data-owner-state]')!.textContent = active ? 'Enabled' : 'Disabled'; },
      });
      editorMounted = true;
    }
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
  try { await load(); } catch (error) { showError(status,error); }
}
