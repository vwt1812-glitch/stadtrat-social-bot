import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passendeKanaele, einstellungenFuer, zeichenZahl, zeichenLimit, HOCHKANT, repostKandidaten } from '../src/postiz.mjs';
test('Buffer channels keep independent IDs and enforce text/photo/video capabilities', () => {
  const channels = [{ id: 'a', identifier: 'x-buffer' }, { id: 'b', identifier: 'x-buffer' }, { id: 'c', identifier: 'tiktok-buffer' }];
  assert.deepEqual(passendeKanaele(channels, 'text').map(k => k.id), ['a', 'b']);
  assert.deepEqual(passendeKanaele(channels, 'foto').map(k => k.id), ['a', 'b']);
  assert.equal(passendeKanaele(channels, 'video').length, 3);
  for (const k of channels) {
    assert.deepEqual(einstellungenFuer(k, { caption: 'Test' }), { __type: k.identifier, isAiGenerated: false });
    assert.equal(zeichenLimit(k), k.identifier === 'x-buffer' ? 280 : 2200);
  }
  assert.equal(zeichenZahl('https://example.org/' + 'x'.repeat(100), 'x-buffer'), 23);
  assert.ok(HOCHKANT.includes('tiktok-buffer'));
  assert.deepEqual(repostKandidaten(channels, channels), []);
});
