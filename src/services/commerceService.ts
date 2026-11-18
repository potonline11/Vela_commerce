import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import type {
  AuctionBidRecord,
  AuctionRecord,
  CartItem,
  CommissionRecord,
  ItemCondition,
  MemberListingRecord,
  MemberPrivateInfo,
  MemberProfile,
  MemberRank,
  OrderRecord,
  OrderShippingPii,
  PaymentIntentRecord,
  PaymentMethod,
  PayoutRequestRecord,
  SecurityLogRecord,
} from '../types';

export const PLATFORM_FEE_RATE = 0.05;

export function calculatePlatformFee(grossAmount: number): {
  feeAmount: number;
  sellerNetAmount: number;
} {
  const feeAmount = Number((grossAmount * PLATFORM_FEE_RATE).toFixed(2));
  const sellerNetAmount = Number((grossAmount - feeAmount).toFixed(2));
  return { feeAmount, sellerNetAmount };
}

export const MLM_TIERS = [
  { tier: 1, ratePercent: 12.0, label: 'Tier 1 · Direct Sponsor' },
  { tier: 2, ratePercent: 6.0, label: 'Tier 2 · Second Level' },
  { tier: 3, ratePercent: 3.0, label: 'Tier 3 · Third Level' },
  { tier: 4, ratePercent: 1.5, label: 'Tier 4 · Fourth Level' },
] as const;

export function calculateRank(personalVolume: number, teamVolume: number): MemberRank {
  const combined = personalVolume + teamVolume;
  if (combined >= 150_000) return 'Diamond';
  if (combined >= 60_000) return 'Platinum';
  if (combined >= 20_000) return 'Gold';
  if (combined >= 5_000) return 'Silver';
  return 'Bronze';
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export async function ensureMemberProfile(user: User, sponsorReferralCode?: string): Promise<void> {
  const memberRef = doc(db, 'members', user.uid);
  let snap;
  try {
    snap = await getDoc(memberRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `members/${user.uid}`);
  }

  let resolvedSponsorUid = '';
  if (sponsorReferralCode && sponsorReferralCode.trim().length >= 4) {
    try {
      const q = query(
        collection(db, 'members'),
        where('referralCode', '==', sponsorReferralCode.trim().toUpperCase()),
        where('status', '==', 'active')
      );
      const sponsorMatches = await getDocs(q);
      if (!sponsorMatches.empty) {
        const candidate = sponsorMatches.docs[0].id;
        if (candidate !== user.uid) {
          resolvedSponsorUid = candidate;
        }
      }
    } catch {
      // Optional sponsor lookup
    }
  }

  if (!snap.exists()) {
    const cleanCode = `VELA-${user.uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()}`;
    const displayName = (user.displayName || user.email?.split('@')[0] || 'Member').slice(0, 80);
    const batch = writeBatch(db);

    batch.set(memberRef, {
      uid: user.uid,
      displayName,
      referralCode: cleanCode,
      ...(resolvedSponsorUid ? { sponsorUid: resolvedSponsorUid } : {}),
      rank: 'Bronze',
      personalVolume: 0,
      teamVolume: 0,
      directCount: 0,
      totalCommissionEarned: 0,
      walletBalance: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const privateRef = doc(db, 'members', user.uid, 'private', 'contact');
    batch.set(privateRef, {
      uid: user.uid,
      email: user.email || 'verified@velacommerce.co',
      phone: '',
      shippingAddress: '',
      promptPayMasked: '',
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `members/${user.uid}`);
    }
  }
}

export async function updateMemberPrivateContact(
  uid: string,
  data: { email: string; phone: string; shippingAddress: string; promptPayMasked: string }
): Promise<void> {
  const ref = doc(db, 'members', uid, 'private', 'contact');
  try {
    await setDoc(
      ref,
      {
        uid,
        email: data.email.slice(0, 160),
        phone: data.phone.slice(0, 32),
        shippingAddress: data.shippingAddress.slice(0, 300),
        promptPayMasked: data.promptPayMasked.slice(0, 32),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `members/${uid}/private/contact`);
  }
}

export function subscribeMyProfile(
  uid: string,
  onData: (profile: MemberProfile | null) => void
): Unsubscribe {
  const ref = doc(db, 'members', uid);
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as MemberProfile) : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, `members/${uid}`)
  );
}

export function subscribeMyPrivateInfo(
  uid: string,
  onData: (info: MemberPrivateInfo | null) => void
): Unsubscribe {
  const ref = doc(db, 'members', uid, 'private', 'contact');
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as MemberPrivateInfo) : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, `members/${uid}/private/contact`)
  );
}

