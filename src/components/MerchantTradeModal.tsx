import React, { useState } from 'react';
import { Coins, Lock, ShoppingBag, Store, Tag, X } from 'lucide-react';
import type { MerchantTradeSnapshot } from '../game/village/villageDevTypes';
import { UI_TEXT, type Language } from '../game/i18n/translations';

interface MerchantTradeModalProps {
  snapshot: MerchantTradeSnapshot;
  lang: Language;
  onBuyOffer: (offerId: string) => void;
  onSellItem: (itemId: string, count: number) => void;
  onClose: () => void;
}

export const MerchantTradeModal: React.FC<MerchantTradeModalProps> = ({
  snapshot,
  lang,
  onBuyOffer,
  onSellItem,
  onClose,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const [mobileTab, setMobileTab] = useState<'buy' | 'sell'>('buy');

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#09110d]/74 p-2.5 sm:p-4 mobile-hud-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merchant-trade-title"
      data-testid="merchant-trade-modal"
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full max-w-4xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#101c16] border border-[#2a3f33] p-4 sm:p-6 text-[#f1f5ee] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#292114] border border-[#5e4a25] flex items-center justify-center shrink-0">
              <Store className="w-5 h-5 text-[#e5a93c]" />
            </div>
            <div className="min-w-0">
              <h2
                id="merchant-trade-title"
                className="font-display text-lg sm:text-xl font-bold leading-tight truncate"
              >
                {snapshot.merchantName} · {snapshot.villageName}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#9cb0a0] mt-0.5">
                <span>
                  {t.villageLevelBadge(snapshot.villageLevel)} · {snapshot.reputationLabel}
                </span>
                <span className="px-2 py-0.5 rounded bg-[#182920] border border-white/10 text-[11px] text-[#bfeec6]">
                  {t.villageRepDiscountHint(snapshot.discountPct, snapshot.sellBonusPct)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="px-3 py-1.5 rounded-xl bg-[#19281f] border border-[#e5a93c]/45 font-mono-num text-xs sm:text-sm font-bold text-[#f7cf73] inline-flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-[#e5a93c]" />
              <span>{snapshot.playerCoins}</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              data-testid="merchant-trade-close-btn"
              aria-label={t.closeBtn}
              className="min-w-[44px] min-h-[44px] rounded-lg bg-[#192a21] hover:bg-[#22392d] border border-[#2f493b] flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Livestock Coop/Pen Hint */}
        <div
          className={`mb-3 px-3 py-2 rounded-xl border text-xs ${
            snapshot.hasPlayerPenNearby
              ? 'bg-[#152a1e] border-[#356347] text-[#a9ebb5]'
              : 'bg-[#1c231a] border-[#3d4a35] text-[#c2ceb8]'
          }`}
        >
          {snapshot.hasPlayerPenNearby ? t.merchantHasPenHint : t.merchantRequiresPenHint}
        </div>

        {/* Mobile Tab Switcher */}
        <div className="grid grid-cols-2 gap-1.5 mb-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileTab('buy')}
            className={`min-h-[42px] rounded-xl border text-xs font-bold cursor-pointer ${
              mobileTab === 'buy'
                ? 'bg-[#22382b] border-[#e5a93c] text-white'
                : 'bg-[#14231b] border-white/10 text-[#9db4a2]'
            }`}
          >
            {t.merchantBuyTab}
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('sell')}
            className={`min-h-[42px] rounded-xl border text-xs font-bold cursor-pointer ${
              mobileTab === 'sell'
                ? 'bg-[#22382b] border-[#e5a93c] text-white'
                : 'bg-[#14231b] border-white/10 text-[#9db4a2]'
            }`}
          >
            {t.merchantSellTab}
          </button>
        </div>

        {/* Two-Pane Buy & Sell Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Buy Goods & Seeds */}
          <div
            className={`rounded-xl bg-[#14231b] border border-[#263c2f] p-3 flex-col gap-2 ${
              mobileTab === 'buy' ? 'flex' : 'hidden md:flex'
            }`}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#e8efe5]">
                <ShoppingBag className="w-4 h-4 text-[#e5a93c]" />
                <span>{t.merchantBuyTab}</span>
              </span>
            </div>

            <div className="flex flex-col gap-2 max-h-[48dvh] overflow-y-auto pe-1">
              {snapshot.buyOffers.map((offer) => {
                const canAfford = snapshot.playerCoins >= offer.finalPriceCoins;
                const lockedByLevel = snapshot.villageLevel < offer.minVillageLevel;
                const disabled = offer.locked || !canAfford;

                return (
                  <div
                    key={offer.id}
                    className="px-3 py-2.5 rounded-xl bg-[#0d1712] border border-white/10 flex items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs sm:text-sm font-semibold text-[#f1f5ee]">
                          {offer.name}
                        </span>
                        {offer.ownedCount > 0 && offer.kind === 'item' && (
                          <span className="text-[10px] font-mono-num text-[#98b39e]">
                            ({offer.ownedCount})
                          </span>
                        )}
                        {lockedByLevel && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#2d2215] border border-[#614a25] text-[10px] text-[#f0cf88]">
                            <Lock className="w-2.5 h-2.5" />
                            <span>{t.merchantLockedLevel(offer.minVillageLevel)}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#9eb4a3] mt-0.5 leading-snug">
                        {offer.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onBuyOffer(offer.id)}
                      data-testid={`merchant-buy-${offer.id}`}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#e5a93c] hover:bg-[#eeb750] disabled:opacity-45 text-[#111914] font-display font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed shrink-0"
                    >
                      <span>{t.merchantBuyBtn}</span>
                      <span className="font-mono-num">{offer.finalPriceCoins}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sell Crops & Products */}
          <div
            className={`rounded-xl bg-[#14231b] border border-[#263c2f] p-3 flex-col gap-2 ${
              mobileTab === 'sell' ? 'flex' : 'hidden md:flex'
            }`}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#e8efe5]">
                <Tag className="w-4 h-4 text-[#7fe094]" />
                <span>{t.merchantSellTab}</span>
              </span>
            </div>

            {snapshot.sellEntries.length === 0 ? (
              <p className="text-xs text-[#8ea393] py-8 text-center px-4">
                {t.merchantEmptySellHint}
              </p>
            ) : (
              <div className="flex flex-col gap-2 max-h-[48dvh] overflow-y-auto pe-1">
                {snapshot.sellEntries.map((entry) => (
                  <div
                    key={entry.itemId}
                    className="px-3 py-2.5 rounded-xl bg-[#0d1712] border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-semibold text-[#f1f5ee] truncate">
                        {entry.name} ×{entry.ownedCount}
                      </div>
                      <div className="text-[11px] font-mono-num text-[#e5a93c] mt-0.5">
                        +{entry.unitSellCoins} {t.coinsLabel} / ea
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSellItem(entry.itemId, 1)}
                        data-testid={`merchant-sell-one-${entry.itemId}`}
                        className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#20382b] hover:bg-[#2a4a39] border border-[#3d694f] text-[11px] font-semibold text-[#d2f5d8] cursor-pointer"
                      >
                        {t.merchantSellOneBtn}
                      </button>
                      {entry.ownedCount > 1 && (
                        <button
                          type="button"
                          onClick={() => onSellItem(entry.itemId, entry.ownedCount)}
                          data-testid={`merchant-sell-all-${entry.itemId}`}
                          className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#2a7d4f] hover:bg-[#34945e] border border-[#7fe094]/60 text-[11px] font-bold text-[#ffffff] cursor-pointer"
                        >
                          {t.merchantSellAllBtn}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
