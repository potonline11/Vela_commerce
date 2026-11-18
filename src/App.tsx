import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Globe, LogIn, LogOut, ShieldCheck, ShoppingBag, User as UserIcon } from 'lucide-react';
import { auth } from './firebase';
import { COPY, type Lang } from './i18n';
import {
  checkIsAdminUser,
  commitAtomicCheckout,
  commitMarketplaceOrAuctionCheckout,
  ensureMemberProfile,
  sendOrderConfirmationEmail,
  signOutUser,
  subscribeAuctions,
  subscribeMemberListings,
  subscribeMyCommissions,
  subscribeMyOrders,
  subscribeMyPayoutRequests,
  subscribeMyPrivateInfo,
  subscribeMyProfile,
  subscribeNetworkMembers,
  subscribeSecurityLogs,
} from './services/commerceService';
import { StorefrontView } from './components/StorefrontView';
import { MarketplaceAuctionView } from './components/MarketplaceAuctionView';
import { DashboardView } from './components/DashboardView';
import { NetworkView } from './components/NetworkView';
import { DropshipView } from './components/DropshipView';
import { AdminView } from './components/AdminView';
import { AuthModal, type AuthModalMode } from './components/AuthModal';
import { CURATED_CJ_CATALOG } from './data/curatedCatalog';
import {
  CheckoutDrawer,
  type CheckoutReceiptData,
  type PendingVelaCheckout,
} from './components/CheckoutDrawer';
import { LogoModal } from './components/LogoModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import type {
  AuctionRecord,
  CartItem,
  CommissionRecord,
  DirectCheckoutTarget,
  MemberListingRecord,
  MemberPrivateInfo,
  MemberProfile,
  OrderRecord,
  PayoutRequestRecord,
  ProductItem,
  SecurityLogRecord,
} from './types';

type ActiveTab = 'storefront' | 'market' | 'dashboard' | 'network' | 'dropship';
type WorkspaceMode = 'member' | 'admin';

