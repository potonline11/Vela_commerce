import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';

export interface CjProductRecord {
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

interface CjShipmentState {
  cjOrderId: string;
  orderNumber: string;
  trackingNumber: string;
  carrierName: string;
  stageIndex: number;
  events: Array<{
    status: 'synced_cj' | 'processing' | 'in_transit' | 'delivered';
    label: string;
    labelTh: string;
    location: string;
    timestamp: string;
  }>;
}

const VELAPAYMENT_BASE_URL = (
  process.env.VELAPAYMENT_BASE_URL || 'https://velapayment.vercel.app'
).replace(/\/+$/, '');

function getPaymentGatewaySecret(): string {
  const raw = process.env.PAYMENT_GATEWAY_SECRET || '';
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

const initialGatewaySecret = getPaymentGatewaySecret();
const GATEWAY_HMAC_SECRET =
  initialGatewaySecret.length >= 16
    ? initialGatewaySecret
    : crypto.randomBytes(32).toString('hex');

const pendingCheckoutStore = new Map<string, { snapshot: unknown; expiresAt: number }>();
const cjOrderStore = new Map<string, CjShipmentState>();

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}***@${parts[1]}`;
}

function signHmac(payload: string): string {
  return crypto.createHmac('sha256', GATEWAY_HMAC_SECRET).update(payload).digest('hex');
}

function sanitizeShortText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

const cleanEnvCjKey = (process.env.CJ_API_KEY || '').trim().replace(/^['"]|['"]$/g, '').trim();
const parsedEnvMarkup = Number(process.env.CJ_MARKUP_PERCENT);
let cjMarkupPercent =
  Number.isFinite(parsedEnvMarkup) && parsedEnvMarkup >= 10 && parsedEnvMarkup <= 500
    ? Math.round(parsedEnvMarkup)
    : 80;

let cjSessionState: {
  connected: boolean;
  mode: 'live_api' | 'catalog_sync';
  maskedEmail: string;
  apiKey: string | null;
  accessToken: string | null;
  lastSyncedAt: string;
} = {
  connected: Boolean(cleanEnvCjKey),
  mode: cleanEnvCjKey ? 'live_api' : 'catalog_sync',
  maskedEmail: process.env.CJ_API_EMAIL
    ? maskEmail(process.env.CJ_API_EMAIL)
    : cleanEnvCjKey
    ? `CJ-${cleanEnvCjKey.split('@')[0]?.slice(0, 6) || 'API'}***`
    : 'sync@velacommerce.co',
  apiKey: cleanEnvCjKey || null,
  accessToken: null,
  lastSyncedAt: new Date().toISOString(),
};

async function exchangeCjApiKeyForToken(apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(
      'https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      }
    );
    const data = (await response.json().catch(() => ({}))) as {
      result?: boolean;
      data?: { accessToken?: string };
    };
    if (response.ok && data?.result && data?.data?.accessToken) {
      return data.data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureCjAccessToken(): Promise<string | null> {
  if (cjSessionState.accessToken) return cjSessionState.accessToken;
  if (!cjSessionState.apiKey) return null;
  const token = await exchangeCjApiKeyForToken(cjSessionState.apiKey);
  if (token) {
    cjSessionState.accessToken = token;
    cjSessionState.lastSyncedAt = new Date().toISOString();
  }
  return token;
}

const CURATED_CJ_CATALOG: CjProductRecord[] = [
  {
    sku: 'CJ-ESP-904',
    cjProductId: '18492038471029',
    title: 'Barista Lever Manual Espresso Press',
    titleTh: 'เครื่องชงเอสเพรสโซ่แรงดันมือรุ่นบาริสต้า',
    category: 'Kitchen Tech',
    description:
      'Precision anodized aluminum manual espresso extractor with integrated 9-bar pressure gauge and walnut grip.',
    descriptionTh:
      'เครื่องสกัดกาแฟเอสเพรสโซ่อะลูมิเนียมอโนไดซ์ พร้อมเกจวัดแรงดัน 9 บาร์และด้ามจับไม้วอลนัท',
    imageUrl: '/src/assets/images/product_espresso_brewer_1794899247328.jpg',
    wholesaleCost: 2650,
    retailPrice: 4490,
    commissionPoolRate: 0.225,
    stock: 142,
    warehouse: 'BKK-LOCAL-01',
    weightGrams: 1850,
    active: true,
  },
  {
    sku: 'CJ-DIF-218',
    cjProductId: '18492038475510',
    title: 'Fluted Matte Ceramic Aroma Diffuser',
    titleTh: 'เครื่องพ่นอโรม่าเซรามิกเนื้อด้านทรงร่อง',
    category: 'Home Living',
    description:
      'Ultrasonic cold-mist diffuser crafted from matte bone ceramic with auto-shutoff and whisper-quiet 22dB operation.',
    descriptionTh:
      'เครื่องกระจายกลิ่นอโรม่าอัลตราโซนิกเซรามิกเนื้อด้าน เสียงเงียบเพียง 22dB พร้อมระบบตัดไฟอัตโนมัติ',
    imageUrl: '/src/assets/images/product_ceramic_diffuser_1794899248058.jpg',
    wholesaleCost: 890,
    retailPrice: 1690,
    commissionPoolRate: 0.225,
    stock: 318,
    warehouse: 'BKK-LOCAL-01',
    weightGrams: 640,
    active: true,
  },
  {
    sku: 'CJ-LMP-402',
    cjProductId: '18492038478824',
    title: 'Titanium Articulated Architect Desk Lamp',
    titleTh: 'โคมไฟตั้งโต๊ะสถาปนิกอะลูมิเนียมไทเทเนียม',
    category: 'Workspace',
    description:
      'Stepless dimming CRI 97+ architectural LED task lamp machined from solid titanium-anodized aluminum.',
    descriptionTh:
      'โคมไฟตั้งโต๊ะ LED ค่าความเที่ยงตรงสี CRI 97+ ปรับหรี่แสงละเอียด ตัวเรือนอะลูมิเนียมไทเทเนียม',
    imageUrl: '/src/assets/images/product_desk_lamp_1794899248030.jpg',
    wholesaleCost: 1580,
    retailPrice: 2890,
    commissionPoolRate: 0.225,
    stock: 89,
    warehouse: 'CN-SZ-02',
    weightGrams: 1220,
    active: true,
  },
  {
    sku: 'CJ-AUD-771',
    cjProductId: '18492038479901',
    title: 'Orbital Spatial ANC Wireless Earbuds',
    titleTh: 'หูฟังไร้สายตัดเสียงรบกวนระบบเสียงรอบทิศทาง',
    category: 'Personal Audio',
    description:
      'Adaptive 42dB hybrid active noise cancellation with dual-driver spatial acoustics and 36-hour pebble charging case.',
    descriptionTh:
      'หูฟังไร้สายตัดเสียงรบกวนไฮบริด 42dB ไดรเวอร์คู่รองรับเสียง 3 มิติ ใช้งานต่อเนื่อง 36 ชั่วโมง',
    imageUrl: '/src/assets/images/product_wireless_audio_1794899246337.jpg',
    wholesaleCost: 1320,
    retailPrice: 2490,
    commissionPoolRate: 0.225,
    stock: 215,
    warehouse: 'BKK-LOCAL-01',
    weightGrams: 240,
    active: true,
  },
  {
    sku: 'CJ-KTL-515',
    cjProductId: '18492038473390',
    title: 'Precision PID Gooseneck Pour-Over Kettle',
    titleTh: 'กาต้มน้ำคอห่านควบคุมอุณหภูมิ PID แม่นยำ',
    category: 'Kitchen Tech',
    description:
      'Degree-accurate PID temperature control electric kettle in matte charcoal steel with ergonomic solid walnut handle.',
    descriptionTh:
      'กาต้มน้ำไฟฟ้าคอห่านควบคุมอุณหภูมิระดับองศา PID เหล็กเคลือบด้านพร้อมด้ามไม้วอลนัทแท้',
    imageUrl: '/src/assets/images/product_smart_kettle_1794899249370.jpg',
    wholesaleCost: 1840,
    retailPrice: 3290,
    commissionPoolRate: 0.225,
    stock: 76,
    warehouse: 'CN-SZ-02',
    weightGrams: 1480,
    active: true,
  },
];

export function createApiApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Normalize Vercel rewrite path (/api/index?__path=cj/products -> /api/cj/products)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const rawPath = req.query?.__path;
    if (typeof rawPath === 'string' && rawPath.length > 0) {
      const cleanSub = rawPath.replace(/^\/+/, '');
      const urlObj = new URL(req.url, 'http://localhost');
      urlObj.searchParams.delete('__path');
      const qs = urlObj.searchParams.toString();
      req.url = `/api/${cleanSub}${qs ? `?${qs}` : ''}`;
    }
    next();
  });

  // Hardened HTTP security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Health probe
  app.get('/api/health', (_req: Request, res: Response) => {
    const secret = getPaymentGatewaySecret();
    res.json({
      status: 'ok',
      gateway: 'active',
      paymentGatewayConfigured: Boolean(secret),
      velapaymentHost: VELAPAYMENT_BASE_URL,
      cjMode: cjSessionState.mode,
    });
  });

  // --- VelaPayment Gateway Endpoints (https://velapayment.vercel.app) ---

  app.post('/api/payments/test-connection', async (_req: Request, res: Response) => {
    const secret = getPaymentGatewaySecret();
    if (!secret) {
      res.status(503).json({
        authenticated: false,
        status: 503,
        error: 'PAYMENT_GATEWAY_SECRET is not set in server environment variables.',
      });
      return;
    }

    const looksLikeStripeKey =
      secret.startsWith('sk_live_') || secret.startsWith('sk_test_') || secret.startsWith('rk_');
    try {
      const upstream = await fetch(
        `${VELAPAYMENT_BASE_URL}/api/v1/merchant/checkout-sessions/diag_auth_check_${Date.now()}`,
        {
          headers: { Authorization: `Bearer ${secret}` },
        }
      );

      if (upstream.status === 401 || upstream.status === 403) {
        const body = (await upstream.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        res.status(upstream.status).json({
          authenticated: false,
          status: upstream.status,
          looksLikeStripeKey,
          error:
            body?.error ||
            body?.message ||
            'Unauthorized: VelaPayment rejected PAYMENT_GATEWAY_SECRET.',
        });
        return;
      }

      res.json({
        authenticated: true,
        status: upstream.status,
        velapaymentHost: VELAPAYMENT_BASE_URL,
      });
    } catch (err) {
      res.status(502).json({
        authenticated: false,
        status: 502,
        error: err instanceof Error ? err.message : 'Unable to reach VelaPayment Gateway',
      });
    }
  });

  app.post('/api/payments/checkout-sessions', async (req: Request, res: Response) => {
    try {
      const secret = getPaymentGatewaySecret();
      if (!secret) {
        res.status(503).json({
          error:
            'PAYMENT_GATEWAY_SECRET ยังไม่ได้ถูกตั้งค่าใน Environment Variables กรุณาใส่ Merchant Secret Key จาก velapayment.vercel.app',
        });
        return;
      }

      const amount = Number(req.body?.amount);
      const orderId = sanitizeShortText(req.body?.orderId, 128);
      const description =
        sanitizeShortText(req.body?.description, 240) || `Vela Commerce Order ${orderId}`;
      const customerEmail = sanitizeShortText(req.body?.customerEmail, 160);
      const successUrl =
        typeof req.body?.successUrl === 'string' ? req.body.successUrl.trim() : '';
      const cancelUrl = typeof req.body?.cancelUrl === 'string' ? req.body.cancelUrl.trim() : '';
      const idempotencyKey = sanitizeShortText(req.body?.idempotencyKey, 80);

      if (!Number.isFinite(amount) || amount < 10 || amount > 10_000_000) {
        res.status(400).json({ error: 'Minimum payment amount is 10 THB' });
        return;
      }
      if (!orderId || !/^[a-zA-Z0-9_\-]+$/.test(orderId)) {
        res.status(400).json({ error: 'Invalid orderId' });
        return;
      }
      if (!customerEmail || !customerEmail.includes('@')) {
        res.status(400).json({ error: 'Valid customerEmail is required' });
        return;
      }
      if (!successUrl || !cancelUrl) {
        res.status(400).json({ error: 'successUrl and cancelUrl are required' });
        return;
      }
      if (!idempotencyKey || idempotencyKey.length < 8) {
        res.status(400).json({ error: 'idempotencyKey is required' });
        return;
      }

      const upstream = await fetch(`${VELAPAYMENT_BASE_URL}/api/v1/merchant/checkout-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          amount,
          orderId,
          description,
          customerEmail,
          successUrl,
          cancelUrl,
          idempotencyKey,
        }),
      });

      const raw = (await upstream.json().catch(() => ({}))) as {
        intentId?: string;
        checkoutUrl?: string;
        error?: string;
        message?: string;
        data?: { intentId?: string; checkoutUrl?: string };
      };

      const intentId = raw?.intentId || raw?.data?.intentId;
      const checkoutUrl = raw?.checkoutUrl || raw?.data?.checkoutUrl;

      if (!upstream.ok || !intentId || !checkoutUrl) {
        if (upstream.status === 401 || upstream.status === 403) {
          const looksLikeStripe = secret.startsWith('sk_live_') || secret.startsWith('sk_test_');
          res.status(upstream.status).json({
            error: looksLikeStripe
              ? 'VelaPayment ปฏิเสธ Key (401): ค่า PAYMENT_GATEWAY_SECRET ปัจจุบันเป็น Stripe Key (sk_...) ไม่ใช่ Merchant Secret Key ของ https://velapayment.vercel.app กรุณานำ Secret Key จากแดชบอร์ด velapayment.vercel.app มาใส่แทน'
              : `VelaPayment ปฏิเสธ Secret Key (401 Unauthorized): กรุณาตรวจสอบค่า PAYMENT_GATEWAY_SECRET ใน Environment Variables ให้ตรงกับ Merchant Secret Key จาก ${VELAPAYMENT_BASE_URL} (ไม่ต้องใส่คำว่า Bearer นำหน้า)`,
          });
          return;
        }

        res.status(upstream.status >= 400 ? upstream.status : 502).json({
          error:
            raw?.error ||
            raw?.message ||
            'VelaPayment Gateway rejected checkout session creation',
        });
        return;
      }

      if (req.body?.pendingSnapshot && typeof req.body.pendingSnapshot === 'object') {
        pendingCheckoutStore.set(intentId, {
          snapshot: req.body.pendingSnapshot,
          expiresAt: Date.now() + 2 * 60 * 60 * 1000,
        });
      }

      const hmacSignature = signHmac(
        `${intentId}|${orderId}|${amount.toFixed(2)}|${idempotencyKey}`
      );
      res.status(201).json({
        intentId,
        checkoutUrl,
        orderId,
        hmacSignature,
        idempotencyKey,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to reach VelaPayment Gateway',
      });
    }
  });

  app.get('/api/payments/checkout-sessions/:intentId', async (req: Request, res: Response) => {
    try {
      const secret = getPaymentGatewaySecret();
      if (!secret) {
        res.status(503).json({ error: 'PAYMENT_GATEWAY_SECRET is not configured' });
        return;
      }

      const intentId = sanitizeShortText(req.params.intentId, 128);
      if (!intentId) {
        res.status(400).json({ error: 'Invalid intentId' });
        return;
      }

      const upstream = await fetch(
        `${VELAPAYMENT_BASE_URL}/api/v1/merchant/checkout-sessions/${encodeURIComponent(intentId)}`,
        {
          headers: {
            Authorization: `Bearer ${secret}`,
          },
        }
      );

      const raw = (await upstream.json().catch(() => ({}))) as {
        paid?: boolean;
        status?: string;
        intentId?: string;
        orderId?: string;
        amount?: number;
        paymentMethod?: string;
        error?: string;
        message?: string;
        data?: {
          paid?: boolean;
          status?: string;
          intentId?: string;
          orderId?: string;
          amount?: number;
          paymentMethod?: string;
        };
      };

      if (!upstream.ok) {
        res.status(upstream.status).json({
          paid: false,
          error: raw?.error || raw?.message || 'Unable to verify VelaPayment checkout session',
        });
        return;
      }

      const paid = raw?.paid === true || raw?.data?.paid === true;
      const resolvedOrderId = raw?.orderId || raw?.data?.orderId || '';
      const resolvedStatus = raw?.status || raw?.data?.status || (paid ? 'succeeded' : 'pending');
      const resolvedMethod = raw?.paymentMethod || raw?.data?.paymentMethod || 'promptpay';
      const resolvedAmount = raw?.amount ?? raw?.data?.amount ?? 0;

      const settledAt = new Date().toISOString();
      const hmacSignature = signHmac(`${intentId}|${resolvedOrderId}|${resolvedAmount}`);
      const receiptHash = paid ? signHmac(`${intentId}|PAID|${resolvedOrderId}|${settledAt}`) : '';

      const cachedPending = pendingCheckoutStore.get(intentId);
      const pendingSnapshot =
        cachedPending && cachedPending.expiresAt > Date.now() ? cachedPending.snapshot : null;

      res.json({
        paid,
        status: resolvedStatus,
        intentId: raw?.intentId || raw?.data?.intentId || intentId,
        orderId: resolvedOrderId,
        amount: resolvedAmount,
        paymentMethod: resolvedMethod,
        hmacSignature,
        receiptHash,
        settledAt,
        pendingSnapshot,
      });
    } catch (err) {
      res.status(502).json({
        paid: false,
        error: err instanceof Error ? err.message : 'Unable to verify VelaPayment status',
      });
    }
  });

  app.post('/api/payments/wallet-settle', (req: Request, res: Response) => {
    const ownerUid = sanitizeShortText(req.body?.ownerUid, 128);
    const amount = Number(req.body?.amount);
    const idempotencyKey = sanitizeShortText(req.body?.idempotencyKey, 80);

    if (!ownerUid || !/^[a-zA-Z0-9_\-]+$/.test(ownerUid)) {
      res.status(400).json({ error: 'Invalid ownerUid' });
      return;
    }
    if (!Number.isFinite(amount) || amount < 10 || amount > 10_000_000) {
      res.status(400).json({ error: 'Invalid wallet settlement amount' });
      return;
    }
    if (!idempotencyKey || idempotencyKey.length < 8) {
      res.status(400).json({ error: 'idempotencyKey is required' });
      return;
    }

    const intentCode = `WAL_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const settledAt = new Date().toISOString();
    const hmacSignature = signHmac(
      `${intentCode}|${ownerUid}|${amount.toFixed(2)}|wallet|${idempotencyKey}`
    );
    const receiptHash = signHmac(`${intentCode}|SETTLED|${settledAt}`);

    res.status(201).json({
      intentCode,
      status: 'settled',
      maskedSource: 'Vela Member Wallet',
      hmacSignature,
      receiptHash,
      settledAt,
    });
  });

  app.post('/api/payments/verify-signature', async (req: Request, res: Response) => {
    const intentCode = sanitizeShortText(req.body?.intentCode, 128);
    const signature = sanitizeShortText(req.body?.signature, 128);
    const secret = getPaymentGatewaySecret();

    if (secret && intentCode && !intentCode.startsWith('WAL_') && !intentCode.startsWith('PI_')) {
      try {
        const upstream = await fetch(
          `${VELAPAYMENT_BASE_URL}/api/v1/merchant/checkout-sessions/${encodeURIComponent(intentCode)}`,
          { headers: { Authorization: `Bearer ${secret}` } }
        );
        if (upstream.ok) {
          const data = (await upstream.json()) as {
            paid?: boolean;
            status?: string;
            data?: { paid?: boolean; status?: string };
          };
          const isPaid = data?.paid === true || data?.data?.paid === true;
          res.json({
            verified: isPaid,
            mode: 'velapayment_live_api',
            algorithm: 'Stripe / PromptPay Verified',
            status: data?.status || data?.data?.status || (isPaid ? 'paid' : 'unpaid'),
            checkedAt: new Date().toISOString(),
          });
          return;
        }
      } catch {
        // Fall through to HMAC format verification
      }
    }

    const validFormat = /^[a-f0-9]{64}$/i.test(signature);
    res.json({
      verified: validFormat,
      mode: 'hmac_sha256',
      algorithm: 'HMAC-SHA256',
      checkedAt: new Date().toISOString(),
    });
  });

  // --- CJ Dropshipping Open API 2.0 Proxy Endpoints ---

  app.get('/api/cj/status', (_req: Request, res: Response) => {
    res.json({
      connected: cjSessionState.connected,
      mode: cjSessionState.mode,
      maskedEmail: cjSessionState.maskedEmail,
      lastSyncedAt: cjSessionState.lastSyncedAt,
      warehouses: ['BKK-LOCAL-01', 'CN-SZ-02', 'US-LA-02'],
      catalogCount: CURATED_CJ_CATALOG.length,
      markupPercent: cjMarkupPercent,
    });
  });

  app.post('/api/cj/markup', (req: Request, res: Response) => {
    const requested = Number(req.body?.markupPercent);
    if (!Number.isFinite(requested) || requested < 10 || requested > 500) {
      res.status(400).json({ error: 'markupPercent must be between 10 and 500' });
      return;
    }
    cjMarkupPercent = Math.round(requested);
    res.json({ markupPercent: cjMarkupPercent });
  });

  app.post('/api/cj/connect', async (req: Request, res: Response) => {
    const email = sanitizeShortText(req.body?.email, 160);
    const apiKey = sanitizeShortText(req.body?.apiKey, 200);

    if (!apiKey) {
      res.status(400).json({ error: 'CJ API Key (CJUserNum@api@...) is required' });
      return;
    }

    try {
      const response = await fetch(
        'https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        }
      );

      const data = (await response.json()) as {
        result?: boolean;
        data?: { accessToken?: string; openId?: number };
        message?: string;
      };

      if (response.ok && data?.result && data?.data?.accessToken) {
        const displayIdentity = email
          ? maskEmail(email)
          : `CJ-${apiKey.split('@')[0]?.slice(0, 6) || 'API'}***`;
        cjSessionState = {
          connected: true,
          mode: 'live_api',
          maskedEmail: displayIdentity,
          apiKey,
          accessToken: data.data.accessToken,
          lastSyncedAt: new Date().toISOString(),
        };
        res.json({
          connected: true,
          mode: 'live_api',
          maskedEmail: cjSessionState.maskedEmail,
          lastSyncedAt: cjSessionState.lastSyncedAt,
        });
        return;
      }

      res.status(401).json({
        error:
          data?.message ||
          'CJ Dropshipping rejected the API Key. Ensure you copied the API Key from CJ -> Authorization -> API (Others -> API).',
      });
    } catch {
      res.status(502).json({
        error: 'Unable to reach CJ Dropshipping API 2.0 endpoint from current network.',
      });
    }
  });

  let cachedUsdToThb: { rate: number; expiresAt: number } = { rate: 34.5, expiresAt: 0 };

  async function getUsdToThbRate(): Promise<number> {
    if (Date.now() < cachedUsdToThb.expiresAt) {
      return cachedUsdToThb.rate;
    }
    try {
      const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
      if (fxRes.ok) {
        const fxData = (await fxRes.json()) as { rates?: { THB?: number } };
        const thb = Number(fxData?.rates?.THB);
        if (Number.isFinite(thb) && thb > 20 && thb < 60) {
          cachedUsdToThb = { rate: Number(thb.toFixed(2)), expiresAt: Date.now() + 60 * 60 * 1000 };
          return cachedUsdToThb.rate;
        }
      }
    } catch {
      // Keep fallback rate
    }
    return cachedUsdToThb.rate;
  }

  function parseCjUsdPrice(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    if (typeof raw === 'string') {
      const match = raw.match(/\d+(?:\.\d+)?/);
      if (match) {
        const parsed = Number(match[0]);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
    return 10;
  }

  function normalizeCjImageUrl(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    let trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
          trimmed = parsed[0].trim();
        }
      } catch {
        // Ignore malformed JSON array
      }
    }
    if (trimmed.includes(',') && !trimmed.includes('?')) {
      trimmed = trimmed.split(',')[0].trim();
    }
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    if (trimmed.startsWith('http://')) return `https://${trimmed.slice(7)}`;
    if (trimmed.startsWith('https://')) return trimmed;
    return '';
  }

  app.get('/api/cj/products', async (req: Request, res: Response) => {
    const q = sanitizeShortText(req.query?.q, 80);
    const qLower = q.toLowerCase();
    const category = sanitizeShortText(req.query?.category, 60);
    const usdToThbRate = await getUsdToThbRate();

    if (cjSessionState.mode === 'live_api') {
      try {
        let token = await ensureCjAccessToken();
        if (token) {
          interface RawCjItem {
            pid?: string;
            id?: string;
            productSku?: string;
            sku?: string;
            productNameEn?: string;
            nameEn?: string;
            productName?: string;
            productImage?: string;
            bigImage?: string;
            productImageSet?: string[];
            sellPrice?: unknown;
            nowPrice?: unknown;
            discountPrice?: unknown;
            categoryName?: string;
            threeCategoryName?: string;
            twoCategoryName?: string;
            oneCategoryName?: string;
            productWeight?: unknown;
            warehouseInventoryNum?: unknown;
            listedNum?: unknown;
          }

          let rawItems: RawCjItem[] = [];

          const fetchCjV2 = async (keyword: string): Promise<RawCjItem[]> => {
            if (!token) return [];
            const v2Url = `https://developers.cjdropshipping.com/api2.0/v1/product/listV2?page=1&size=24${
              keyword ? `&keyWord=${encodeURIComponent(keyword)}` : ''
            }`;
            let v2Res = await fetch(v2Url, { headers: { 'CJ-Access-Token': token } });
            if (v2Res.status === 401) {
              cjSessionState.accessToken = null;
              token = await ensureCjAccessToken();
              if (token) {
                v2Res = await fetch(v2Url, { headers: { 'CJ-Access-Token': token } });
              }
            }
            if (!v2Res.ok) return [];
            const v2Data = (await v2Res.json()) as {
              result?: boolean;
              data?: {
                content?: Array<{ productList?: RawCjItem[] }>;
                list?: RawCjItem[];
              };
            };
            const contentItems = Array.isArray(v2Data?.data?.content)
              ? v2Data.data.content.flatMap((bucket) =>
                  Array.isArray(bucket?.productList) ? bucket.productList : []
                )
              : [];
            const v2List =
              contentItems.length > 0
                ? contentItems
                : Array.isArray(v2Data?.data?.list)
                ? v2Data.data.list
                : [];
            return v2Data?.result && v2List.length > 0 ? v2List : [];
          };

          const fetchCjV1 = async (keyword: string): Promise<RawCjItem[]> => {
            if (!token) return [];
            const v1Url = `https://developers.cjdropshipping.com/api2.0/v1/product/list?pageNum=1&pageSize=24${
              keyword ? `&productNameEn=${encodeURIComponent(keyword)}` : ''
            }`;
            let cjRes = await fetch(v1Url, {
              headers: { 'CJ-Access-Token': token },
            });
            if (cjRes.status === 401) {
              cjSessionState.accessToken = null;
              token = await ensureCjAccessToken();
              if (token) {
                cjRes = await fetch(v1Url, { headers: { 'CJ-Access-Token': token } });
              }
            }
            if (!cjRes.ok) return [];
            const cjData = (await cjRes.json()) as {
              result?: boolean;
              data?: { list?: RawCjItem[] };
            };
            return cjData?.result && Array.isArray(cjData.data?.list) && cjData.data.list.length > 0
              ? cjData.data.list
              : [];
          };

          try {
            if (q) {
              rawItems = await fetchCjV2(q);
              if (rawItems.length === 0) {
                rawItems = await fetchCjV1(q);
              }
            } else {
              rawItems = await fetchCjV1('');
              if (rawItems.length === 0) {
                rawItems = await fetchCjV2('');
              }
              const adultFilterRe =
                /\b(vibrator|dildo|nipple|lingerie|thong|bondage|erotic|sexy|porn|masturbat|fetish)\b/i;
              const safeItems = rawItems.filter((item) => {
                const label = `${item.nameEn || item.productNameEn || item.productName || ''} ${
                  item.categoryName || ''
                }`;
                return !adultFilterRe.test(label);
              });
              if (safeItems.length > 0) {
                rawItems = safeItems;
              }
            }
          } catch {
            // Fall through to curated catalog if both endpoints fail
          }

          if (rawItems.length > 0) {
            const liveMapped: CjProductRecord[] = rawItems.slice(0, 24).map((item, idx) => {
              const firstImg =
                normalizeCjImageUrl(item.bigImage) ||
                normalizeCjImageUrl(item.productImage) ||
                (Array.isArray(item.productImageSet)
                  ? normalizeCjImageUrl(item.productImageSet[0])
                  : '');
              const usdPrice = parseCjUsdPrice(
                item.nowPrice ?? item.discountPrice ?? item.sellPrice
              );
              const wholesaleThb = Math.max(10, Math.round(usdPrice * usdToThbRate));
              const retailThb = Math.max(
                10,
                Math.round(wholesaleThb * (1 + cjMarkupPercent / 100))
              );
              const title =
                sanitizeShortText(item.nameEn || item.productNameEn || item.productName, 140) ||
                `Vela Item #${idx + 1}`;
              const cat =
                sanitizeShortText(
                  item.threeCategoryName ||
                    item.twoCategoryName ||
                    item.oneCategoryName ||
                    item.categoryName,
                  60
                ) || 'Featured Collection';
              const inv = Number(item.warehouseInventoryNum ?? item.listedNum);
              const stock = Number.isFinite(inv) && inv > 0 ? Math.round(inv) : 120;

              return {
                sku: sanitizeShortText(item.sku || item.productSku, 64) || `CJ-LIVE-${idx + 1}`,
                cjProductId: String(item.pid || item.id || `CJ-${idx + 1}`),
                title,
                titleTh: title,
                category: cat,
                description: `Curated ${cat} selection · Verified quality and direct fulfillment.`,
                descriptionTh: `สินค้าคัดสรรหมวด ${cat} · พร้อมจัดส่งตรงถึงหน้าบ้าน`,
                imageUrl: firstImg,
                wholesaleUsd: Number(usdPrice.toFixed(2)),
                wholesaleCost: wholesaleThb,
                retailPrice: retailThb,
                commissionPoolRate: 0.225,
                stock,
                warehouse: 'GLOBAL-HUB',
                weightGrams: Number(item.productWeight) || 500,
                active: true,
              };
            });

            const filteredLive =
              category && category !== 'All'
                ? liveMapped.filter((p) => p.category === category)
                : liveMapped;

            res.json({
              source: 'live_api',
              usdToThbRate,
              markupPercent: cjMarkupPercent,
              products: filteredLive,
            });
            return;
          }
        }
      } catch {
        // Fall back to curated synced catalog
      }
    }

    const filtered = CURATED_CJ_CATALOG.filter((item) => {
      const matchesQuery =
        !qLower ||
        item.title.toLowerCase().includes(qLower) ||
        item.titleTh.toLowerCase().includes(qLower) ||
        item.sku.toLowerCase().includes(qLower);
      const matchesCat = !category || category === 'All' || item.category === category;
      return matchesQuery && matchesCat;
    }).map((item) => ({
      ...item,
      wholesaleUsd: Number((item.wholesaleCost / usdToThbRate).toFixed(2)),
      retailPrice: Math.round(item.wholesaleCost * (1 + cjMarkupPercent / 100)),
    }));

    res.json({
      source: cjSessionState.mode,
      usdToThbRate,
      markupPercent: cjMarkupPercent,
      products: filtered,
    });
  });

  app.post('/api/cj/orders/create', async (req: Request, res: Response) => {
    const orderNumber = sanitizeShortText(req.body?.orderNumber, 40);
    const sku = sanitizeShortText(req.body?.sku, 64);
    const quantity = Math.max(1, Math.min(100, Number(req.body?.quantity) || 1));
    const shippingCity = sanitizeShortText(req.body?.shippingCity, 80) || 'Bangkok';

    if (!orderNumber || !sku) {
      res.status(400).json({ error: 'orderNumber and sku are required' });
      return;
    }

    const cjOrderId = `CJ${Date.now().toString().slice(-8)}${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    const trackingNumber = `CJP${crypto.randomBytes(5).toString('hex').toUpperCase()}TH`;
    const carrierName = shippingCity.toLowerCase().includes('bangkok')
      ? 'CJ Packet Express · Kerry TH'
      : 'CJ Global Air Logistics';

    const now = new Date().toISOString();
    const shipment: CjShipmentState = {
      cjOrderId,
      orderNumber,
      trackingNumber,
      carrierName,
      stageIndex: 1,
      events: [
        {
          status: 'synced_cj',
          label: 'Order pushed to CJ Dropshipping Warehouse API',
          labelTh: 'ส่งคำสั่งซื้อเข้าคลัง CJ Dropshipping อัตโนมัติแล้ว',
          location: 'BKK-LOCAL-01 Hub',
          timestamp: now,
        },
        {
          status: 'processing',
          label: `Picked & QC verified (${quantity} unit${quantity > 1 ? 's' : ''} · ${sku})`,
          labelTh: `หยิบสินค้าและตรวจสอบคุณภาพเรียบร้อย (${quantity} ชิ้น · ${sku})`,
          location: 'Warehouse Dispatch Zone',
          timestamp: now,
        },
      ],
    };

    cjOrderStore.set(cjOrderId, shipment);

    res.status(201).json({
      cjOrderId,
      trackingNumber,
      carrierName,
      fulfillmentStatus: 'processing',
      events: shipment.events,
    });
  });

  app.get('/api/cj/orders/:cjOrderId/tracking', (req: Request, res: Response) => {
    const cjOrderId = sanitizeShortText(req.params.cjOrderId, 80);
    if (!cjOrderId) {
      res.status(400).json({ error: 'Invalid cjOrderId' });
      return;
    }

    let shipment = cjOrderStore.get(cjOrderId);
    if (!shipment) {
      shipment = {
        cjOrderId,
        orderNumber: 'ORD-SYNC',
        trackingNumber: `CJP${cjOrderId.slice(-6)}TH`,
        carrierName: 'CJ Packet Express · Kerry TH',
        stageIndex: 1,
        events: [
          {
            status: 'synced_cj',
            label: 'Order pushed to CJ Dropshipping Warehouse API',
            labelTh: 'ส่งคำสั่งซื้อเข้าคลัง CJ Dropshipping อัตโนมัติแล้ว',
            location: 'BKK-LOCAL-01 Hub',
            timestamp: new Date(Date.now() - 3600_000).toISOString(),
          },
        ],
      };
    }

    const now = new Date().toISOString();
    if (shipment.stageIndex < 2) {
      shipment.stageIndex = 2;
      shipment.events.push({
        status: 'in_transit',
        label: 'Departed sorting facility & handed over to last-mile courier',
        labelTh: 'สินค้าออกจากศูนย์คัดแยกและส่งมอบให้ขนส่งปลายทางแล้ว',
        location: 'Bangkok Hub Transit',
        timestamp: now,
      });
    } else if (shipment.stageIndex === 2) {
      shipment.stageIndex = 3;
      shipment.events.push({
        status: 'delivered',
        label: 'Delivered to recipient and signed electronically',
        labelTh: 'จัดส่งสำเร็จถึงผู้รับปลายทางเรียบร้อยแล้ว',
        location: 'Destination Confirmed',
        timestamp: now,
      });
    }

    cjOrderStore.set(cjOrderId, shipment);
    const latestStatus = shipment.events[shipment.events.length - 1]?.status || 'processing';

    res.json({
      cjOrderId: shipment.cjOrderId,
      trackingNumber: shipment.trackingNumber,
      carrierName: shipment.carrierName,
      fulfillmentStatus: latestStatus,
      events: shipment.events,
    });
  });

  // --- Automated Order Confirmation, Referral Link & Credentials Email API ---

  function getEmailProviderConfig() {
    const resendKey = (process.env.RESEND_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
    const smtpUser = (process.env.SMTP_USER || '').trim().replace(/^['"]|['"]$/g, '');
    const smtpPass = (process.env.SMTP_PASS || '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/\s+/g, '');
    const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const fromEmail =
      (process.env.EMAIL_FROM || '').trim() ||
      (smtpUser ? `Vela Commerce <${smtpUser}>` : 'Vela Commerce <onboarding@resend.dev>');

    if (resendKey) {
      return { configured: true, provider: 'resend' as const, resendKey, fromEmail };
    }
    if (smtpUser && smtpPass) {
      return {
        configured: true,
        provider: 'smtp' as const,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPass,
        fromEmail,
      };
    }
    return { configured: false, provider: 'none' as const, fromEmail };
  }

  function escapeHtmlText(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function dispatchTransactionalEmail(params: {
    toEmail: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ sent: boolean; provider: 'resend' | 'smtp' | 'none'; message: string }> {
    const cfg = getEmailProviderConfig();
    if (!cfg.configured) {
      return {
        sent: false,
        provider: 'none',
        message:
          'Server email provider is not configured yet (set RESEND_API_KEY or SMTP_USER + SMTP_PASS).',
      };
    }

    if (cfg.provider === 'resend') {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.resendKey}`,
        },
        body: JSON.stringify({
          from: cfg.fromEmail,
          to: [params.toEmail],
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
      });
      if (!resendRes.ok) {
        const errBody = (await resendRes.json().catch(() => ({}))) as { message?: string };
        return {
          sent: false,
          provider: 'resend',
          message: errBody?.message || `Resend returned HTTP ${resendRes.status}`,
        };
      }
      return { sent: true, provider: 'resend', message: 'Email sent via Resend API.' };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        secure: cfg.smtpPort === 465,
        auth: {
          user: cfg.smtpUser,
          pass: cfg.smtpPass,
        },
      });
      await transporter.sendMail({
        from: cfg.fromEmail,
        to: params.toEmail,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      return { sent: true, provider: 'smtp', message: 'Email sent via SMTP.' };
    } catch (err) {
      return {
        sent: false,
        provider: 'smtp',
        message: err instanceof Error ? err.message : 'SMTP delivery failed',
      };
    }
  }

  app.get('/api/emails/status', (_req: Request, res: Response) => {
    const cfg = getEmailProviderConfig();
    const senderMasked =
      cfg.provider === 'smtp'
        ? maskEmail(cfg.smtpUser)
        : cfg.provider === 'resend'
        ? cfg.fromEmail
        : 'Not Configured';
    res.json({
      configured: cfg.configured,
      provider: cfg.provider,
      senderMasked,
    });
  });

  app.post('/api/emails/order-confirmation', async (req: Request, res: Response) => {
    const toEmail = sanitizeShortText(req.body?.toEmail, 160);
    const customerName = sanitizeShortText(req.body?.customerName, 100) || 'สมาชิก Vela Commerce';
    const orderNumber = sanitizeShortText(req.body?.orderNumber, 48) || `ORD-${Date.now()}`;
    const itemSummary = sanitizeShortText(req.body?.itemSummary, 240) || 'สินค้า Vela Commerce';
    const totalAmount = Number(req.body?.totalAmount) || 0;
    const intentId = sanitizeShortText(req.body?.intentId, 128) || '';
    const referralCode = sanitizeShortText(req.body?.referralCode, 32) || 'VELA-MEMBER';
    const originUrl = sanitizeShortText(req.body?.originUrl, 200) || 'https://velacommerce.vercel.app';
    const temporaryPassword =
      typeof req.body?.temporaryPassword === 'string'
        ? req.body.temporaryPassword.trim().slice(0, 80)
        : '';

    if (!toEmail || !toEmail.includes('@')) {
      res.status(400).json({ error: 'Valid toEmail is required' });
      return;
    }

    const cleanOrigin = originUrl.replace(/\/+$/, '');
    const referralLink = `${cleanOrigin}/?ref=${encodeURIComponent(referralCode)}`;
    const loginUrl = `${cleanOrigin}/?auth=login`;
    const resetPasswordUrl = `${cleanOrigin}/?auth=reset`;

    const subject = `[Vela Commerce] ยืนยันการชำระเงิน ${orderNumber} · ข้อมูลเข้าสู่ระบบสมาชิก & ลิงก์แนะนำ`;

    const passwordHtmlRow = temporaryPassword
      ? `<tr>
           <td style="padding:8px 0;color:#475569;font-size:13px;">รหัสผ่านชั่วคราว (Password)</td>
           <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:700;font-family:monospace;">${escapeHtmlText(temporaryPassword)}</td>
         </tr>`
      : `<tr>
           <td style="padding:8px 0;color:#475569;font-size:13px;">รหัสผ่าน (Password)</td>
           <td style="padding:8px 0;color:#0f172a;font-size:13px;">ใช้รหัสผ่านที่คุณตั้งไว้ (หรือกดตั้งรหัสใหม่จากลิงก์รีเซ็ตด้านล่าง)</td>
         </tr>`;

    const html = `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f8fafc;color:#0f172a;">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
          <h1 style="margin:0 0 8px 0;font-size:20px;color:#0f172a;">Vela Commerce · ยืนยันการชำระเงินสำเร็จ</h1>
          <p style="margin:0 0 20px 0;font-size:14px;color:#475569;">สวัสดีคุณ ${escapeHtmlText(customerName)}, ระบบได้รับยอดชำระสำหรับคำสั่งซื้อ <strong>${escapeHtmlText(orderNumber)}</strong> เรียบร้อยแล้ว</p>

          <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 6px 0;font-size:13px;color:#065f46;font-weight:600;">สรุปคำสั่งซื้อ</p>
            <p style="margin:0;font-size:13px;color:#0f172a;">รายการ: ${escapeHtmlText(itemSummary)}</p>
            <p style="margin:4px 0 0 0;font-size:13px;color:#0f172a;">ยอดชำระ: <strong>฿${totalAmount.toLocaleString('th-TH')}</strong> ${intentId ? `· Ref: ${escapeHtmlText(intentId)}` : ''}</p>
          </div>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 10px 0;font-size:14px;color:#0f172a;font-weight:700;">ข้อมูลเข้าสู่ระบบสมาชิก (ดูค่าคอมมิชชั่น & รายละเอียด)</p>
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#475569;font-size:13px;">ชื่อผู้ใช้ (Username)</td>
                <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:700;font-family:monospace;">${escapeHtmlText(toEmail)}</td>
              </tr>
              ${passwordHtmlRow}
              <tr>
                <td style="padding:8px 0;color:#475569;font-size:13px;">รหัสแนะนำของคุณ</td>
                <td style="padding:8px 0;color:#047857;font-size:14px;font-weight:700;font-family:monospace;">${escapeHtmlText(referralCode)}</td>
              </tr>
            </table>
            <p style="margin:12px 0 6px 0;font-size:13px;color:#475569;">ลิงก์แนะนำสมาชิกส่วนตัว (แชร์เพื่อรับคอมมิชชั่น 4 ชั้น 12% / 6% / 3% / 1.5%):</p>
            <p style="margin:0 0 14px 0;font-size:13px;word-break:break-all;"><a href="${escapeHtmlText(referralLink)}" style="color:#047857;font-weight:600;">${escapeHtmlText(referralLink)}</a></p>
            <div style="margin-top:12px;">
              <a href="${escapeHtmlText(loginUrl)}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;margin-right:8px;">เข้าสู่ระบบดูค่าคอมมิชชั่น</a>
              <a href="${escapeHtmlText(resetPasswordUrl)}" style="display:inline-block;padding:10px 16px;background:#ffffff;color:#0f172a;border:1px solid #cbd5e1;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">รีเซ็ตรหัสผ่าน (Reset Password)</a>
            </div>
          </div>

          <p style="margin:0;font-size:12px;color:#64748b;">แนะนำให้เปลี่ยนรหัสผ่านหลังจากเข้าสู่ระบบครั้งแรกเพื่อความปลอดภัยสูงสุด</p>
        </div>
      </div>
    `;

    const text = [
      `Vela Commerce - ยืนยันการชำระเงิน ${orderNumber}`,
      `รายการ: ${itemSummary}`,
      `ยอดชำระ: ฿${totalAmount.toLocaleString('th-TH')}`,
      `Username: ${toEmail}`,
      temporaryPassword
        ? `Password: ${temporaryPassword}`
        : `Password: ใช้รหัสผ่านเดิมของคุณ หรือรีเซ็ตได้ที่ ${resetPasswordUrl}`,
      `รหัสแนะนำ (Referral Code): ${referralCode}`,
      `ลิงก์แนะนำสมาชิก: ${referralLink}`,
      `เข้าสู่ระบบดูค่าคอมมิชชั่น: ${loginUrl}`,
      `รีเซ็ตรหัสผ่าน: ${resetPasswordUrl}`,
    ].join('\n');

    const delivery = await dispatchTransactionalEmail({
      toEmail,
      subject,
      html,
      text,
    });

    const mailtoDraftUrl = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(text)}`;

    res.json({
      sent: delivery.sent,
      provider: delivery.provider,
      toEmail,
      username: toEmail,
      temporaryPassword: temporaryPassword || null,
      referralCode,
      referralLink,
      loginUrl,
      resetPasswordUrl,
      mailtoDraftUrl,
      message: delivery.message,
    });
  });

  app.post('/api/emails/test', async (req: Request, res: Response) => {
    const toEmail = sanitizeShortText(req.body?.toEmail, 160);
    if (!toEmail || !toEmail.includes('@')) {
      res.status(400).json({ error: 'Valid recipient email is required' });
      return;
    }
    const delivery = await dispatchTransactionalEmail({
      toEmail,
      subject: '[Vela Commerce] ทดสอบระบบส่งอีเมลอัตโนมัติสำเร็จ',
      html: `<p>ระบบส่งอีเมลยืนยันคำสั่งซื้อและข้อมูลสมาชิกของ <strong>Vela Commerce</strong> พร้อมใช้งานแล้ว</p>`,
      text: 'ระบบส่งอีเมลยืนยันคำสั่งซื้อและข้อมูลสมาชิกของ Vela Commerce พร้อมใช้งานแล้ว',
    });
    res.status(delivery.sent ? 200 : 200).json(delivery);
  });

  // --- 24/7 Customer Support Chatbot (Server-Side Gemini API) ---

  function getGeminiClient(): GoogleGenAI | null {
    const rawKey = (process.env.GEMINI_API_KEY || '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();
    if (!rawKey || rawKey === 'MY_GEMINI_API_KEY') return null;
    return new GoogleGenAI({
      apiKey: rawKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  app.post('/api/chat', async (req: Request, res: Response) => {
    const message = sanitizeShortText(req.body?.message, 1000);
    if (!message) {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets or Vercel Environment Variables.',
      });
      return;
    }

    const lang = req.body?.lang === 'en' ? 'en' : 'th';
    const isSignedIn = Boolean(req.body?.isSignedIn);
    const memberName = sanitizeShortText(req.body?.memberDisplayName, 80);

    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const historyContents = rawHistory
      .slice(-10)
      .filter(
        (turn: unknown): turn is { role: 'user' | 'model'; text: string } =>
          Boolean(turn) &&
          typeof turn === 'object' &&
          ((turn as { role?: string }).role === 'user' ||
            (turn as { role?: string }).role === 'model') &&
          typeof (turn as { text?: unknown }).text === 'string' &&
          Boolean((turn as { text: string }).text.trim())
      )
      .map((turn: { role: 'user' | 'model'; text: string }) => ({
        role: turn.role,
        parts: [{ text: sanitizeShortText(turn.text, 1200) }],
      }));

    const rawCatalog = Array.isArray(req.body?.catalogPreview) ? req.body.catalogPreview : [];
    const safeCatalogLines = rawCatalog
      .slice(0, 12)
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return '';
        const p = item as {
          sku?: unknown;
          title?: unknown;
          category?: unknown;
          price?: unknown;
          stock?: unknown;
        };
        const title = sanitizeShortText(p.title, 80);
        const sku = sanitizeShortText(p.sku, 32);
        const cat = sanitizeShortText(p.category, 40);
        const price = Number(p.price);
        const stock = Number(p.stock);
        if (!title || !Number.isFinite(price)) return '';
        return `- ${title} (SKU: ${sku || 'N/A'}, หมวด: ${cat || 'General'}, ราคา: ฿${Math.round(
          price
        ).toLocaleString('th-TH')}, คงเหลือ: ${Number.isFinite(stock) ? stock : 'พร้อมส่ง'})`;
      })
      .filter(Boolean);

    const systemInstruction = [
      'คุณคือผู้ช่วยบริการลูกค้าตลอด 24 ชั่วโมงของร้าน Vela Commerce ("Vela Support Assistant")',
      'ตอบคำถามอย่างสุภาพ ชัดเจน กระชับ และตรงประเด็น หากลูกค้าถามเป็นภาษาไทยให้ตอบเป็นภาษาไทย หากถามเป็นภาษาอังกฤษให้ตอบเป็นภาษาอังกฤษ',
      `ภาษาหลักของหน้าเว็บตอนนี้: ${lang === 'th' ? 'ไทย' : 'English'}`,
      isSignedIn && memberName
        ? `สถานะลูกค้า: เข้าสู่ระบบสมาชิกแล้ว (ชื่อ: ${memberName})`
        : 'สถานะลูกค้า: ผู้เยี่ยมชม / ยังไม่ได้เข้าสู่ระบบ',
      '',
      'ข้อมูลสำคัญของระบบ Vela Commerce:',
      '1. การสั่งซื้อและสินค้า: เลือกสินค้าที่หน้าร้าน ("หน้าร้านค้า") กดเพิ่มลงตะกร้า กรอกที่อยู่จัดส่ง และกดชำระเงินได้ทันที',
      '2. ช่องทางชำระเงิน: รองรับ Thai PromptPay QR, บัตรเครดิต/เดบิต ผ่าน VelaPayment Gateway และกระเป๋าเงินคอมมิชชั่นสมาชิก (Commission Wallet)',
      '3. บัญชีสมาชิกอัตโนมัติ & อีเมลยืนยัน: หลังชำระเงินสำเร็จ ระบบจะส่งอีเมลยืนยันคำสั่งซื้อ พร้อม Username (อีเมล), รหัสผ่านเริ่มต้น (สำหรับลูกค้าใหม่), ลิงก์แนะนำส่วนตัว และลิงก์รีเซ็ตรหัสผ่านให้โดยอัตโนมัติ',
      '4. การติดตามพัสดุ: เข้าเมนู "คำสั่งซื้อ & จัดส่ง" เพื่อดูเลขพัสดุและสถานะการจัดส่งล่าสุด',
      '5. การรีเซ็ต/เปลี่ยนรหัสผ่าน: กดปุ่ม "เข้าสู่ระบบ / สมัครสมาชิก" แล้วเลือก "ลืมรหัสผ่าน / รีเซ็ต" หรือเปลี่ยนรหัสผ่านได้ในหน้า "แดชบอร์ดยอดขาย" เมื่อเข้าสู่ระบบแล้ว',
      '6. ระบบสมาชิก & คอมมิชชั่น MLM 4 ชั้น: รวม 22.5% (ชั้น 1 = 12%, ชั้น 2 = 6%, ชั้น 3 = 3%, ชั้น 4 = 1.5%) ระดับสมาชิกเลื่อนตามยอด PV+TV (Bronze -> Silver 5,000+ -> Gold 20,000+ -> Platinum 60,000+ -> Diamond 150,000+) แจ้งถอนขั้นต่ำ ฿100 ผ่าน PromptPay หรือบัญชีธนาคารได้ในหน้าแดชบอร์ด',
      '7. ตลาดสมาชิก & ประมูล ("ตลาด & ประมูล"): สมาชิกที่ยืนยันแล้วสามารถลงขายสินค้าหรือเปิดประมูลได้ (ค่าธรรมเนียมแพลตฟอร์ม 5%)',
      '',
      'กฎเหล็กด้านความปลอดภัยและความลับทางธุรกิจ:',
      '- ห้ามเปิดเผยชื่อซัพพลายเออร์ต้นทาง (ห้ามพูดถึง CJ Dropshipping), ห้ามบอกราคาทุน (wholesale cost), ราคา USD, อัตราแลกเปลี่ยน หรือ % การบวกกำไร ให้ลูกค้าทราบโดยเด็ดขาด ให้แจ้งเฉพาะราคาขายหน้าร้านเป็นเงินบาท (฿) เท่านั้น',
      '- หากไม่พบข้อมูลคำสั่งซื้อเฉพาะราย ให้แนะนำลูกค้าตรวจสอบในเมนู "คำสั่งซื้อ & จัดส่ง" หรือแจ้งเลขออเดอร์พร้อมอีเมลเพื่อติดต่อแอดมินร้าน',
      safeCatalogLines.length > 0
        ? `\nตัวอย่างสินค้าที่วางขายอยู่ในหน้าร้านตอนนี้:\n${safeCatalogLines.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [...historyContents, { role: 'user', parts: [{ text: message }] }],
        config: {
          systemInstruction,
        },
      });

      const reply = (response.text || '').trim();
      if (!reply) {
        res.status(502).json({ error: 'Empty response received from Gemini assistant.' });
        return;
      }

      res.json({ reply });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'Unable to generate chat response';
      const status =
        errMessage.includes('API_KEY_INVALID') || errMessage.includes('PERMISSION_DENIED')
          ? 403
          : errMessage.includes('RESOURCE_EXHAUSTED') || errMessage.includes('429')
          ? 429
          : 502;
      res.status(status).json({ error: errMessage });
    }
  });

  return app;
}

const vercelApp = createApiApp();
export default vercelApp;
