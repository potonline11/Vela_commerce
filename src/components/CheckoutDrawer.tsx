import React, { useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  Minus,
  Plus,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';
import { commitAtomicCheckout } from '../services/commerceService';
import type { CartItem, MemberPrivateInfo, MemberProfile } from '../types';

export interface PendingVelaCheckout {
  orderId: string;
  orderNumber: string;
  intentId: string;
  hmacSignature: string;
  idempotencyKey: string;
  amount: number;
  cart: CartItem[];
  sponsorReferralCode: string;
  shipping: {
    recipientName: string;
    phone: string;
    addressLine: string;
    city: string;
    postalCode: string;
  };
  createdAt: number;
}

export interface CheckoutReceiptData {
  orderNumber: string;
  cjOrderId: string;
  trackingNumber: string;
  receiptHash: string;
  intentId?: string;
  commissionsDistributed: Array<{ tier: number; beneficiaryName: string; amount: number }>;
}

interface CheckoutDrawerProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  user: User | null;
  profile: MemberProfile | null;
  privateInfo: MemberPrivateInfo | null;
  allMembers: MemberProfile[];
  cart: CartItem[];
  onUpdateQty: (sku: string, delta: number) => void;
  onRemoveItem: (sku: string) => void;
  onClearCart: () => void;
  onSignIn: () => Promise<void>;
  onGoDropship: () => void;
  verifyingCallback: boolean;
  callbackNotice: string;
  externalReceipt: CheckoutReceiptData | null;
  onClearExternalReceipt: () => void;
}

