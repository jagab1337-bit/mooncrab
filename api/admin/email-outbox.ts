import { createEmailOutboxHandler } from '../../server/email-outbox.ts';

export const config = { maxDuration: 60 };
export default createEmailOutboxHandler();
