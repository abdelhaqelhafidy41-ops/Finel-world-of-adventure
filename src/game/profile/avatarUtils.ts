import {
  AVATAR_PALETTE,
  pickAvatarColor,
} from '../../../shared/multiplayerProtocol';
import {
  MAX_AVATAR_DATA_URL_LENGTH,
  PRESET_AVATAR_IDS,
  migrateAvatarConfig,
  type AvatarConfig,
  type PresetAvatarId,
} from '../../../shared/profileTypes';

export interface PresetAvatarDefinition {
  id: PresetAvatarId;
  color: string;
  labelEn: string;
  labelAr: string;
}

export const PRESET_AVATARS: PresetAvatarDefinition[] = [
  { id: 'ranger', color: '#10b981', labelEn: 'Forest Ranger', labelAr: 'حارس الغابة' },
  { id: 'mountain-guardian', color: '#3b82f6', labelEn: 'Mountain Guardian', labelAr: 'حارس الجبل' },
  { id: 'mystic', color: '#8b5cf6', labelEn: 'Star Mystic', labelAr: 'عراف النجوم' },
  { id: 'scout', color: '#06b6d4', labelEn: 'Wind Scout', labelAr: 'كشاف الرياح' },
  { id: 'blacksmith', color: '#f59e0b', labelEn: 'Forge Master', labelAr: 'سيد الحدادة' },
  { id: 'hunter', color: '#ef4444', labelEn: 'Crimson Hunter', labelAr: 'الصياد القرمزي' },
  { id: 'nomad', color: '#84cc16', labelEn: 'Steppe Nomad', labelAr: 'رحالة السهول' },
  { id: 'guardian', color: '#ec4899', labelEn: 'Citadel Warden', labelAr: 'حامي القلعة' },
];

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getPresetEmblemMarkup(id: PresetAvatarId): string {
  switch (id) {
    case 'ranger':
      return `<path d="M64 24l18 22h-8l12 18H74l10 16H44l10-16H42l12-18h-8z" fill="#ecfdf5" opacity="0.95"/><rect x="59" y="80" width="10" height="20" rx="2" fill="#d1fae5"/>`;
    case 'mountain-guardian':
      return `<path d="M64 21L93 33v28c0 22-12 36-29 45-17-9-29-23-29-45V33z" fill="#eff6ff" opacity="0.96"/><path d="M42 71l10-16 6 7 6-21 7 20 6-7 9 17c-4 10-12 18-22 24-10-6-18-14-22-24z" fill="#1d4ed8"/><path d="M64 41l5 14-3-2-2 3-2-3-3 2z" fill="#eff6ff"/>`;
    case 'mystic':
      return `<path d="M64 20l10 28 28 10-28 10-10 28-10-28-28-10 28-10z" fill="#f5f3ff" opacity="0.96"/><circle cx="64" cy="58" r="9" fill="#6d28d9"/>`;
    case 'scout':
      return `<circle cx="64" cy="64" r="32" fill="none" stroke="#ecfeff" stroke-width="6"/><polygon points="64,34 74,64 64,94 54,64" fill="#cffafe"/><circle cx="64" cy="64" r="6" fill="#0891b2"/>`;
    case 'blacksmith':
      return `<path d="M34 52h60v12l-12 10v16H46V74L34 64z" fill="#fef3c7"/><path d="M52 30h24v16H52z" fill="#fde68a"/><rect x="58" y="42" width="12" height="14" fill="#d97706"/>`;
    case 'hunter':
      return `<path d="M40 90C34 62 42 36 68 28c6 18 14 34 26 52l-12 12c-12-12-20-26-26-42-8 10-12 24-6 40z" fill="#fee2e2"/><line x1="36" y1="92" x2="94" y2="36" stroke="#fca5a5" stroke-width="5" stroke-linecap="round"/>`;
    case 'nomad':
      return `<path d="M22 86l24-36 18 22 16-28 26 42z" fill="#ecfccb"/><circle cx="88" cy="36" r="10" fill="#fef08a"/>`;
    case 'guardian':
      return `<path d="M36 44l14-14 14 16 14-16 14 14v36H36z" fill="#fdf2f8"/><rect x="36" y="84" width="56" height="10" rx="3" fill="#fbcfe8"/>`;
  }
}

