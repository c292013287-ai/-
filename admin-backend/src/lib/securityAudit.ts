import prisma from './prisma';

export function auditRetentionDays() {
  const days = Number(process.env.SECURITY_AUDIT_RETENTION_DAYS ?? 30);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30;
}
export async function pruneAudit() {
  await prisma.securityEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - auditRetentionDays() * 86400000) } } });
}
export async function audit(actor: number, action: string, target: string) {
  await prisma.securityEvent.create({ data: { actor, action, target } });
}
