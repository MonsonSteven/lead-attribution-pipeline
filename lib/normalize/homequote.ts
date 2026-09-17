// HomeQuote Network (Class B vendor) normalizer. Combined Name (split) + TrustedForm consent cert. See §8e.
import type { CanonicalLead } from '../types';
import { asObj, pick, splitName, toE164, toProductCategory } from './shared';

export function normalizeHomeQuote(raw: unknown): CanonicalLead {
  const p = asObj(raw);
  const { firstName, lastName } = splitName(pick(p, 'Name', 'name', 'names'));
  const product = pick(p, 'Product', 'product', 'product_of_interest');
  const cert = pick(p, 'Trusted Form', 'trusted_form', 'trustedform', 'TrustedForm');
  return {
    firstName,
    lastName,
    phone: toE164(pick(p, 'Phone', 'phone')),
    email: pick(p, 'Email', 'email'),
    address1: pick(p, 'Address', 'address', 'street'),
    city: pick(p, 'City', 'city'),
    state: pick(p, 'State', 'state'),
    zip: pick(p, 'Zip', 'Zip Code', 'zip'),
    productInterest: product, // raw passthrough -> MS Notes
    productCategory: toProductCategory(product),
    consentGiven: cert != null, // TrustedForm cert = documented consent
    consentCertUrl: cert,
    source: 'vendor:homequote',
    channel: 'HomeQuote Network',
    provenance: { trustedForm: cert },
  };
}
