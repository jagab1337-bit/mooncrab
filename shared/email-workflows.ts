export const EMAIL_WORKFLOWS = {
  guest: { name: 'Guest acknowledgment', trigger: 'Website request received', recipient: 'Guest', kind: 'guest' },
  owner: { name: 'Owner booking alert', trigger: 'Website request received', recipient: 'Saved owner alert recipients', kind: 'owner' },
  confirmation: { name: 'Website confirmation', trigger: 'Website reservation approved', recipient: 'Guest', kind: 'confirmation' },
  manual: { name: 'Manual booking confirmation', trigger: 'Host confirms and chooses to email', recipient: 'Guest', kind: 'confirmation' },
  decline: { name: 'Booking decline', trigger: 'Pending website request declined', recipient: 'Guest', kind: 'decline' },
  test: { name: 'Notification test', trigger: 'Host runs a test', recipient: 'Saved owner alert recipients', kind: 'test' },
} as const;

export type EmailWorkflow = keyof typeof EMAIL_WORKFLOWS;
export type BookingEmailKind = Exclude<(typeof EMAIL_WORKFLOWS)[EmailWorkflow]['kind'], 'test'>;
export const TOGGLEABLE_WORKFLOWS = ['guest', 'confirmation', 'manual', 'decline'] as const;
