# Freedom Storefront

可 fork 的商店模板、薄 SDK 與離線 HTML 預覽工具。商品、供貨條件、Store、選品版本與人的確認由 [`freedom-platform`](https://github.com/FreeTWAI-AI/freedom-platform) 的中央 API 保存。本 repo 不建立第二套會員、商品資料庫或金流帳。

本階段是 **會員內部預覽**：可讀取已登入使用者的商店資料，建立商店／選品草稿、提出供貨確認，以及生成私人本機版面。公開商店 API、SellerParty 啟用、買家 purpose token、checkout、訂單、付款與正式發布尚未在這個模板實作。

## 四種模板

| 目錄 | 現在可做 |
| --- | --- |
| `templates/master-store` | 會員可查看的參考商品目錄；不需要開店或販售 |
| `templates/catalog-store` | 明確選定自己一家商店，預覽其選品與供貨狀態 |
| `templates/single-product` | 明確選定商店與一筆選品，預覽已保存的商品及售價版本 |
| `templates/service-offer` | 已有版面入口，清楚顯示服務商店 API 尚未提供；不假造預約／購買能力 |

每個模板有 `template.json`；共用 renderer 在 `packages/templates/index.mjs`。可修改版面與文案，再跑測試。商品與選品的 canonical schema、授權與狀態轉換保持在 Platform。

## 本機預覽

需要 Node.js 24，沒有第三方 runtime 相依套件。

```sh
npm test
npm run build -- --template master-store --input examples/demo-snapshot.json --output dist/master.html
npm run build -- --template catalog-store --input examples/demo-snapshot.json --output dist/catalog.html
npm run build -- --template single-product --input examples/demo-snapshot.json --output dist/product.html --listing-id demo-listing
npm run build -- --template service-offer --input examples/demo-snapshot.json --output dist/service.html
```

用瀏覽器開啟產生的 HTML。範例只含虛構資料與明示的範例 ID，不能直接送入 API 當成真實商品。CLI 不連網、不部署、不覆蓋既有檔案；輸出採私人檔案權限。要重建請選新檔名或自行刪除舊預覽。

真實會員 snapshot 可能含供貨參考價及私人商店資料。保存到 git 忽略的 `snapshots/`，不要 commit 或上傳到 Pages。`noindex` 不是存取控制。Renderer 不載入遠端照片／腳本，也不把聯絡文字變成可執行連結。

## 接中央 API

所有 SDK 函式接受共用 client：

```js
client.call(operationId, { params, body, idempotencyKey, version })
```

共用 transport 由 Platform 的協定同步至 `vendor/freedom-platform/client.mjs`。驗證與 session 的設定由應用端注入；SDK 不接 DB URL、不持支付密鑰，也不代建登入機制。現行 API 是登入後的同一會員工作區；跨網域 public storefront 的短效 purpose-token 不是這一版能力。

```js
import { loadStorefront, createStore, selectProduct, requestSupply, renderPreview } from './src/index.mjs';

// client 由應用的受驗證 transport 提供。
const view = await loadStorefront(client, { storeId: myStoreId });
const html = renderPreview('catalog-store', view);

const store = await createStore(client, {
  name: '我的商店', description: '我的選品方向', support_contact: '平台內聯絡',
}, { idempotencyKey: createStoreIntentKey });

const listing = await selectProduct(client, {
  store_id: store.store_id,
  offer_version_id: reviewedOfferVersionId,
  retail_price_minor: 18000,
  sale_terms: '核對完再送供貨商確認',
}, { idempotencyKey: selectIntentKey });

// 先讓人核對 listing.snapshot；同一次重試保留相同 key／body／version。
await requestSupply(client, listing, { idempotencyKey: supplyIntentKey });
```

| SDK 函式 | 共用 operation ID | 一致性 |
| --- | --- | --- |
| `loadStorefront` | `listCatalog`, `listStores`, `listListings` | 從目前 session 讀取；依 storeId 篩選並排除不屬於已回傳商店的選品 |
| `createStore` | `createStore` | 明確傳入 idempotency key |
| `selectProduct` | `createListing` | 保存 exact offer version；明確傳入 idempotency key |
| `requestSupply` | `requestSupply` | 傳送 listing ID、已審閱 snapshot digest、aggregate version 與相同重試 key |

API 驗證真正的使用者／社群／商店所有權。SDK 的篩選只是避免版面誤混資料，不是新的授權邊界。API 的拒絕、衝突與錯誤原樣交回 caller；SDK 不自動重試或生成新命令身分。版本衝突後重新讀取並讓人確認，新的操作才使用新 key。

供貨量是 snapshot 記錄，沒有庫存保留；`accepted` 是內部供貨演練確認，沒有代表完成正式簽署、QC 或可收款。所有目前顯示金額遵循中央契約的 1/100 單位。

## 後續公開商店

依 [主計畫 §4](https://github.com/FreeTWAI-AI/freedom-platform/blob/main/docs/platform-plan/02-architecture-repositories.md)，要上公開商店，需要先在 Platform 建立 Store 的 SellerParty、單一 buyer-facing seller collection connection、allowed origins 與 catalog selection，再提供限定欄位的 public read／checkout API。瀏覽器只帶 public store ID 與短效 purpose token；付款 secret 和資料庫連線不進模板或 bundle。

本 repo 沒有自行補一個 public endpoint、把私人 catalog 直接發布，或把供貨確認解讀成交易完成。
