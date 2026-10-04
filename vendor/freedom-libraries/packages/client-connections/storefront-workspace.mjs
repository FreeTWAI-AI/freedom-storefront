import { ScopedReadClient } from './read-client.mjs';

/** Private workspace for the one store approved by the member. Never publish this JSON. */
export async function loadConnectedStorefront(options) {
  const client = new ScopedReadClient(options);
  const connection = await client.read('connection');
  if (connection.kind !== 'storefront' || connection.scope !== 'storefront:read'
      || typeof connection.store_id !== 'string' || !connection.store_id) {
    throw new TypeError('A storefront:read connection for one approved store is required.');
  }
  const [catalog, stores, listings] = await Promise.all(
    ['catalog', 'stores', 'listings'].map(resource => client.read(resource)),
  );
  // Defense against mixed snapshots/adapters, not a replacement for server authorization.
  if (stores.items.length !== 1 || stores.items[0]?.store_id !== connection.store_id
      || listings.items.some(item => item?.store_id !== connection.store_id)) {
    throw new TypeError('Read response differs from the approved store.');
  }
  return {
    schema_version: '1', mode: 'internal_preview', generated_at: new Date().toISOString(),
    store_id: connection.store_id, catalog: catalog.items, stores: stores.items, listings: listings.items,
    capabilities: { checkout: false, payments: false, public_publication: false, service_offers: false },
  };
}
