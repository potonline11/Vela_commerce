import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import type { Lang } from '../i18n';
import type { ProductItem } from '../types';

interface LogoModalProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  products?: ProductItem[];
}

const LIGHT_LOGO_SRC = '/src/assets/images/vela_logo_light_1794903358298.jpg';
const DARK_LOGO_SRC = '/src/assets/images/vela_logo_dark_1794903358546.jpg';

const STORE_PHOTOS = [
  {
    key: 'store-exterior',
    titleTh: 'รูปถ่ายหน้าร้าน Vela Commerce (ภายนอก)',
    titleEn: 'Vela Commerce Flagship Exterior',
    src: '/src/assets/images/store_exterior_signage_1794905201716.jpg',
    filename: 'vela-commerce-store-exterior.png',
  },
  {
    key: 'store-interior',
    titleTh: 'รูปถ่ายโชว์รูมและจุดแพ็กสินค้า (ภายใน)',
    titleEn: 'Vela Commerce Showroom & Studio',
    src: '/src/assets/images/store_interior_showroom_1794905200811.jpg',
    filename: 'vela-commerce-store-interior.png',
  },
  {
    key: 'store-display',
    titleTh: 'มุมจัดแสดงสินค้าภายในร้าน',
    titleEn: 'In-Store Product Display Table',
    src: '/src/assets/images/hero_storefront_showcase_1794899247913.jpg',
    filename: 'vela-commerce-store-display.png',
  },
];

const VELA_VECTOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="48" fill="#FFFFFF"/>
  <path d="M256 64 L160 232 L256 232 Z" fill="none" stroke="#047857" stroke-width="18" stroke-linejoin="round"/>
  <path d="M256 64 L352 232 L256 232" fill="none" stroke="#047857" stroke-width="18" stroke-linejoin="round"/>
  <path d="M148 256 L256 424 L364 256" fill="none" stroke="#0F172A" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M196 256 L256 352 L316 256" fill="none" stroke="#047857" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export async function downloadRasterAsPng(src: string, filename: string): Promise<void> {
  const response = await fetch(src, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error('Failed to load image asset');
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('Unexpected response format (not an image)');
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 1024;
    canvas.height = img.naturalHeight || 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))),
        'image/png',
        1.0
      );
    });

    const pngUrl = URL.createObjectURL(pngBlob);
    const link = document.createElement('a');
    link.href = pngUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(pngUrl), 3000);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function downloadSvgVector(filename: string): void {
  const blob = new Blob([VELA_VECTOR_SVG], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function LogoModal({ open, onClose, lang, products = [] }: LogoModalProps) {
  const [tab, setTab] = useState<'logos' | 'store' | 'products'>('store');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  if (!open) return null;

  const handleDownload = async (key: string, src: string, filename: string) => {
    setBusyKey(key);
    setErrorMsg('');
    try {
      await downloadRasterAsPng(src, filename);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 sm:p-6">
      <div className="w-full max-w-3xl max-h-[90vh] bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {lang === 'th'
                ? 'คลังภาพร้านค้า โลโก้ และสินค้า (Vela Commerce)'
                : 'Vela Commerce Store & Brand Media Kit'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'th'
                ? 'แปลงเป็นไฟล์ .PNG แท้พร้อมใช้งานสำหรับการยืนยันร้านค้า Payment Gateway และอีเมล'
                : 'Exported as genuine lossless .PNG files ready for merchant verification and email attachments.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close media kit"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('store')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'store'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'th' ? 'รูปถ่ายร้านค้า (3)' : 'Store Photos (3)'}
            </button>
            <button
              type="button"
              onClick={() => setTab('products')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'products'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'th'
                ? `ภาพถ่ายสินค้า (${products.length})`
                : `Product Photos (${products.length})`}
            </button>
            <button
              type="button"
              onClick={() => setTab('logos')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'logos'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lang === 'th' ? 'โลโก้ร้าน (2 + SVG)' : 'Store Logos (2 + SVG)'}
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {tab === 'store' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {STORE_PHOTOS.map((item) => (
                <div
                  key={item.key}
                  className="border border-slate-200 rounded-xl overflow-hidden bg-white flex flex-col justify-between"
                >
                  <div className="aspect-video bg-slate-100 overflow-hidden">
                    <img
                      src={item.src}
                      alt={lang === 'th' ? item.titleTh : item.titleEn}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-4 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-800">
                      {lang === 'th' ? item.titleTh : item.titleEn}
                    </span>
                    <button
                      type="button"
                      disabled={busyKey === item.key}
                      onClick={() => handleDownload(item.key, item.src, item.filename)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{busyKey === item.key ? '...' : 'PNG'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'products' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {products.map((p) => {
                const title = lang === 'th' ? p.titleTh : p.title;
                const filename = `${p.sku.toLowerCase()}-product-photo.png`;
                return (
                  <div
                    key={p.sku}
                    className="border border-slate-200 rounded-xl overflow-hidden bg-white flex flex-col justify-between"
                  >
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      <img
                        src={p.imageUrl}
                        alt={title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[11px] font-mono text-slate-500 block">{p.sku}</span>
                        <span className="text-xs font-medium text-slate-800 truncate block">
                          {title}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={busyKey === p.sku}
                        onClick={() => handleDownload(p.sku, p.imageUrl, filename)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{busyKey === p.sku ? '...' : 'PNG'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'logos' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
                  <div className="aspect-square rounded-lg overflow-hidden border border-slate-100 bg-white">
                    <img
                      src={LIGHT_LOGO_SRC}
                      alt="Vela Commerce Light Logo"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">
                      {lang === 'th' ? 'โลโก้พื้นขาว' : 'Light Edition'}
                    </span>
                    <button
                      type="button"
                      disabled={busyKey === 'light'}
                      onClick={() =>
                        handleDownload('light', LIGHT_LOGO_SRC, 'vela-commerce-logo-light.png')
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{busyKey === 'light' ? '...' : 'PNG'}</span>
                    </button>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-900">
                  <div className="aspect-square rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
                    <img
                      src={DARK_LOGO_SRC}
                      alt="Vela Commerce Dark Logo"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-200">
                      {lang === 'th' ? 'โลโก้พื้นเข้ม' : 'Dark Edition'}
                    </span>
                    <button
                      type="button"
                      disabled={busyKey === 'dark'}
                      onClick={() =>
                        handleDownload('dark', DARK_LOGO_SRC, 'vela-commerce-logo-dark.png')
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-white rounded-lg hover:bg-slate-100 disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{busyKey === 'dark' ? '...' : 'PNG'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  {lang === 'th'
                    ? 'สามารถดาวน์โหลดโลโก้แบบ SVG เวกเตอร์เพื่อขยายขนาดไม่จำกัด'
                    : 'Download scalable SVG vector mark for print or storefront signage.'}
                </span>
                <button
                  type="button"
                  onClick={() => downloadSvgVector('vela-commerce-mark.svg')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'ดาวน์โหลด SVG เวกเตอร์' : 'Download SVG Vector'}</span>
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              {errorMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
