import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Archive,
  Clock,
  Gavel,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react';
import type { Lang } from '../i18n';
import {
  archiveMemberListing,
  calculatePlatformFee,
  closeAuctionRecord,
  createAuctionItem,
  createMemberListing,
  placeAuctionBid,
  subscribeAuctionBids,
} from '../services/commerceService';
import type {
  AuctionBidRecord,
  AuctionRecord,
  DirectCheckoutTarget,
  ItemCondition,
  MemberListingRecord,
  MemberProfile,
} from '../types';

const STUDIO_IMAGE_PRESETS = [
  {
    label: 'Artisan Matcha Teaset',
    labelTh: 'ชุดชงมัทฉะเซรามิกแฮนด์เมด',
    url: '/src/assets/images/market_artisan_teaset_1794964576950.jpg',
  },
  {
    label: 'Mechanical Chronograph Watch',
    labelTh: 'นาฬิกาโครโนกราฟสเตนเลสสตีล',
    url: '/src/assets/images/auction_vintage_chronograph_1794964580946.jpg',
  },
  {
    label: '35mm Rangefinder Camera',
    labelTh: 'กล้องฟิล์ม Rangefinder คลาสสิก',
    url: '/src/assets/images/auction_rangefinder_camera_1794964576817.jpg',
  },
  {
    label: 'Manual Espresso Brewer',
    labelTh: 'เครื่องชงเอสเพรสโซ่แรงดันมือ',
    url: '/src/assets/images/product_espresso_brewer_1794899247328.jpg',
  },
  {
    label: 'Spatial ANC Earbuds',
    labelTh: 'หูฟังไร้สาย ANC',
    url: '/src/assets/images/product_wireless_audio_1794899246337.jpg',
  },
];

interface MarketplaceAuctionViewProps {
  lang: Lang;
  user: User | null;
  profile: MemberProfile | null;
  listings: MemberListingRecord[];
  auctions: AuctionRecord[];
  onSignIn: () => Promise<void>;
  onStartDirectCheckout: (target: DirectCheckoutTarget) => void;
}

function StudioImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

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
      onError={() => setFailed(true)}
      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}

function formatCountdown(endsAt: unknown, nowMs: number, lang: Lang): { ended: boolean; text: string } {
  const ts = endsAt as { toMillis?: () => number; seconds?: number } | undefined;
  const endMs = ts?.toMillis?.() ?? (typeof ts?.seconds === 'number' ? ts.seconds * 1000 : 0);
  if (!endMs) return { ended: true, text: lang === 'th' ? 'สิ้นสุดแล้ว' : 'Ended' };
  const diff = endMs - nowMs;
  if (diff <= 0) {
    return { ended: true, text: lang === 'th' ? 'หมดเวลาประมูล' : 'Ended' };
  }
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return { ended: false, text: `${days}d ${pad(hrs)}:${pad(mins)}:${pad(secs)}` };
  }
  return { ended: false, text: `${pad(hrs)}:${pad(mins)}:${pad(secs)}` };
}

