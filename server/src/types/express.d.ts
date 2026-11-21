import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        orgId: string | null;
        email: string;
      };
      requestId?: string;
      rawBodyBuffer?: Buffer;
    }
  }
}

export {};
