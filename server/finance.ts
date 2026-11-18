import { isValidDate } from './availability.ts';
import type { HandlerOptions } from './availability.ts';
import { shortText, workspaceRecords } from './workspace-records.ts';

export function validateTransaction(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, name, category, cents, date, notes, parties } = value as Record<string, unknown>;
  if ((kind !== 'in' && kind !== 'out') || !shortText(name, 120) || !name.trim()
    || !shortText(category, 80) || !category.trim() || typeof cents !== 'number'
    || !Number.isSafeInteger(cents) || cents <= 0 || cents > 1_000_000_000
    || !isValidDate(date) || !shortText(notes, 1000) || !Array.isArray(parties) || parties.length < 1 || parties.length > 12) return null;
  const payers = [];
  let total = 0;
  for (const party of parties) {
    if (!party || !shortText(party.name, 80) || !party.name.trim()
      || !Number.isSafeInteger(party.cents) || party.cents <= 0 || party.cents > cents) return null;
    total += party.cents;
    payers.push({ name: party.name.trim(), cents: party.cents });
  }
  if (total !== cents) return null;
  return { kind, name: name.trim(), category: category.trim(), cents, date, notes, parties: payers };
}
export const createFinanceHandler = (options?: HandlerOptions) => workspaceRecords('finance', validateTransaction, options);
