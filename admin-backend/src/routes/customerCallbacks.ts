import { Router, text } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import prisma from '../lib/prisma';
import { decryptCallback, parseCallbackXml } from '../lib/customerCallback';
import { fingerprintOf, sql } from '../lib/customerLiveStore';
import { customerLive, enqueueDetail } from '../services/customerLive';

const router = Router();
const configFile = () => process.env.CUSTOMER_CALLBACK_CONFIG || path.resolve('data/customer-callbacks.json');
export async function callbackConfig(id: number): Promise<{ token: string; aesKey: string } | undefined> {
  try { return JSON.parse(await readFile(configFile(), 'utf8'))[String(id)]; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}

router.all('/:id', text({ type: ['text/*', 'application/xml'], limit: '64kb' }), async (req, res) => {
  if (!customerLive.enabled) { res.status(503).send('Unavailable'); return; }
  if (!['GET', 'POST'].includes(req.method)) { res.sendStatus(405); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.sendStatus(404); return; }
  try {
    const config = await callbackConfig(id);
    const entity = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!config || entity?.status !== 'active') { res.sendStatus(404); return; }
    const scalar = (value: unknown) => typeof value === 'string' ? value : '';
    const encrypted = req.method === 'GET' ? scalar(req.query.echostr) : scalar(parseCallbackXml(req.body).Encrypt);
    let payload: string;
    try { payload = decryptCallback(config, entity.corpid, encrypted, scalar(req.query.msg_signature), scalar(req.query.timestamp), scalar(req.query.nonce)); }
    catch { res.status(403).send('Invalid signature'); return; }
    if (req.method === 'GET') { res.type('text/plain').send(payload); return; }
    const event = parseCallbackXml(payload);
    if (event.ToUserName !== entity.corpid) { res.sendStatus(403); return; }
    if (event.Event !== 'change_external_contact') { res.type('text/plain').send('success'); return; }
    const user = scalar(event.UserID); const external = scalar(event.ExternalUserID);
    if (!user || !external || user.length > 191 || external.length > 191) { res.status(400).send('Invalid event'); return; }
    const fp = fingerprintOf(entity);
    const eventKey = createHash('sha256').update(JSON.stringify([id, fp, payload])).digest('hex');
    await prisma.$transaction(async tx => {
      const inserted = await tx.$executeRaw(sql`INSERT IGNORE INTO customer_live_events(event_key,entity_id,received_ms) VALUES(${eventKey},${id},${Date.now()})`);
      if (!inserted) return;
      await tx.$executeRaw(sql`INSERT INTO customer_live_state(entity_id,fingerprint,event_ms) VALUES(${id},${fp},${Date.now()}) ON DUPLICATE KEY UPDATE event_ms=VALUES(event_ms)`);
      await tx.$executeRaw(sql`INSERT INTO customer_live_employees(entity_id,fingerprint,user_id,full_ms) VALUES(${id},${fp},${user},${Date.now()}) ON DUPLICATE KEY UPDATE due_ms=0`);
      // Always re-read current state. Reordered/retried deletion events cannot remove a re-added customer.
      if (!['del_external_contact', 'del_follow_user'].includes(event.ChangeType)) await enqueueDetail(id, fp, external, user, tx);
    });
    res.type('text/plain').send('success');
  } catch { res.status(503).send('Retry later'); }
});
export default router;