export function subscribeNetworkMembers(
  isAdminUser: boolean,
  onData: (members: MemberProfile[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'members'))
    : query(collection(db, 'members'), where('status', '==', 'active'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as MemberProfile));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'members')
  );
}

export function subscribeMyOrders(
  uid: string,
  isAdminUser: boolean,
  onData: (orders: OrderRecord[]) => void
): Unsubscribe {
  if (isAdminUser) {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderRecord, 'id'>) }));
        onData(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
    );
  }

  const buyerMap = new Map<string, OrderRecord>();
  const sellerMap = new Map<string, OrderRecord>();

  const emit = () => {
    const merged = new Map<string, OrderRecord>([...buyerMap, ...sellerMap]);
    const list = Array.from(merged.values()).sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
      const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
      return tb - ta;
    });
    onData(list);
  };

  const unsubBuyer = onSnapshot(
    query(collection(db, 'orders'), where('buyerUid', '==', uid)),
    (snap) => {
      buyerMap.clear();
      for (const d of snap.docs) {
        buyerMap.set(d.id, { id: d.id, ...(d.data() as Omit<OrderRecord, 'id'>) });
      }
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
  );

  const unsubSeller = onSnapshot(
    query(collection(db, 'orders'), where('sellerUid', '==', uid)),
    (snap) => {
      sellerMap.clear();
      for (const d of snap.docs) {
        sellerMap.set(d.id, { id: d.id, ...(d.data() as Omit<OrderRecord, 'id'>) });
      }
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
  );

  return () => {
    unsubBuyer();
    unsubSeller();
  };
}

export function subscribeMyCommissions(
  uid: string,
  isAdminUser: boolean,
  onData: (commissions: CommissionRecord[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'commissions'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'commissions'), where('beneficiaryUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CommissionRecord, 'id'>),
      }));
      list.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
        const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
        return tb - ta;
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'commissions')
  );
}

export function subscribeMyPaymentIntents(
  uid: string,
  onData: (intents: PaymentIntentRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'paymentIntents'), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<PaymentIntentRecord, 'id'>),
      }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'paymentIntents')
  );
}

export function subscribeMyPayoutRequests(
  uid: string,
  isAdminUser: boolean,
  onData: (payouts: PayoutRequestRecord[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'payoutRequests'))
    : query(collection(db, 'payoutRequests'), where('memberUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<PayoutRequestRecord, 'id'>),
      }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'payoutRequests')
  );
}

export function subscribeSecurityLogs(
  uid: string,
  isAdminUser: boolean,
  onData: (logs: SecurityLogRecord[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'securityLogs'))
    : query(collection(db, 'securityLogs'), where('actorUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SecurityLogRecord, 'id'>),
      }));
      list.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
        const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
        return tb - ta;
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'securityLogs')
  );
}

export async function fetchOrderShippingPii(orderId: string): Promise<OrderShippingPii | null> {
  const ref = doc(db, 'orders', orderId, 'shipping', 'details');
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as OrderShippingPii) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `orders/${orderId}/shipping/details`);
  }
}

export interface CheckoutInput {
  user: User;
  buyerProfile: MemberProfile;
  allMembers: MemberProfile[];
  cart: CartItem[];
  paymentMethod: PaymentMethod;
  intentCode: string;
  hmacSignature: string;
  receiptHash: string;
  maskedSource: string;
  idempotencyKey: string;
  orderId?: string;
  orderNumber?: string;
  sponsorReferralCode?: string;
  shipping: {
    recipientName: string;
    phone: string;
    addressLine: string;
    city: string;
    postalCode: string;
  };
}

