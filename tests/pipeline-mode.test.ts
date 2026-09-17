import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldWriteLive, marketSharpConfigured, liveSources } from '../lib/pipeline-mode';

// Each test sets exactly the four gate vars (node --test isolates by file, so this won't leak elsewhere).
const GATE_VARS = ['PIPELINE_SHADOW_MODE', 'PIPELINE_LIVE_SOURCES', 'MARKETSHARP_SUBMIT_URL', 'MARKETSHARP_API_KEY'];
function env(o: Record<string, string>) {
  for (const k of GATE_VARS) delete process.env[k];
  for (const [k, v] of Object.entries(o)) process.env[k] = v;
}
const CREDS = { MARKETSHARP_SUBMIT_URL: 'https://x', MARKETSHARP_API_KEY: 'k' };

test('default (all unset) → shadow', () => {
  env({});
  assert.equal(shouldWriteLive('web-form'), false);
});
test('ALL THREE gates satisfied → LIVE', () => {
  env({ PIPELINE_SHADOW_MODE: 'false', PIPELINE_LIVE_SOURCES: 'web-form', ...CREDS });
  assert.equal(shouldWriteLive('web-form'), true);
});
test('source not in the live list → shadow', () => {
  env({ PIPELINE_SHADOW_MODE: 'false', PIPELINE_LIVE_SOURCES: 'phone', ...CREDS });
  assert.equal(shouldWriteLive('web-form'), false);
});
test('listed but no creds → shadow (fail safe)', () => {
  env({ PIPELINE_SHADOW_MODE: 'false', PIPELINE_LIVE_SOURCES: 'web-form' });
  assert.equal(shouldWriteLive('web-form'), false);
});
test('master shadow switch ON overrides everything → shadow', () => {
  env({ PIPELINE_SHADOW_MODE: 'true', PIPELINE_LIVE_SOURCES: 'web-form', ...CREDS });
  assert.equal(shouldWriteLive('web-form'), false);
});
test('marketSharpConfigured requires both url AND key', () => {
  env({ MARKETSHARP_SUBMIT_URL: 'https://x' });
  assert.equal(marketSharpConfigured(), false);
  env({ ...CREDS });
  assert.equal(marketSharpConfigured(), true);
});
test('liveSources parses + trims a comma list', () => {
  env({ PIPELINE_LIVE_SOURCES: ' web-form , phone ,' });
  assert.deepEqual(liveSources(), ['web-form', 'phone']);
});
