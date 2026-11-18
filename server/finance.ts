import { createHash, randomUUID } from 'node:crypto';
import { isValidDate } from './availability.ts';
import type { HandlerOptions } from './availability.ts';
import { shortText, uuidPattern, workspaceRecords, type WorkspaceState, type WorkspaceRecord } from './workspace-records.ts';

type Party = { name: string; cents: number; personId?: string };
type Transaction = WorkspaceRecord & { parties: Party[] };
type Person = { id: string; name: string; revision: string; archived: boolean; formerNames: string[] };
type PersonUpdate = { operation?: string; name?: string };
const normalize = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const legacyId = (name: string) => 'legacy-' + createHash('sha256').update(normalize(name)).digest('hex');
const validPersonId = (id: unknown): id is string =>
  typeof id === 'string' && (uuidPattern.test(id) || /^legacy-[0-9a-f]{64}$/.test(id));
const defaultNames = ['Jake', 'James', 'Kile'];

function directory(state: WorkspaceState): Map<string, Person> {
  const stored = (state.metadata as { people?: Person[] } | undefined)?.people ?? [];
  const people = new Map(stored.map(person => [person.id, person]));
  const include = (name: string, id = legacyId(name)) => {
    if (!people.has(id)) people.set(id, { id, name, revision: 'legacy', archived: false, formerNames: [] });
  };
  defaultNames.forEach(name => include(name));
  for (const row of state.records as Transaction[]) {
    for (const party of row.parties) include(party.name, party.personId);
  }
  return people;
}

function present(state: WorkspaceState): Record<string, unknown> {
  const people = [...directory(state).values()].map(({ formerNames, ...person }) => person)
    .sort((a,b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const records = (state.records as Transaction[]).map(row => ({
    ...row, parties: row.parties.map(party => ({ ...party, personId: party.personId ?? legacyId(party.name) })),
  }));
  return { records, people };
}

function storeDirectory(state: WorkspaceState, people: Map<string, Person>): void {
  state.metadata = { people: [...people.values()] };
}

function changePerson(state: WorkspaceState, body: { action?: string; id?: string; revision?: string; record?: unknown }): {status:number; error:string} | null {
  if (body.action !== 'person') return { status: 400, error: 'Choose a supported finance action.' };
  const update = body.record as PersonUpdate | undefined;
  const people = directory(state);
  const previous = body.id ? people.get(body.id) : undefined;
  if (body.id && (!previous || previous.revision !== body.revision)) {
    return { status: 409, error: 'This person changed in another session. Refresh and try again.' };
  }
  if (update?.operation === 'save') {
    if (!shortText(update.name, 80) || !normalize(update.name) || /[\r\n\t]/.test(update.name)) {
      return { status: 400, error: 'Enter a name of up to 80 characters.' };
    }
    const name = update.name.trim().replace(/\s+/g, ' ');
    const duplicate = [...people.values()].some(person => person.id !== previous?.id
      && [person.name, ...person.formerNames].some(existing => normalize(existing) === normalize(name)));
    if (duplicate) return { status: 409, error: 'That name already belongs to another person. Check the archived names too.' };
    const id = previous?.id ?? randomUUID();
    const formerNames = new Set(previous?.formerNames ?? []);
    if (previous && normalize(previous.name) !== normalize(name)) formerNames.add(previous.name);
    people.set(id, { id, name, revision: randomUUID(), archived: previous?.archived ?? false, formerNames: [...formerNames] });
  } else if (previous && (update?.operation === 'archive' || update?.operation === 'restore')) {
    people.set(previous.id, { ...previous, archived: update.operation === 'archive', revision: randomUUID() });
  } else return { status: 400, error: 'Choose a person and a valid directory action.' };
  storeDirectory(state, people);
  return null;
}

export function validateTransaction(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, name, category, cents, date, notes, parties } = value as Record<string, unknown>;
  if ((kind !== 'in' && kind !== 'out') || !shortText(name, 120) || !name.trim()
    || !shortText(category, 80) || !category.trim() || typeof cents !== 'number'
    || !Number.isSafeInteger(cents) || cents <= 0 || cents > 1_000_000_000
    || !isValidDate(date) || !shortText(notes, 1000) || !Array.isArray(parties) || parties.length < 1 || parties.length > 12) return null;
  const payers: Party[] = [];
  let total = 0;
  for (const party of parties) {
    if (!party || !shortText(party.name, 80) || !party.name.trim()
      || (party.personId !== undefined && !validPersonId(party.personId))
      || !Number.isSafeInteger(party.cents) || party.cents <= 0 || party.cents > cents) return null;
    total += party.cents;
    payers.push({ name: party.name.trim(), cents: party.cents, ...(party.personId ? { personId: party.personId } : {}) });
  }
  if (total !== cents) return null;
  return { kind, name: name.trim(), category: category.trim(), cents, date, notes, parties: payers };
}

function associatePeople(state: WorkspaceState, record: Record<string, unknown>, previous: WorkspaceRecord | undefined): Record<string, unknown> | null {
  const people = directory(state);
  const existing = (previous as Transaction | undefined)?.parties ?? [];
  const historicalIds = new Set(existing.map(party => party.personId ?? legacyId(party.name)));
  const parties: Party[] = [];
  for (const party of record.parties as Party[]) {
    const match = party.personId ? people.get(party.personId) : [...people.values()].find(person =>
      [person.name, ...person.formerNames].some(name => normalize(name) === normalize(party.name)));
    if ((party.personId && !match) || (match?.archived && !historicalIds.has(match.id))) return null;
    const id = match?.id ?? legacyId(party.name);
    if (parties.some(entry => entry.personId === id)) return null;
    const previousName = existing.find(entry => (entry.personId ?? legacyId(entry.name)) === id)?.name;
    parties.push({ ...party, name: previousName ?? match?.name ?? party.name, personId: id });
  }
  return { ...record, parties };
}

export const createFinanceHandler = (options?: HandlerOptions) => workspaceRecords('finance', validateTransaction, options, undefined, {
  view: present, prepare: associatePeople, mutate: changePerson,
});