export async function commitAtomicCheckout(input: CheckoutInput): Promise<{
  orderNumber: string;
  cjOrderId: string;
  trackingNumber: string;
  commissionsDistributed: Array<{ tier: number; beneficiaryName: string; amount: number }>;
}> {
  const totalAmount = input.cart.reduce(
    (sum, item) => sum + item.product.retailPrice * item.quantity,
    0
  );
  const totalWholesale = input.cart.reduce(
    (sum, item) => sum + item.product.wholesaleCost * item.quantity,
    0
  );
  const primaryItem = input.cart[0];
  const totalQty = input.cart.reduce((sum, item) => sum + item.quantity, 0);
  const orderNumber =
    input.orderNumber ||
    `ORD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 899)}`;

  // 1. Push order automatically to CJ Dropshipping backend proxy
  const cjRes = await fetch('/api/cj/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderNumber,
      sku: primaryItem.product.sku,
      quantity: totalQty,
      shippingCity: input.shipping.city,
    }),
  });
  if (!cjRes.ok) {
    throw new Error('CJ Dropshipping fulfillment push failed');
  }
  const cjData = (await cjRes.json()) as {
    cjOrderId: string;
    trackingNumber: string;
    carrierName: string;
    fulfillmentStatus: 'processing';
  };

  // 2. Resolve 4-tier upline chain safely
  const memberByUid = new Map<string, MemberProfile>();
  const memberByCode = new Map<string, MemberProfile>();
  for (const m of input.allMembers) {
    memberByUid.set(m.uid, m);
    memberByCode.set(m.referralCode.toUpperCase(), m);
  }

  let firstSponsorUid = input.buyerProfile.sponsorUid || '';
  if (!firstSponsorUid && input.sponsorReferralCode) {
    const matched = memberByCode.get(input.sponsorReferralCode.trim().toUpperCase());
    if (matched && matched.uid !== input.user.uid) {
      firstSponsorUid = matched.uid;
    }
  }

  const orderId =
    input.orderId && /^[a-zA-Z0-9_\-]+$/.test(input.orderId)
      ? input.orderId
      : `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const intentDocId = `pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeIntentCode = input.intentCode.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 64);

  const batch = writeBatch(db);

  // PaymentIntent doc
  batch.set(doc(db, 'paymentIntents', intentDocId), {
    intentCode: safeIntentCode.length >= 6 ? safeIntentCode : `VP_${safeIntentCode}`,
    ownerUid: input.user.uid,
    orderId,
    amount: totalAmount,
    currency: 'THB',
    method: input.paymentMethod,
    maskedSource: input.maskedSource,
    hmacSignature: input.hmacSignature,
    idempotencyKey: input.idempotencyKey,
    status: 'settled',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Order doc (zero street-level PII)
  batch.set(doc(db, 'orders', orderId), {
    orderNumber,
    buyerUid: input.user.uid,
    sellerUid: firstSponsorUid || input.user.uid,
    itemSku: primaryItem.product.sku,
    itemTitle:
      input.cart.length > 1
        ? `${primaryItem.product.title} (+${input.cart.length - 1})`
        : primaryItem.product.title,
    quantity: totalQty,
    unitPrice: primaryItem.product.retailPrice,
    totalAmount,
    wholesaleCost: totalWholesale,
    paymentIntentId: input.intentCode,
    paymentMethod: input.paymentMethod,
    paymentSignature: input.receiptHash,
    paymentStatus: 'paid',
    cjOrderId: cjData.cjOrderId,
    fulfillmentStatus: cjData.fulfillmentStatus,
    trackingNumber: cjData.trackingNumber,
    carrierName: cjData.carrierName,
    shippingCity: input.shipping.city.slice(0, 80),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Isolated Order Shipping PII subcollection
  batch.set(doc(db, 'orders', orderId, 'shipping', 'details'), {
    orderId,
    buyerUid: input.user.uid,
    recipientName: input.shipping.recipientName.slice(0, 100),
    phone: input.shipping.phone.slice(0, 32),
    addressLine: input.shipping.addressLine.slice(0, 240),
    postalCode: input.shipping.postalCode.slice(0, 16),
    countryCode: 'TH',
    createdAt: serverTimestamp(),
  });

  // Buyer personal volume + wallet debit if paid via wallet
  const nextPv = Number((input.buyerProfile.personalVolume + totalAmount).toFixed(2));
  const nextBuyerWallet =
    input.paymentMethod === 'wallet'
      ? Math.max(0, Number((input.buyerProfile.walletBalance - totalAmount).toFixed(2)))
      : input.buyerProfile.walletBalance;

  batch.update(doc(db, 'members', input.user.uid), {
    personalVolume: nextPv,
    walletBalance: nextBuyerWallet,
    rank: calculateRank(nextPv, input.buyerProfile.teamVolume),
    updatedAt: serverTimestamp(),
  });

  // Multi-tier MLM Commission distribution (Tier 1 -> Tier 4)
  const commissionsDistributed: Array<{ tier: number; beneficiaryName: string; amount: number }> = [];
  const visited = new Set<string>([input.user.uid]);
  let cursorUid = firstSponsorUid;

  for (const tierSpec of MLM_TIERS) {
    if (!cursorUid || visited.has(cursorUid)) break;
    const upline = memberByUid.get(cursorUid);
    if (!upline) break;
    visited.add(cursorUid);

    const commissionAmount = Number(((totalAmount * tierSpec.ratePercent) / 100).toFixed(2));
    if (commissionAmount > 0) {
      const commId = `com_${Date.now()}_t${tierSpec.tier}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(db, 'commissions', commId), {
        orderId,
        orderNumber,
        beneficiaryUid: upline.uid,
        sourceBuyerUid: input.user.uid,
        tier: tierSpec.tier,
        ratePercent: tierSpec.ratePercent,
        commissionAmount,
        status: 'credited',
        createdAt: serverTimestamp(),
      });

      const nextTeamVolume = Number((upline.teamVolume + totalAmount).toFixed(2));
      const nextWallet = Number((upline.walletBalance + commissionAmount).toFixed(2));
      const nextEarned = Number((upline.totalCommissionEarned + commissionAmount).toFixed(2));

      batch.update(doc(db, 'members', upline.uid), {
        teamVolume: nextTeamVolume,
        totalCommissionEarned: nextEarned,
        walletBalance: nextWallet,
        lastCommissionId: commId,
        rank: calculateRank(upline.personalVolume, nextTeamVolume),
        updatedAt: serverTimestamp(),
      });

      commissionsDistributed.push({
        tier: tierSpec.tier,
        beneficiaryName: upline.displayName,
        amount: commissionAmount,
      });
    }

    cursorUid = upline.sponsorUid || '';
  }

  // Immutable Security Audit Log
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  batch.set(doc(db, 'securityLogs', logId), {
    actorUid: input.user.uid,
    action: 'PAYMENT_SETTLED_CJ_DISPATCHED',
    resourceType: 'order',
    resourceId: orderId,
    integrityHash: input.receiptHash,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
  }

  return {
    orderNumber,
    cjOrderId: cjData.cjOrderId,
    trackingNumber: cjData.trackingNumber,
    commissionsDistributed,
  };
}

export async function syncOrderTrackingWithCj(order: OrderRecord): Promise<void> {
  if (!order.cjOrderId) return;
  const res = await fetch(`/api/cj/orders/${encodeURIComponent(order.cjOrderId)}/tracking`);
  if (!res.ok) {
    throw new Error('Failed to sync tracking from CJ Dropshipping');
  }
  const data = (await res.json()) as {
    fulfillmentStatus: 'synced_cj' | 'processing' | 'in_transit' | 'delivered';
    trackingNumber: string;
    carrierName: string;
  };

  try {
    await updateDoc(doc(db, 'orders', order.id), {
      fulfillmentStatus: data.fulfillmentStatus,
      trackingNumber: data.trackingNumber,
      carrierName: data.carrierName,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function updateDirectSellerTracking(
  orderId: string,
  trackingNumber: string,
  carrierName: string,
  fulfillmentStatus: 'in_transit' | 'delivered'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      trackingNumber: trackingNumber.trim().slice(0, 80) || 'DIRECT-PARCEL',
      carrierName: carrierName.trim().slice(0, 64) || 'Flash Express',
      fulfillmentStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${orderId}`);
  }
}

export async function submitPayoutWithdrawal(
  profile: MemberProfile,
  amount: number,
  destination: string,
  method: 'promptpay' | 'bank_transfer'
): Promise<void> {
  if (amount < 100 || amount > profile.walletBalance) {
    throw new Error('Invalid withdrawal amount');
  }

  const cleanDest = destination.trim();
  const masked =
    cleanDest.length > 4
      ? `${'*'.repeat(Math.max(4, cleanDest.length - 4))}${cleanDest.slice(-4)}`
      : cleanDest;

  const payoutId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const batch = writeBatch(db);
  batch.set(doc(db, 'payoutRequests', payoutId), {
    memberUid: profile.uid,
    amount: Number(amount.toFixed(2)),
    destinationMasked: masked.slice(0, 48),
    method,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'members', profile.uid), {
    walletBalance: Number((profile.walletBalance - amount).toFixed(2)),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'securityLogs', logId), {
    actorUid: profile.uid,
    action: 'PAYOUT_REQUEST_SUBMITTED',
    resourceType: 'payoutRequest',
    resourceId: payoutId,
    integrityHash: `${profile.uid.slice(0, 12)}_${Date.now()}`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `payoutRequests/${payoutId}`);
  }
}

// --- Member Marketplace (Shopee-style · 5% Fee) & Live Auctions (eBay-style · 5% Fee) ---

export async function checkIsAdminUser(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (user.email === 'pnmall4u@gmail.com') return true;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function adminUpdateMemberStatus(
  memberUid: string,
  nextStatus: 'active' | 'suspended'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'members', memberUid), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `members/${memberUid}`);
  }
}

export async function adminProcessPayoutRequest(
  adminUser: User,
  payout: PayoutRequestRecord,
  nextStatus: 'approved' | 'completed' | 'rejected'
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'payoutRequests', payout.id), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });

  // Refund member wallet if payout is rejected from pending/approved state
  if (nextStatus === 'rejected' && payout.status !== 'rejected' && payout.status !== 'completed') {
    const memberRef = doc(db, 'members', payout.memberUid);
    const memberSnap = await getDoc(memberRef);
    if (memberSnap.exists()) {
      const m = memberSnap.data() as MemberProfile;
      batch.update(memberRef, {
        walletBalance: Number((m.walletBalance + payout.amount).toFixed(2)),
        updatedAt: serverTimestamp(),
      });
    }
  }

  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  batch.set(doc(db, 'securityLogs', logId), {
    actorUid: adminUser.uid,
    action: `ADMIN_PAYOUT_${nextStatus.toUpperCase()}`,
    resourceType: 'payoutRequest',
    resourceId: payout.id,
    integrityHash: `${adminUser.uid.slice(0, 10)}_${payout.id.slice(0, 10)}_${Date.now()}`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `payoutRequests/${payout.id}`);
  }
}

