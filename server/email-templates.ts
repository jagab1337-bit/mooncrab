/** Real HTML text remains readable when an email client blocks remote images. */
export interface EmailBooking {
  id: string; name: string; email: string; phone?: string; whatsapp?: boolean;
  room?: string; checkIn: string; checkOut: string; guests: number; message: string;
  status: string; createdAt: string;
  pricing?: { nights: number; totalPhp: number; depositPhp: number; extraGuestFeePhp?: number; roomSubtotalPhp?: number; lineItems?: Array<{ label: string; totalPhp?: number; amountPhp?: number }> };
}

export interface TemplateContacts { website: string; bookings: string; greetings: string; phone: string; whatsapp: string; instagram: string; facebook: string; maps: string }
export const EMAIL_CONTACTS: TemplateContacts = {
  website: 'https://mooncrabsiargao.com/',
  bookings: 'bookings@mooncrabsiargao.com',
  greetings: 'greetings@mooncrabsiargao.com',
  phone: '+63 962 528 4264',
  whatsapp: 'https://wa.me/639625284264',
  instagram: 'https://www.instagram.com/mooncrabsiargao/',
  facebook: 'https://www.facebook.com/share/1CsWCrqdR8/?mibextid=wwXIfr',
  maps: 'https://maps.app.goo.gl/RwCRdtYfqmGDei1e8',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function firstName(name: string): string { return name.trim().split(/\s+/)[0] || 'there'; }
const peso = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: value % 1 ? 2 : 0 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(`${value}T12:00:00+08:00`));
function nights(booking: EmailBooking): number { return booking.pricing?.nights ?? Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86_400_000); }

/** Shared with application emails; mailbox signature configuration is a separate owner action. */
export function emailSignature(contacts: TemplateContacts = EMAIL_CONTACTS): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#472F29;"><tr><td style="padding:18px 0 0;border-top:1px solid #d9d0c1;"><strong style="font-family:Georgia,serif;font-size:23px;font-weight:normal;">Mooncrab Siargao</strong><br><span style="font-size:11px;line-height:2;color:#716157;">RESERVATIONS &amp; GUEST CARE</span><br><a href="${escapeHtml(`mailto:${contacts.greetings}`)}" style="color:#472F29;font-size:12px;">${escapeHtml(contacts.greetings)}</a><br><a href="${escapeHtml(`tel:${contacts.phone.replace(/[^+0-9]/g, '')}`)}" style="color:#472F29;font-size:12px;text-decoration:none;">${escapeHtml(contacts.phone)} · Calls &amp; SMS</a><br><a href="${escapeHtml(contacts.maps)}" style="color:#716157;font-size:11px;text-decoration:none;line-height:1.8;">Pangitlogan Street, Purok 5<br>General Luna, Siargao 8419, Philippines</a><br><a href="${escapeHtml(contacts.website)}" style="color:#472F29;font-size:12px;line-height:2;">mooncrabsiargao.com</a></td></tr></table>`;
}

function button(label: string, href: string, primary = false): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:${primary ? '15px 25px' : '11px 15px'};margin:5px 7px 5px 0;background:${primary ? '#472F29' : '#e7e6da'};color:${primary ? '#F7EEE3' : '#472F29'};border-radius:5px;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:${primary ? '15' : '12'}px;line-height:1.4;">${escapeHtml(label)}</a>`;
}

function summary(booking: EmailBooking, owner: boolean): string {
  const rows = [
    ['Room requested', booking.room || 'KASAG'],
    ['Check-in', `${date(booking.checkIn)} · 2:00 PM`],
    ['Check-out', `${date(booking.checkOut)} · 11:00 AM`],
    ['Duration', `${nights(booking)} nights`],
    ['Guests', String(booking.guests)],
    ['Estimated accommodation total', booking.pricing ? peso(booking.pricing.totalPhp) : 'Host quote required'],
    ['50% deposit after agreement', booking.pricing ? peso(booking.pricing.depositPhp) : 'Based on the agreed total'],
    ['Status', 'Pending · not a confirmed reservation'],
    ...(owner ? [['Guest', booking.name], ['Email', booking.email], ['Phone', booking.phone || 'Not supplied on legacy request'], ['WhatsApp available', booking.whatsapp ? 'Yes' : 'Not indicated'], ['Submitted', new Date(booking.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' · Philippine time']] : []),
  ];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ede9dc;margin:22px 0;"><tr><td colspan="2" style="padding:17px 20px 5px;font-family:Georgia,serif;font-size:23px;color:#472F29;">Your requested island stay</td></tr>${rows.map(([label, value]) => `<tr><td style="width:47%;padding:8px 10px 8px 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#716157;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 20px 8px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#472F29;vertical-align:top;">${escapeHtml(value)}</td></tr>`).join('')}<tr><td colspan="2" style="padding:8px 20px 17px;font-size:10px;color:#716157;">Reference: ${escapeHtml(booking.id)}</td></tr></table>`;
}

function wrap(title: string, content: string, contacts: TemplateContacts): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:20px 8px;background:#eae4d9;"><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;background:#F7EEE3;"><tr><td style="height:6px;background:#839689;font-size:0;">&nbsp;</td></tr><tr><td style="padding:25px 28px 18px;text-align:center;"><a href="${escapeHtml(contacts.website)}"><img src="${escapeHtml(`${contacts.website}images/mooncrab-logo-email.png?v=20261119`)}" width="150" height="120" alt="Moon Crab Hostel · Siargao" style="display:block;width:150px;height:120px;margin:0 auto;border:0;"></a><p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#716157;">A SMALL STAY. A BEAUTIFUL ISLAND.</p></td></tr><tr><td style="padding:0 28px 28px;font-family:Arial,Helvetica,sans-serif;color:#472F29;font-size:14px;line-height:1.75;">${content}${emailSignature(contacts)}</td></tr></table></body></html>`;
}

