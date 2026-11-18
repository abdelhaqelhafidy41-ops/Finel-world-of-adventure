import React, { useMemo } from 'react';
import { Archive, ArrowLeftRight, Backpack, Shield, X } from 'lucide-react';
import type { StorageModalSnapshot } from '../game/building/buildingTypes';
import { UI_TEXT, type Language } from '../game/i18n/translations';
import { ItemManager } from '../game/inventory/ItemManager';
import type {
  InventorySlotView,
  InventorySnapshot,
} from '../game/inventory/inventoryTypes';

interface BuildingStorageModalProps {
  snapshot: StorageModalSnapshot;
  inventory: InventorySnapshot;
  lang: Language;
  onTransfer: (
    direction: 'deposit' | 'withdraw',
    itemId: string,
    count: number,
  ) => void;
  onClose: () => void;
}

export const BuildingStorageModal: React.FC<BuildingStorageModalProps> = ({
  snapshot,
  inventory,
  lang,
  onTransfer,
  onClose,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const itemManager = useMemo(() => new ItemManager(), []);

  const depositableSlots = useMemo(
    () =>
      inventory.slots.filter(
        (slot): slot is InventorySlotView =>
          Boolean(slot && slot.definition.droppable && !slot.equipped),
      ),
    [inventory.slots],
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#09110d]/74 p-2.5 sm:p-4 mobile-hud-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="building-storage-title"
      data-testid="building-storage-modal"
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full max-w-3xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#101c16] border border-[#2a3f33] p-4 sm:p-6 text-[#f1f5ee] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Archive className="w-5 h-5 text-[#e5a93c] shrink-0" />
            <div className="min-w-0">
              <h2
                id="building-storage-title"
                className="font-display text-lg sm:text-xl font-bold leading-tight truncate"
              >
                {snapshot.title} · {t.buildStorageTitle}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#9cb0a0] mt-0.5">
                <span className="font-mono-num">
                  {t.buildStorageCapacityLabel(
                    snapshot.items.length,
                    snapshot.capacity,
                  )}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#16271e] border border-white/10 text-[11px] text-[#cce0d0]">
                  <Shield className="w-3 h-3 text-[#7fe094]" />
                  {t.buildPermLabels[snapshot.permission]}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            data-testid="storage-close-btn"
            aria-label={t.closeBtn}
            className="min-w-[44px] min-h-[44px] rounded-lg bg-[#192a21] hover:bg-[#22392d] border border-[#2f493b] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-Pane Transfer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Player Backpack Pane */}
          <div className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#e8efe5]">
                <Backpack className="w-4 h-4 text-[#e5a93c]" />
                {t.buildStorageBackpack}
              </span>
              <span className="font-mono-num text-[11px] text-[#9cb0a0]">
                {inventory.usedSlots}/{inventory.capacity}
              </span>
            </div>

            {depositableSlots.length === 0 ? (
              <p className="text-xs text-[#8ea393] py-6 text-center">
                {t.buildStorageEmpty}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[46dvh] overflow-y-auto pe-1">
                {depositableSlots.map((slot) => (
                  <div
                    key={`${slot.slotIndex}_${slot.itemId}`}
                    className="px-2.5 py-2 rounded-lg bg-[#0d1712] border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#f1f5ee] truncate">
                        {isRtl ? slot.definition.nameAr : slot.definition.name}
                      </div>
                      <div className="font-mono-num text-[11px] text-[#9cb0a0]">
                        ×{slot.count}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={!snapshot.canModify}
                        onClick={() => onTransfer('deposit', slot.itemId, 1)}
                        className="min-h-[38px] px-2.5 rounded-lg bg-[#1d3527] hover:bg-[#274835] disabled:opacity-45 border border-[#4ade80]/35 text-[11px] font-semibold text-[#d9f7e3] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeftRight className="w-3 h-3" />
                        <span>{t.buildStorageDepositBtn}</span>
                      </button>
                      {slot.count > 1 && (
                        <button
                          type="button"
                          disabled={!snapshot.canModify}
                          onClick={() =>
                            onTransfer('deposit', slot.itemId, slot.count)
                          }
                          className="min-h-[38px] px-2.5 rounded-lg bg-[#182920] hover:bg-[#22392d] disabled:opacity-45 border border-white/14 text-[11px] font-semibold text-[#e5a93c] cursor-pointer"
                        >
                          {t.buildStorageAllBtn}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Structure Storage Pane */}
          <div className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#e8efe5]">
                <Archive className="w-4 h-4 text-[#7fe094]" />
                {t.buildStorageVault}
              </span>
              <span className="font-mono-num text-[11px] text-[#9cb0a0]">
                {snapshot.items.length}/{snapshot.capacity}
              </span>
            </div>

            {snapshot.items.length === 0 ? (
              <p className="text-xs text-[#8ea393] py-6 text-center">
                {t.buildStorageEmpty}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[46dvh] overflow-y-auto pe-1">
                {snapshot.items.map((item) => (
                  <div
                    key={item.itemId}
                    className="px-2.5 py-2 rounded-lg bg-[#0d1712] border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#f1f5ee] truncate">
                        {itemManager.getName(item.itemId, lang)}
                      </div>
                      <div className="font-mono-num text-[11px] text-[#9cb0a0]">
                        ×{item.count}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={!snapshot.canModify}
                        onClick={() => onTransfer('withdraw', item.itemId, 1)}
                        className="min-h-[38px] px-2.5 rounded-lg bg-[#1d3527] hover:bg-[#274835] disabled:opacity-45 border border-[#4ade80]/35 text-[11px] font-semibold text-[#d9f7e3] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ArrowLeftRight className="w-3 h-3" />
                        <span>{t.buildStorageWithdrawBtn}</span>
                      </button>
                      {item.count > 1 && (
                        <button
                          type="button"
                          disabled={!snapshot.canModify}
                          onClick={() =>
                            onTransfer('withdraw', item.itemId, item.count)
                          }
                          className="min-h-[38px] px-2.5 rounded-lg bg-[#182920] hover:bg-[#22392d] disabled:opacity-45 border border-white/14 text-[11px] font-semibold text-[#e5a93c] cursor-pointer"
                        >
                          {t.buildStorageAllBtn}
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