export async function adminCancelAuction(auctionId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'auctions', auctionId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `auctions/${auctionId}`);
  }
}

export function subscribeMemberListings(
  uid: string | null,
  isAdminUser: boolean,
  onData: (listings: MemberListingRecord[]) => void
): Unsubscribe {
  if (isAdminUser) {
    return onSnapshot(
      collection(db, 'memberListings'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<MemberListingRecord, 'id'>) }))
          .sort((a, b) => {
            const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
            const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
            return tb - ta;
          });
        onData(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'memberListings')
    );
  }

  const activeMap = new Map<string, MemberListingRecord>();
  const ownMap = new Map<string, MemberListingRecord>();

  const emit = () => {
    const merged = new Map<string, MemberListingRecord>([...activeMap, ...ownMap]);
    const list = Array.from(merged.values()).sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
      const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
      return tb - ta;
    });
    onData(list);
  };

  const unsubActive = onSnapshot(
    query(collection(db, 'memberListings'), where('status', '==', 'active')),
    (snap) => {
      activeMap.clear();
      for (const d of snap.docs) {
        activeMap.set(d.id, { id: d.id, ...(d.data() as Omit<MemberListingRecord, 'id'>) });
      }
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'memberListings')
  );

  let unsubOwn: Unsubscribe | null = null;
  if (uid) {
    unsubOwn = onSnapshot(
      query(collection(db, 'memberListings'), where('sellerUid', '==', uid)),
      (snap) => {
        ownMap.clear();
        for (const d of snap.docs) {
          ownMap.set(d.id, { id: d.id, ...(d.data() as Omit<MemberListingRecord, 'id'>) });
        }
        emit();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'memberListings')
    );
  }

  return () => {
    unsubActive();
    if (unsubOwn) unsubOwn();
  };
}

