import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLeadBridge } from '../lib/normalize/leadbridge';
import { normalizeHomeQuote } from '../lib/normalize/homequote';
import { normalizeRenovatePros } from '../lib/normalize/renovatepros';

test('LeadBridge: flat mapping, E.164 phone, trustworthy state, native id → provenance', () => {
  const c = normalizeLeadBridge({
    First: 'Jordan', Last: 'Avery', Phone: '5551230201', Email: 'jordan@example.com',
    Address: '412 Maple Grove Lane', City: 'RIVERTON', State: 'FL', 'Zip Code': '32566',
    'Product of Interest': 'Windows', 'External Lead ID': '10000001',
  });
  assert.equal(c.firstName, 'Jordan');
  assert.equal(c.lastName, 'Avery');
  assert.equal(c.phone, '+15551230201');
  assert.equal(c.state, 'FL');
  assert.equal(c.productInterest, 'Windows');
  assert.equal(c.productCategory, 'Windows');
  assert.equal(c.source, 'vendor:leadbridge');
  assert.equal(c.channel, 'LeadBridge');
  assert.equal(c.provenance?.externalLeadId, '10000001');
});

test('HomeQuote Network: splits the combined Name; captures TrustedForm consent', () => {
  const c = normalizeHomeQuote({
    Name: 'CASEY MORGAN', Phone: '5551230202', Email: 'casey@example.com',
    Address: '88 Lakeshore Drive', City: 'Fairview', State: 'FL', Zip: '32563',
    Product: 'Bathroom Remodeling', 'Trusted Form': 'https://cert.trustedform.com/demo00000000000000000000000000000000',
  });
  assert.equal(c.firstName, 'CASEY'); // name-split
  assert.equal(c.lastName, 'MORGAN');
  assert.equal(c.productInterest, 'Bathroom Remodeling'); // raw passthrough
  assert.equal(c.productCategory, 'Bath'); // best-effort bucket
  assert.equal(c.consentGiven, true);
  assert.equal(c.consentCertUrl, 'https://cert.trustedform.com/demo00000000000000000000000000000000');
  assert.equal(c.source, 'vendor:homequote');
});

test('RenovatePros: separate names, Vertical passthrough, sub-codes → provenance', () => {
  const c = normalizeRenovatePros({
    First: 'Taylor', Last: 'Brooks', Email: 'taylor@example.com', Phone: '5551230203',
    Street: '150 Oak Ridge Road, Fairview', City: 'FAIRVIEW', State: 'FL', Zip: '32503',
    Vertical: 'Window', 'Lead ID': '20000002', Source: 'DEMO-SUBSRC', Campaign: '9001',
  });
  assert.equal(c.firstName, 'Taylor');
  assert.equal(c.lastName, 'Brooks');
  assert.equal(c.address1, '150 Oak Ridge Road, Fairview'); // city bundled — mirrored verbatim
  assert.equal(c.productInterest, 'Window');
  assert.equal(c.productCategory, 'Windows');
  assert.equal(c.source, 'vendor:renovatepros');
  assert.equal(c.provenance?.subSource, 'DEMO-SUBSRC');
  assert.equal(c.provenance?.leadId, '20000002');
});