export function bookingEmail(booking: EmailBooking, kind: 'guest' | 'owner', contacts: TemplateContacts = EMAIL_CONTACTS): { subject: string; html: string; text: string } {
  const owner = kind === 'owner';
  const subject = owner ? `New KASAG booking request · ${booking.checkIn} · ${booking.id}` : '🌙 Your Moon Crab Siargao Booking Request — Next Steps';
  const greeting = owner ? 'A new island stay request.' : `Hi ${escapeHtml(firstName(booking.name))},`;
  const intro = owner
    ? '<p>A direct booking request has been saved. Review the details in your secure dashboard, agree the final total, and verify the 50% deposit in your bank account before confirming. This request has not reserved the room.</p>'
    : '<p>Thank you for inquiring about your stay at Moon Crab Siargao! 🌙🦀 We’ve received your booking request and look forward to helping you plan your island days.</p><p><strong>To finish your booking, please click the WhatsApp button below to chat with our team.</strong> We’ll confirm availability and finalize the details of your stay.</p>';
  const controls = owner
    ? button('Review booking request', 'https://mooncrabsiargao.com/admin', true)
    : `${button('Chat With Us on WhatsApp', `${contacts.whatsapp}?text=${encodeURIComponent(`Hi Mooncrab, I’m ${firstName(booking.name)}. I requested ${booking.room || 'KASAG'} for ${booking.checkIn} to ${booking.checkOut}${booking.pricing ? `, estimated ${peso(booking.pricing.totalPhp)}` : ''}. Could you help confirm the details?`)}`, true)}<p style="font-size:11px;margin:5px 0 20px;color:#716157;">WhatsApp, calls &amp; SMS: ${escapeHtml(contacts.phone)}.</p><p style="margin-bottom:5px;">Prefer another way to reach us?</p>${button('Facebook · open our page', contacts.facebook)}${button('Instagram', contacts.instagram)}`;
  const note = owner
    ? '<p style="font-size:11px;color:#716157;">Use the dashboard to confirm or decline. Confirming rechecks availability and blocks the stay’s nights. Contact the guest directly about your decision.</p>'
    : '<p style="font-size:12px;">Your reservation is not yet confirmed. A 50% deposit of the agreed total is required, and we verify receipt manually before confirming your dates.</p><p style="font-size:11px;line-height:1.6;color:#716157;">This is an automated email. Please do not reply to this message. To contact our team, use the WhatsApp, Facebook, or Instagram buttons above.</p>';
  const content = `<p style="font-size:11px;letter-spacing:1.5px;color:#667b6c;">${owner ? 'NEW DIRECT BOOKING INQUIRY' : 'YOUR ISLAND STAY IS ONE STEP CLOSER 🌴'}</p><h1 style="font-family:Georgia,serif;font-size:31px;font-weight:normal;line-height:1.2;margin:16px 0;">${greeting}</h1>${intro}${summary(booking, owner)}${owner && booking.message ? `<p><strong>Guest notes</strong><br>${escapeHtml(booking.message).replace(/\n/g, '<br>')}</p>` : ''}${controls}${note}`;
  const text = [
    owner ? 'NEW MOON CRAB SIARGAO BOOKING REQUEST' : `Hi ${firstName(booking.name)},`,
    owner ? 'A pending request has been saved. It does not reserve the room.' : 'Thank you for your booking request. To finish your booking, please chat with our team on WhatsApp.',
    `Reference: ${booking.id}`, `Room: ${booking.room || 'KASAG'}`, `Check-in: ${booking.checkIn} · 2:00 PM`, `Check-out: ${booking.checkOut} · 11:00 AM`, `Nights: ${nights(booking)}`, `Guests: ${booking.guests}`,
    `Estimated accommodation total: ${booking.pricing ? peso(booking.pricing.totalPhp) : 'Host quote required'}`,
    `50% deposit after agreement: ${booking.pricing ? peso(booking.pricing.depositPhp) : 'Based on the agreed total'}`,
    'Status: Pending. Your reservation is not yet confirmed.',
    ...(owner ? [`Guest: ${booking.name}`, `Email: ${booking.email}`, `Phone: ${booking.phone || 'Not supplied'}`, `WhatsApp: ${booking.whatsapp ? 'Yes' : 'Not indicated'}`, `Submitted: ${booking.createdAt}`, `Notes: ${booking.message}`, 'Dashboard: https://mooncrabsiargao.com/admin'] : []),
    `WhatsApp: ${contacts.whatsapp}`, `Facebook: ${contacts.facebook}`, `Instagram: ${contacts.instagram}`,
    'A 50% deposit of the agreed total is required. We verify bank receipt manually before confirming dates.',
    'Mooncrab Siargao · Reservations & Guest Care', contacts.greetings, `Calls/SMS: ${contacts.phone}`, contacts.website,
    ...(owner ? [] : ['This is an automated email. Please do not reply. Contact us using the links above.']),
  ].join('\n\n');
  return { subject, html: wrap(subject, content, contacts), text };
}