export function subscribeAuctions(
  uid: string | null,
  isAdminUser: boolean,
  onData: (auctions: AuctionRecord[]) => void
): Unsubscribe {
  if (isAdminUser) {
    return onSnapshot(
      collection(db, 'auctions'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<AuctionRecord, 'id'>) }))
          .sort((a, b) => {
            const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
            const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
            return tb - ta;
          });
        onData(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'auctions')
    );
  }

  const publicMap = new Map<string, AuctionRecord>();
  const ownMap = new Map<string, AuctionRecord>();

  const emit = () => {
    const merged = new Map<string, AuctionRecord>([...publicMap, ...ownMap]);
    const list = Array.from(merged.values()).sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
      const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
      return tb - ta;
    });
    onData(list);
  };

  const unsubPublic = onSnapshot(
    query(collection(db, 'auctions'), where('status', 'in', ['live', 'ended_pending_payment', 'settled'])),
    (snap) => {
      publicMap.clear();
      for (const d of snap.docs) {
        publicMap.set(d.id, { id: d.id, ...(d.data() as Omit<AuctionRecord, 'id'>) });
      }
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'auctions')
  );

  let unsubOwn: Unsubscribe | null = null;
  if (uid) {
    unsubOwn = onSnapshot(
      query(collection(db, 'auctions'), where('sellerUid', '==', uid)),
      (snap) => {
        ownMap.clear();
        for (const d of snap.docs) {
          ownMap.set(d.id, { id: d.id, ...(d.data() as Omit<AuctionRecord, 'id'>) });
        }
        emit();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'auctions')
    );
  }

  return () => {
    unsubPublic();
    if (unsubOwn) unsubOwn();
  };
}