export function CheckoutDrawer({
  open,
  onClose,
  lang,
  user,
  profile,
  privateInfo,
  allMembers,
  cart,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onSignIn,
  onGoDropship,
  verifyingCallback,
  callbackNotice,
  externalReceipt,
  onClearExternalReceipt,
}: CheckoutDrawerProps) {
  const t = COPY[lang];
  const [gatewayChoice, setGatewayChoice] = useState<'velapayment' | 'wallet'>('velapayment');
  const [recipientName, setRecipientName] = useState(user?.displayName || '');
  const [phone, setPhone] = useState(privateInfo?.phone || '089-123-4567');
  const [addressLine, setAddressLine] = useState(
    privateInfo?.shippingAddress || '99/14 Sukhumvit Rd, Watthana'
  );
  const [city, setCity] = useState('Bangkok');
  const [postalCode, setPostalCode] = useState('10110');
  const [sponsorCode, setSponsorCode] = useState('');

  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [localReceipt, setLocalReceipt] = useState<CheckoutReceiptData | null>(null);

  if (!open) return null;

  const activeReceipt = externalReceipt || localReceipt;
  const subtotal = cart.reduce((sum, item) => sum + item.product.retailPrice * item.quantity, 0);
  const formatThb = (val: number) =>
    new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      maximumFractionDigits: 0,
    }).format(val);

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile || cart.length === 0) return;
    setErrorMsg('');
    setBusy(true);

    try {
      if (subtotal < 10) {
        throw new Error(
          lang === 'th' ? 'ยอดชำระขั้นต่ำคือ 10 บาท' : 'Minimum payment amount is 10 THB'
        );
      }

      const idempotencyKey = `IDEM_${user.uid.slice(0, 8)}_${Date.now()}`;
      const shippingPayload = {
        recipientName: recipientName.trim() || profile.displayName,
        phone: phone.trim(),
        addressLine: addressLine.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
      };

      if (gatewayChoice === 'wallet') {
        if (profile.walletBalance < subtotal) {
          throw new Error(
            lang === 'th'
              ? 'ยอดเงินในกระเป๋าคอมมิชชั่นไม่เพียงพอ'
              : 'Insufficient commission wallet balance'
          );
        }

        const walletRes = await fetch('/api/payments/wallet-settle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerUid: user.uid,
            amount: subtotal,
            idempotencyKey,
          }),
        });
        const walletData = await walletRes.json();
        if (!walletRes.ok) {
          throw new Error(walletData.error || 'Wallet settlement failed');
        }

        const result = await commitAtomicCheckout({
          user,
          buyerProfile: profile,
          allMembers,
          cart,
          paymentMethod: 'wallet',
          intentCode: walletData.intentCode,
          hmacSignature: walletData.hmacSignature,
          receiptHash: walletData.receiptHash,
          maskedSource: walletData.maskedSource,
          idempotencyKey,
          sponsorReferralCode: sponsorCode,
          shipping: shippingPayload,
        });

        setLocalReceipt({
          ...result,
          receiptHash: walletData.receiptHash,
          intentId: walletData.intentCode,
        });
        onClearCart();
        return;
      }

      // Live VelaPayment Checkout Session Flow (https://velapayment.vercel.app)
      const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const orderNumber = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 899)}`;
      const origin = window.location.origin;
      const successUrl = `${origin}/`;
      const cancelUrl = `${origin}/?payment=cancelled&orderId=${encodeURIComponent(orderId)}`;

      const primaryTitle = lang === 'th' ? cart[0].product.titleTh : cart[0].product.title;
      const description =
        cart.length > 1
          ? `${primaryTitle} (+${cart.length - 1} items) · ${orderNumber}`
          : `${primaryTitle} · ${orderNumber}`;

      const res = await fetch('/api/payments/checkout-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: subtotal,
          orderId,
          description,
          customerEmail: user.email || privateInfo?.email || 'customer@velacommerce.co',
          successUrl,
          cancelUrl,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.checkoutUrl || !data.intentId) {
        throw new Error(data.error || 'Failed to create VelaPayment checkout session');
      }

      const pendingSnapshot: PendingVelaCheckout = {
        orderId,
        orderNumber,
        intentId: data.intentId,
        hmacSignature: data.hmacSignature,
        idempotencyKey,
        amount: subtotal,
        cart,
        sponsorReferralCode: sponsorCode,
        shipping: shippingPayload,
        createdAt: Date.now(),
      };

      localStorage.setItem(`vela_pending_checkout_${orderId}`, JSON.stringify(pendingSnapshot));
      localStorage.setItem('vela_pending_checkout_latest', JSON.stringify(pendingSnapshot));

      setRedirectUrl(data.checkoutUrl);

      try {
        if (window.top && window.top !== window) {
          window.top.location.href = data.checkoutUrl;
        } else {
          window.location.assign(data.checkoutUrl);
        }
      } catch {
        // Fallback button remains visible if cross-origin top navigation is restricted by iframe sandbox
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]">
      <div className="w-full max-w-xl bg-white h-full overflow-y-auto border-l border-slate-200 flex flex-col justify-between">
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2.5">
              <Lock className="w-4 h-4 text-emerald-700" />
              <h2 className="text-lg font-semibold text-slate-900">
                {lang === 'th' ? 'ชำระเงินผ่าน VelaPayment' : 'VelaPayment Checkout'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setLocalReceipt(null);
                setRedirectUrl(null);
                onClearExternalReceipt();
                onClose();
              }}
              aria-label="Close drawer"
              className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {verifyingCallback ? (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
              <Loader2 className="w-7 h-7 text-slate-900 animate-spin" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  {lang === 'th'
                    ? 'กำลังตรวจสอบสถานะการชำระเงินจริงกับ VelaPayment...'
                    : 'Verifying live payment status with VelaPayment...'}
                </p>
                <p className="text-xs text-slate-500">
                  {lang === 'th'
                    ? 'เมื่อยืนยันแล้วระบบจะส่งเข้า CJ Dropshipping และปันผลคอมมิชชั่นทันที'
                    : 'Fulfillment and MLM commissions will settle automatically once confirmed.'}
                </p>
              </div>
            </div>
          ) : activeReceipt ? (
            <div className="space-y-6 py-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 space-y-3">
                <div className="flex items-center gap-2.5 text-emerald-800">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <h3 className="text-base font-semibold">{t.orderCompleteTitle}</h3>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2 text-xs">
                  <div>
                    <span className="text-emerald-700 block">Order Number</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {activeReceipt.orderNumber}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block">CJ Dropshipping ID</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {activeReceipt.cjOrderId}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block">Tracking Number</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {activeReceipt.trackingNumber}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block">VelaPayment Intent</span>
                    <span className="font-mono text-slate-800 truncate block">
                      {activeReceipt.intentId || activeReceipt.receiptHash.slice(0, 18)}
                    </span>
                  </div>
                </div>
              </div>

              {activeReceipt.commissionsDistributed.length > 0 && (
                <div className="border border-slate-200 rounded-xl p-5 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Multi-Tier MLM Commissions Settled
                  </h4>
                  <div className="divide-y divide-slate-100">
                    {activeReceipt.commissionsDistributed.map((c) => (
                      <div key={c.tier} className="py-2 flex items-center justify-between text-xs">
                        <span className="text-slate-600">
                          Tier {c.tier} · {c.beneficiaryName}
                        </span>
                        <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                          +{formatThb(c.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setLocalReceipt(null);
                    onClearExternalReceipt();
                    onClose();
                    onGoDropship();
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  {t.viewDropshipOrders}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocalReceipt(null);
                    onClearExternalReceipt();
                    onClose();
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  {t.continueShopping}
                </button>
              </div>
            </div>
          ) : redirectUrl ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-semibold text-slate-900">
                {lang === 'th'
                  ? 'สร้างลิงก์ชำระเงิน VelaPayment สำเร็จ'
                  : 'VelaPayment Checkout Session Ready'}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {lang === 'th'
                  ? 'ระบบกำลังนำท่านไปยังหน้าชำระเงิน Stripe Thailand / PromptPay QR หากหน้าต่างไม่เปลี่ยนอัตโนมัติ กรุณากดปุ่มด้านล่าง'
                  : 'Redirecting you to Stripe Thailand / PromptPay QR checkout. If your browser does not redirect automatically, click below.'}
              </p>
              <a
                href={redirectUrl}
                target="_top"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors"
              >
                <span>
                  {lang === 'th'
                    ? 'ไปหน้าชำระเงิน VelaPayment'
                    : 'Proceed to VelaPayment Checkout'}
                </span>
                <ExternalLink className="w-4 h-4" />
              </a>
              <button
                type="button"
                onClick={() => setRedirectUrl(null)}
                className="w-full px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                {lang === 'th' ? 'กลับไปแก้ไขรายการ' : 'Back to Checkout'}
              </button>
            </div>
          ) : cart.length === 0 ? (
            <div className="py-16 text-center space-y-4">
              {callbackNotice && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 text-left">
                  {callbackNotice}
                </div>
              )}
              <p className="text-sm text-slate-500">{t.emptyCart}</p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
              >
                {t.browseProducts}
              </button>
            </div>
          ) : (
            <form onSubmit={handleCheckoutSubmit} className="space-y-6">
              {callbackNotice && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  {callbackNotice}
                </div>
              )}

              {/* Itemized Bag */}
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl">
                {cart.map((item) => (
                  <div key={item.product.sku} className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {lang === 'th' ? item.product.titleTh : item.product.title}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        {item.product.sku} · {formatThb(item.product.retailPrice)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onUpdateQty(item.product.sku, -1)}
                        className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-mono w-6 text-center tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQty(item.product.sku, 1)}
                        className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.product.sku)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="p-4 bg-slate-50 flex items-center justify-between rounded-b-xl">
                  <span className="text-sm font-medium text-slate-700">Subtotal</span>
                  <span className="text-lg font-semibold text-slate-900 tabular-nums">
                    {formatThb(subtotal)}
                  </span>
                </div>
              </div>

              {!user ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">{t.signInRequiredTitle}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{t.signInRequiredDesc}</p>
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="w-full px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    {t.signIn}
                  </button>
                </div>
              ) : (
                <>
                  {/* Shipping PII Section */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">{t.shippingSection}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="text"
                        required
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        placeholder={t.recipientName}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                      <input
                        type="text"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder={t.phone}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <input
                      type="text"
                      required
                      value={addressLine}
                      onChange={(e) => setAddressLine(e.target.value)}
                      placeholder={t.addressLine}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <input
                        type="text"
                        required
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder={t.city}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                      <input
                        type="text"
                        required
                        value={postalCode}
                        onChange={(e) => setPostalCode(e.target.value)}
                        placeholder={t.postalCode}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
                      />
                      <input
                        type="text"
                        value={sponsorCode}
                        onChange={(e) => setSponsorCode(e.target.value)}
                        placeholder={t.sponsorCode}
                        className="col-span-2 sm:col-span-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono uppercase"
                      />
                    </div>
                  </div>

                  {/* Payment Method Selector */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {lang === 'th' ? 'เลือกช่องทางชำระเงิน' : 'Select Payment Method'}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setGatewayChoice('velapayment')}
                        className={`p-3.5 rounded-lg border text-left transition-colors ${
                          gatewayChoice === 'velapayment'
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <CreditCard className="w-4 h-4 mb-1.5" />
                        <span className="text-xs font-semibold block">VelaPayment Gateway</span>
                        <span
                          className={`text-[11px] block mt-0.5 ${
                            gatewayChoice === 'velapayment' ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          Stripe Thailand · PromptPay QR
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setGatewayChoice('wallet')}
                        className={`p-3.5 rounded-lg border text-left transition-colors ${
                          gatewayChoice === 'wallet'
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Wallet className="w-4 h-4 mb-1.5" />
                        <span className="text-xs font-semibold block">
                          {lang === 'th' ? 'กระเป๋าเงินคอมมิชชั่น' : 'Commission Wallet'}
                        </span>
                        <span
                          className={`text-[11px] font-mono block mt-0.5 tabular-nums ${
                            gatewayChoice === 'wallet' ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {formatThb(profile?.walletBalance || 0)}
                        </span>
                      </button>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                      {errorMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full px-4 py-3 text-sm font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors"
                  >
                    {busy
                      ? t.processing
                      : gatewayChoice === 'wallet'
                      ? t.confirmPayBtn
                      : lang === 'th'
                      ? `ชำระเงิน ${formatThb(subtotal)} ผ่าน VelaPayment`
                      : `Pay ${formatThb(subtotal)} via VelaPayment`}
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
