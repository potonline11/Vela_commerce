import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Globe, LogIn, LogOut, ShoppingBag } from 'lucide-react';
import { auth } from './firebase';
import { COPY, type Lang } from './i18n';
import {
  ensureMemberProfile,
  signInWithGoogle,
  signOutUser,
  subscribeMyCommissions,
  subscribeMyOrders,
  subscribeMyPayoutRequests,
  subscribeMyPrivateInfo,
  subscribeMyProfile,
  subscribeNetworkMembers,
  subscribeSecurityLogs,
} from './services/commerceService';
import { StorefrontView } from './components/StorefrontView';
import { DashboardView } from './components/DashboardView';
import { NetworkView } from './components/NetworkView';
import { DropshipView } from './components/DropshipView';
import {
  CheckoutDrawer,
  type CheckoutReceiptData,
  type PendingVelaCheckout,
} from './components/CheckoutDrawer';
import { LogoModal } from './components/LogoModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { commitAtomicCheckout } from './services/commerceService';
import type {
  CartItem,
  CommissionRecord,
  MemberPrivateInfo,
  MemberProfile,
  OrderRecord,
  PayoutRequestRecord,
  ProductItem,
  SecurityLogRecord,
} from './types';

type ActiveTab = 'storefront' | 'dashboard' | 'network' | 'dropship';