export function subscribeAuctionBids(
  auctionId: string,
  onData: (bids: AuctionBidRecord[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'auctions', auctionId, 'bids'),
    where('auctionId', '==', auctionId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<AuctionBidRecord, 'id'>) }))
        .sort((a, b) => b.amount - a.amount);
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `auctions/${auctionId}/bids`)
  );
}

export async function createMemberListing(
  user: User,
  profile: MemberProfile,
  input: {
    title: string;
    description: string;
    category: string;
    condition: ItemCondition;
    imageUrl: string;
    price: number;
    stock: number;
  }
): Promise<string> {
  const listingId = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const cleanPrice = Number(Number(input.price).toFixed(2));
  const cleanStock = Math.max(1, Math.min(10000, Math.floor(Number(input.stock))));

  if (!Number.isFinite(cleanPrice) || cleanPrice < 10) {
    throw new Error('Price must be at least 10 THB');
  }

  try {
    await setDoc(doc(db, 'memberListings', listingId), {
      sellerUid: user.uid,
      sellerName: (profile.displayName || user.displayName || 'Member').slice(0, 80),
      title: input.title.trim().slice(0, 140),
      description: input.description.trim().slice(0, 800),
      category: input.category.trim().slice(0, 60) || 'General',
      condition: input.condition,
      imageUrl: input.imageUrl.trim().slice(0, 500),
      price: cleanPrice,
      stock: cleanStock,
      platformFeeRate: PLATFORM_FEE_RATE,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return listingId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `memberListings/${listingId}`);
  }
}

export async function archiveMemberListing(listingId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'memberListings', listingId), {
      status: 'archived',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `memberListings/${listingId}`);
  }
}

