import masterStore from '../../templates/master-store/template.json' with { type: 'json' };
import catalogStore from '../../templates/catalog-store/template.json' with { type: 'json' };
import singleProduct from '../../templates/single-product/template.json' with { type: 'json' };
import serviceOffer from '../../templates/service-offer/template.json' with { type: 'json' };

export const templates = Object.freeze(Object.fromEntries([masterStore, catalogStore, singleProduct, serviceOffer].map(value => [value.id, Object.freeze(value)])));

function escape(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function money(minor, currency) {
  if ((typeof minor !== 'number' && typeof minor !== 'string') || (typeof minor === 'string' && !minor.trim())) return '價格待確認';
  const amount = Number(minor);
  if (!Number.isSafeInteger(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency ?? '')) return '價格待確認';
  // Platform commerce contracts express all current price amounts in 1/100 units.
  return `${escape(currency)} ${(amount / 100).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const statuses = { draft: '選品草稿', requested: '等待供貨商確認', accepted: '供貨已確認（內部演練）', declined: '供貨未接受' };

function productCard(product) {
  const offer = product.current_offer ?? {}, supply = offer.snapshot ?? {};
  return `<article class="card"><div class="eyebrow">實體商品 · 供貨條件 ${escape(offer.revision ?? '待確認')}</div><h2>${escape(product.title)}</h2><p>${escape(product.specifications)}</p><dl><div><dt>供貨商</dt><dd>${escape(product.supplier_name ?? '未提供')}</dd></div><div><dt>供貨參考價</dt><dd>${money(offer.net_price_minor, offer.currency)}</dd></div><div><dt>供貨狀態</dt><dd>${offer.availability === 'finite' ? `目前記錄 ${escape(offer.stock)} 件` : '供貨量待確認'}</dd></div></dl><p class="muted">${escape(supply.shipping_terms ?? offer.shipping_terms ?? '')}</p><p class="muted">品質審查：尚未驗證</p></article>`;
}

function listingCard(listing) {
  const snapshot = listing.snapshot ?? {}, supply = snapshot.supply ?? {};
  return `<article class="card"><div class="eyebrow">${escape(statuses[listing.state] ?? '狀態待確認')}</div><h2>${escape(supply.title ?? '未提供商品名稱')}</h2><p>${escape(supply.specifications)}</p><p class="price">${money(snapshot.retail_price_minor ?? listing.retail_price_minor, snapshot.currency ?? listing.currency)}</p><dl><div><dt>銷售說明</dt><dd>${escape(snapshot.sale_terms ?? listing.sale_terms)}</dd></div><div><dt>出貨條件</dt><dd>${escape(supply.shipping_terms)}</dd></div><div><dt>退換貨條件</dt><dd>${escape(supply.return_terms)}</dd></div></dl><details><summary>已保存的版本</summary><p>供貨版本：<code>${escape(snapshot.offer_version_id ?? listing.offer_version_id)}</code></p><p>選品摘要：<code>${escape(listing.snapshot_sha256)}</code></p><p>此頁保留選品時的供貨內容；不會自動替換成新報價。</p></details></article>`;
}

/** Pure, network-free renderer. Only explicitly selected private snapshot data becomes HTML. */
export function renderPreview(templateId, snapshot, { storeId, listingId } = {}) {
  const template = templates[templateId];
  if (!template) throw new TypeError('Unknown storefront template.');
  if (!snapshot || snapshot.schema_version !== '1' || snapshot.mode !== 'internal_preview') throw new TypeError('Expected an internal_preview snapshot with schema_version 1.');
  for (const field of ['catalog', 'stores', 'listings']) if (!Array.isArray(snapshot[field])) throw new TypeError(`Snapshot ${field} must be an array.`);

  let heading = template.name, description = template.description, content;
  if (templateId === 'service-offer') {
    content = '<section class="card"><h2>服務商店 API 尚未提供</h2><p>平台已有合作與交付紀錄，但尚未提供商店服務選品、預約或結帳 API。此模板先保留入口，不把實體商品改標成可購買服務。</p></section>';
  } else if (templateId === 'master-store') {
    content = snapshot.catalog.map(productCard).join('') || '<p class="empty">目前沒有可查看的供貨商品。</p>';
  } else {
    const selectedId = storeId ?? snapshot.store_id;
    if (typeof selectedId !== 'string' || !selectedId) throw new TypeError('Explicitly select storeId to render a seller template.');
    const stores = snapshot.stores.filter(store => store.store_id === selectedId);
    if (stores.length !== 1) throw new Error('Selected store is unavailable in this snapshot.');
    const store = stores[0];
    heading = store.name; description = store.description;
    let listings = snapshot.listings.filter(listing => listing.store_id === selectedId);
    if (templateId === 'single-product') {
      if (typeof listingId !== 'string' || !listingId) throw new TypeError('Explicitly select listingId for single-product.');
      listings = listings.filter(listing => listing.listing_id === listingId);
      if (listings.length !== 1) throw new Error('Selected listing is unavailable in this store.');
      heading = listings[0].snapshot?.supply?.title ?? '單品說明';
    }
    content = listings.map(listingCard).join('') || '<p class="empty">尚未選入商品。請先在會員工作台建立選品草稿。</p>';
    content += `<section class="contact"><h2>商店聯絡資訊</h2><p>${escape(store.support_contact)}</p></section>`;
  }
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(heading)} · Freedom 內部預覽</title><style>
:root{font-family:system-ui,sans-serif;color:#172c29;background:#edf4f1;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{width:min(1100px,calc(100% - 40px));margin:48px auto}header{max-width:800px;margin-bottom:32px}.badge,.eyebrow{font-size:.8rem;letter-spacing:.05em;color:#386957}.badge{display:inline-block;border:1px solid #8cae9e;border-radius:20px;padding:6px 12px}h1{font-size:clamp(2rem,6vw,3.4rem);line-height:1.1;margin:22px 0 16px}h2{font-size:1.2rem}p,dd{line-height:1.6;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px}.card,.contact{background:#fff;border:1px solid #d6e4dc;border-radius:16px;padding:24px;min-width:0}.contact{grid-column:1/-1}dl{display:grid;gap:12px}dt{font-size:.8rem;color:#657971}dd{margin:4px 0 0}.price{font-size:1.7rem;font-weight:700}.muted,footer{color:#657971;font-size:.9rem}details{border-top:1px solid #e4ede8;padding-top:16px}summary{cursor:pointer}code{font-size:.8rem;overflow-wrap:anywhere}footer{margin-top:32px;border-top:1px solid #c8dcd0;padding-top:20px}.empty{padding:24px}
</style></head><body><main><header><span class="badge">會員內部預覽 · 尚未開放購買</span><h1>${escape(heading)}</h1><p>${escape(description)}</p></header><div class="grid">${content}</div><footer><p>此檔案可能含私人商店及供貨資料，僅供授權成員本機預覽。未啟用公開商店、結帳、付款或服務預約。</p><p>資料擷取時間：${escape(snapshot.generated_at ?? '未提供')} · 模板：${escape(template.id)}</p></footer></main></body></html>`;
}