export function MarketplaceAuctionView({
  lang,
  user,
  profile,
  listings,
  auctions,
  onSignIn,
  onStartDirectCheckout,
}: MarketplaceAuctionViewProps) {
  const [subTab, setSubTab] = useState<'marketplace' | 'auctions'>('marketplace');
  const [search, setSearch] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Create Modal State
  const [createMode, setCreateMode] = useState<'listing' | 'auction' | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Collectibles');
  const [condition, setCondition] = useState<ItemCondition>('like_new');
  const [imageUrl, setImageUrl] = useState(STUDIO_IMAGE_PRESETS[0].url);
  const [price, setPrice] = useState('2900');
  const [stock, setStock] = useState('1');
  const [minIncrement, setMinIncrement] = useState('100');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [formError, setFormError] = useState('');

  // Bid Detail Modal State
  const [activeAuctionId, setActiveAuctionId] = useState<string | null>(null);
  const [auctionBids, setAuctionBids] = useState<AuctionBidRecord[]>([]);
  const [bidAmount, setBidAmount] = useState('');
  const [bidBusy, setBidBusy] = useState(false);
  const [bidError, setBidError] = useState('');

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const activeAuction = auctions.find((a) => a.id === activeAuctionId) || null;

  useEffect(() => {
    if (!activeAuctionId || !user) {
      setAuctionBids([]);
      return;
    }
    const unsub = subscribeAuctionBids(activeAuctionId, setAuctionBids);
    return () => unsub();
  }, [activeAuctionId, user]);

  useEffect(() => {
    if (activeAuction) {
      const nextMin =
        activeAuction.bidCount === 0
          ? activeAuction.startingPrice
          : activeAuction.currentBid + activeAuction.minBidIncrement;
      setBidAmount(String(nextMin));
      setBidError('');
    }
  }, [activeAuction?.id, activeAuction?.currentBid, activeAuction?.bidCount]);

  const formatThb = (val: number) =>
    new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      maximumFractionDigits: 0,
    }).format(val);

  const conditionLabel = (cond: ItemCondition) => {
    if (cond === 'new') return lang === 'th' ? 'มือหนึ่ง' : 'Brand New';
    if (cond === 'like_new') return lang === 'th' ? 'สภาพเหมือนใหม่' : 'Like New';
    return lang === 'th' ? 'มือสอง' : 'Pre-Owned';
  };

  const openCreateModal = (mode: 'listing' | 'auction') => {
    setFormError('');
    setCreateMode(mode);
    setImageUrl(mode === 'auction' ? STUDIO_IMAGE_PRESETS[1].url : STUDIO_IMAGE_PRESETS[0].url);
    setTitle('');
    setDescription('');
    setPrice(mode === 'auction' ? '3500' : '1890');
    setStock('1');
    setMinIncrement('100');
    setDurationMinutes('60');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !createMode) return;
    setFormError('');
    setSubmittingCreate(true);

    try {
      if (createMode === 'listing') {
        await createMemberListing(user, profile, {
          title,
          description,
          category,
          condition,
          imageUrl,
          price: Number(price),
          stock: Number(stock),
        });
        setSubTab('marketplace');
      } else {
        await createAuctionItem(user, profile, {
          title,
          description,
          category,
          condition,
          imageUrl,
          startingPrice: Number(price),
          minBidIncrement: Number(minIncrement),
          durationMinutes: Number(durationMinutes),
        });
        setSubTab('auctions');
      }
      setCreateMode(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to publish item');
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handlePlaceBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !activeAuction) return;
    setBidError('');
    setBidBusy(true);
    try {
      await placeAuctionBid(user, profile, activeAuction, Number(bidAmount));
    } catch (err) {
      setBidError(err instanceof Error ? err.message : 'Unable to place bid');
    } finally {
      setBidBusy(false);
    }
  };

  const previewNumericPrice = Math.max(0, Number(price) || 0);
  const { feeAmount: previewFee, sellerNetAmount: previewNet } =
    calculatePlatformFee(previewNumericPrice);

  const q = search.trim().toLowerCase();
  const visibleListings = listings.filter((item) => {
    const isVisible = item.status === 'active' || (user && item.sellerUid === user.uid);
    const matchesQ =
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.sellerName.toLowerCase().includes(q);
    return isVisible && matchesQ;
  });

  const visibleAuctions = auctions.filter((auc) => {
    const matchesQ =
      !q ||
      auc.title.toLowerCase().includes(q) ||
      auc.category.toLowerCase().includes(q) ||
      auc.sellerName.toLowerCase().includes(q);
    return matchesQ;
  });

  return (
    <div className="space-y-10">
      {/* Header + 5% Fee Summary */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-slate-200 pb-6">
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">
            {lang === 'th'
              ? 'ตลาดซื้อขายสมาชิก (ค่าธรรมเนียม 5%) · ห้องประมูลสด (ค่าธรรมเนียม 5%)'
              : 'Member Marketplace (5% Fee) · Live Timed Auctions (5% Fee)'}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight text-balance">
            {lang === 'th'
              ? 'ลงขายสินค้าสมาชิก & ประมูลสินค้าออนไลน์'
              : 'Member Marketplace & Live Auctions'}
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            {lang === 'th'
              ? 'สมาชิกสามารถนำสินค้าของตัวเองมาลงขายหรือเปิดประมูลได้ทันที แพลตฟอร์มเก็บค่าธรรมเนียม 5% จากยอดขายหรือยอดประมูลที่ชนะ และโอนสุทธิ 95% เข้ากระเป๋าเงินผู้ขายอัตโนมัติ'
              : 'Members can list personal goods for direct sale or run timed auctions. A flat 5% platform fee applies upon settlement, crediting 95% net proceeds directly to the seller wallet.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => (user ? openCreateModal('listing') : onSignIn())}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{lang === 'th' ? 'ลงขายสินค้า (ค่าธรรมเนียม 5%)' : 'List Item (5% Fee)'}</span>
          </button>
          <button
            type="button"
            onClick={() => (user ? openCreateModal('auction') : onSignIn())}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-900 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Gavel className="w-3.5 h-3.5" />
            <span>{lang === 'th' ? 'เปิดประมูลสินค้า (ค่าธรรมเนียม 5%)' : 'Start Auction (5% Fee)'}</span>
          </button>
        </div>
      </div>

      {/* Mode Switch & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setSubTab('marketplace')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'marketplace'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>
              {lang === 'th'
                ? `ตลาดสมาชิก (${visibleListings.length})`
                : `Marketplace (${visibleListings.length})`}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('auctions')}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'auctions'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Gavel className="w-3.5 h-3.5" />
            <span>
              {lang === 'th'
                ? `ห้องประมูล (${visibleAuctions.length})`
                : `Live Auctions (${visibleAuctions.length})`}
            </span>
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              lang === 'th' ? 'ค้นหาสินค้า หมวดหมู่ หรือชื่อผู้ขาย...' : 'Search item, category, or seller...'
            }
            className="w-full sm:w-72 pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      </div>

      {/* Sub-view 1: Shopee-Style Member Marketplace (5% Fee) */}
      {subTab === 'marketplace' && (
        <>
          {visibleListings.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
              <p className="text-sm text-slate-600">
                {lang === 'th'
                  ? 'ยังไม่มีสินค้าจากสมาชิกในหมวดนี้ เริ่มลงขายสินค้าของคุณได้ทันทีโดยเสียค่าธรรมเนียมเพียง 5% เมื่อขายได้'
                  : 'No member listings yet. Publish your own product with a flat 5% platform fee upon sale.'}
              </p>
              <button
                type="button"
                onClick={() => (user ? openCreateModal('listing') : onSignIn())}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {user
                    ? lang === 'th'
                      ? 'ลงขายสินค้าชิ้นแรก'
                      : 'Create First Listing'
                    : lang === 'th'
                    ? 'เข้าสู่ระบบเพื่อลงขายสินค้า'
                    : 'Sign In to List an Item'}
                </span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {visibleListings.map((item) => {
                const isOwn = user?.uid === item.sellerUid;
                const { feeAmount, sellerNetAmount } = calculatePlatformFee(item.price);

                return (
                  <article
                    key={item.id}
                    className="group bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <div>
                      <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                        <StudioImage src={item.imageUrl} alt={item.title} />
                      </div>
                      <div className="p-6 space-y-3">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>{item.category}</span>
                          <span aria-hidden="true">·</span>
                          <span>{conditionLabel(item.condition)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.sellerName}</span>
                        </div>

                        <h3 className="text-base font-semibold text-slate-900 leading-snug">
                          {item.title}
                        </h3>

                        <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">
                          {item.description}
                        </p>
                      </div>
                    </div>

                    <div className="px-6 pb-6 pt-4 border-t border-slate-100 space-y-4">
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-slate-500 block">
                            {lang === 'th' ? 'ค่าแพลตฟอร์ม 5%' : '5% Fee'}
                          </span>
                          <span className="font-mono font-medium text-slate-700 tabular-nums">
                            {formatThb(feeAmount)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">
                            {lang === 'th' ? 'ผู้ขายรับสุทธิ 95%' : 'Seller Net'}
                          </span>
                          <span className="font-mono font-medium text-emerald-700 tabular-nums">
                            {formatThb(sellerNetAmount)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500 block">
                            {lang === 'th' ? 'ราคาขาย' : 'Price'}
                          </span>
                          <span className="text-base font-semibold text-slate-900 tabular-nums">
                            {formatThb(item.price)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500 tabular-nums">
                          {item.status === 'archived'
                            ? lang === 'th'
                              ? 'เก็บถาวรแล้ว'
                              : 'Archived'
                            : item.stock <= 0 || item.status === 'sold_out'
                            ? lang === 'th'
                              ? 'สินค้าหมด'
                              : 'Sold Out'
                            : lang === 'th'
                            ? `คงเหลือ ${item.stock} ชิ้น`
                            : `${item.stock} in stock`}
                        </span>

                        {isOwn ? (
                          item.status !== 'archived' && (
                            <button
                              type="button"
                              onClick={() => archiveMemberListing(item.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                            >
                              <Archive className="w-3.5 h-3.5" />
                              <span>{lang === 'th' ? 'เก็บรายการ' : 'Archive'}</span>
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            disabled={item.status !== 'active' || item.stock <= 0}
                            onClick={() =>
                              user
                                ? onStartDirectCheckout({
                                    kind: 'marketplace',
                                    listing: item,
                                    quantity: 1,
                                  })
                                : onSignIn()
                            }
                            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                          >
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>{lang === 'th' ? 'ซื้อทันที' : 'Buy Now'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Sub-view 2: eBay-Style Live Auctions (5% Fee) */}
      {subTab === 'auctions' && (
        <>
          {visibleAuctions.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
              <p className="text-sm text-slate-600">
                {lang === 'th'
                  ? 'ยังไม่มีรายการประมูลที่เปิดอยู่ สมาชิกสามารถเปิดประมูลสินค้าของตัวเองโดยคิดค่าธรรมเนียม 5% จากยอดชนะประมูล'
                  : 'No live auctions yet. Start a timed auction with a 5% fee applied only on the winning bid.'}
              </p>
              <button
                type="button"
                onClick={() => (user ? openCreateModal('auction') : onSignIn())}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <Gavel className="w-4 h-4" />
                <span>
                  {user
                    ? lang === 'th'
                      ? 'เปิดประมูลรายการแรก'
                      : 'Start First Auction'
                    : lang === 'th'
                    ? 'เข้าสู่ระบบเพื่อเปิดประมูล'
                    : 'Sign In to Start Auction'}
                </span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {visibleAuctions.map((auc) => {
                const isSeller = user?.uid === auc.sellerUid;
                const isHighestBidder = Boolean(user && auc.highestBidderUid === user.uid);
                const countdown = formatCountdown(auc.endsAt, nowMs, lang);
                const isSettled = auc.status === 'settled';
                const isCancelled = auc.status === 'cancelled';
                const awaitingWinnerPayment =
                  !isSettled &&
                  !isCancelled &&
                  auc.bidCount > 0 &&
                  (auc.status === 'ended_pending_payment' || countdown.ended);

                const { feeAmount, sellerNetAmount } = calculatePlatformFee(auc.currentBid);

                return (
                  <article
                    key={auc.id}
                    className="group bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <div>
                      <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                        <StudioImage src={auc.imageUrl} alt={auc.title} />
                      </div>
                      <div className="p-6 space-y-3">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate">
                            {auc.category} · {conditionLabel(auc.condition)} · {auc.sellerName}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono font-medium text-slate-900 shrink-0 tabular-nums">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            {isSettled
                              ? lang === 'th'
                                ? 'ชำระแล้ว'
                                : 'Settled'
                              : isCancelled
                              ? lang === 'th'
                                ? 'ยกเลิก'
                                : 'Closed'
                              : countdown.text}
                          </span>
                        </div>

                        <h3 className="text-base font-semibold text-slate-900 leading-snug">
                          {auc.title}
                        </h3>

                        <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">
                          {auc.description}
                        </p>
                      </div>
                    </div>

                    <div className="px-6 pb-6 pt-4 border-t border-slate-100 space-y-4">
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-slate-500 block">
                            {lang === 'th' ? 'ค่าธรรมเนียม 5%' : '5% Fee'}
                          </span>
                          <span className="font-mono font-medium text-slate-700 tabular-nums">
                            {formatThb(feeAmount)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">
                            {lang === 'th' ? 'ผู้ขายรับสุทธิ' : 'Seller Net'}
                          </span>
                          <span className="font-mono font-medium text-emerald-700 tabular-nums">
                            {formatThb(sellerNetAmount)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500 block">
                            {auc.bidCount === 0
                              ? lang === 'th'
                                ? 'ราคาเริ่มต้น'
                                : 'Starting Bid'
                              : lang === 'th'
                              ? 'ราคาสูงสุดล่าสุด'
                              : 'Current Bid'}
                          </span>
                          <span className="text-base font-semibold text-slate-900 tabular-nums">
                            {formatThb(auc.currentBid)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="tabular-nums truncate">
                          {auc.bidCount > 0
                            ? `${auc.bidCount} ${lang === 'th' ? 'บิด' : 'bids'} · ${
                                isHighestBidder
                                  ? lang === 'th'
                                    ? 'คุณนำอยู่'
                                    : 'You lead'
                                  : auc.highestBidderName || 'Bidder'
                              }`
                            : lang === 'th'
                            ? `บิดขั้นต่ำ +${formatThb(auc.minBidIncrement)}`
                            : `Min step +${formatThb(auc.minBidIncrement)}`}
                        </span>

                        {awaitingWinnerPayment && isHighestBidder ? (
                          <button
                            type="button"
                            onClick={() =>
                              onStartDirectCheckout({
                                kind: 'auction',
                                auction: auc,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
                          >
                            <span>{lang === 'th' ? 'ชำระเงินที่ชนะประมูล' : 'Pay Winning Bid'}</span>
                          </button>
                        ) : isSettled ? (
                          <span className="text-xs font-medium text-emerald-700 whitespace-nowrap">
                            {lang === 'th' ? 'ปิดการขายแล้ว' : 'Completed'}
                          </span>
                        ) : isSeller && auc.status === 'live' ? (
                          <button
                            type="button"
                            onClick={() => closeAuctionRecord(auc)}
                            className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                          >
                            {auc.bidCount > 0
                              ? lang === 'th'
                                ? 'ปิดประมูล & ให้ผู้ชนะชำระ'
                                : 'End & Award Winner'
                              : lang === 'th'
                              ? 'ปิดรอบประมูล'
                              : 'Cancel Auction'}
                          </button>
                        ) : !isCancelled && !countdown.ended ? (
                          <button
                            type="button"
                            onClick={() => (user ? setActiveAuctionId(auc.id) : onSignIn())}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                          >
                            <Gavel className="w-3.5 h-3.5" />
                            <span>{lang === 'th' ? 'เสนอราคาประมูล' : 'Place Bid'}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setActiveAuctionId(auc.id)}
                            className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                          >
                            {lang === 'th' ? 'ดูประวัติบิด' : 'Bid History'}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Create Listing / Create Auction Modal */}
      {createMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]">
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {createMode === 'listing'
                    ? lang === 'th'
                      ? 'ลงขายสินค้าสมาชิก (ค่าธรรมเนียม 5%)'
                      : 'Publish Member Listing (5% Fee)'
                    : lang === 'th'
                    ? 'เปิดประมูลสินค้าออนไลน์ (ค่าธรรมเนียม 5%)'
                    : 'Create Timed Auction (5% Fee)'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === 'th'
                    ? 'คำนวณยอดรับสุทธิ 95% อัตโนมัติเมื่อผู้ซื้อชำระเงินผ่าน VelaPayment'
                    : '95% net proceeds credit directly to your member wallet upon settlement.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateMode(null)}
                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  {lang === 'th' ? 'ชื่อสินค้า' : 'Item Title'}
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={140}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    createMode === 'auction'
                      ? 'Vintage Chronograph Mechanical Watch'
                      : 'Handcrafted Celadon Matcha Bowl Set'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  {lang === 'th' ? 'รายละเอียดและสภาพสินค้า' : 'Description'}
                </label>
                <textarea
                  required
                  minLength={4}
                  maxLength={800}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    lang === 'th'
                      ? 'ระบุรายละเอียด อุปกรณ์ครบชุด หรือตำหนิให้ชัดเจน'
                      : 'Include condition notes, included accessories, and shipping details.'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    {lang === 'th' ? 'หมวดหมู่' : 'Category'}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="Collectibles">Collectibles</option>
                    <option value="Watches & Jewellery">Watches & Jewellery</option>
                    <option value="Cameras & Audio">Cameras & Audio</option>
                    <option value="Home & Craft">Home & Craft</option>
                    <option value="Lifestyle Tech">Lifestyle Tech</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    {lang === 'th' ? 'สภาพสินค้า' : 'Condition'}
                  </label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as ItemCondition)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="new">{lang === 'th' ? 'มือหนึ่ง (New)' : 'Brand New'}</option>
                    <option value="like_new">{lang === 'th' ? 'เหมือนใหม่ (Like New)' : 'Like New'}</option>
                    <option value="used">{lang === 'th' ? 'มือสอง (Pre-Owned)' : 'Pre-Owned'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">
                  {lang === 'th' ? 'เลือกภาพถ่ายสินค้า (สตูดิโอของร้าน หรือใส่ URL)' : 'Product Photography'}
                </label>
                <div className="grid grid-cols-5 gap-2 mb-2">
                  {STUDIO_IMAGE_PRESETS.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setImageUrl(preset.url)}
                      className={`aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all ${
                        imageUrl === preset.url
                          ? 'border-slate-900 ring-2 ring-slate-900/20'
                          : 'border-slate-200 opacity-75 hover:opacity-100'
                      }`}
                      title={lang === 'th' ? preset.labelTh : preset.label}
                    >
                      <img
                        src={preset.url}
                        alt={preset.label}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  required
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg text-slate-600"
                />
              </div>

              {createMode === 'listing' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      {lang === 'th' ? 'ราคาขาย (บาท · ขั้นต่ำ ฿10)' : 'Selling Price (THB)'}
                    </label>
                    <input
                      type="number"
                      required
                      min={10}
                      step="1"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      {lang === 'th' ? 'จำนวนสต็อก (ชิ้น)' : 'Stock Quantity'}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={10000}
                      value={stock}
                      onChange={(e) => setStock(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      {lang === 'th' ? 'ราคาเริ่มต้น (บาท)' : 'Starting Bid (THB)'}
                    </label>
                    <input
                      type="number"
                      required
                      min={10}
                      step="1"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      {lang === 'th' ? 'เพิ่มบิดขั้นต่ำ (บาท)' : 'Min Increment'}
                    </label>
                    <input
                      type="number"
                      required
                      min={10}
                      step="10"
                      value={minIncrement}
                      onChange={(e) => setMinIncrement(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      {lang === 'th' ? 'ระยะเวลาประมูล' : 'Duration'}
                    </label>
                    <select
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="5">{lang === 'th' ? '5 นาที (ทดสอบเร็ว)' : '5 minutes'}</option>
                      <option value="60">{lang === 'th' ? '1 ชั่วโมง' : '1 hour'}</option>
                      <option value="1440">{lang === 'th' ? '24 ชั่วโมง' : '24 hours'}</option>
                      <option value="4320">{lang === 'th' ? '3 วัน' : '3 days'}</option>
                      <option value="10080">{lang === 'th' ? '7 วัน' : '7 days'}</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Live 5% Fee Calculator */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">
                    {createMode === 'auction'
                      ? lang === 'th'
                        ? 'ฐานราคาเริ่มต้น'
                        : 'Base Amount'
                      : lang === 'th'
                      ? 'ราคาตั้งขาย'
                      : 'Gross Price'}
                  </span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatThb(previewNumericPrice)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">
                    {lang === 'th' ? 'ค่าธรรมเนียม 5%' : 'Platform Fee (5%)'}
                  </span>
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    -{formatThb(previewFee)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block">
                    {lang === 'th' ? 'รับสุทธิ 95%' : 'Seller Net (95%)'}
                  </span>
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                    {formatThb(previewNet)}
                  </span>
                </div>
              </div>

              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateMode(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {submittingCreate
                    ? lang === 'th'
                      ? 'กำลังบันทึก...'
                      : 'Publishing...'
                    : createMode === 'listing'
                    ? lang === 'th'
                      ? 'ลงขายสินค้าทันที'
                      : 'Publish Listing'
                    : lang === 'th'
                    ? 'เปิดรอบประมูลทันที'
                    : 'Launch Auction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Auction Bid Room Modal */}
      {activeAuction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto space-y-6">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <p className="text-xs text-slate-500">
                  {activeAuction.category} · {activeAuction.sellerName} ·{' '}
                  {formatCountdown(activeAuction.endsAt, nowMs, lang).text}
                </p>
                <h2 className="text-lg font-semibold text-slate-900 mt-1">
                  {activeAuction.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveAuctionId(null)}
                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-start">
              <div className="sm:col-span-5 aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                <StudioImage src={activeAuction.imageUrl} alt={activeAuction.title} />
              </div>

              <div className="sm:col-span-7 space-y-4">
                <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">
                      {lang === 'th' ? 'ราคาประมูลปัจจุบัน' : 'Current Highest Bid'}
                    </span>
                    <span className="text-xl font-semibold text-slate-900 tabular-nums">
                      {formatThb(activeAuction.currentBid)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 block">
                      {lang === 'th' ? 'ผู้นำล่าสุด' : 'Highest Bidder'}
                    </span>
                    <span className="text-sm font-medium text-slate-900 block truncate">
                      {activeAuction.bidCount > 0
                        ? activeAuction.highestBidderName || 'Bidder'
                        : lang === 'th'
                        ? 'ยังไม่มีผู้บิด'
                        : 'No bids yet'}
                    </span>
                  </div>
                </div>

                {activeAuction.status === 'live' &&
                  !formatCountdown(activeAuction.endsAt, nowMs, lang).ended &&
                  user &&
                  user.uid !== activeAuction.sellerUid && (
                    <form onSubmit={handlePlaceBid} className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700 block mb-1">
                          {lang === 'th'
                            ? `ใส่ราคาประมูล (ขั้นต่ำ ${formatThb(
                                activeAuction.bidCount === 0
                                  ? activeAuction.startingPrice
                                  : activeAuction.currentBid + activeAuction.minBidIncrement
                              )})`
                            : `Your Bid (Min ${formatThb(
                                activeAuction.bidCount === 0
                                  ? activeAuction.startingPrice
                                  : activeAuction.currentBid + activeAuction.minBidIncrement
                              )})`}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            required
                            min={
                              activeAuction.bidCount === 0
                                ? activeAuction.startingPrice
                                : activeAuction.currentBid + activeAuction.minBidIncrement
                            }
                            step="1"
                            value={bidAmount}
                            onChange={(e) => setBidAmount(e.target.value)}
                            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setBidAmount(
                                String(
                                  (Number(bidAmount) || activeAuction.currentBid) +
                                    activeAuction.minBidIncrement
                                )
                              )
                            }
                            className="px-3 py-2 text-xs font-mono font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg whitespace-nowrap"
                          >
                            +{formatThb(activeAuction.minBidIncrement)}
                          </button>
                        </div>
                      </div>

                      {bidError && (
                        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                          {bidError}
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={bidBusy}
                        className="w-full py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                      >
                        {bidBusy
                          ? lang === 'th'
                            ? 'กำลังส่งราคาประมูล...'
                            : 'Submitting Bid...'
                          : lang === 'th'
                          ? `ยืนยันเสนอราคา ${formatThb(Number(bidAmount) || 0)}`
                          : `Place Bid ${formatThb(Number(bidAmount) || 0)}`}
                      </button>
                      <p className="text-[11px] text-slate-500">
                        {lang === 'th'
                          ? 'หมายเหตุ: เมื่อชนะการประมูล ผู้ชนะชำระยอดประมูลผ่าน VelaPayment และหักค่าธรรมเนียมแพลตฟอร์ม 5% เหมือน eBay'
                          : 'Winner settles the final bid via VelaPayment with a 5% platform fee.'}
                      </p>
                    </form>
                  )}
              </div>
            </div>

            {/* Immutable Subcollection Bid Ledger */}
            <div className="border-t border-slate-200 pt-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <h3 className="font-semibold text-slate-900">
                  {lang === 'th' ? 'ประวัติการเสนอราคาล่าสุด' : 'Live Bid Ledger'}
                </h3>
                <span className="text-slate-500 tabular-nums">{auctionBids.length} entries</span>
              </div>

              {auctionBids.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  {lang === 'th'
                    ? 'ยังไม่มีผู้เสนอราคา เป็นคนแรกที่เปิดบิดได้เลย'
                    : 'No bids recorded yet.'}
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-48 overflow-y-auto">
                  {auctionBids.map((b, idx) => (
                    <div
                      key={b.id}
                      className="px-4 py-2.5 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">#{auctionBids.length - idx}</span>
                        <span className="font-medium text-slate-900">{b.bidderName}</span>
                      </div>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatThb(b.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
