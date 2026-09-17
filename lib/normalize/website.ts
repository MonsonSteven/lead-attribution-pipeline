// Website / Organic normalizer: Fluent Forms webhook payload -> CanonicalLead. See design doc §8.
//
// FF payload shape (confirmed against a real submission 2026-08-20): the form fields live at the
// TOP LEVEL as structured values — `names` is an object {first_name,last_name}, `address_1` is an
// object {address_line_1,city,state,zip,country} (⚠ its `state` is actually the COUNTY, from Google
// autocomplete), and the standalone `state` field (top level) holds the real state. `__submission`
// carries metadata + a flattened `user_inputs` duplicate (strings), which we use only as a fallback.

import { getLatestConsentVersion, getParamChannelMap } from '../repo';
import { asObj, pick, splitName, toE164, toProductCategory } from './shared';
import type { CanonicalLead, ClickIds } from '../types';

// Precedence for resolving a single primary channel when multiple click-ids are present (rare).
const CLICK_ID_PRECEDENCE = ['gclid', 'msclkid', 'oppref', 'fbclid', 'ttclid', 'gbraid', 'wbraid'] as const;

export async function normalizeWebsite(
  raw: unknown,
  // Injectable config lookups (default to the real repo calls); tests pass stubs to stay DB-free.
  getParamMap: typeof getParamChannelMap = getParamChannelMap,
  getConsentVer: typeof getLatestConsentVersion = getLatestConsentVersion,
): Promise<CanonicalLead> {
  const p = asObj(raw); // top level = the form fields (structured)
  const sub = asObj(p['__submission']); // metadata + flattened user_inputs
  const ui = asObj(sub['user_inputs']); // flattened fallback

  const val = (key: string) => pick(p, key) ?? pick(ui, key); // prefer top level, fall back to user_inputs

  // ── attribution: collect the click-id bag, resolve one primary channel ──
  const clickIds: ClickIds = {};
  const presentParams: string[] = [];
  for (const key of CLICK_ID_PRECEDENCE) {
    const v = val(key);
    if (v) {
      (clickIds as Record<string, string>)[key] = v;
      presentParams.push(key);
    }
  }
  const paramChannel = await getParamMap();
  const primaryParam = CLICK_ID_PRECEDENCE.find((k) => presentParams.includes(k));
  const channel = primaryParam ? paramChannel[primaryParam] ?? 'organic-web' : 'organic-web';

  // ── name: prefer the top-level object; fall back to splitting the combined string ──
  const namesObj = asObj(p['names']);
  let firstName = pick(namesObj, 'first_name', 'first');
  let lastName = pick(namesObj, 'last_name', 'last');
  if (!firstName && !lastName) {
    ({ firstName, lastName } = splitName(pick(ui, 'names') ?? val('name')));
  }

  // ── address: prefer the top-level object. Its `state` sub-field is the COUNTY (autocomplete quirk);
  //    the real state is the standalone top-level `state` field. ──
  const addrObj = asObj(p['address_1']);
  const address1 = pick(addrObj, 'address_line_1', 'address_line1') ?? val('address') ?? val('street');
  const address2 = pick(addrObj, 'address_line_2', 'address_line2');
  const city = pick(addrObj, 'city') ?? pick(sub, 'city');
  const county = pick(addrObj, 'state'); // ⚠ the block's "state" is actually the county
  const country = pick(addrObj, 'country') ?? pick(sub, 'country');

  // ── consent (SMS checkbox) ──
  const consentRaw = val('terms-n-condition') ?? val('terms_n_condition') ?? val('terms');
  const consentGiven = consentRaw != null && /^(accepted|on|yes|true|1)$/i.test(consentRaw);
  const consentVersion = consentGiven ? await getConsentVer() : null;

  // ── appointment ──
  const scheduleRaw = val('schedule_appointment');
  const scheduleAppointment = scheduleRaw != null ? /^(yes|true|1)$/i.test(scheduleRaw) : null;

  const productInterest = val('dropdown') ?? val('product') ?? val('product_of_interest');
  const createdAt = pick(sub, 'created_at') ?? val('timestamp');

  return {
    firstName,
    lastName,
    phone: toE164(val('phone')),
    email: val('email'),

    address1,
    address2,
    city,
    state: val('state'), // standalone State field — authoritative (NOT the address block's state)
    zip: val('zip') ?? pick(addrObj, 'zip'),
    county,
    country,

    productInterest,
    productCategory: toProductCategory(productInterest),
    scheduleAppointment,
    appointmentDate: val('appointment_date'),
    appointmentTime: val('appointment_time'),

    consentGiven,
    consentVersion,
    consentAt: consentGiven ? createdAt : null,

    source: 'web-form',
    channel,
    campaign: val('utm_promo') ?? val('promo'),
    region: val('utm_region') ?? val('region'),
    clickIds: Object.keys(clickIds).length ? clickIds : null,
    rawAttribution: presentParams.length > 1 ? { presentParams, collision: true } : { presentParams },

    provenance: {
      formId: pick(sub, 'form_id'),
      submissionId: pick(sub, 'id'),
      ip: pick(sub, 'ip'),
      browser: pick(sub, 'browser'),
      device: pick(sub, 'device'),
      sourceUrl: pick(sub, 'source_url'),
      createdAt,
    },
  };
}

/** Source-native dedupe key for a website lead: the FF submission id (+ form id for global uniqueness). */
export function websiteSourceMessageId(raw: unknown): string | null {
  const sub = asObj(asObj(raw)['__submission'] ?? raw);
  const id = pick(sub, 'id');
  const form = pick(sub, 'form_id');
  if (!id) return null;
  return form ? `ff:${form}:${id}` : `ff:${id}`;
}
