import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStorefront, createStore, selectProduct, requestSupply } from '../packages/storefront-sdk/index.mjs';

function workspace() {
  const data = {
    listCatalog: { items: [{ product_id: 'product-a', current_offer: { offer_version_id: 'offer-v2' } }] },
    listStores: { items: [{ store_id: 'store-a' }, { store_id: 'store-b' }] },
    listListings: { items: [{ listing_id: 'a', store_id: 'store-a' }, { listing_id: 'b', store_id: 'store-b' }, { listing_id: 'foreign', store_id: 'foreign-store' }] },
  };
  const calls = [];
  return { data, calls, client: { async call(operation, options) { calls.push({ operation, options }); return data[operation] ?? { receipt: 'persisted' }; } } };
}

test('store-specific workspace excludes other stores and orphan listings without mutating API data', async () => {
  const { client, data, calls } = workspace();
  const snapshot = await loadStorefront(client, { storeId: 'store-a' });
  assert.deepEqual(snapshot.stores.map(row => row.store_id), ['store-a']);
  assert.deepEqual(snapshot.listings.map(row => row.listing_id), ['a']);
  assert.equal(snapshot.catalog[0].current_offer.offer_version_id, 'offer-v2');
  assert.equal(snapshot.mode, 'internal_preview');
  assert.equal(snapshot.capabilities.checkout, false);
  assert.equal(snapshot.capabilities.public_publication, false);
  assert.deepEqual(calls.map(row => row.operation).sort(), ['listCatalog', 'listListings', 'listStores']);
  snapshot.catalog[0].current_offer.offer_version_id = 'changed';
  assert.equal(data.listCatalog.items[0].current_offer.offer_version_id, 'offer-v2');
});

test('workspace without selection includes only listings attached to returned stores', async () => {
  const { client } = workspace();
  assert.deepEqual((await loadStorefront(client)).listings.map(row => row.listing_id), ['a', 'b']);
});

test('unknown store and invalid API response fail closed', async () => {
  const { client, data } = workspace();
  await assert.rejects(loadStorefront(client, { storeId: 'foreign-store' }), /unavailable/);
  await assert.rejects(loadStorefront(client, { storeId: '' }), /storeId/);
  data.listCatalog = { products: [] };
  await assert.rejects(loadStorefront(client), /invalid collection/);
});

test('create and select delegate exact command bodies and explicit idempotency to canonical API', async () => {
  const { client, calls } = workspace();
  const store = { name: 'My store', description: 'Draft', support_contact: 'Contact' };
  const listing = { store_id: 'store-a', offer_version_id: 'offer-v2', retail_price_minor: 24000, sale_terms: 'Draft only' };
  await createStore(client, store, { idempotencyKey: 'create-intent' });
  await selectProduct(client, listing, { idempotencyKey: 'select-intent' });
  assert.deepEqual(calls, [
    { operation: 'createStore', options: { body: store, idempotencyKey: 'create-intent' } },
    { operation: 'createListing', options: { body: listing, idempotencyKey: 'select-intent' } },
  ]);
  assert.throws(() => createStore(client, store), /idempotencyKey/);
  assert.throws(() => selectProduct(client, listing, { idempotencyKey: '  ' }), /idempotencyKey/);
});

test('supply request pins digest and concurrency version and keeps retry identity', async () => {
  const { client, calls } = workspace();
  const listing = { listing_id: 'listing-a', snapshot_sha256: 'a'.repeat(64), aggregate_version: 3 };
  await requestSupply(client, listing, { idempotencyKey: 'reviewed-intent' });
  await requestSupply(client, listing, { idempotencyKey: 'reviewed-intent' });
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], { operation: 'requestSupply', options: {
    params: { id: 'listing-a' }, body: { snapshot_sha256: 'a'.repeat(64) }, idempotencyKey: 'reviewed-intent', version: 3,
  } });
  assert.throws(() => requestSupply(client, { ...listing, snapshot_sha256: 'not-a-digest' }, { idempotencyKey: 'x' }), /snapshot_sha256/);
  assert.throws(() => requestSupply(client, { ...listing, aggregate_version: undefined }, { idempotencyKey: 'x' }), /version/);
});

test('authorization and conflict errors propagate unchanged; adapter never retries commands automatically', async () => {
  let calls = 0;
  const conflict = Object.assign(new Error('precondition failed'), { status: 412 });
  const client = { async call() { calls++; throw conflict; } };
  await assert.rejects(createStore(client, {}, { idempotencyKey: 'x' }), error => error === conflict);
  assert.equal(calls, 1);
});
