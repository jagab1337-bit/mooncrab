import { isValidDate } from './availability.ts';
import type { HandlerOptions } from './availability.ts';
import { validFileIds, validLinks } from './properties.ts';
import { shortText, uuidPattern, workspaceRecords } from './workspace-records.ts';

const statuses = ['Planned', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const priorities = ['Low', 'Medium', 'High', 'Urgent'];
const optionalDate = (value: unknown) => value === '' || isValidDate(value);
const validId = (value: unknown) => typeof value === 'string' && uuidPattern.test(value);
function task(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const { id, title, description, status, priority, startDate, dueDate, notes, checklist, fileIds, links } = value as Record<string, unknown>;
  if (!validId(id) || !shortText(title, 120) || !title.trim() || !shortText(description, 2000) || !shortText(notes, 3000)
    || !statuses.includes(String(status)) || !priorities.includes(String(priority)) || !optionalDate(startDate) || !optionalDate(dueDate)
    || (startDate && dueDate && String(startDate) > String(dueDate)) || !validFileIds(fileIds) || !validLinks(links)
    || !Array.isArray(checklist) || checklist.length > 40
    || !checklist.every(item => item && shortText(item.text, 160) && item.text.trim() && typeof item.done === 'boolean')) return null;
  return { id, title, description, status, priority, startDate, dueDate, notes, fileIds, links, checklist: checklist.map(({text, done}) => ({text, done})) };
}

function project(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const { title, description, status, priority, startDate, dueDate, completionDate, coverId, notes, tasks, milestones, fileIds, links } = value as Record<string, unknown>;
  if (!shortText(title, 120) || !title.trim() || !shortText(description, 2500)
    || !statuses.includes(String(status)) || !priorities.includes(String(priority)) || !optionalDate(startDate)
    || !optionalDate(dueDate) || !optionalDate(completionDate) || (startDate && dueDate && String(startDate) > String(dueDate))
    || (startDate && completionDate && String(startDate) > String(completionDate)) || !validFileIds(fileIds) || !validLinks(links)
    || (coverId !== '' && (!validId(coverId) || !fileIds.includes(String(coverId))))
    || !Array.isArray(tasks) || tasks.length > 80 || !Array.isArray(notes) || notes.length > 80
    || !Array.isArray(milestones) || milestones.length > 80) return null;
  const safeTasks = tasks.map(task);
  if (safeTasks.some(row => !row) || new Set(safeTasks.map(row => row?.id)).size !== tasks.length) return null;
  if (!notes.every(note => note && validId(note.id) && shortText(note.text, 6000) && note.text.trim())) return null;
  if (!milestones.every(milestone => milestone && validId(milestone.id) && shortText(milestone.title, 120)
    && milestone.title.trim() && isValidDate(milestone.date) && typeof milestone.done === 'boolean')) return null;
  return {
    title: title.trim(), description, status, priority, startDate, dueDate, completionDate, coverId,
    fileIds, links, tasks: safeTasks, notes: notes.map(({id, text}) => ({id, text})),
    milestones: milestones.map(({id, title, date, done}) => ({id, title, date, done})),
  };
}

function addProjectHistory(data: Record<string, unknown>, previous: Record<string, unknown> | undefined, timestamp: string): Record<string, unknown> {
  const history = (previous?.history ?? []) as { text: string; at: string }[];
  const events = previous ? [] : ['Project created'];
  if (previous && data.status !== previous.status) events.push(`Status changed to ${data.status}`);
  if (previous && data.dueDate !== previous.dueDate) events.push('Deadline changed');
  const oldTasks = (previous?.tasks ?? []) as { id: string; status: string }[];
  for (const candidate of data.tasks as { id: string; status: string; title: string }[]) {
    if (candidate.status === 'Completed' && !oldTasks.some(row => row.id === candidate.id && row.status === 'Completed')) events.push(`Task completed: ${candidate.title}`);
  }
  const oldNotes = (previous?.notes ?? []) as { id: string; text: string; at: string }[];
  const notes = (data.notes as { id: string; text: string }[]).map(note => {
    const before = oldNotes.find(row => row.id === note.id);
    if (!before) events.push('Note added');
    return { ...note, at: before?.at ?? timestamp };
  });
  const oldFiles = (previous?.fileIds ?? []) as string[];
  if ((data.fileIds as string[]).some(id => !oldFiles.includes(id))) events.push('File attached');
  return { ...data, notes, history: [...events.map(text => ({ text, at: timestamp })), ...history].slice(0, 100) };
}
export const createProjectsHandler = (options?: HandlerOptions) => workspaceRecords('projects', project, options, addProjectHistory);