export async function createAuctionItem(
  user: User,
  profile: MemberProfile,
  input: {
    title: string;
    description: string;
    category: string;
    condition: ItemCondition;
    imageUrl: string;
    startingPrice: number;
    minBidIncrement: number;
    durationMinutes: number;
  }
): Promise<string> {
  const auctionId = `auc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const startingPrice = Number(Number(input.startingPrice).toFixed(2));
  const minBidIncrement = Number(Number(input.minBidIncrement).toFixed(2));
  const durationMs = Math.max(5, Math.min(10080, Math.floor(input.durationMinutes))) * 60_000;

  if (!Number.isFinite(startingPrice) || startingPrice < 10) {
    throw new Error('Starting price must be at least 10 THB');
  }
  if (!Number.isFinite(minBidIncrement) || minBidIncrement < 10) {
    throw new Error('Minimum bid increment must be at least 10 THB');
  }

  try {
    await setDoc(doc(db, 'auctions', auctionId), {
      sellerUid: user.uid,
      sellerName: (profile.displayName || user.displayName || 'Member').slice(0, 80),
      title: input.title.trim().slice(0, 140),
      description: input.description.trim().slice(0, 800),
      category: input.category.trim().slice(0, 60) || 'Collectibles',
      condition: input.condition,
      imageUrl: input.imageUrl.trim().slice(0, 500),
      startingPrice,
      minBidIncrement,
      currentBid: startingPrice,
      bidCount: 0,
      platformFeeRate: PLATFORM_FEE_RATE,
      endsAt: Timestamp.fromMillis(Date.now() + durationMs),
      status: 'live',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return auctionId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `auctions/${auctionId}`);
  }
}

export async function placeAuctionBid(
  user: User,
  profile: MemberProfile,
  auction: AuctionRecord,
  bidAmountInput: number
): Promise<void> {
  if (auction.sellerUid === user.uid) {
    throw new Error('Seller cannot bid on their own auction');
  }
  if (auction.status !== 'live') {
    throw new Error('Auction is no longer live');
  }
  const endsMs = (auction.endsAt as { toMillis?: () => number })?.toMillis?.() || 0;
  if (endsMs && Date.now() >= endsMs) {
    throw new Error('Auction timer has ended');
  }

  const minRequired =
    auction.bidCount === 0
      ? auction.startingPrice
      : Number((auction.currentBid + auction.minBidIncrement).toFixed(2));
  const bidAmount = Number(Number(bidAmountInput).toFixed(2));

  if (!Number.isFinite(bidAmount) || bidAmount < minRequired) {
    throw new Error(`Bid must be at least ${minRequired} THB`);
  }

  const bidId = `bid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const bidderName = (profile.displayName || user.displayName || 'Bidder').slice(0, 80);

  const batch = writeBatch(db);
  batch.set(doc(db, 'auctions', auction.id, 'bids', bidId), {
    auctionId: auction.id,
    bidderUid: user.uid,
    bidderName,
    amount: bidAmount,
    createdAt: serverTimestamp(),
  });

  batch.update(doc(db, 'auctions', auction.id), {
    currentBid: bidAmount,
    bidCount: auction.bidCount + 1,
    highestBidderUid: user.uid,
    highestBidderName: bidderName,
    lastBidId: bidId,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `auctions/${auction.id}/bids/${bidId}`);
  }
}

