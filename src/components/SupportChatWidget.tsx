import React, { useEffect, useRef, useState } from 'react';
import { Bot, MessageSquare, RotateCcw, Send, X } from 'lucide-react';
import type { Lang } from '../i18n';
import type { ProductItem } from '../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

interface SupportChatWidgetProps {
  lang: Lang;
  products: ProductItem[];
  isSignedIn: boolean;
  memberDisplayName?: string;
  hidden?: boolean;
}

export function SupportChatWidget({
  lang,
  products,
  isSignedIn,
  memberDisplayName,
  hidden = false,
}: SupportChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, open]);

  if (hidden) return null;

  const quickPrompts =
    lang === 'th'
      ? [
          'แนะนำสินค้าขายดีในร้านหน่อย',
          'รับชำระเงินช่องทางไหนบ้าง?',
          'เช็คสถานะพัสดุและลืมรหัสผ่านทำยังไง?',
          'ค่าคอมมิชชั่นสมาชิก MLM คิดยังไง?',
        ]
      : [
          'Recommend popular products',
          'What payment methods do you accept?',
          'How do I track orders or reset password?',
          'How do member commissions work?',
        ];

  const welcomeText =
    lang === 'th'
      ? 'สวัสดีครับ ยินดีต้อนรับสู่ Vela Commerce ผู้ช่วยอัตโนมัติพร้อมดูแลคุณตลอด 24 ชม. สอบถามเรื่องสินค้า การชำระเงิน พัสดุ หรือระบบสมาชิกได้เลยครับ'
      : 'Hello! Welcome to Vela Commerce 24/7 Support. Ask me about products, payments, order tracking, or member benefits.';

  const sendMessage = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || sending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setErrorMsg('');
    setSending(true);

    try {
      const catalogPreview = products.slice(0, 12).map((p) => ({
        sku: p.sku,
        title: lang === 'th' ? p.titleTh : p.title,
        category: p.category,
        price: p.retailPrice,
        stock: p.stock,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: messages.slice(-10).map((m) => ({ role: m.role, text: m.text })),
          lang,
          isSignedIn,
          memberDisplayName,
          catalogPreview,
        }),
      });

      const rawBody = await res.text();
      let data: { reply?: string; error?: string } = {};
      try {
        data = JSON.parse(rawBody);
      } catch {
        throw new Error(`HTTP ${res.status}`);
      }

      if (!res.ok || !data.reply) {
        throw new Error(data.error || 'Unable to get assistant reply.');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}`,
          role: 'model',
          text: data.reply as string,
        },
      ]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : lang === 'th'
          ? 'ไม่สามารถเชื่อมต่อผู้ช่วยได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'
          : 'Unable to connect to assistant right now.'
      );
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2.5 px-4 py-3 bg-slate-900 text-white rounded-xl shadow-lg hover:bg-slate-800 transition-colors text-xs font-medium"
          aria-label={lang === 'th' ? 'เปิดแชทผู้ช่วย 24 ชั่วโมง' : 'Open 24/7 Support Chat'}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <MessageSquare className="w-4 h-4 shrink-0" />
          <span>{lang === 'th' ? 'ผู้ช่วยร้านค้า 24 ชม.' : '24/7 Support Chat'}</span>
        </button>
      ) : (
        <div className="w-[360px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-5rem)] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Chat Header */}
          <div className="px-4 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {lang === 'th' ? 'ผู้ช่วย Vela Commerce' : 'Vela Support Assistant'}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>{lang === 'th' ? 'ออนไลน์ตลอด 24 ชม.' : 'Online 24/7'}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    setErrorMsg('');
                  }}
                  className="p-1.5 text-slate-300 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
                  title={lang === 'th' ? 'เริ่มสนทนาใหม่' : 'Clear chat'}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 text-slate-300 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
                aria-label="Close chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/70">
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-md bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="bg-white border border-slate-200 rounded-xl rounded-tl-xs px-3.5 py-2.5 text-xs text-slate-700 leading-relaxed max-w-[85%]">
                {welcomeText}
              </div>
            </div>

            {messages.length === 0 && (
              <div className="pt-1 pl-8 flex flex-col gap-1.5">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending}
                    onClick={() => sendMessage(prompt)}
                    className="text-left px-3 py-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-lg hover:border-slate-400 hover:text-slate-900 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="bg-slate-900 text-white rounded-xl rounded-tr-xs px-3.5 py-2.5 text-xs leading-relaxed max-w-[85%] whitespace-pre-wrap">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl rounded-tl-xs px-3.5 py-2.5 text-xs text-slate-800 leading-relaxed max-w-[85%] whitespace-pre-wrap">
                    {msg.text}
                  </div>
                </div>
              )
            )}

            {sending && (
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-md bg-slate-900 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="bg-white border border-slate-200 rounded-xl rounded-tl-xs px-3.5 py-2.5 text-xs text-slate-500">
                  {lang === 'th' ? 'กำลังพิมพ์คำตอบ...' : 'Typing reply...'}
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {errorMsg}
              </div>
            )}
          </div>

          {/* Input Bar */}
          <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              placeholder={
                lang === 'th' ? 'พิมพ์คำถามของคุณที่นี่...' : 'Ask a question...'
              }
              className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="p-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors shrink-0"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
