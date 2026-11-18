import React, { useState } from 'react';
import { ArrowRight, Package, Search, ShoppingBag } from 'lucide-react';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';
import type { ProductItem } from '../types';

interface StorefrontViewProps {
  lang: Lang;
  products: ProductItem[];
  loadingProducts: boolean;
  cjSource?: string;
  usdToThbRate?: number;
  onSearchCatalog?: (query?: string) => void;
  onAddToCart: (product: ProductItem) => void;
  onNavigateDashboard: () => void;
  onOpenMediaKit: () => void;
}

function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed || !src) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center p-6 text-slate-500">
        <Package className="w-8 h-8 mb-2 stroke-[1.5]" />
        <span className="text-xs font-medium text-center line-clamp-2">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}

export function StorefrontView({
  lang,
  products,
  loadingProducts,
  cjSource = 'catalog_sync',
  usdToThbRate = 34.5,
  onSearchCatalog,
  onAddToCart,
  onNavigateDashboard,
  onOpenMediaKit,
}: StorefrontViewProps) {
  const t = COPY[lang];
  const [search, setSearch] = useState('');
  const [activeRemoteQuery, setActiveRemoteQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [heroError, setHeroError] = useState(false);

  const handleRemoteSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = search.trim();
    setCategory('All');
    setActiveRemoteQuery(trimmed);
    onSearchCatalog?.(trimmed);
  };

  const handleResetFilters = () => {
    setSearch('');
    setCategory('All');
    if (activeRemoteQuery) {
      setActiveRemoteQuery('');
      onSearchCatalog?.('');
    }
  };

  const categories = ['All', ...Array.from(new Set(products.map((p) => p.category)))];

  const filtered = products.filter((p) => {
    const matchesCat = category === 'All' || p.category === category;
    const q = search.trim().toLowerCase();
    const isRemoteMatch = activeRemoteQuery.trim().toLowerCase() === q && q.length > 0;
    const matchesQ =
      !q ||
      isRemoteMatch ||
      p.title.toLowerCase().includes(q) ||
      p.titleTh.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q);
    return matchesCat && matchesQ;
  });

  const formatThb = (val: number) =>
    new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(val);

  return (
    <div className="space-y-16">
      {/* Hero Split Showcase */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-8 lg:p-10 flex flex-col justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 tracking-wide mb-4">
              {t.heroKicker}
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900 tracking-tight leading-tight text-balance mb-5">
              {t.heroTitle}
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-xl mb-8">
              {t.heroSubtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-200">
            <a
              href="#catalog"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <span>{t.heroPrimaryCta}</span>
              <ArrowRight className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={onNavigateDashboard}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              {t.heroSecondaryCta}
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 min-h-[300px]">
          {!heroError ? (
            <img
              src="/src/assets/images/hero_storefront_showcase_1794899247913.jpg"
              alt="Vela Commerce curated home hardware showcase"
              referrerPolicy="no-referrer"
              onError={() => setHeroError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-8 text-slate-500 text-sm">
              Vela Commerce Curated Collection
            </div>
          )}
        </div>
      </section>

      {/* 4-Column Architectural Value Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="text-xl font-semibold text-slate-900 tabular-nums mb-1.5">{t.kpiTierPool}</div>
          <p className="text-sm text-slate-600 leading-relaxed">{t.kpiTierLabel}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="text-xl font-semibold text-slate-900 font-mono mb-1.5">{t.kpiSecurity}</div>
          <p className="text-sm text-slate-600 leading-relaxed">{t.kpiSecurityLabel}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="text-xl font-semibold text-slate-900 font-mono mb-1.5">{t.kpiCjSync}</div>
          <p className="text-sm text-slate-600 leading-relaxed">{t.kpiCjLabel}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="text-xl font-semibold text-slate-900 mb-1.5">{t.kpiPii}</div>
          <p className="text-sm text-slate-600 leading-relaxed">{t.kpiPiiLabel}</p>
        </div>
      </section>

      {/* Catalog Section */}
      <section id="catalog" className="space-y-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 tracking-tight text-balance">
              {t.catalogTitle}
            </h2>
            <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">{t.catalogSubtitle}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
              <span
                className={`font-medium ${
                  cjSource === 'live_api' ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {cjSource === 'live_api'
                  ? lang === 'th'
                    ? 'ซิงค์คลังสินค้าจริง CJ Dropshipping API 2.0'
                    : 'Live CJ Dropshipping API 2.0 Connected'
                  : lang === 'th'
                  ? 'โหมด Catalog Sync (ใส่ CJ_API_KEY ในระบบแอดมิน/Vercel เพื่อดึงสินค้าจริง)'
                  : 'Catalog Sync Mode (Connect CJ_API_KEY in Admin / Vercel for live items)'}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                |
              </span>
              <span className="font-mono text-slate-600 tabular-nums">
                1 USD = ฿{usdToThbRate.toFixed(2)} · Markup +30%
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <form onSubmit={handleRemoteSearchSubmit} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="w-full sm:w-64 pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={loadingProducts}
                className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {lang === 'th' ? 'ค้นหาจาก CJ' : 'Search CJ'}
              </button>
            </form>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    category === cat
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat === 'All' ? t.allCategories : cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadingProducts ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3].map((idx) => (
              <div key={idx} className="bg-white border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-slate-200" />
                <div className="p-6 space-y-3">
                  <div className="h-3 w-1/2 bg-slate-200 rounded" />
                  <div className="h-5 w-3/4 bg-slate-200 rounded" />
                  <div className="h-4 w-full bg-slate-200 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-sm text-slate-600 mb-4">
              {lang === 'th' ? 'ไม่พบสินค้าที่ตรงกับคำค้นหาในรายการปัจจุบัน' : 'No matching products in current list'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {search.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = search.trim();
                    setCategory('All');
                    setActiveRemoteQuery(trimmed);
                    onSearchCatalog?.(trimmed);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  {lang === 'th' ? `ค้นหา "${search.trim()}" จากคลัง CJ จริง` : `Search "${search.trim()}" on CJ`}
                </button>
              )}
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-4 py-2 text-sm font-medium text-slate-900 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Reset Filters
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filtered.map((product) => {
              const title = lang === 'th' ? product.titleTh : product.title;
              const desc = lang === 'th' ? product.descriptionTh : product.description;
              const poolAmount = Math.round(product.retailPrice * product.commissionPoolRate);

              return (
                <article
                  key={product.sku}
                  className="group bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <div>
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      <ProductImage src={product.imageUrl} alt={title} />
                    </div>

                    <div className="p-6 space-y-3">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{product.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{product.sku}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{product.warehouse}</span>
                      </div>

                      <h3 className="text-base font-semibold text-slate-900 leading-snug">
                        {title}
                      </h3>

                      <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">
                        {desc}
                      </p>
                    </div>
                  </div>

                  <div className="px-6 pb-6 pt-4 border-t border-slate-100 space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500 block">{t.wholesaleLabel}</span>
                        <span className="font-mono font-medium text-slate-700 tabular-nums">
                          {formatThb(product.wholesaleCost)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">{t.poolLabel}</span>
                        <span className="font-mono font-medium text-emerald-700 tabular-nums">
                          +{formatThb(poolAmount)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500 block">{t.retailLabel}</span>
                        <span className="text-base font-semibold text-slate-900 tabular-nums">
                          {formatThb(product.retailPrice)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-500 tabular-nums">
                        {t.inStock} · {product.stock}
                      </span>
                      <button
                        type="button"
                        onClick={() => onAddToCart(product)}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span>{t.addToCart}</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Flagship Store & Fulfillment Showroom */}
      <section className="space-y-6 pt-4 border-t border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">
              {lang === 'th' ? 'หน้าร้านและโชว์รูม Vela Commerce' : 'Vela Commerce Flagship Showroom'}
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {lang === 'th'
                ? 'สุขุมวิท · กรุงเทพมหานคร — ศูนย์จัดแสดงสินค้าและตรวจสอบคุณภาพก่อนส่งมอบ'
                : 'Sukhumvit, Bangkok — Retail showroom and automated fulfillment verification hub.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenMediaKit}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            {lang === 'th' ? 'ดาวน์โหลดรูปถ่ายร้านค้าและสินค้า (PNG)' : 'Download Store & Product Photos (PNG)'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="aspect-video bg-slate-100 overflow-hidden">
              <img
                src="/src/assets/images/store_exterior_signage_1794905201716.jpg"
                alt="Vela Commerce Flagship Storefront Exterior"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-5 flex items-center justify-between text-xs text-slate-600">
              <span className="font-medium text-slate-900">
                {lang === 'th' ? 'ภาพถ่ายหน้าร้านพร้อมป้ายแบรนด์' : 'Flagship Exterior Signage'}
              </span>
              <span className="font-mono">Phrom Phong · BKK</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="aspect-video bg-slate-100 overflow-hidden">
              <img
                src="/src/assets/images/store_interior_showroom_1794905200811.jpg"
                alt="Vela Commerce Showroom Interior and Fulfillment Desk"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-5 flex items-center justify-between text-xs text-slate-600">
              <span className="font-medium text-slate-900">
                {lang === 'th' ? 'โซนโชว์รูมสินค้าและจุดแพ็กจัดส่ง' : 'Showroom & Packaging Desk'}
              </span>
              <span className="font-mono">Open 10:00 – 20:00</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
