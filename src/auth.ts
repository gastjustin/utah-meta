/**
 * UtahMeta - Token-based auth
 *
 * Simple bearer-token auth for the household/personal-server use case.
 * POST /auth/login with an authSubject (+ optional password) upserts a
 * UserProfile and returns a short-lived token. All other API routes
 * (except /health) are protected by requireAuth and expose the resolved
 * user on req.user.
 *
 * Passwords are hashed with PBKDF2 (Node built-in crypto, no external deps).
 * Users created without a password (passwordHash = null) can still login
 * without one — backward compatible with the original passwordless flow.
 */

import { randomUUID, pbkdf2Sync, timingSafeEqual } from "crypto";
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
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = "sha512";

function hashPassword(password: string): string {
  const salt = randomUUID();
  const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], "hex");
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, PBKDF2_DIGEST);
  return timingSafeEqual(expected, actual);
}

export const authRouter = Router();

authRouter.post("/login", async (req: Request, res: Response) => {
  const { authSubject, displayName, password } = req.body as {
    authSubject?: string;
    displayName?: string;
    password?: string;
  };

  if (!authSubject) {
    return res.status(400).json({ error: "authSubject is required" });
  }

  // Auto-grant admin to the first user ever created.
  const userCount = await prisma.userProfile.count();
  const shouldBeAdmin = userCount === 0;

  // Check if user already exists
  const existing = await prisma.userProfile.findUnique({ where: { authSubject } });

  if (existing) {
    // If user has a password set, verify it
    if (existing.passwordHash) {
      if (!password || !verifyPassword(password, existing.passwordHash)) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
    }
    // User without passwordHash: allow passwordless login (backward compat)
    const user = existing;
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
    return;
  }

  // New user: create with optional password
  const user = await prisma.userProfile.create({
    data: {
      authSubject,
      displayName: displayName || authSubject,
      isAdmin: shouldBeAdmin,
      passwordHash: password ? hashPassword(password) : null,
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

// POST /auth/change-password — change own password (requires auth)
authRouter.post("/change-password", async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "newPassword is required (min 4 characters)" });
  }

  const user = await prisma.userProfile.findUnique({
    where: { userId: req.user.userId },
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  // If user has a password, verify current password
  if (user.passwordHash) {
    if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  }

  await prisma.userProfile.update({
    where: { userId: user.userId },
    data: { passwordHash: hashPassword(newPassword) },
  });

  res.json({ success: true });
});

// POST /auth/reset-password — admin resets another user's password
authRouter.post("/reset-password", async (req: Request, res: Response) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { userId, newPassword } = req.body as {
    userId?: string;
    newPassword?: string;
  };

  if (!userId || !newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "userId and newPassword are required (min 4 characters)" });
  }

  const target = await prisma.userProfile.findUnique({ where: { userId } });
  if (!target) return res.status(404).json({ error: "User not found" });

  await prisma.userProfile.update({
    where: { userId },
    data: { passwordHash: hashPassword(newPassword) },
  });

  res.json({ success: true });
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
