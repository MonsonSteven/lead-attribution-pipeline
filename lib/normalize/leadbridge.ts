// LeadBridge (Class B vendor) normalizer. Flat, clean; External Lead ID is the native key. See §8b.
import type { CanonicalLead } from '../types';
import { asObj, pick, toE164, toProductCategory } from './shared';

export function normalizeLeadBridge(raw: unknown): CanonicalLead {
  const p = asObj(raw);
  const product = pick(p, 'Product of Interest', 'Product Of Interest', 'product_of_interest', 'product');
  return {
    firstName: pick(p, 'First', 'first', 'first_name'),
    lastName: pick(p, 'Last', 'last', 'last_name'),
    phone: toE164(pick(p, 'Phone', 'phone')),
    email: pick(p, 'Email', 'email'),
    address1: pick(p, 'Address', 'address', 'address1', 'street'),
    city: pick(p, 'City', 'city'),
    state: pick(p, 'State', 'state'), // trustworthy (FL/AL, geo-filtered on LeadBridge's end)
    zip: pick(p, 'Zip Code', 'Zip', 'zip', 'zip_code'),
    productInterest: product, // raw passthrough -> MS Notes
    productCategory: toProductCategory(product),
    source: 'vendor:leadbridge',
    channel: 'LeadBridge',
    provenance: { externalLeadId: pick(p, 'External Lead ID', 'external_lead_id', 'externalLeadId') },
  };
}
