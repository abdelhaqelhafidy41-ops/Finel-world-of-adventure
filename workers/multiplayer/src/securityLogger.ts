export type SecurityEventCategory =
  | 'CURRENCY_TAMPER'
  | 'XP_TAMPER'
  | 'INVENTORY_TAMPER'
  | 'ROLE_ESCALATION'
  | 'PERMISSION_DENIED'
  | 'MOVEMENT_ANOMALY'
  | 'COMBAT_ANOMALY'
  | 'RATE_LIMIT_EXCEEDED'
  | 'IMPERSONATION_ATTEMPT'
  | 'PAYLOAD_TAMPER'
  | 'AUTHORITY_VIOLATION';

export type SecurityEventSeverity = 'low' | 'medium' | 'high';

export interface SecurityAuditEntry {
  ts: number;
  category: SecurityEventCategory;
  severity: SecurityEventSeverity;
  code: string;
  roomId?: string;
  actorId?: string;
  detail?: string;
}

const MAX_AUDIT_RING_SIZE = 120;

/**
 * Strips potentially sensitive tokens, IP addresses, or secrets before logging.
 */
function sanitizeAuditValue(value: string | undefined, maxLen = 48): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .trim();
  return cleaned ? cleaned.slice(0, maxLen) : undefined;
}

/**
 * Privacy-safe, server-only security audit logger.
 * Never stores IPs, session tokens, passwords, or raw user chat.
 * Never exposed to normal clients.
 */
export class SecurityAuditLogger {
  private readonly entries: SecurityAuditEntry[] = [];

  public record(event: {
    category: SecurityEventCategory;
    severity: SecurityEventSeverity;
    code: string;
    roomId?: string;
    actorId?: string;
    playerId?: string;
    detail?: string;
    now?: number;
  }): void {
    const rawActor = event.actorId ?? event.playerId;
    const entry: SecurityAuditEntry = {
      ts: event.now ?? Date.now(),
      category: event.category,
      severity: event.severity,
      code: sanitizeAuditValue(event.code, 48) ?? 'UNKNOWN',
      ...(event.roomId ? { roomId: sanitizeAuditValue(event.roomId, 36) } : {}),
      ...(rawActor ? { actorId: sanitizeAuditValue(rawActor, 36) } : {}),
      ...(event.detail ? { detail: sanitizeAuditValue(event.detail, 96) } : {}),
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_AUDIT_RING_SIZE) {
      this.entries.shift();
    }

    try {
      console.warn('[SECURITY_AUDIT]', JSON.stringify(entry));
    } catch {
      // Ignore logging errors in constrained runtimes
    }
  }

  public getRecentCount(windowMs = 60_000, now = Date.now()): number {
    let count = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (now - this.entries[i].ts <= windowMs) {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }

  public getInternalAuditSnapshot(): ReadonlyArray<Readonly<SecurityAuditEntry>> {
    return this.entries.map((e) => ({ ...e }));
  }
}

export const workerSecurityLogger = new SecurityAuditLogger();

/**
 * Ensures client-facing error messages never leak internal paths, secrets,
 * stack traces, or Durable Object implementation details.
 */
export function sanitizeClientErrorMessage(message: unknown, fallback = 'Request rejected.'): string {
  if (typeof message !== 'string') return fallback;
  const trimmed = message.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!trimmed) return fallback;
  if (
    /stack|trace|internal|durable|storage|secret|hmac|tokenHash|sql|cloudflare|\.ts:/i.test(
      trimmed,
    )
  ) {
    return fallback;
  }
  return trimmed.slice(0, 140);
}