function AppShell() {
  const [lang, setLang] = useState<Lang>('th');
  const [activeTab, setActiveTab] = useState<ActiveTab>('storefront');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<MemberPrivateInfo | null>(null);
  const [networkMembers, setNetworkMembers] = useState<MemberProfile[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequestRecord[]>([]);
  const [securityLogs, setSecurityLogs] = useState<SecurityLogRecord[]>([]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoModalOpen, setLogoModalOpen] = useState(false);
  const [verifyingCallback, setVerifyingCallback] = useState(false);
  const [callbackNotice, setCallbackNotice] = useState('');
  const [externalReceipt, setExternalReceipt] = useState<CheckoutReceiptData | null>(null);
  const [handledCallbackIntent, setHandledCallbackIntent] = useState<string | null>(null);

  const t = COPY[lang];

  const loadCatalog = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await fetch('/api/cj/products');
      const data = (await res.json()) as { products?: ProductItem[] };
      if (Array.isArray(data.products)) {
        setProducts(data.products);
      }
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
        await ensureMemberProfile(nextUser);
      } else {
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

  useEffect(() => {
    if (!authReady || !user) return;
    const isAdminUser = user.email === 'pnmall4u@gmail.com' && user.emailVerified;

    const unsubs = [
      subscribeMyProfile(user.uid, setProfile),
      subscribeMyPrivateInfo(user.uid, setPrivateInfo),
      subscribeNetworkMembers((members) => {
        setNetworkMembers(members);
        setMembersLoaded(true);
      }),
      subscribeMyOrders(user.uid, isAdminUser, setOrders),
      subscribeMyCommissions(user.uid, isAdminUser, setCommissions),
      subscribeMyPayoutRequests(user.uid, isAdminUser, setPayouts),
      subscribeSecurityLogs(user.uid, isAdminUser, setSecurityLogs),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, user]);

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
    if (!authReady || !user || !profile || !membersLoaded) {
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

        if (!rawPending) {
          throw new Error(
            lang === 'th'
              ? 'ยืนยันการชำระเงินสำเร็จ แต่ไม่พบข้อมูลตะกร้าสินค้าในเบราว์เซอร์นี้'
              : 'Payment confirmed, but local checkout snapshot was not found.'
          );
        }

        const pending = JSON.parse(rawPending) as PendingVelaCheckout;
        const normalizedMethod =
          verifyData.paymentMethod === 'card'
            ? 'card'
            : verifyData.paymentMethod === 'wallet'
            ? 'wallet'
            : 'promptpay';

        const result = await commitAtomicCheckout({
          user,
          buyerProfile: profile,
          allMembers: networkMembers,
          cart: pending.cart,
          paymentMethod: normalizedMethod,
          intentCode: intentId,
          hmacSignature: verifyData.hmacSignature || pending.hmacSignature,
          receiptHash: verifyData.receiptHash || verifyData.hmacSignature,
          maskedSource:
            normalizedMethod === 'card'
              ? 'VelaPayment · Stripe Card'
              : 'VelaPayment · PromptPay QR',
          idempotencyKey: pending.idempotencyKey,
          orderId: pending.orderId,
          orderNumber: pending.orderNumber,
          sponsorReferralCode: pending.sponsorReferralCode,
          shipping: pending.shipping,
        });

        localStorage.removeItem(`vela_pending_checkout_${pending.orderId}`);
        localStorage.removeItem('vela_pending_checkout_latest');
        setCart([]);
        setExternalReceipt({
          ...result,
          receiptHash: verifyData.receiptHash || verifyData.hmacSignature,
          intentId,
        });
      } catch (err) {
        setCallbackNotice(
          err instanceof Error ? err.message : 'Unable to verify payment callback'
        );
      } finally {
        setVerifyingCallback(false);
        window.history.replaceState({}, '', window.location.pathname);
      }
    })();
  }, [authReady, user, profile, membersLoaded, networkMembers, handledCallbackIntent, lang]);

  const handleSignIn = async () => {
    await signInWithGoogle();
  };

  const handleAddToCart = (product: ProductItem) => {
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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1280px] mx-auto px-6 py-4 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('storefront')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            {t.brand}
          </button>

          {/* Zone 2: 4 Clean Single-Line Text Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {(
              [
                ['storefront', t.navStorefront],
                ['dashboard', t.navDashboard],
                ['network', t.navNetwork],
                ['dropship', t.navDropship],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                  activeTab === key
                    ? 'text-slate-900 border-slate-900'
                    : 'text-slate-500 border-transparent hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 tabular-nums"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>
              {t.cart} ({totalBagItems})
            </span>
          </button>
        </div>
      </header>

      {/* Workspace Sub-Toolbar (Account, Mobile Nav & Language Switch) */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1280px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex md:hidden items-center gap-3 overflow-x-auto">
            {(
              [
                ['storefront', t.navStorefront],
                ['dashboard', t.navDashboard],
                ['network', t.navNetwork],
                ['dropship', t.navDropship],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 ${
                  activeTab === key
                    ? 'bg-slate-900 text-white font-medium'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

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
                onClick={handleSignIn}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-slate-900 font-medium bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{t.signIn}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-10">
        {activeTab === 'storefront' && (
          <StorefrontView
            lang={lang}
            products={products}
            loadingProducts={loadingProducts}
            onAddToCart={handleAddToCart}
            onNavigateDashboard={() => setActiveTab('dashboard')}
            onOpenMediaKit={() => setLogoModalOpen(true)}
          />
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            lang={lang}
            user={user}
            profile={profile}
            orders={orders}
            commissions={commissions}
            payouts={payouts}
            securityLogs={securityLogs}
            onSignIn={handleSignIn}
          />
        )}

        {activeTab === 'network' && (
          <NetworkView
            lang={lang}
            user={user}
            profile={profile}
            allMembers={networkMembers}
            onSignIn={handleSignIn}
          />
        )}

        {activeTab === 'dropship' && (
          <DropshipView
            lang={lang}
            user={user}
            orders={orders}
            products={products}
            onRefreshCatalog={loadCatalog}
            onSignIn={handleSignIn}
          />
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
            <span>Vela Commerce · Proprietary HMAC-SHA256 Payment Gateway & CJ Dropshipping Sync</span>
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

      <CheckoutDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        lang={lang}
        user={user}
        profile={profile}
        privateInfo={privateInfo}
        allMembers={networkMembers}
        cart={cart}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={handleRemoveItem}
        onClearCart={() => setCart([])}
        onSignIn={handleSignIn}
        onGoDropship={() => setActiveTab('dropship')}
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
