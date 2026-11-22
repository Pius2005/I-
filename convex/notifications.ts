import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireUser } from '../shared/authz';
import { paginate, pagination } from '../shared/shared';

export const list = query({
  args: {
    token: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const { page, pageSize, skip } = pagination(args);
    const all = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .collect();
    const filtered = all
      .filter((n) => (args.unreadOnly ? !n.readAt : true))
      .sort((a, b) => b.createdAt - a.createdAt);
    const items = filtered.slice(skip, skip + pageSize).map((n) => ({ ...n, id: n._id }));
    const result = paginate(items, filtered.length, page, pageSize);
    return {
      ...result,
      meta: { ...result.meta, unread: all.filter((n) => !n.readAt).length },
    };
  },
});

export const markRead = mutation({
  args: { token: v.string(), id: v.id('notifications') },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const notification = await ctx.db.get(args.id);
    if (notification && notification.userId === auth.user._id) {
      await ctx.db.patch(notification._id, { readAt: Date.now() });
    }
    return { ok: true };
  },
});

export const markAllRead = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .collect();
    for (const row of rows.filter((r) => !r.readAt)) {
      await ctx.db.patch(row._id, { readAt: Date.now() });
    }
    return { ok: true };
  },
});

export const preferences = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const prefs = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .unique();
    if (prefs) return prefs;
    return { email: true, sms: false, whatsapp: false, inApp: true };
  },
});

export const updatePreferences = mutation({
  args: {
    token: v.string(),
    email: v.optional(v.boolean()),
    sms: v.optional(v.boolean()),
    whatsapp: v.optional(v.boolean()),
    inApp: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await requireUser(ctx, args.token);
    const existing = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_user', (q) => q.eq('userId', auth.user._id))
      .unique();
    const patch = {
      email: args.email ?? existing?.email ?? true,
      sms: args.sms ?? existing?.sms ?? false,
      whatsapp: args.whatsapp ?? existing?.whatsapp ?? false,
      inApp: args.inApp ?? existing?.inApp ?? true,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ...existing, ...patch };
    }
    const id = await ctx.db.insert('notificationPreferences', { userId: auth.user._id, ...patch });
    return await ctx.db.get(id);
  },
});
