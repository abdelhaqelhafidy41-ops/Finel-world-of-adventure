import React from 'react';
import { ArrowDownToLine, ExternalLink, X } from 'lucide-react';
import { UI_TEXT, type Language } from '../../game/i18n/translations';
import type { AppUpdateInfo } from '../../game/settings/AppUpdateService';

interface UpdateNotificationModalProps {
  lang: Language;
  updateInfo: AppUpdateInfo;
  onClose: () => void;
  onDontShowAgain: (version: string) => void;
}

export const UpdateNotificationModal: React.FC<UpdateNotificationModalProps> = ({
  lang,
  updateInfo,
  onClose,
  onDontShowAgain,
}) => {
  const t = UI_TEXT[lang];
  const isRtl = lang === 'ar';
  const description =
    lang === 'ar'
      ? updateInfo.releaseNotes.ar || t.updateAvailableBody
      : updateInfo.releaseNotes.en || t.updateAvailableBody;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#070f0b]/72 backdrop-blur-sm p-3.5 sm:p-4 mobile-hud-safe pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
      data-testid="update-notification-modal"
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="woa-surface w-full max-w-sm rounded-2xl bg-[#101c16] border border-[#2d4638] p-4 sm:p-5 text-[#f1f5ee] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#e5a93c]/15 border border-[#e5a93c]/40 flex items-center justify-center shrink-0 text-[#e5a93c]">
              <ArrowDownToLine className="w-5 h-5" />
            </div>
            <div className="min-w-0 text-start">
              <h2
                id="app-update-title"
                className="font-display text-base sm:text-lg font-bold text-[#f7faf5] leading-snug"
              >
                {t.updateAvailableTitle}
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-[#c4d5c4] leading-relaxed">
                {description}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t.updateCloseBtn}
            data-testid="update-modal-close-x"
            className="min-w-[36px] min-h-[36px] rounded-lg bg-[#192b22] hover:bg-[#233a2e] border border-[#2f493b] flex items-center justify-center shrink-0 text-[#c9d9ca] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Version Badges */}
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[#15241c] border border-[#273d30] px-3 py-2 text-start">
            <div className="text-[10px] sm:text-[11px] text-[#9cb0a0]">
              {t.updateCurrentVersionLabel}
            </div>
            <div
              dir="ltr"
              className="mt-0.5 font-mono-num text-xs sm:text-sm font-semibold text-[#dce6dc] text-start"
            >
              v{updateInfo.installedVersion}
            </div>
          </div>
          <div className="rounded-xl bg-[#1f2c1c] border border-[#e5a93c]/45 px-3 py-2 text-start">
            <div className="text-[10px] sm:text-[11px] text-[#e8c67a]">
              {t.updateNewVersionLabel}
            </div>
            <div
              dir="ltr"
              className="mt-0.5 font-mono-num text-xs sm:text-sm font-bold text-[#f5c76b] text-start"
            >
              v{updateInfo.latestVersion}
            </div>
          </div>
        </div>

        {/* Primary & Secondary Actions */}
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href={updateInfo.updateUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="update-now-btn"
              className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#e5a93c] hover:bg-[#eeb750] active:scale-[0.98] text-[#111914] font-display font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 shadow-md transition-colors cursor-pointer"
            >
              <span>{t.updateNowBtn}</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
            <button
              type="button"
              onClick={onClose}
              data-testid="update-close-btn"
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#192b22] hover:bg-[#233a2e] border border-[#2f493b] text-xs sm:text-sm font-medium text-[#e4ece1] transition-colors cursor-pointer"
            >
              {t.updateCloseBtn}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onDontShowAgain(updateInfo.latestVersion)}
            data-testid="update-dont-show-again-btn"
            className="w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-transparent hover:bg-[#16261d] text-[11px] sm:text-xs font-medium text-[#9cb2a0] hover:text-[#dce6dc] transition-colors cursor-pointer"
          >
            {t.updateDontShowAgainBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