export function buildPresetAvatarDataUri(
  id: PresetAvatarId,
  colorOverride?: string,
): string {
  const def = PRESET_AVATARS.find((p) => p.id === id) ?? PRESET_AVATARS[0];
  const bg = colorOverride || def.color;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><radialGradient id="g" cx="35%" cy="28%" r="75%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="100%" stop-color="#05100b" stop-opacity="0.45"/></radialGradient></defs><rect width="128" height="128" rx="26" fill="${bg}"/><rect width="128" height="128" rx="26" fill="url(#g)"/><circle cx="64" cy="64" r="52" fill="none" stroke="#ffffff" stroke-opacity="0.24" stroke-width="3"/>${getPresetEmblemMarkup(def.id)}</svg>`;
  return svgToDataUri(svg);
}

/**
 * Generates a deterministic neutral fantasy crest SVG from a seed (orbital rings,
 * alpine chevrons, hexagonal crystals, and 6-point compass stars — never religious crosses).
 */
export function generateDeterministicAvatarDataUri(
  seedInput: string,
  colorOverride?: string,
): string {
  const seed = seedInput.trim() || 'WA-EXPLORER';
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const color = colorOverride || pickAvatarColor(seed);
  const accentRing = AVATAR_PALETTE[(hash >>> 12) % AVATAR_PALETTE.length];
  const motif = hash % 4;
  const rotDeg = ((hash >>> 4) % 6) * 15;
  const orbX = 40 + ((hash >>> 8) % 48);

  let emblem = '';
  if (motif === 0) {
    // Twin mountain horizon crest & sun/moon orb
    emblem = `<circle cx="${orbX}" cy="38" r="9" fill="#fef08a" fill-opacity="0.94"/><path d="M24 90L48 52l14 19 16-26 26 45z" fill="#f8fafc" fill-opacity="0.94"/><path d="M40 90l18-24 10 14 10-14 16 24z" fill="#0f172a" fill-opacity="0.22"/>`;
  } else if (motif === 1) {
    // Hexagonal rune shield + inner crystal gem + orbital dots
    emblem = `<polygon points="64,24 96,42 96,86 64,104 32,86 32,42" fill="none" stroke="#f8fafc" stroke-width="5" stroke-opacity="0.9" stroke-linejoin="round"/><polygon points="64,38 82,64 64,90 46,64" fill="#ffffff" fill-opacity="0.94"/><circle cx="64" cy="64" r="7" fill="${color}"/>`;
  } else if (motif === 2) {
    // 6-point compass star crest with rotating outer dots
    const pts: string[] = [];
    for (let i = 0; i < 12; i++) {
      const a = ((i * 30 - 90 + rotDeg) * Math.PI) / 180;
      const r = i % 2 === 0 ? 34 : 15;
      pts.push(`${(64 + Math.cos(a) * r).toFixed(1)},${(64 + Math.sin(a) * r).toFixed(1)}`);
    }
    emblem = `<circle cx="64" cy="64" r="38" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-dasharray="10 8" stroke-opacity="0.65"/><polygon points="${pts.join(' ')}" fill="#f8fafc" fill-opacity="0.95"/><circle cx="64" cy="64" r="8" fill="${color}"/>`;
  } else {
    // Dual trail chevrons & orbital crest orb
    emblem = `<circle cx="64" cy="37" r="9" fill="#ffffff" fill-opacity="0.95"/><path d="M34 70l30-22 30 22-8 11-22-16-22 16z" fill="#f8fafc" fill-opacity="0.95"/><path d="M40 92l24-18 24 18-7 9-17-12-17 12z" fill="#e2e8f0" fill-opacity="0.88"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><radialGradient id="gd" cx="35%" cy="28%" r="75%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.24"/><stop offset="100%" stop-color="#05100b" stop-opacity="0.4"/></radialGradient></defs><rect width="128" height="128" rx="26" fill="${color}"/><rect width="128" height="128" rx="26" fill="url(#gd)"/><circle cx="64" cy="64" r="54" fill="none" stroke="${accentRing}" stroke-width="4.5" stroke-opacity="0.72"/>${emblem}</svg>`;
  return svgToDataUri(svg);
}

export function resolveAvatarSrc(
  avatar?: AvatarConfig | null,
  fallbackSeed = 'WA-ADVENTURER',
): string {
  if (!avatar) {
    return buildPresetAvatarDataUri('ranger', pickAvatarColor(fallbackSeed));
  }
  const normalized = migrateAvatarConfig(avatar).avatar;
  if (normalized.kind === 'uploaded' && normalized.value.startsWith('data:image/')) {
    return normalized.value;
  }
  if (normalized.kind === 'generated') {
    return generateDeterministicAvatarDataUri(normalized.value || fallbackSeed, normalized.color);
  }
  const presetId = (PRESET_AVATAR_IDS as readonly string[]).includes(normalized.value)
    ? (normalized.value as PresetAvatarId)
    : 'ranger';
  return buildPresetAvatarDataUri(presetId, normalized.color);
}

const MAX_UPLOAD_RAW_BYTES = 5 * 1024 * 1024;
const THUMBNAIL_SIZE = 128;

function hasPngMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function hasJpegMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasWebpMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

export type AvatarUploadErrorCode =
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE_FORMAT'
  | 'DECODE_FAILED';

/**
 * Validates raw file magic bytes (PNG/JPEG/WebP only — blocks executables & scripts),
 * center-crops to a square 128x128 thumbnail on Canvas (stripping EXIF metadata),
 * and outputs a compact compressed AvatarConfig.
 */
export async function processCustomAvatarFile(
  file: File,
): Promise<{ ok: true; avatar: AvatarConfig } | { ok: false; code: AvatarUploadErrorCode }> {
  if (!file || file.size <= 0 || file.size > MAX_UPLOAD_RAW_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE' };
  }

  const headerBuf = await file.slice(0, 16).arrayBuffer();
  const headerBytes = new Uint8Array(headerBuf);
  if (
    !hasPngMagic(headerBytes) &&
    !hasJpegMagic(headerBytes) &&
    !hasWebpMagic(headerBytes)
  ) {
    return { ok: false, code: 'UNSUPPORTED_IMAGE_FORMAT' };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (srcW < 8 || srcH < 8) {
      return { ok: false, code: 'DECODE_FAILED' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_SIZE;
    canvas.height = THUMBNAIL_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { ok: false, code: 'DECODE_FAILED' };
    }

    const cropSize = Math.min(srcW, srcH);
    const sx = Math.floor((srcW - cropSize) / 2);
    const sy = Math.floor((srcH - cropSize) / 2);

    ctx.fillStyle = '#0c1611';
    ctx.fillRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    ctx.drawImage(
      img,
      sx,
      sy,
      cropSize,
      cropSize,
      0,
      0,
      THUMBNAIL_SIZE,
      THUMBNAIL_SIZE,
    );

    const qualities = [0.82, 0.72, 0.6, 0.48];
    for (const mime of ['image/webp', 'image/jpeg'] as const) {
      for (const q of qualities) {
        const dataUrl = canvas.toDataURL(mime, q);
        if (
          dataUrl.startsWith(`data:${mime};base64,`) &&
          dataUrl.length <= MAX_AVATAR_DATA_URL_LENGTH
        ) {
          return {
            ok: true,
            avatar: {
              kind: 'uploaded',
              value: dataUrl,
              color: '#10b981',
            },
          };
        }
      }
    }
    return { ok: false, code: 'FILE_TOO_LARGE' };
  } catch {
    return { ok: false, code: 'DECODE_FAILED' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
