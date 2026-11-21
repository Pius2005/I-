import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async.js';
import { requireAuth } from '../middleware/auth.js';
import { paginated, paginationSchema, validate } from '../lib/validate.js';
import { unreadNotificationCount } from '../services/notifications.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = validate(paginationSchema.extend({ unreadOnly: z.coerce.boolean().optional() }), req.query);
    const where = { userId: req.user!.id, ...(query.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.notification.count({ where }),
      unreadNotificationCount(req.user!.id),
    ]);
    res.json({ ...paginated(items, total, query.page, query.pageSize), meta: { ...paginated([], total, query.page, query.pageSize).meta, unread } });
  }),
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { readAt: new Date() },
    });
    res.json({ data: { ok: true } });
  }),
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ data: { ok: true } });
  }),
);

const prefSchema = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
  inApp: z.boolean().optional(),
});

router.get(
  '/preferences',
  asyncHandler(async (req, res) => {
    const prefs = await prisma.notificationPreference.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id },
      update: {},
    });
    res.json({ data: prefs });
  }),
);

router.put(
  '/preferences',
  asyncHandler(async (req, res) => {
    const input = validate(prefSchema, req.body);
    const prefs = await prisma.notificationPreference.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, ...input },
      update: input,
    });
    res.json({ data: prefs });
  }),
);

export default router;
