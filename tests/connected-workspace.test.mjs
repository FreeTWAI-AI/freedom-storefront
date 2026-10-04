import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadConnectedStorefront } from '../src/index.mjs';
import { loadConnectedStorefront as shared } from '../vendor/freedom-libraries/packages/client-connections/storefront-workspace.mjs';

test('consumer entrypoint calls shared read transport over HTTP and propagates revocation', async () => {
  assert.equal(loadConnectedStorefront, shared);
  const token = 'fw_read_' + 'A'.repeat(43), seen = [];
  let revoked = false;
  const server = createServer((req, res) => {
    seen.push(req.url);
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, 'Bearer ' + token);
    assert.equal(req.headers.cookie, undefined);
    const values = {
      '/client-api/v1/connection': { kind: 'storefront', scope: 'storefront:read', store_id: 'fixture-store', read_only: true },
      '/client-api/v1/retail/catalog': { items: [{ product_id: 'fixture-product' }], read_only: true },
      '/client-api/v1/retail/stores': { items: [{ store_id: 'fixture-store' }], read_only: true },
      '/client-api/v1/retail/listings': { items: [{ listing_id: 'fixture-listing', store_id: 'fixture-store' }], read_only: true },
    };
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = revoked ? 401 : 200;
    res.end(JSON.stringify(revoked ? { code: 'client_token_invalid' } : values[req.url]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const workspace = await loadConnectedStorefront({ origin, token });
    assert.equal(workspace.store_id, 'fixture-store');
    assert.equal(workspace.listings[0].listing_id, 'fixture-listing');
    assert.equal(workspace.capabilities.public_publication, false);
    assert.equal(workspace.capabilities.checkout, false);
    assert(!JSON.stringify(workspace).includes(token));
    assert.equal(seen.length, 4);
    revoked = true;
    await assert.rejects(loadConnectedStorefront({ origin, token }), { status: 401 });
    assert.equal(seen.length, 5, 'No retry or data reads after revoked connection');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
