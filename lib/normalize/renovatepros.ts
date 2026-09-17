// RenovatePros (Class B vendor) normalizer. Lead ID = native key; Source/Campaign sub-codes kept as
// provenance; Street bundles the city (mirrored verbatim for parity). See §8f.
import type { CanonicalLead } from '../types';
import { asObj, pick, toE164, toProductCategory } from './shared';

export function normalizeRenovatePros(raw: unknown): CanonicalLead {
  const p = asObj(raw);
  const product = pick(p, 'Vertical', 'vertical', 'product');
  return {
    firstName: pick(p, 'First', 'first', 'first_name'),
    lastName: pick(p, 'Last', 'last', 'last_name'),
    phone: toE164(pick(p, 'Phone', 'phone')),
    email: pick(p, 'Email', 'email'),
    address1: pick(p, 'Street', 'street', 'Address', 'address'), // may bundle the city — mirror verbatim
    city: pick(p, 'City', 'city'),
    state: pick(p, 'State', 'state'),
    zip: pick(p, 'Zip', 'zip', 'Zip Code'),
    productInterest: product, // raw passthrough ("Window") -> MS Notes
    productCategory: toProductCategory(product),
    source: 'vendor:renovatepros',
    channel: 'RenovatePros',
    provenance: {
      subSource: pick(p, 'Source', 'source'),
      subCampaign: pick(p, 'Campaign', 'campaign'),
      leadId: pick(p, 'Lead ID', 'lead_id', 'leadId'),
    },
  };
}
