/**
 * UtahMeta - Token-based auth
 *
 * Simple bearer-token auth for the household/personal-server use case.
 * POST /auth/login with an authSubject upserts a UserProfile and returns
 * a short-lived token. All other API routes (except /health) are protected
 * by requireAuth and expose the resolved user on req.user.
 */

import { randomUUID } from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "./db";
import { redis } from "./redis";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        authSubject: string;
        displayName: string;
        isAdmin: boolean;
      };
    }
  }
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const authRouter = Router();

authRouter.post("/login", async (req: Request, res: Response) => {
  const { authSubject, displayName } = req.body as {
    authSubject?: string;
    displayName?: string;
  };

  if (!authSubject) {
    return res.status(400).json({ error: "authSubject is required" });
  }

  // Auto-grant admin to the first user ever created.
  const userCount = await prisma.userProfile.count();
  const shouldBeAdmin = userCount === 0;

  const user = await prisma.userProfile.upsert({
    where: { authSubject },
    update: {},
    create: {
      authSubject,
      displayName: displayName || authSubject,
      isAdmin: shouldBeAdmin,
    },
  });

  const token = randomUUID();
  await redis.set(
    `auth:${token}`,
    JSON.stringify({
      userId: user.userId,
      authSubject: user.authSubject,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    }),
    "EX",
    TOKEN_TTL_SECONDS
  );

  res.json({ token, user });
});

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.slice(7);
  const raw = await redis.get(`auth:${token}`);
  if (!raw) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  try {
    req.user = JSON.parse(raw);
    next();
  } catch {
    res.status(401).json({ error: "Malformed session" });
  }
}
