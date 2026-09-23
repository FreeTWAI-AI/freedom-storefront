import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import example from '../examples/demo-snapshot.json' with { type: 'json' };
import { renderPreview, templates } from '../packages/templates/index.mjs';

test('all four declared templates render local HTML without scripts, network assets or checkout controls', () => {
  assert.equal(Object.keys(templates).length, 4);
  for (const template of Object.values(templates)) {
    const html = renderPreview(template.id, example, { listingId: 'demo-listing' });
    assert.match(html, /<!doctype html>/);
    assert.match(html, /會員內部預覽/);
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /<(?:script|form|iframe|img|button)\b/i);
    assert.doesNotMatch(html, /(?:src|href|action)=["']https?:/i);
    assert.equal(template.checkout_enabled, false);
    assert.equal(template.public_publication_enabled, false);
  }
});

test('catalog and single-product render only the explicitly selected store and pinned supply revision', () => {
  const snapshot = structuredClone(example);
  snapshot.stores.push({ store_id: 'other-store', name: 'OTHER STORE PRIVATE', support_contact: 'OTHER CONTACT PRIVATE' });
  snapshot.listings.push({ listing_id: 'other-listing', store_id: 'other-store', snapshot: { supply: { title: 'OTHER PRODUCT PRIVATE' } } });
  snapshot.catalog[0].title = 'NEW OFFER MUST NOT REPLACE PIN';
  const html = renderPreview('catalog-store', snapshot);
  assert.match(html, /手工筆記本（範例）/);
  assert.match(html, /TWD 180.00/);
  assert.match(html, /demo-offer-v1/);
  assert.doesNotMatch(html, /OTHER .* PRIVATE|NEW OFFER MUST NOT REPLACE PIN/);
  assert.throws(() => renderPreview('single-product', snapshot, { listingId: 'other-listing' }), /unavailable/);
  assert.throws(() => renderPreview('single-product', snapshot), /listingId/);
  snapshot.store_id = null;
  assert.throws(() => renderPreview('catalog-store', snapshot), /storeId/);
  assert.throws(() => renderPreview('catalog-store', snapshot, { storeId: 'not-ours' }), /unavailable/);
});

test('untrusted names, contacts and specifications are text, including script and attribute injection', () => {
  const snapshot = structuredClone(example);
  const attack = '<script>alert("private")</script><img src=x onerror=steal()>';
  snapshot.stores[0].name = attack;
  snapshot.stores[0].support_contact = attack;
  snapshot.listings[0].snapshot.supply.title = attack;
  snapshot.listings[0].snapshot.supply.specifications = attack;
  snapshot.catalog[0].title = attack;
  for (const templateId of ['master-store', 'catalog-store', 'single-product']) {
    const html = renderPreview(templateId, snapshot, { listingId: 'demo-listing' });
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>|<img src=x/);
  }
});

test('service-offer states unavailable and does not reinterpret physical catalog as a service', () => {
  const html = renderPreview('service-offer', example);
  assert.equal(templates['service-offer'].status, 'unavailable-api-pending');
  assert.match(html, /服務商店 API 尚未提供/);
  assert.doesNotMatch(html, /手工筆記本|180.00/);
});

test('renderer refuses unsupported or public snapshots', () => {
  assert.throws(() => renderPreview('unknown', example), /Unknown/);
  assert.throws(() => renderPreview('master-store', { ...example, mode: 'public' }), /internal_preview/);
  assert.throws(() => renderPreview('master-store', { ...example, schema_version: '2' }), /schema_version/);
});

test('build CLI creates private HTML offline and refuses overwriting an existing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'freedom-storefront-test-'));
  const output = join(directory, 'preview.html');
  const args = ['scripts/build-preview.mjs', '--template', 'single-product', '--input', 'examples/demo-snapshot.json', '--output', output, '--listing-id', 'demo-listing'];
  try {
    const result = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(result, /No deployment or publication/);
    assert.match(await readFile(output, 'utf8'), /手工筆記本/);
    if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.throws(() => execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] }), /Command failed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