function AppShell() {
  const [lang, setLang] = useState<Lang>('th');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('member');
  const [adminInitialSection, setAdminInitialSection] = useState<'overview' | 'system_cj'>('overview');
  const [activeTab, setActiveTab] = useState<ActiveTab>('storefront');
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const [products, setProducts] = useState<ProductItem[]>(CURATED_CJ_CATALOG);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [usdToThbRate, setUsdToThbRate] = useState<number>(34.5);
  const [markupPercent, setMarkupPercent] = useState<number>(80);
  const [memberListings, setMemberListings] = useState<MemberListingRecord[]>([]);
  const [auctions, setAuctions] = useState<AuctionRecord[]>([]);

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<MemberPrivateInfo | null>(null);
  const [networkMembers, setNetworkMembers] = useState<MemberProfile[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequestRecord[]>([]);
  const [securityLogs, setSecurityLogs] = useState<SecurityLogRecord[]>([]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [directTarget, setDirectTarget] = useState<DirectCheckoutTarget | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoModalOpen, setLogoModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('login');
  const [authInitialEmail, setAuthInitialEmail] = useState('');
  const [capturedRefCode, setCapturedRefCode] = useState('');
  const [verifyingCallback, setVerifyingCallback] = useState(false);
  const [callbackNotice, setCallbackNotice] = useState('');
  const [externalReceipt, setExternalReceipt] = useState<CheckoutReceiptData | null>(null);
  const [handledCallbackIntent, setHandledCallbackIntent] = useState<string | null>(null);

  const t = COPY[lang];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refParam = params.get('ref');
    if (refParam && refParam.trim().length >= 4) {
      const cleanRef = refParam.trim().toUpperCase();
      setCapturedRefCode(cleanRef);
      localStorage.setItem('vela_ref_code', cleanRef);
    } else {
      const savedRef = localStorage.getItem('vela_ref_code');
      if (savedRef) setCapturedRefCode(savedRef);
    }

    const authParam = params.get('auth');
    if (authParam === 'reset' || authParam === 'login' || authParam === 'register') {
      setAuthModalMode(authParam);
      setAuthModalOpen(true);
    }
  }, []);

  const loadCatalog = useCallback(async (searchQuery?: string) => {
    setLoadingProducts(true);
    try {
      const cleanQ = typeof searchQuery === 'string' ? searchQuery.trim() : '';
      const url = cleanQ ? `/api/cj/products?q=${encodeURIComponent(cleanQ)}` : '/api/cj/products';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        usdToThbRate?: number;
        markupPercent?: number;
        products?: ProductItem[];
      };
      if (typeof data.usdToThbRate === 'number' && Number.isFinite(data.usdToThbRate)) {
        setUsdToThbRate(data.usdToThbRate);
      }
      if (typeof data.markupPercent === 'number' && Number.isFinite(data.markupPercent)) {
        setMarkupPercent(data.markupPercent);
      }
      if (Array.isArray(data.products)) {
        if (data.products.length > 0 || cleanQ) {
          setProducts(data.products);
        }
      }
    } catch {
      // Keep CURATED_CJ_CATALOG fallback visible
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        await ensureMemberProfile(nextUser, localStorage.getItem('vela_ref_code') || undefined);
        const adminStatus = await checkIsAdminUser(nextUser);
        setIsAdmin(adminStatus);
        if (!adminStatus) {
          setWorkspaceMode('member');
        }
      } else {
        setIsAdmin(false);
        setWorkspaceMode('member');
        setProfile(null);
        setPrivateInfo(null);
        setNetworkMembers([]);
        setMembersLoaded(false);
        setOrders([]);
        setCommissions([]);
        setPayouts([]);
        setSecurityLogs([]);
      }
    });
    return () => unsub();
  }, []);

  // Public + Seller/Admin-Scoped Subscriptions for Member Marketplace & Live Auctions
  useEffect(() => {
    const unsubListings = subscribeMemberListings(user?.uid || null, isAdmin, setMemberListings);
    const unsubAuctions = subscribeAuctions(user?.uid || null, isAdmin, setAuctions);
    return () => {
      unsubListings();
      unsubAuctions();
    };
  }, [user?.uid, isAdmin]);

  useEffect(() => {
    if (!authReady || !user) return;

    const unsubs = [
      subscribeMyProfile(user.uid, setProfile),
      subscribeMyPrivateInfo(user.uid, setPrivateInfo),
      subscribeNetworkMembers(isAdmin, (members) => {
        setNetworkMembers(members);
        setMembersLoaded(true);
      }),
      subscribeMyOrders(user.uid, isAdmin, setOrders),
      subscribeMyCommissions(user.uid, isAdmin, setCommissions),
      subscribeMyPayoutRequests(user.uid, isAdmin, setPayouts),
      subscribeSecurityLogs(user.uid, isAdmin, setSecurityLogs),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, user, isAdmin]);

  // Verify VelaPayment redirect callback (?intentId=...&orderId=...&status=succeeded or ?payment=cancelled)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentFlag = params.get('payment');
    const intentId = params.get('intentId');
    const orderIdParam = params.get('orderId');

    if (paymentFlag === 'cancelled') {
      setCallbackNotice(
        lang === 'th'
          ? 'รายการชำระเงินถูกยกเลิก ท่านสามารถตรวจสอบข้อมูลและกดชำระเงินใหม่อีกครั้งได้'
          : 'Payment was cancelled. You can review your bag and try again.'
      );
      setDrawerOpen(true);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (!intentId || handledCallbackIntent === intentId) return;
    if (!authReady) {
      setDrawerOpen(true);
      return;
    }
    if (!user) {
      setDrawerOpen(true);
      setAuthModalMode('login');
      setCallbackNotice(
        lang === 'th'
          ? 'ระบบตรวจพบการชำระเงินกลับมาแล้ว กรุณาเข้าสู่ระบบด้วยอีเมล/รหัสผ่าน หรือ Google เพื่อยืนยันสิทธิ์และบันทึกคำสั่งซื้อเข้าบัญชีของคุณ'
          : 'Returned from VelaPayment. Please sign in to finalize and record your paid order.'
      );
      return;
    }
    if (!profile || !membersLoaded) {
      setDrawerOpen(true);
      return;
    }

    setHandledCallbackIntent(intentId);
    setDrawerOpen(true);
    setVerifyingCallback(true);
    setCallbackNotice('');

    (async () => {
      try {
        const res = await fetch(
          `/api/payments/checkout-sessions/${encodeURIComponent(intentId)}`
        );
        const verifyData = await res.json();

        if (!res.ok || verifyData.paid !== true) {
          throw new Error(
            verifyData.error ||
              (lang === 'th'
                ? `การชำระเงินยังไม่เสร็จสมบูรณ์ (สถานะ: ${verifyData.status || 'pending'})`
                : `Payment not yet confirmed (status: ${verifyData.status || 'pending'})`)
          );
        }

        const rawPending =
          (orderIdParam && localStorage.getItem(`vela_pending_checkout_${orderIdParam}`)) ||
          localStorage.getItem('vela_pending_checkout_latest');

        const pending: PendingVelaCheckout | null = rawPending
          ? (JSON.parse(rawPending) as PendingVelaCheckout)
          : (verifyData.pendingSnapshot as PendingVelaCheckout | null) || null;

        if (!pending) {
          throw new Error(
            lang === 'th'
              ? 'ยืนยันการชำระเงินสำเร็จ แต่ไม่พบข้อมูลรายการสินค้า (กรุณาติดต่อผู้ดูแลระบบพร้อมรหัส ' +
                intentId +
                ')'
              : `Payment confirmed, but checkout snapshot was not found (${intentId}).`
          );
        }
        const normalizedMethod =
          verifyData.paymentMethod === 'card'
            ? 'card'
            : verifyData.paymentMethod === 'wallet'
            ? 'wallet'
            : 'promptpay';
        const maskedSource =
          normalizedMethod === 'card'
            ? 'VelaPayment · Stripe Card'
            : 'VelaPayment · PromptPay QR';

        const targetEmail = pending.customerEmail || user.email || privateInfo?.email || '';
        const targetRefCode = pending.referralCode || profile.referralCode;
        const targetItemSummary = pending.directTarget
          ? pending.directTarget.kind === 'marketplace'
            ? `${pending.directTarget.listing.title} (x${pending.directTarget.quantity})`
            : `Auction Win: ${pending.directTarget.auction.title}`
          : pending.cart.length > 0
          ? `${lang === 'th' ? pending.cart[0].product.titleTh : pending.cart[0].product.title}${
              pending.cart.length > 1 ? ` (+${pending.cart.length - 1})` : ''
            }`
          : `Vela Commerce Order ${pending.orderNumber}`;

        if (
          (pending.checkoutType === 'marketplace' || pending.checkoutType === 'auction') &&
          pending.directTarget
        ) {
          const target = pending.directTarget;
          const result = await commitMarketplaceOrAuctionCheckout({
            mode: target.kind,
            user,
            buyerProfile: profile,
            sellerUid:
              target.kind === 'marketplace'
                ? target.listing.sellerUid
                : target.auction.sellerUid,
            listing: target.kind === 'marketplace' ? target.listing : undefined,
            auction: target.kind === 'auction' ? target.auction : undefined,
            quantity: target.kind === 'marketplace' ? target.quantity : 1,
            unitPrice:
              target.kind === 'marketplace' ? target.listing.price : target.auction.currentBid,
            itemTitle:
              target.kind === 'marketplace' ? target.listing.title : target.auction.title,
            itemSku:
              target.kind === 'marketplace'
                ? `MKT-${target.listing.id.slice(-6).toUpperCase()}`
                : `AUC-${target.auction.id.slice(-6).toUpperCase()}`,
            paymentMethod: normalizedMethod,
            intentCode: intentId,
            hmacSignature: verifyData.hmacSignature || pending.hmacSignature,
            receiptHash: verifyData.receiptHash || verifyData.hmacSignature,
            maskedSource,
            idempotencyKey: pending.idempotencyKey,
            orderId: pending.orderId,
            orderNumber: pending.orderNumber,
            shipping: pending.shipping,
          });
          const emailResult = targetEmail
            ? await sendOrderConfirmationEmail({
                toEmail: targetEmail,
                customerName: pending.shipping.recipientName || profile.displayName,
                orderNumber: result.orderNumber,
                itemSummary: targetItemSummary,
                totalAmount: pending.amount,
                intentId,
                referralCode: targetRefCode,
                temporaryPassword: pending.autoCreatedPassword || null,
              })
            : null;
          setDirectTarget(null);
          setExternalReceipt({
            ...result,
            receiptHash: verifyData.receiptHash || verifyData.hmacSignature,
            intentId,
            emailResult,
          });
        } else {
          const result = await commitAtomicCheckout({
            user,
            buyerProfile: profile,
            allMembers: networkMembers.filter((m) => m.status === 'active'),
            cart: pending.cart,
            paymentMethod: normalizedMethod,
            intentCode: intentId,
            hmacSignature: verifyData.hmacSignature || pending.hmacSignature,
            receiptHash: verifyData.receiptHash || verifyData.hmacSignature,
            maskedSource,
            idempotencyKey: pending.idempotencyKey,
            orderId: pending.orderId,
            orderNumber: pending.orderNumber,
            sponsorReferralCode: pending.sponsorReferralCode,
            shipping: pending.shipping,
          });
          const emailResult = targetEmail
            ? await sendOrderConfirmationEmail({
                toEmail: targetEmail,
                customerName: pending.shipping.recipientName || profile.displayName,
                orderNumber: result.orderNumber,
                itemSummary: targetItemSummary,
                totalAmount: pending.amount,
                intentId,
                referralCode: targetRefCode,
                temporaryPassword: pending.autoCreatedPassword || null,
              })
            : null;
          setCart([]);
          setExternalReceipt({
            ...result,
            receiptHash: verifyData.receiptHash || verifyData.hmacSignature,
            intentId,
            emailResult,
          });
        }

        localStorage.removeItem(`vela_pending_checkout_${pending.orderId}`);
        localStorage.removeItem('vela_pending_checkout_latest');
      } catch (err) {
        setCallbackNotice(
          err instanceof Error ? err.message : 'Unable to verify payment callback'
        );
      } finally {
        setVerifyingCallback(false);
        window.history.replaceState({}, '', window.location.pathname);
      }
    })();
  }, [authReady, user, profile, privateInfo, membersLoaded, networkMembers, handledCallbackIntent, lang]);

  const openAuthModal = (mode: AuthModalMode = 'login', initialEmail = '') => {
    setAuthModalMode(mode);
    setAuthInitialEmail(initialEmail);
    setAuthModalOpen(true);
  };

  const handleSignIn = async () => {
    openAuthModal('login');
  };

  const handleAddToCart = (product: ProductItem) => {
    setDirectTarget(null);
    setCart((prev) => {
      const existing = prev.find((i) => i.product.sku === product.sku);
      if (existing) {
        return prev.map((i) =>
          i.product.sku === product.sku ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    setDrawerOpen(true);
  };

  const handleStartDirectCheckout = (target: DirectCheckoutTarget) => {
    setDirectTarget(target);
    setExternalReceipt(null);
    setDrawerOpen(true);
  };

  const handleUpdateDirectQty = (delta: number) => {
    setDirectTarget((prev) => {
      if (!prev || prev.kind !== 'marketplace') return prev;
      const next = Math.max(1, Math.min(prev.listing.stock, prev.quantity + delta));
      return { ...prev, quantity: next };
    });
  };

  const handleUpdateQty = (sku: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.product.sku === sku ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    );
  };

  const handleRemoveItem = (sku: string) => {
    setCart((prev) => prev.filter((i) => i.product.sku !== sku));
  };

  const totalBagItems = cart.reduce((sum, i) => sum + i.quantity, 0);

  // Cleanly isolate Member-scoped records when viewing Member Workspace (even for Admin user)
  const memberOrders = user
    ? orders.filter((o) => o.buyerUid === user.uid || o.sellerUid === user.uid)
    : [];
  const memberCommissions = user
    ? commissions.filter((c) => c.beneficiaryUid === user.uid)
    : [];
  const memberPayouts = user
    ? payouts.filter((p) => p.memberUid === user.uid)
    : [];
  const activeNetworkMembers = networkMembers.filter((m) => m.status === 'active');

  const navigateMemberTab = (tab: ActiveTab) => {
    setWorkspaceMode('member');
    setActiveTab(tab);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract (1 Brand + Logo, 5 Nav Links, 1 Primary CTA) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1280px] mx-auto px-6 py-3.5 flex items-center justify-between gap-6">
          {/* Zone 1: Brand Logo + Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => navigateMemberTab('storefront')}
            className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            <img
              src="/src/assets/images/vela_logo_light_1794903358298.jpg"
              alt="Vela Commerce Logo"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
            />
            <span>{t.brand}</span>
          </button>

          {/* Zone 2: 5 Clean Single-Line Text Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {(
              [
                ['storefront', t.navStorefront],
                ['market', t.navMarketAuction],
                ['dashboard', t.navDashboard],
                ['network', t.navNetwork],
                ['dropship', t.navDropship],
              ] as const
            ).map(([key, label]) => {
              const isTabActive = workspaceMode === 'member' && activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => navigateMemberTab(key)}
                  className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                    isTabActive
                      ? 'text-slate-900 border-slate-900'
                      : 'text-slate-500 border-transparent hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <button
            type="button"
            onClick={() => {
              setDirectTarget(null);
              setDrawerOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 tabular-nums"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>
              {t.cart} ({totalBagItems})
            </span>
          </button>
        </div>
      </header>

      {/* Workspace Sub-Toolbar (Admin/Member Switch, Account Summary, Mobile Nav & Language) */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1280px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex md:hidden items-center gap-3 overflow-x-auto">
            {(
              [
                ['storefront', t.navStorefront],
                ['market', t.navMarketAuction],
                ['dashboard', t.navDashboard],
                ['network', t.navNetwork],
                ['dropship', t.navDropship],
              ] as const
            ).map(([key, label]) => {
              const isTabActive = workspaceMode === 'member' && activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => navigateMemberTab(key)}
                  className={`px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 ${
                    isTabActive
                      ? 'bg-slate-900 text-white font-medium'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {/* Segmented Switch separating Member Workspace & Admin System Control (only visible to verified Admin) */}
            {isAdmin && (
              <div className="inline-flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setWorkspaceMode('member')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    workspaceMode === 'member'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserIcon className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'ส่วนสมาชิก' : 'Member Workspace'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceMode('admin')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    workspaceMode === 'admin'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'ศูนย์ควบคุม Admin' : 'Admin Console'}</span>
                </button>
              </div>
            )}

            <div className="hidden md:flex items-center gap-2 text-slate-500">
              {user && profile ? (
                <>
                  <span className="font-medium text-slate-900">{profile.displayName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{profile.rank}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{profile.referralCode}</span>
                </>
              ) : (
                <span>Guest Storefront Preview</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <button
              type="button"
              onClick={() => setLang((prev) => (prev === 'th' ? 'en' : 'th'))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{lang === 'th' ? 'EN' : 'TH'}</span>
            </button>

            {user ? (
              <button
                type="button"
                onClick={signOutUser}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t.signOut}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-slate-900 font-medium bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{lang === 'th' ? 'เข้าสู่ระบบ / สมัครสมาชิก' : 'Sign In / Register'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content: Strict Separation Between Admin System Control and Member Workspace */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-10">
        {isAdmin && workspaceMode === 'admin' && user ? (
          <AdminView
            lang={lang}
            user={user}
            initialSection={adminInitialSection}
            allMembers={networkMembers}
            orders={orders}
            commissions={commissions}
            payouts={payouts}
            memberListings={memberListings}
            auctions={auctions}
            products={products}
            usdToThbRate={usdToThbRate}
            markupPercent={markupPercent}
            securityLogs={securityLogs}
            onRefreshCatalog={loadCatalog}
          />
        ) : (
          <>
            {activeTab === 'storefront' && (
              <StorefrontView
                lang={lang}
                products={products}
                loadingProducts={loadingProducts}
                onSearchCatalog={loadCatalog}
                onAddToCart={handleAddToCart}
                onNavigateDashboard={() => navigateMemberTab('dashboard')}
                onOpenMediaKit={() => setLogoModalOpen(true)}
              />
            )}

            {activeTab === 'market' && (
              <MarketplaceAuctionView
                lang={lang}
                user={user}
                profile={profile}
                listings={memberListings}
                auctions={auctions}
                onSignIn={handleSignIn}
                onStartDirectCheckout={handleStartDirectCheckout}
              />
            )}

            {activeTab === 'dashboard' && (
              <DashboardView
                lang={lang}
                user={user}
                profile={profile}
                orders={memberOrders}
                commissions={memberCommissions}
                payouts={memberPayouts}
                onSignIn={handleSignIn}
              />
            )}

            {activeTab === 'network' && (
              <NetworkView
                lang={lang}
                user={user}
                profile={profile}
                allMembers={activeNetworkMembers}
                onSignIn={handleSignIn}
              />
            )}

            {activeTab === 'dropship' && (
              <DropshipView
                lang={lang}
                user={user}
                isAdmin={isAdmin}
                orders={memberOrders}
                products={products}
                onRefreshCatalog={loadCatalog}
                onOpenAdminCjSetup={() => {
                  setAdminInitialSection('system_cj');
                  setWorkspaceMode('admin');
                }}
                onSignIn={handleSignIn}
              />
            )}
          </>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-[1280px] mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <img
              src="/src/assets/images/vela_logo_light_1794903358298.jpg"
              alt="Vela Commerce Logo"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-md object-cover border border-slate-200 shrink-0"
            />
            <span>Vela Commerce · VelaPayment Gateway, Member Marketplace & Auctions (5% Fee) & CJ Dropshipping</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setLogoModalOpen(true)}
              className="text-slate-700 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap"
            >
              {lang === 'th' ? 'คลังภาพร้านค้า · โลโก้ · สินค้า (PNG)' : 'Store, Logo & Product Media Kit'}
            </button>
          </div>
        </div>
      </footer>

      <LogoModal
        open={logoModalOpen}
        onClose={() => setLogoModalOpen(false)}
        lang={lang}
        products={products}
      />

      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        initialEmail={authInitialEmail}
        defaultSponsorCode={capturedRefCode}
        lang={lang}
        onClose={() => setAuthModalOpen(false)}
      />

      <CheckoutDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        lang={lang}
        user={user}
        profile={profile}
        privateInfo={privateInfo}
        allMembers={activeNetworkMembers}
        cart={cart}
        directTarget={directTarget}
        defaultSponsorCode={capturedRefCode}
        onUpdateDirectQty={handleUpdateDirectQty}
        onClearDirectTarget={() => setDirectTarget(null)}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={handleRemoveItem}
        onClearCart={() => setCart([])}
        onOpenAuthModal={(mode, initEmail) => openAuthModal(mode, initEmail || '')}
        onGoDropship={() => navigateMemberTab('dropship')}
        onGoDashboard={() => navigateMemberTab('dashboard')}
        verifyingCallback={verifyingCallback}
        callbackNotice={callbackNotice}
        externalReceipt={externalReceipt}
        onClearExternalReceipt={() => setExternalReceipt(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
