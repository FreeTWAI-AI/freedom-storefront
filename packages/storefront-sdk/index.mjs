// The API remains the sole authority for membership, ownership and state transitions.
// This adapter never receives a database URL or a provider payment credential.
function port(client) {
  if (!client || typeof client.call !== 'function') throw new TypeError('A Platform client with call(operationId, options) is required.');
  return client;
}

function rows(response, operation) {
  if (!response || !Array.isArray(response.items)) throw new TypeError(`${operation} returned an invalid collection.`);
  return response.items;
}

function mutationOptions(options = {}) {
  const { idempotencyKey, version } = options;
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new TypeError('Provide an explicit idempotencyKey; keep it when retrying the same intent.');
  }
  return { idempotencyKey, ...(version === undefined ? {} : { version }) };
}

/** Read an authenticated seller workspace. This is NOT a public storefront export. */
export async function loadStorefront(client, { storeId } = {}) {
  port(client);
  if (storeId !== undefined && (typeof storeId !== 'string' || !storeId.trim())) throw new TypeError('storeId must be a non-empty string.');
  const [catalogResponse, storesResponse, listingsResponse] = await Promise.all([
    client.call('listCatalog'), client.call('listStores'), client.call('listListings'),
  ]);
  const catalog = rows(catalogResponse, 'listCatalog');
  const availableStores = rows(storesResponse, 'listStores');
  const availableListings = rows(listingsResponse, 'listListings');
  const stores = storeId === undefined ? availableStores : availableStores.filter(store => store.store_id === storeId);
  if (storeId !== undefined && stores.length !== 1) throw new Error('Requested store is unavailable in the current authenticated workspace.');
  const visibleStoreIds = new Set(stores.map(store => store.store_id));
  const listings = availableListings.filter(listing => visibleStoreIds.has(listing.store_id));
  return structuredClone({
    schema_version: '1', mode: 'internal_preview', generated_at: new Date().toISOString(),
    store_id: storeId ?? null, catalog, stores, listings,
    capabilities: { checkout: false, payments: false, public_publication: false, service_offers: false },
  });
}

/** Register an internal store draft. SellerParty / public-store activation is a later API. */
export function createStore(client, body, options) {
  return port(client).call('createStore', { body, ...mutationOptions(options) });
}

/** Pin an exact supplier offer version, retail price and sale terms in a listing draft. */
export function selectProduct(client, body, options) {
  return port(client).call('createListing', { body, ...mutationOptions(options) });
}

/** Request an internal supply confirmation against the reviewed listing snapshot. */
export function requestSupply(client, listing, options) {
  port(client);
  const command = mutationOptions(options);
  if (!listing || typeof listing.listing_id !== 'string' || !listing.listing_id.trim()) throw new TypeError('A listing_id is required.');
  if (!/^[a-f0-9]{64}$/.test(listing.snapshot_sha256 ?? '')) throw new TypeError('The reviewed listing snapshot_sha256 is required.');
  const version = command.version ?? listing.aggregate_version;
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('A positive aggregate version is required.');
  return client.call('requestSupply', {
    params: { id: listing.listing_id }, body: { snapshot_sha256: listing.snapshot_sha256 },
    ...command, version,
  });
}
