import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Link2, RefreshCw, Truck } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';
import { fetchOrderShippingPii, syncOrderTrackingWithCj } from '../services/commerceService';
import type { CjStatusResponse, OrderRecord, OrderShippingPii, ProductItem } from '../types';

interface DropshipViewProps {
  lang: Lang;
  user: User | null;
  orders: OrderRecord[];
  products: ProductItem[];
  onRefreshCatalog: () => Promise<void>;
  onSignIn: () => Promise<void>;
}

export function DropshipView({
  lang,
  user,
  orders,
  products,
  onRefreshCatalog,
  onSignIn,
}: DropshipViewProps) {
  const t = COPY[lang];
  const [cjStatus, setCjStatus] = useState<CjStatusResponse | null>(null);
  const [cjEmail, setCjEmail] = useState('');
  const [cjApiKey, setCjApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectMessage, setConnectMessage] = useState('');
  const [syncingOrderId, setSyncingOrderId] = useState<string | null>(null);
  const [revealedPii, setRevealedPii] = useState<Record<string, OrderShippingPii | null>>({});

  useEffect(() => {
    fetch('/api/cj/status')
      .then((r) => r.json())
      .then((data) => setCjStatus(data as CjStatusResponse))
      .catch(() => {});
  }, []);

  const formatThb = (val: number) =>
    new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(val);

  if (!user) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 max-w-xl mx-auto text-center space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">{t.signInRequiredTitle}</h2>
        <p className="text-sm text-slate-600 leading-relaxed">{t.signInRequiredDesc}</p>
        <button
          type="button"
          onClick={onSignIn}
          className="px-5 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
        >
          {t.signIn}
        </button>
      </div>
    );
  }

  const handleCjConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setConnectMessage('');
    try {
      const res = await fetch('/api/cj/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cjEmail, apiKey: cjApiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'CJ connection failed');
      }
      setCjApiKey('');
      setConnectMessage(
        lang === 'th' ? 'เชื่อมต่อ CJ Dropshipping API สำเร็จ' : 'Connected to CJ Dropshipping API 2.0'
      );
      const statusRes = await fetch('/api/cj/status');
      setCjStatus((await statusRes.json()) as CjStatusResponse);
      await onRefreshCatalog();
    } catch (err) {
      setConnectMessage(err instanceof Error ? err.message : 'Unable to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleSyncTracking = async (order: OrderRecord) => {
    setSyncingOrderId(order.id);
    try {
      await syncOrderTrackingWithCj(order);
    } finally {
      setSyncingOrderId(null);
    }
  };

  const handleTogglePii = async (orderId: string) => {
    if (orderId in revealedPii) {
      setRevealedPii((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      return;
    }
    const pii = await fetchOrderShippingPii(orderId);
    setRevealedPii((prev) => ({ ...prev, [orderId]: pii }));
  };

  return (
    <div className="space-y-10">
      <div className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{t.dropshipTitle}</h1>
        <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">{t.dropshipSubtitle}</p>
      </div>

      {/* CJ Dropshipping API Connector + Catalog Sync Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-slate-700" />
              <h2 className="text-base font-semibold text-slate-900">{t.cjConfigTitle}</h2>
            </div>
            <span className="text-xs font-mono text-emerald-700">
              {cjStatus?.mode === 'live_api' ? 'Live API' : 'Catalog Sync'}
            </span>
          </div>

          <div className="text-xs text-slate-600 space-y-1.5 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <div>Account: <span className="font-mono text-slate-900">{cjStatus?.maskedEmail || 'sync@velacommerce.co'}</span></div>
            <div>Warehouses: <span className="font-mono text-slate-900">{cjStatus?.warehouses?.join(' · ') || 'BKK-LOCAL-01 · CN-SZ-02'}</span></div>
            <p className="pt-1 text-slate-500 leading-relaxed">
              {lang === 'th'
                ? 'ในหน้า CJ App Store ให้เลือกหมวด Others → API (ไม่ต้องเลือกหมวด AI) แล้วสร้าง API Key รูปแบบ CJUserNum@api@... มาวางด้านล่าง'
                : 'In CJ App Store, install Others → API (instead of the AI section), generate your API Key (CJUserNum@api@...), and paste it below.'}
            </p>
          </div>

          <form onSubmit={handleCjConnect} className="space-y-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                {t.cjEmailLabel} ({lang === 'th' ? 'ไม่บังคับ' : 'Optional'})
              </label>
              <input
                type="email"
                value={cjEmail}
                onChange={(e) => setCjEmail(e.target.value)}
                placeholder="merchant@domain.com"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">{t.cjApiKeyLabel}</label>
              <input
                type="password"
                required
                value={cjApiKey}
                onChange={(e) => setCjApiKey(e.target.value)}
                placeholder="CJUserNum@api@xxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>

            {connectMessage && <p className="text-xs text-slate-700">{connectMessage}</p>}

            <button
              type="submit"
              disabled={connecting}
              className="w-full py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {connecting ? t.processing : t.cjConnectBtn}
            </button>
          </form>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">CJ Warehouse Margin Matrix</h2>
            <button
              type="button"
              onClick={onRefreshCatalog}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync SKUs</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-5 font-medium">SKU</th>
                  <th className="py-3 px-5 font-medium">Product</th>
                  <th className="py-3 px-5 font-medium text-right">CJ Cost</th>
                  <th className="py-3 px-5 font-medium text-right">Retail</th>
                  <th className="py-3 px-5 font-medium text-right">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.sku} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5 font-mono text-xs text-slate-900">{p.sku}</td>
                    <td className="py-3 px-5 text-xs text-slate-700 max-w-[220px] truncate">
                      {lang === 'th' ? p.titleTh : p.title}
                    </td>
                    <td className="py-3 px-5 font-mono text-xs text-slate-600 text-right tabular-nums">
                      {formatThb(p.wholesaleCost)}
                    </td>
                    <td className="py-3 px-5 font-mono text-xs font-semibold text-slate-900 text-right tabular-nums">
                      {formatThb(p.retailPrice)}
                    </td>
                    <td className="py-3 px-5 font-mono text-xs text-emerald-700 text-right tabular-nums">
                      {p.stock}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Dropship Order Fulfillment Pipeline */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-slate-700" />
            <h2 className="text-base font-semibold text-slate-900">{t.ordersPipelineTitle}</h2>
          </div>
          <span className="text-xs text-slate-500 tabular-nums">{orders.length} orders</span>
        </div>

        {orders.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            ยังไม่มีคำสั่งซื้อ Dropship เมื่อชำระเงินสำเร็จระบบจะสร้างรหัส CJ Order และเลขพัสดุให้อัตโนมัติ
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {orders.map((order) => {
              const pii = revealedPii[order.id];
              const isRevealed = order.id in revealedPii;

              return (
                <div key={order.id} className="p-6 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-slate-900">{order.orderNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{order.cjOrderId || 'Pending CJ'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{order.shippingCity}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-emerald-700">{order.fulfillmentStatus}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {order.itemTitle} × {order.quantity}
                      </h3>
                      <p className="text-xs font-mono text-slate-500">
                        Tracking: {order.trackingNumber || '—'} · Carrier: {order.carrierName || 'CJ Logistics'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold font-mono text-slate-900 tabular-nums mr-2">
                        {formatThb(order.totalAmount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleTogglePii(order.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap"
                      >
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{isRevealed ? t.hidePiiBtn : t.revealPiiBtn}</span>
                      </button>

                      {order.fulfillmentStatus !== 'delivered' &&
                        order.fulfillmentStatus !== 'cancelled' && (
                          <button
                            type="button"
                            disabled={syncingOrderId === order.id}
                            onClick={() => handleSyncTracking(order)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${syncingOrderId === order.id ? 'animate-spin' : ''}`}
                            />
                            <span>{t.syncTrackingBtn}</span>
                          </button>
                        )}
                    </div>
                  </div>

                  {isRevealed && (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1">
                      {pii ? (
                        <>
                          <div>
                            Recipient: <span className="font-medium text-slate-900">{pii.recipientName}</span> ·{' '}
                            <span className="font-mono">{pii.phone}</span>
                          </div>
                          <div>
                            Address: {pii.addressLine}, {order.shippingCity} {pii.postalCode} ({pii.countryCode})
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-500">ไม่มีสิทธิ์เข้าถึงข้อมูล PII หรือไม่พบข้อมูลจัดส่ง</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