export async function closeAuctionRecord(auction: AuctionRecord): Promise<void> {
  if (auction.status !== 'live') return;
  try {
    await updateDoc(doc(db, 'auctions', auction.id), {
      status: auction.bidCount > 0 ? 'ended_pending_payment' : 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `auctions/${auction.id}`);
  }
}

export interface DirectSettlementInput {
  mode: 'marketplace' | 'auction';
  user: User;
  buyerProfile: MemberProfile;
  sellerUid: string;
  listing?: MemberListingRecord;
  auction?: AuctionRecord;
  quantity: number;
  unitPrice: number;
  itemTitle: string;
  itemSku: string;
  paymentMethod: PaymentMethod;
  intentCode: string;
  hmacSignature: string;
  receiptHash: string;
  maskedSource: string;
  idempotencyKey: string;
  orderId?: string;
  orderNumber?: string;
  shipping: {
    recipientName: string;
    phone: string;
    addressLine: string;
    city: string;
    postalCode: string;
  };
}

export async function commitMarketplaceOrAuctionCheckout(
  input: DirectSettlementInput
): Promise<{
  orderNumber: string;
  cjOrderId: string;
  trackingNumber: string;
  platformFeeAmount: number;
  sellerNetAmount: number;
  commissionsDistributed: Array<{ tier: number; beneficiaryName: string; amount: number }>;
}> {
  if (input.sellerUid === input.user.uid) {
    throw new Error('Seller cannot purchase or settle their own item');
  }

  const quantity = input.mode === 'auction' ? 1 : Math.max(1, Math.floor(input.quantity));
  const totalAmount = Number((input.unitPrice * quantity).toFixed(2));
  const { feeAmount, sellerNetAmount } = calculatePlatformFee(totalAmount);

  const sellerRef = doc(db, 'members', input.sellerUid);
  let sellerSnap;
  try {
    sellerSnap = await getDoc(sellerRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `members/${input.sellerUid}`);
  }
  if (!sellerSnap.exists()) {
    throw new Error('Seller member profile not found');
  }
  const sellerProfile = sellerSnap.data() as MemberProfile;

  const orderId =
    input.orderId && /^[a-zA-Z0-9_\-]+$/.test(input.orderId)
      ? input.orderId
      : `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const orderNumber =
    input.orderNumber ||
    `${input.mode === 'auction' ? 'AUC' : 'MKT'}-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 899)}`;
  const intentDocId = `pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeIntentCode = input.intentCode.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 64);

  const batch = writeBatch(db);

  batch.set(doc(db, 'paymentIntents', intentDocId), {
    intentCode: safeIntentCode.length >= 6 ? safeIntentCode : `VP_${safeIntentCode}`,
    ownerUid: input.user.uid,
    orderId,
    amount: totalAmount,
    currency: 'THB',
    method: input.paymentMethod,
    maskedSource: input.maskedSource,
    hmacSignature: input.hmacSignature,
    idempotencyKey: input.idempotencyKey,
    status: 'settled',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'orders', orderId), {
    orderNumber,
    orderSource: input.mode === 'auction' ? 'auction_win' : 'member_marketplace',
    ...(input.mode === 'marketplace' && input.listing ? { listingId: input.listing.id } : {}),
    ...(input.mode === 'auction' && input.auction ? { auctionId: input.auction.id } : {}),
    buyerUid: input.user.uid,
    sellerUid: input.sellerUid,
    itemSku: input.itemSku.slice(0, 64),
    itemTitle: input.itemTitle.slice(0, 140),
    quantity,
    unitPrice: input.unitPrice,
    totalAmount,
    wholesaleCost: 0,
    platformFeeAmount: feeAmount,
    sellerNetAmount,
    paymentIntentId: input.intentCode,
    paymentMethod: input.paymentMethod,
    paymentSignature: input.receiptHash,
    paymentStatus: 'paid',
    fulfillmentStatus: 'processing',
    carrierName: 'Seller Direct Shipping',
    shippingCity: input.shipping.city.slice(0, 80),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'orders', orderId, 'shipping', 'details'), {
    orderId,
    buyerUid: input.user.uid,
    recipientName: input.shipping.recipientName.slice(0, 100),
    phone: input.shipping.phone.slice(0, 32),
    addressLine: input.shipping.addressLine.slice(0, 240),
    postalCode: input.shipping.postalCode.slice(0, 16),
    countryCode: 'TH',
    createdAt: serverTimestamp(),
  });

  // Update buyer PV & debit wallet if wallet method used
  const nextBuyerPv = Number((input.buyerProfile.personalVolume + totalAmount).toFixed(2));
  const nextBuyerWallet =
    input.paymentMethod === 'wallet'
      ? Math.max(0, Number((input.buyerProfile.walletBalance - totalAmount).toFixed(2)))
      : input.buyerProfile.walletBalance;

  batch.update(doc(db, 'members', input.user.uid), {
    personalVolume: nextBuyerPv,
    walletBalance: nextBuyerWallet,
    rank: calculateRank(nextBuyerPv, input.buyerProfile.teamVolume),
    updatedAt: serverTimestamp(),
  });

  // Credit seller wallet by 95% net proceeds atomically verified via lastOrderId
  batch.update(sellerRef, {
    walletBalance: Number((sellerProfile.walletBalance + sellerNetAmount).toFixed(2)),
    lastOrderId: orderId,
    updatedAt: serverTimestamp(),
  });

  if (input.mode === 'marketplace' && input.listing) {
    const nextStock = Math.max(0, input.listing.stock - quantity);
    batch.update(doc(db, 'memberListings', input.listing.id), {
      stock: nextStock,
      status: nextStock === 0 ? 'sold_out' : 'active',
      lastOrderId: orderId,
      updatedAt: serverTimestamp(),
    });
  } else if (input.mode === 'auction' && input.auction) {
    batch.update(doc(db, 'auctions', input.auction.id), {
      status: 'settled',
      winningOrderId: orderId,
      updatedAt: serverTimestamp(),
    });
  }

  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  batch.set(doc(db, 'securityLogs', logId), {
    actorUid: input.user.uid,
    action: input.mode === 'auction' ? 'AUCTION_5PCT_SETTLED' : 'MARKETPLACE_5PCT_SETTLED',
    resourceType: 'order',
    resourceId: orderId,
    integrityHash: input.receiptHash,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
  }

  return {
    orderNumber,
    cjOrderId: input.mode === 'auction' ? 'AUCTION-DIRECT' : 'SELLER-DIRECT',
    trackingNumber: 'AWAITING-SELLER-DISPATCH',
    platformFeeAmount: feeAmount,
    sellerNetAmount,
    commissionsDistributed: [],
  };
}
