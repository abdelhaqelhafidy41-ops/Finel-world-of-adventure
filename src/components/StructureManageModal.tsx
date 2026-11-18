import React, { useState } from 'react';
import {
  ArrowUpCircle,
  Hammer,
  Shield,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type {
  BuildingPermissionScope,
  StructureManageSnapshot,
} from '../game/building/buildingTypes';
import { UI_TEXT, type Language } from '../game/i18n/translations';

interface StructureManageModalProps {
  snapshot: StructureManageSnapshot;
  lang: Language;
  onRepair: (structureId: string) => void;
  onUpgrade: (structureId: string) => void;
  onSetPermission: (structureId: string, scope: BuildingPermissionScope) => void;
  onDemolish: (structureId: string) => boolean;
  onClose: () => void;
}

const PERMISSION_SCOPES: BuildingPermissionScope[] = [
  'owner',
  'friends',
  'party',
  'everyone',
];

export const StructureManageModal: React.FC<StructureManageModalProps> = ({
  snapshot,
  lang,
  onRepair,
  onUpgrade,
  onSetPermission,
  onDemolish,
  onClose,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const [confirmDemolish, setConfirmDemolish] = useState(false);

  const healthPct = Math.max(
    0,
    Math.min(100, (snapshot.health / Math.max(1, snapshot.maxHealth)) * 100),
  );
  const needsRepair = snapshot.health < snapshot.maxHealth;
  const blockedDemolishByStorage =
    snapshot.hasStorage && snapshot.storageCount > 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#09110d]/74 p-3 sm:p-4 mobile-hud-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="structure-manage-title"
      data-testid="structure-manage-modal"
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#101c16] border border-[#2a3f33] p-4 sm:p-6 text-[#f1f5ee] shadow-2xl flex flex-col gap-4"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Hammer className="w-5 h-5 text-[#e5a93c] shrink-0" />
            <div className="min-w-0">
              <h2
                id="structure-manage-title"
                className="font-display text-lg sm:text-xl font-bold leading-tight truncate"
              >
                {snapshot.name}
              </h2>
              <p className="text-xs text-[#9cb0a0] mt-0.5">
                {t.buildManageOwnerLabel}:{' '}
                <strong className="text-[#e8efe5]">{snapshot.ownerName}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            data-testid="structure-manage-close-btn"
            aria-label={t.closeBtn}
            className="min-w-[44px] min-h-[44px] rounded-lg bg-[#192a21] hover:bg-[#22392d] border border-[#2f493b] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Structural Integrity & Repair */}
        <div className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-[#dce8dd]">{t.buildManageHealthLabel}</span>
            <span className="font-mono-num text-[#f5f8f2]" dir="ltr">
              {snapshot.health} / {snapshot.maxHealth}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[#0d1712] overflow-hidden">
            <div
              className={`h-full transition-[width] duration-150 ${
                healthPct < 35
                  ? 'bg-[#e05a47]'
                  : healthPct < 70
                    ? 'bg-[#e5a93c]'
                    : 'bg-[#4ade80]'
              }`}
              style={{ width: `${healthPct}%` }}
            />
          </div>

          {needsRepair && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {snapshot.repairCosts.map((c) => (
                  <span
                    key={c.itemId}
                    className={`px-2 py-0.5 rounded border text-[11px] font-mono-num ${
                      c.enough
                        ? 'bg-[#173322] border-[#4ade80]/40 text-[#9bf0b8]'
                        : 'bg-[#361818] border-[#f87171]/45 text-[#fca5a5]'
                    }`}
                  >
                    {c.name}: {snapshot.isCreativeFree ? '∞' : c.owned}/
                    {c.required}
                  </span>
                ))}
              </div>
              <button
                type="button"
                data-testid="structure-repair-btn"
                disabled={!snapshot.canRepair}
                onClick={() => onRepair(snapshot.structureId)}
                className="min-h-[42px] px-3.5 rounded-lg bg-[#234733] hover:bg-[#2c5a40] disabled:opacity-45 border border-[#4ade80]/45 text-xs font-semibold text-[#e6faec] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>{t.buildManageRepairBtn}</span>
              </button>
            </div>
          )}
        </div>

        {/* Upgrade Option */}
        {snapshot.upgradeBlueprintId && snapshot.upgradeName && (
          <div className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3.5 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {snapshot.upgradeCosts.map((c) => (
                  <span
                    key={c.itemId}
                    className={`px-2 py-0.5 rounded border text-[11px] font-mono-num ${
                      c.enough
                        ? 'bg-[#173322] border-[#4ade80]/40 text-[#9bf0b8]'
                        : 'bg-[#361818] border-[#f87171]/45 text-[#fca5a5]'
                    }`}
                  >
                    {c.name}: {snapshot.isCreativeFree ? '∞' : c.owned}/
                    {c.required}
                  </span>
                ))}
              </div>

              <button
                type="button"
                data-testid="structure-upgrade-btn"
                disabled={!snapshot.canUpgrade}
                onClick={() => onUpgrade(snapshot.structureId)}
                className="min-h-[42px] px-3.5 rounded-lg bg-[#2b3c20] hover:bg-[#374d29] disabled:opacity-45 border border-[#e5a93c]/55 text-xs font-semibold text-[#fde68a] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowUpCircle className="w-4 h-4" />
                <span>{t.buildManageUpgradeBtn(snapshot.upgradeName)}</span>
              </button>
            </div>
          </div>
        )}

        {/* Access Permission Scope */}
        <div className="rounded-xl bg-[#14231b] border border-[#263c2f] p-3.5 flex flex-col gap-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#dce8dd]">
            <Shield className="w-4 h-4 text-[#7fe094]" />
            <span>{t.buildManagePermLabel}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {PERMISSION_SCOPES.map((scope) => {
              const active = snapshot.permission === scope;
              return (
                <button
                  key={scope}
                  type="button"
                  data-testid={`structure-perm-${scope}`}
                  disabled={!snapshot.isOwner}
                  onClick={() => onSetPermission(snapshot.structureId, scope)}
                  className={`min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                    active
                      ? 'bg-[#213a2c] border-[#e5a93c] text-[#ffffff]'
                      : 'bg-[#0d1712] border-white/10 text-[#a5baa8] hover:bg-[#182920]'
                  }`}
                >
                  {t.buildPermLabels[scope]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Demolish & Material Refund */}
        {snapshot.isOwner && (
          <div className="rounded-xl bg-[#1d1414] border border-[#4a2624] p-3.5 flex flex-col gap-2.5">
            {!snapshot.isCreativeFree && snapshot.refundItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#d6c2bf]">
                <span>{t.buildManageDemolishRefundHint}:</span>
                {snapshot.refundItems.map((r) => (
                  <span
                    key={r.itemId}
                    className="px-2 py-0.5 rounded bg-[#140d0d] border border-white/10 font-mono-num text-[#f5ecd3]"
                  >
                    {r.name} ×{r.count}
                  </span>
                ))}
              </div>
            )}

            {blockedDemolishByStorage && (
              <p className="text-xs font-medium text-[#fca5a5]">
                {t.buildManageDemolishNotEmpty}
              </p>
            )}

            {!confirmDemolish ? (
              <button
                type="button"
                data-testid="structure-demolish-btn"
                disabled={blockedDemolishByStorage}
                onClick={() => setConfirmDemolish(true)}
                className="min-h-[44px] w-full px-4 rounded-xl bg-[#471d1b] hover:bg-[#5e2422] disabled:opacity-45 border border-[#e05a47]/55 text-xs font-bold text-[#fecaca] inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>{t.buildManageDemolishBtn}</span>
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="structure-demolish-confirm"
                  onClick={() => {
                    const ok = onDemolish(snapshot.structureId);
                    if (ok) onClose();
                  }}
                  className="min-h-[44px] px-3 rounded-xl bg-[#c24d40] hover:bg-[#d65b4d] text-xs font-bold text-[#ffffff] cursor-pointer"
                >
                  {t.buildManageDemolishConfirm}
                </button>
                <button
                  type="button"
                  data-testid="structure-demolish-cancel"
                  onClick={() => setConfirmDemolish(false)}
                  className="min-h-[44px] px-3 rounded-xl bg-[#192a21] hover:bg-[#22392d] border border-[#2f493b] text-xs font-semibold text-[#e4ece1] cursor-pointer"
                >
                  {t.buildManageDemolishCancel}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
