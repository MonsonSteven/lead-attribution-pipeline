// Source registry: maps a receiver URL slug -> {canonical source, native dedupe-key extractor}.
// The generic receiver (/api/receivers/[source]) uses this; the processor dispatches normalizers.

import type { LeadSource } from './types';
import { websiteSourceMessageId } from './normalize/website';
import { phoneSourceMessageId } from './normalize/phone';
import { asObj, pick } from './normalize/shared';

interface SourceDef {
  source: LeadSource;
  /** Source-native dedupe key (idempotency): FF submission id, TrustedForm URL, vendor Lead ID, etc. */
  extractMessageId(payload: unknown): string | null;
}

export const SOURCES: Record<string, SourceDef> = {
  website: {
    source: 'web-form',
    extractMessageId: websiteSourceMessageId,
  },
  leadbridge: {
    source: 'vendor:leadbridge',
    extractMessageId: (p) => {
      const id = pick(asObj(p), 'External Lead ID', 'external_lead_id', 'externalLeadId');
      return id ? `leadbridge:${id}` : null;
    },
  },
  'homequote': {
    source: 'vendor:homequote',
    // The TrustedForm cert URL is unique per lead — it IS the dedupe key.
    extractMessageId: (p) => pick(asObj(p), 'Trusted Form', 'trusted_form', 'trustedform', 'TrustedForm'),
  },
  'renovatepros': {
    source: 'vendor:renovatepros',
    extractMessageId: (p) => {
      const id = pick(asObj(p), 'Lead ID', 'lead_id', 'leadId');
      return id ? `proremodel:${id}` : null;
    },
  },
  'twilio-call': {
    source: 'phone',
    // Twilio CallSid is unique per call — the idempotency key so a retried Studio HTTP request
    // (or a re-executed flow) can't create a duplicate call-lead. Sent from the Studio HTTP widget.
    extractMessageId: phoneSourceMessageId,
  },
};

export function getSourceDef(slug: string): SourceDef | null {
  return SOURCES[slug] ?? null;
}
