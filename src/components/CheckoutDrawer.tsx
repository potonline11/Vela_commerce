import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Mail,
  Minus,
  Plus,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';
import {
  calculatePlatformFee,
  commitAtomicCheckout,
  commitMarketplaceOrAuctionCheckout,
  generateSecureTempPassword,
  registerWithEmail,
  sendMemberPasswordReset,
  sendOrderConfirmationEmail,
  updateMemberPrivateContact,
} from '../services/commerceService';
import type {
  CartItem,
  DirectCheckoutTarget,
  EmailConfirmationResult,
  MemberPrivateInfo,
  MemberProfile,
} from '../types';

export interface PendingVelaCheckout {
  checkoutType: 'cj_cart' | 'marketplace' | 'auction';
  orderId: string;
  orderNumber: string;
  intentId: string;
  hmacSignature: string;
  idempotencyKey: string;
  amount: number;
  cart: CartItem[];
  directTarget?: DirectCheckoutTarget | null;
  sponsorReferralCode: string;
  customerEmail?: string;
  autoCreatedPassword?: string;
  referralCode?: string;
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
  platformFeeAmount?: number;
  sellerNetAmount?: number;
  commissionsDistributed: Array<{ tier: number; beneficiaryName: string; amount: number }>;
  emailResult?: EmailConfirmationResult | null;
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
  directTarget: DirectCheckoutTarget | null;
  defaultSponsorCode?: string;
  onUpdateDirectQty: (delta: number) => void;
  onClearDirectTarget: () => void;
  onUpdateQty: (sku: string, delta: number) => void;
  onRemoveItem: (sku: string) => void;
  onClearCart: () => void;
  onOpenAuthModal: (mode: 'login' | 'register' | 'reset', initialEmail?: string) => void;
  onGoDropship: () => void;
  onGoDashboard: () => void;
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
  directTarget,
  defaultSponsorCode = '',
  onUpdateDirectQty,
  onClearDirectTarget,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onOpenAuthModal,
  onGoDropship,
  onGoDashboard,
  verifyingCallback,
  callbackNotice,
  externalReceipt,
  onClearExternalReceipt,
}: CheckoutDrawerProps) {
  const t = COPY[lang];
  const [gatewayChoice, setGatewayChoice] = useState<'velapayment' | 'wallet'>('velapayment');
  const [customerEmail, setCustomerEmail] = useState(user?.email || privateInfo?.email || '');
  const [customPassword, setCustomPassword] = useState('');
  const [recipientName, setRecipientName] = useState(user?.displayName || '');
  const [phone, setPhone] = useState(privateInfo?.phone || '089-123-4567');
  const [addressLine, setAddressLine] = useState(
    privateInfo?.shippingAddress || '99/14 Sukhumvit Rd, Watthana'
  );
  const [city, setCity] = useState('Bangkok');
  const [postalCode, setPostalCode] = useState('10110');
  const [sponsorCode, setSponsorCode] = useState(defaultSponsorCode);

  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [emailExistsPrompt, setEmailExistsPrompt] = useState(false);
  const [localReceipt, setLocalReceipt] = useState<CheckoutReceiptData | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    if (user?.email && !customerEmail) {
      setCustomerEmail(user.email);
    } else if (privateInfo?.email && !customerEmail) {
      setCustomerEmail(privateInfo.email);
    }
    if (user?.displayName && !recipientName) {
      setRecipientName(user.displayName);
    }
    if (defaultSponsorCode && !sponsorCode) {
      setSponsorCode(defaultSponsorCode);
    }
  }, [user, privateInfo, defaultSponsorCode, customerEmail, recipientName, sponsorCode]);

  if (!open) return null;

  const activeReceipt = externalReceipt || localReceipt;
  const isDirectMode = Boolean(directTarget);

  const subtotal = directTarget
    ? directTarget.kind === 'marketplace'
      ? Number((directTarget.listing.price * directTarget.quantity).toFixed(2))
      : directTarget.auction.currentBid
    : cart.reduce((sum, item) => sum + item.product.retailPrice * item.quantity, 0);

  const feePreview = directTarget ? calculatePlatformFee(subtotal) : null;

  const formatThb = (val: number) =>
    new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      maximumFractionDigits: 0,
    }).format(val);

  const hasItemsToCheckout = isDirectMode || cart.length > 0;

  const copyValue = (key: string, val: string) => {
    navigator.clipboard.writeText(val).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleReceiptPasswordReset = async (emailToReset: string) => {
    setResetBusy(true);
    setResetMsg('');
    try {
      await sendMemberPasswordReset(emailToReset);
      setResetMsg(
        lang === 'th'
          ? `ส่งลิงก์ Reset Password ไปที่ ${emailToReset} เรียบร้อยแล้ว`
          : `Password reset link sent to ${emailToReset}.`
      );
    } catch (err) {
      setResetMsg(err instanceof Error ? err.message : 'Unable to send reset email');
    } finally {
      setResetBusy(false);
    }
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasItemsToCheckout) return;
    setErrorMsg('');
    setEmailExistsPrompt(false);
    setResetMsg('');
    setBusy(true);

    try {
      const resolvedEmail = (customerEmail || user?.email || privateInfo?.email || '').trim();
      if (!resolvedEmail || !resolvedEmail.includes('@')) {
        throw new Error(
          lang === 'th'
            ? 'กรุณากรอกอีเมลที่ถูกต้องเพื่อรับใบเสร็จและข้อมูลเข้าสู่ระบบสมาชิก'
            : 'Please enter a valid email address for confirmation and member access.'
        );
      }
      if (subtotal < 10) {
        throw new Error(
          lang === 'th' ? 'ยอดชำระขั้นต่ำคือ 10 บาท' : 'Minimum payment amount is 10 THB'
        );
      }

      let activeUser = user;
      let activeProfile = profile;
      let autoCreatedPassword = '';

      if (!activeUser) {
        const pwdToUse =
          customPassword.trim().length >= 6 ? customPassword.trim() : generateSecureTempPassword();
        try {
          const reg = await registerWithEmail(
            resolvedEmail,
            pwdToUse,
            recipientName.trim() || resolvedEmail.split('@')[0],
            sponsorCode
          );
          activeUser = reg.user;
          activeProfile = reg.profile;
          autoCreatedPassword = pwdToUse;

          updateMemberPrivateContact(reg.user.uid, {
            email: resolvedEmail,
            phone: phone.trim(),
            shippingAddress: `${addressLine.trim()}, ${city.trim()} ${postalCode.trim()}`,
            promptPayMasked: '',
          }).catch(() => {});
        } catch (regErr) {
          const msg = regErr instanceof Error ? regErr.message : String(regErr);
          if (msg.includes('auth/email-already-in-use')) {
            setEmailExistsPrompt(true);
            throw new Error(
              lang === 'th'
                ? 'อีเมลนี้มีบัญชีสมาชิกอยู่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่าน หรือกดปุ่ม Reset Password ด้านล่างก่อนชำระเงิน'
                : 'An account with this email already exists. Please sign in or reset your password below.'
            );
          }
          if (msg.includes('auth/operation-not-allowed')) {
            throw new Error(
              lang === 'th'
                ? 'ระบบ Email/Password ยังไม่ได้เปิดใช้งานใน Firebase Console กรุณาเข้าสู่ระบบด้วย Google หรือเปิดใช้งาน Email/Password ใน Firebase Console'
                : 'Email/Password sign-in is not yet enabled in Firebase Console. Please use Google Sign-In or enable Email/Password.'
            );
          }
          throw regErr;
        }
      }

      if (!activeUser || !activeProfile) {
        throw new Error(
          lang === 'th'
            ? 'กำลังโหลดโปรไฟล์สมาชิก กรุณาลองกดชำระเงินอีกครั้ง'
            : 'Member profile is loading. Please try again.'
        );
      }

      const idempotencyKey = `IDEM_${activeUser.uid.slice(0, 8)}_${Date.now()}`;
      const shippingPayload = {
        recipientName: recipientName.trim() || activeProfile.displayName,
        phone: phone.trim(),
        addressLine: addressLine.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
      };

      const buildItemSummary = () => {
        if (directTarget?.kind === 'marketplace') {
          return `${directTarget.listing.title} (x${directTarget.quantity})`;
        }
        if (directTarget?.kind === 'auction') {
          return `Auction Win: ${directTarget.auction.title}`;
        }
        if (cart.length > 0) {
          const primaryTitle = lang === 'th' ? cart[0].product.titleTh : cart[0].product.title;
          return cart.length > 1 ? `${primaryTitle} (+${cart.length - 1})` : primaryTitle;
        }
        return 'Vela Commerce Order';
      };

      if (gatewayChoice === 'wallet') {
        if (activeProfile.walletBalance < subtotal) {
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
            ownerUid: activeUser.uid,
            amount: subtotal,
            idempotencyKey,
          }),
        });
        const walletData = await walletRes.json();
        if (!walletRes.ok) {
          throw new Error(walletData.error || 'Wallet settlement failed');
        }

        if (directTarget) {
          const result = await commitMarketplaceOrAuctionCheckout({
            mode: directTarget.kind,
            user: activeUser,
            buyerProfile: activeProfile,
            sellerUid:
              directTarget.kind === 'marketplace'
                ? directTarget.listing.sellerUid
                : directTarget.auction.sellerUid,
            listing: directTarget.kind === 'marketplace' ? directTarget.listing : undefined,
            auction: directTarget.kind === 'auction' ? directTarget.auction : undefined,
            quantity: directTarget.kind === 'marketplace' ? directTarget.quantity : 1,
            unitPrice:
              directTarget.kind === 'marketplace'
                ? directTarget.listing.price
                : directTarget.auction.currentBid,
            itemTitle:
              directTarget.kind === 'marketplace'
                ? directTarget.listing.title
                : directTarget.auction.title,
            itemSku:
              directTarget.kind === 'marketplace'
                ? `MKT-${directTarget.listing.id.slice(-6).toUpperCase()}`
                : `AUC-${directTarget.auction.id.slice(-6).toUpperCase()}`,
            paymentMethod: 'wallet',
            intentCode: walletData.intentCode,
            hmacSignature: walletData.hmacSignature,
            receiptHash: walletData.receiptHash,
            maskedSource: walletData.maskedSource,
            idempotencyKey,
            shipping: shippingPayload,
          });
          const emailResult = await sendOrderConfirmationEmail({
            toEmail: resolvedEmail,
            customerName: shippingPayload.recipientName,
            orderNumber: result.orderNumber,
            itemSummary: buildItemSummary(),
            totalAmount: subtotal,
            intentId: walletData.intentCode,
            referralCode: activeProfile.referralCode,
            temporaryPassword: autoCreatedPassword || null,
          });
          setLocalReceipt({
            ...result,
            receiptHash: walletData.receiptHash,
            intentId: walletData.intentCode,
            emailResult,
          });
          onClearDirectTarget();
        } else {
          const result = await commitAtomicCheckout({
            user: activeUser,
            buyerProfile: activeProfile,
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
          const emailResult = await sendOrderConfirmationEmail({
            toEmail: resolvedEmail,
            customerName: shippingPayload.recipientName,
            orderNumber: result.orderNumber,
            itemSummary: buildItemSummary(),
            totalAmount: subtotal,
            intentId: walletData.intentCode,
            referralCode: activeProfile.referralCode,
            temporaryPassword: autoCreatedPassword || null,
          });
          setLocalReceipt({
            ...result,
            receiptHash: walletData.receiptHash,
            intentId: walletData.intentCode,
            emailResult,
          });
          onClearCart();
        }
        return;
      }

      // Live VelaPayment Checkout Session Flow (https://velapayment.vercel.app)
      const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const prefix =
        directTarget?.kind === 'auction'
          ? 'AUC'
          : directTarget?.kind === 'marketplace'
          ? 'MKT'
          : 'ORD';
      const orderNumber = `${prefix}-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 899)}`;
      const origin = window.location.origin;
      const successUrl = `${origin}/`;
      const cancelUrl = `${origin}/?payment=cancelled&orderId=${encodeURIComponent(orderId)}`;
      const description = `${buildItemSummary()} · ${orderNumber}`;

      const pendingSnapshot: PendingVelaCheckout = {
        checkoutType: directTarget ? directTarget.kind : 'cj_cart',
        orderId,
        orderNumber,
        intentId: '',
        hmacSignature: '',
        idempotencyKey,
        amount: subtotal,
        cart: directTarget ? [] : cart,
        directTarget,
        sponsorReferralCode: sponsorCode,
        customerEmail: resolvedEmail,
        autoCreatedPassword: autoCreatedPassword || undefined,
        referralCode: activeProfile.referralCode,
        shipping: shippingPayload,
        createdAt: Date.now(),
      };

      const res = await fetch('/api/payments/checkout-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: subtotal,
          orderId,
          description,
          customerEmail: resolvedEmail,
          successUrl,
          cancelUrl,
          idempotencyKey,
          pendingSnapshot,
        }),
      });

      const rawText = await res.text();
      let data: { checkoutUrl?: string; intentId?: string; hmacSignature?: string; error?: string } = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(
          lang === 'th'
            ? `เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ${res.status}): ${rawText.slice(0, 80)}`
            : `Unexpected API response (HTTP ${res.status}): ${rawText.slice(0, 80)}`
        );
      }

      if (!res.ok || !data.checkoutUrl || !data.intentId) {
        throw new Error(data.error || 'Failed to create VelaPayment checkout session');
      }

      pendingSnapshot.intentId = data.intentId;
      pendingSnapshot.hmacSignature = data.hmacSignature || '';

      localStorage.setItem(`vela_pending_checkout_${orderId}`, JSON.stringify(pendingSnapshot));
      localStorage.setItem('vela_pending_checkout_latest', JSON.stringify(pendingSnapshot));

      setRedirectUrl(data.checkoutUrl);
      window.location.assign(data.checkoutUrl);
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
                {directTarget?.kind === 'auction'
                  ? lang === 'th'
                    ? 'ชำระเงินค่าประมูล (VelaPayment)'
                    : 'Auction Settlement (VelaPayment)'
                  : directTarget?.kind === 'marketplace'
                  ? lang === 'th'
                    ? 'ชำระเงินสินค้าสมาชิก (VelaPayment)'
                    : 'Marketplace Checkout (VelaPayment)'
                  : lang === 'th'
                  ? 'ชำระเงินผ่าน VelaPayment'
                  : 'VelaPayment Checkout'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setLocalReceipt(null);
                setRedirectUrl(null);
                onClearExternalReceipt();
                onClearDirectTarget();
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
                    ? 'เมื่อยืนยันแล้วระบบจะปิดออเดอร์และคำนวณยอดโอนอัตโนมัติ'
                    : 'Orders and payouts will settle automatically once confirmed.'}
                </p>
              </div>
            </div>
          ) : activeReceipt ? (
            <div className="space-y-6 py-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 space-y-3">
                <div className="flex items-center gap-2.5 text-emerald-800">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <h3 className="text-base font-semibold">
                    {typeof activeReceipt.platformFeeAmount === 'number'
                      ? lang === 'th'
                        ? 'ชำระเงินสำเร็จ & โอนยอดสุทธิ 95% ให้ผู้ขายแล้ว'
                        : 'Payment Settled · 95% Credited to Seller'
                      : t.orderCompleteTitle}
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2 text-xs">
                  <div>
                    <span className="text-emerald-700 block">Order Number</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {activeReceipt.orderNumber}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block">
                      {typeof activeReceipt.platformFeeAmount === 'number'
                        ? 'Platform Fee (5%)'
                        : 'CJ Dropshipping ID'}
                    </span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {typeof activeReceipt.platformFeeAmount === 'number'
                        ? formatThb(activeReceipt.platformFeeAmount)
                        : activeReceipt.cjOrderId}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-700 block">
                      {typeof activeReceipt.sellerNetAmount === 'number'
                        ? 'Seller Net (95%)'
                        : 'Tracking Number'}
                    </span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {typeof activeReceipt.sellerNetAmount === 'number'
                        ? formatThb(activeReceipt.sellerNetAmount)
                        : activeReceipt.trackingNumber}
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

              {activeReceipt.emailResult && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-slate-800 shrink-0" />
                      <h4 className="text-sm font-semibold text-slate-900">
                        {lang === 'th'
                          ? 'ข้อมูลบัญชีสมาชิก · ลิงก์แนะนำ & อีเมลยืนยัน'
                          : 'Member Account · Referral Link & Confirmation Email'}
                      </h4>
                    </div>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                        activeReceipt.emailResult.sent
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {activeReceipt.emailResult.sent
                        ? lang === 'th'
                          ? 'ส่งอีเมลอัตโนมัติแล้ว'
                          : 'Email Sent'
                        : lang === 'th'
                        ? 'พร้อมส่ง/คัดลอก'
                        : 'Ready'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    {activeReceipt.emailResult.sent
                      ? lang === 'th'
                        ? `ระบบได้ส่งอีเมลยืนยัน ลิงก์แนะนำสมาชิก และข้อมูลเข้าสู่ระบบไปยัง ${activeReceipt.emailResult.toEmail} เรียบร้อยแล้ว`
                        : `Confirmation email with referral link and login details sent to ${activeReceipt.emailResult.toEmail}.`
                      : lang === 'th'
                      ? `สร้างข้อมูลยืนยันและบัญชีสมาชิกสำหรับ ${activeReceipt.emailResult.toEmail} เรียบร้อยแล้ว (ตั้งค่า RESEND_API_KEY หรือ SMTP ใน Environment เพื่อส่งเข้า Inbox อัตโนมัติ)`
                      : `Confirmation details prepared for ${activeReceipt.emailResult.toEmail} (configure RESEND_API_KEY or SMTP env vars for automatic inbox delivery).`}
                  </p>

                  <div className="space-y-2 text-xs bg-white border border-slate-200 rounded-lg p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Username (Email)</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-900">
                          {activeReceipt.emailResult.username}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyValue('usr', activeReceipt.emailResult!.username)}
                          className="p-1 text-slate-500 hover:text-slate-900"
                          title="Copy Username"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {copiedKey === 'usr' && <span className="text-[11px] text-emerald-700">✓</span>}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Password</span>
                      {activeReceipt.emailResult.temporaryPassword ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold text-emerald-700">
                            {activeReceipt.emailResult.temporaryPassword}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              copyValue('pwd', activeReceipt.emailResult!.temporaryPassword!)
                            }
                            className="p-1 text-slate-500 hover:text-slate-900"
                            title="Copy Password"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {copiedKey === 'pwd' && <span className="text-[11px] text-emerald-700">✓</span>}
                        </div>
                      ) : (
                        <span className="text-slate-700">
                          {lang === 'th' ? 'ใช้รหัสผ่านปัจจุบันของคุณ' : 'Your existing password'}
                        </span>
                      )}
                    </div>

                    <div className="pt-1 border-t border-slate-100 space-y-1">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Link2 className="w-3 h-3" />
                        {lang === 'th' ? 'ลิงก์แนะนำสมาชิกของคุณ' : 'Your Referral Link'} (
                        {activeReceipt.emailResult.referralCode})
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <code className="font-mono text-[11px] text-emerald-800 break-all">
                          {activeReceipt.emailResult.referralLink}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyValue('ref', activeReceipt.emailResult!.referralLink)}
                          className="px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 rounded shrink-0"
                        >
                          {copiedKey === 'ref' ? (lang === 'th' ? 'คัดลอกแล้ว' : 'Copied') : lang === 'th' ? 'คัดลอก' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={resetBusy}
                      onClick={() => handleReceiptPasswordReset(activeReceipt.emailResult!.toEmail)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>
                        {resetBusy
                          ? lang === 'th'
                            ? 'กำลังส่ง...'
                            : 'Sending...'
                          : lang === 'th'
                          ? 'รีเซ็ตรหัสผ่าน (Reset Password)'
                          : 'Reset Password'}
                      </span>
                    </button>
                    {!activeReceipt.emailResult.sent && activeReceipt.emailResult.mailtoDraftUrl && (
                      <a
                        href={activeReceipt.emailResult.mailtoDraftUrl}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        <span>{lang === 'th' ? 'เปิดร่างอีเมลส่งลูกค้า' : 'Open Email Draft'}</span>
                      </a>
                    )}
                  </div>
                  {resetMsg && <p className="text-xs text-emerald-700">{resetMsg}</p>}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setLocalReceipt(null);
                    onClearExternalReceipt();
                    onClearDirectTarget();
                    onClose();
                    onGoDashboard();
                  }}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  {lang === 'th' ? 'ดูค่าคอม & ข้อมูลสมาชิก' : 'View Member Dashboard'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocalReceipt(null);
                    onClearExternalReceipt();
                    onClearDirectTarget();
                    onClose();
                    onGoDropship();
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  {t.viewDropshipOrders}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocalReceipt(null);
                    onClearExternalReceipt();
                    onClearDirectTarget();
                    onClose();
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  {t.continueShopping}
                </button>
              </div>
            </div>
          ) : redirectUrl ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-3">
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
              <button
                type="button"
                onClick={() => window.location.assign(redirectUrl)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors"
              >
                <span>
                  {lang === 'th'
                    ? 'ไปหน้าชำระเงิน VelaPayment'
                    : 'Proceed to VelaPayment Checkout'}
                </span>
                <ExternalLink className="w-4 h-4" />
              </button>
              <a
                href={redirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <span>
                  {lang === 'th' ? 'เปิดหน้าชำระเงินในแท็บใหม่' : 'Open Checkout in New Tab'}
                </span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => setRedirectUrl(null)}
                className="w-full px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                {lang === 'th' ? 'กลับไปแก้ไขรายการ' : 'Back to Checkout'}
              </button>
            </div>
          ) : !hasItemsToCheckout ? (
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

              {/* Itemized Summary: Direct Marketplace/Auction OR CJ Cart */}
              {directTarget ? (
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-200">
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 mb-0.5">
                        {directTarget.kind === 'auction'
                          ? lang === 'th'
                            ? 'ชนะการประมูล · ค่าธรรมเนียม 5%'
                            : 'Auction Win · 5% Fee'
                          : lang === 'th'
                          ? 'สินค้าสมาชิก · ค่าธรรมเนียม 5%'
                          : 'Member Listing · 5% Fee'}
                      </p>
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {directTarget.kind === 'marketplace'
                          ? directTarget.listing.title
                          : directTarget.auction.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {lang === 'th' ? 'ผู้ขาย' : 'Seller'}:{' '}
                        {directTarget.kind === 'marketplace'
                          ? directTarget.listing.sellerName
                          : directTarget.auction.sellerName}
                      </p>
                    </div>

                    {directTarget.kind === 'marketplace' ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onUpdateDirectQty(-1)}
                          disabled={directTarget.quantity <= 1}
                          className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs font-mono w-6 text-center tabular-nums">
                          {directTarget.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUpdateDirectQty(1)}
                          disabled={directTarget.quantity >= directTarget.listing.stock}
                          className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-mono text-slate-500">1 item</span>
                    )}
                  </div>

                  {feePreview && (
                    <div className="p-4 bg-slate-50 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>{lang === 'th' ? 'ค่าธรรมเนียมแพลตฟอร์ม (5%)' : 'Platform Fee (5%)'}</span>
                        <span className="font-mono tabular-nums">{formatThb(feePreview.feeAmount)}</span>
                      </div>
                      <div className="flex items-center justify-between text-emerald-700">
                        <span>{lang === 'th' ? 'ผู้ขายได้รับสุทธิ (95%)' : 'Seller Net Proceeds (95%)'}</span>
                        <span className="font-mono tabular-nums">{formatThb(feePreview.sellerNetAmount)}</span>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                        <span className="text-sm font-medium text-slate-800">
                          {lang === 'th' ? 'ยอดชำระรวม' : 'Total Due'}
                        </span>
                        <span className="text-lg font-semibold text-slate-900 tabular-nums">
                          {formatThb(subtotal)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
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
              )}

              {/* Optional Sign-In / Auto-Register Banner when Guest */}
              {!user && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-900">
                      {lang === 'th'
                        ? 'สั่งซื้อพร้อมสร้างบัญชีสมาชิกอัตโนมัติ (หรือเข้าสู่ระบบเดิม)'
                        : 'Checkout & Auto-Create Member Account'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenAuthModal('login', customerEmail)}
                        className="text-xs font-medium text-slate-800 underline underline-offset-2 hover:text-slate-900"
                      >
                        {lang === 'th' ? 'เข้าสู่ระบบ (Email/Google)' : 'Sign In'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenAuthModal('reset', customerEmail)}
                        className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                      >
                        {lang === 'th' ? 'ลืมรหัสผ่าน?' : 'Reset Password'}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {lang === 'th'
                      ? 'ระบบจะใช้อีเมลด้านล่างเป็น Username และส่งลิงก์แนะนำ + รหัสผ่านเข้าอีเมลโดยอัตโนมัติหลังชำระเงินสำเร็จ เพื่อเข้าดูค่าคอมมิชชั่นได้ทันที'
                      : 'Your email below becomes your Member Username. After payment, we automatically send your confirmation, referral link, and password.'}
                  </p>
                </div>
              )}

              {/* Customer Email & Member Account Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  {lang === 'th' ? 'อีเมลสมาชิก & ข้อมูลจัดส่ง (แยกสิทธิ์ PII)' : t.shippingSection}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">
                      {lang === 'th'
                        ? 'อีเมลรับใบเสร็จ & Username สมาชิก *'
                        : 'Email for Receipt & Member Login *'}
                    </label>
                    <input
                      type="email"
                      required
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="customer@email.com"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  {!user ? (
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">
                        {lang === 'th'
                          ? 'ตั้งรหัสผ่าน (เว้นว่างให้ระบบสร้างอัตโนมัติ)'
                          : 'Password (leave blank to auto-generate)'}
                      </label>
                      <input
                        type="password"
                        minLength={6}
                        value={customPassword}
                        onChange={(e) => setCustomPassword(e.target.value)}
                        placeholder={lang === 'th' ? 'สุ่มรหัสผ่านปลอดภัยอัตโนมัติ' : 'Auto-generated if blank'}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                  ) : (
                    <div className="flex items-end pb-1">
                      <span className="text-xs text-emerald-700 font-medium">
                        {lang === 'th'
                          ? `เข้าสู่ระบบแล้ว: ${profile?.referralCode || user.email}`
                          : `Signed in: ${profile?.referralCode || user.email}`}
                      </span>
                    </div>
                  )}
                </div>

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
                  {!isDirectMode && (
                    <input
                      type="text"
                      value={sponsorCode}
                      onChange={(e) => setSponsorCode(e.target.value)}
                      placeholder={t.sponsorCode}
                      className="col-span-2 sm:col-span-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono uppercase"
                    />
                  )}
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
                    disabled={!user}
                    onClick={() => setGatewayChoice('wallet')}
                    className={`p-3.5 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                      gatewayChoice === 'wallet'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Wallet className="w-4 h-4 mb-1.5" />
                    <span className="text-xs font-semibold block">
                      {lang === 'th' ? 'กระเป๋าเงินสมาชิก' : 'Member Wallet'}
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
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 space-y-2">
                  <p>{errorMsg}</p>
                  {emailExistsPrompt && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onOpenAuthModal('login', customerEmail)}
                        className="px-3 py-1 bg-slate-900 text-white rounded-md font-medium"
                      >
                        {lang === 'th' ? 'เข้าสู่ระบบด้วยอีเมลนี้' : 'Sign In with This Email'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenAuthModal('reset', customerEmail)}
                        className="px-3 py-1 bg-white border border-slate-300 text-slate-800 rounded-md font-medium"
                      >
                        {lang === 'th' ? 'รีเซ็ตรหัสผ่าน (Reset Password)' : 'Reset Password'}
                      </button>
                    </div>
                  )}
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
                  ? lang === 'th'
                    ? `ชำระ ${formatThb(subtotal)} ด้วยกระเป๋าเงินสมาชิก`
                    : `Pay ${formatThb(subtotal)} with Member Wallet`
                  : lang === 'th'
                  ? `ชำระเงิน ${formatThb(subtotal)} ผ่าน VelaPayment`
                  : `Pay ${formatThb(subtotal)} via VelaPayment`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
