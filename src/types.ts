export type MemberRank = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
export type PaymentMethod = 'promptpay' | 'card' | 'wallet';
export type ItemCondition = 'new' | 'like_new' | 'used';
export type OrderSource = 'cj_dropship' | 'member_marketplace' | 'auction_win';
export type FulfillmentStatus =
  | 'queued'
  | 'synced_cj'
  | 'processing'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export interface ProductItem {
  sku: string;
  cjProductId: string;
  title: string;
  titleTh: string;
  category: string;
  description: string;
  descriptionTh: string;
  imageUrl: string;
  wholesaleUsd?: number;
  wholesaleCost: number;
  retailPrice: number;
  commissionPoolRate: number;
  stock: number;
  warehouse: string;
  weightGrams: number;
  active: boolean;
}

export interface MemberListingRecord {
  id: string;
  sellerUid: string;
  sellerName: string;
  title: string;
  description: string;
  category: string;
  condition: ItemCondition;
  imageUrl: string;
  price: number;
  stock: number;
  platformFeeRate: number;
  lastOrderId?: string;
  status: 'active' | 'sold_out' | 'archived';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuctionRecord {
  id: string;
  sellerUid: string;
  sellerName: string;
  title: string;
  description: string;
  category: string;
  condition: ItemCondition;
  imageUrl: string;
  startingPrice: number;
  minBidIncrement: number;
  currentBid: number;
  bidCount: number;
  highestBidderUid?: string;
  highestBidderName?: string;
  lastBidId?: string;
  winningOrderId?: string;
  platformFeeRate: number;
  endsAt?: unknown;
  status: 'live' | 'ended_pending_payment' | 'settled' | 'cancelled';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuctionBidRecord {
  id: string;
  auctionId: string;
  bidderUid: string;
  bidderName: string;
  amount: number;
  createdAt?: unknown;
}

export interface MemberProfile {
  uid: string;
  displayName: string;
  referralCode: string;
  sponsorUid?: string;
  rank: MemberRank;
  personalVolume: number;
  teamVolume: number;
  directCount: number;
  totalCommissionEarned: number;
  walletBalance: number;
  lastCommissionId?: string;
  lastOrderId?: string;
  status: 'active' | 'suspended';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MemberPrivateInfo {
  uid: string;
  email: string;
  phone?: string;
  shippingAddress?: string;
  promptPayMasked?: string;
  updatedAt?: unknown;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  orderSource?: OrderSource;
  listingId?: string;
  auctionId?: string;
  buyerUid: string;
  sellerUid: string;
  itemSku: string;
  itemTitle: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  wholesaleCost: number;
  platformFeeAmount?: number;
  sellerNetAmount?: number;
  paymentIntentId: string;
  paymentMethod: PaymentMethod;
  paymentSignature: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  cjOrderId?: string;
  fulfillmentStatus: FulfillmentStatus;
  trackingNumber?: string;
  carrierName?: string;
  shippingCity: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface OrderShippingPii {
  orderId: string;
  buyerUid: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  postalCode: string;
  countryCode: string;
}

export interface CommissionRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  beneficiaryUid: string;
  sourceBuyerUid: string;
  tier: number;
  ratePercent: number;
  commissionAmount: number;
  status: 'credited' | 'paid' | 'reversed';
  createdAt?: unknown;
}

export interface PaymentIntentRecord {
  id: string;
  intentCode: string;
  ownerUid: string;
  orderId?: string;
  amount: number;
  currency: 'THB' | 'USD';
  method: PaymentMethod;
  maskedSource: string;
  hmacSignature: string;
  idempotencyKey: string;
  status: 'requires_confirmation' | 'authorized' | 'settled' | 'failed';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PayoutRequestRecord {
  id: string;
  memberUid: string;
  amount: number;
  destinationMasked: string;
  method: 'promptpay' | 'bank_transfer';
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SecurityLogRecord {
  id: string;
  actorUid: string;
  action: string;
  resourceType: string;
  resourceId: string;
  integrityHash: string;
  createdAt?: unknown;
}

export interface CartItem {
  product: ProductItem;
  quantity: number;
}

export type DirectCheckoutTarget =
  | {
      kind: 'marketplace';
      listing: MemberListingRecord;
      quantity: number;
    }
  | {
      kind: 'auction';
      auction: AuctionRecord;
    };

export interface CjStatusResponse {
  connected: boolean;
  mode: 'live_api' | 'catalog_sync';
  maskedEmail: string;
  lastSyncedAt: string;
  warehouses: string[];
  catalogCount: number;
  markupPercent?: number;
}

export interface EmailStatusResponse {
  configured: boolean;
  provider: 'resend' | 'smtp' | 'none';
  senderMasked: string;
}

export interface EmailConfirmationResult {
  sent: boolean;
  provider: 'resend' | 'smtp' | 'none';
  toEmail: string;
  username: string;
  temporaryPassword?: string | null;
  referralCode: string;
  referralLink: string;
  loginUrl: string;
  resetPasswordUrl: string;
  mailtoDraftUrl?: string;
  message?: string;
}

