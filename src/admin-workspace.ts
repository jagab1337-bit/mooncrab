import './admin-workspace.css';

export type AdminFetch = (path: string, method?: string, body?: unknown) => Promise<Record<string, unknown>>;
export type RecordIdentity = { id: string; revision: string; createdAt: string; updatedAt: string };
export const workspaceUrl = (section: string) => `/api/admin/workspace?section=${section}`;
export const money = (cents: number) => new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', minimumFractionDigits: 2,
}).format(cents / 100);
export const localDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', dateStyle: 'short' }).format(new Date());
export const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
export function showError(container: HTMLElement, error: unknown): void {
  container.textContent = error instanceof Error ? error.message : 'The request failed. Try again.';
}
