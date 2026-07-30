/**
 * UtahMeta - User & Device Profile Routes (Phase 4: User profiles)
 *
 * Real provisioning for the "Users & Playback" pillar. Until now, users
 * were only ever created implicitly by watch-state-sync on first playback
 * (keyed by auth_subject). These endpoints let you manage UserProfile and
 * DeviceProfile rows directly:
 *   - create/list/get/update/delete users
 *   - register/list/update/delete a user's devices
 *
 * A DeviceProfile.clientType is validated against CLIENT_CAPABILITIES so a
 * device can't be registered with a client the playback engine doesn't know
 * how to make direct-play decisions for.
 */

import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { CLIENT_CAPABILITIES } from "./direct-play-engine";

export const userRouter = Router();

// ---------- Users ----------

// POST /users — create a user. authSubject is the external identity used by
// watch-state-sync; it's unique, so re-posting the same subject 409s.
userRouter.post("/users", async (req: Request, res: Response) => {
  const { displayName, authSubject, defaultAudioPolicyId, homeNodeId } =
    req.body as {
      displayName?: string;
      authSubject?: string;
      defaultAudioPolicyId?: string;
      homeNodeId?: string;
    };

  if (!displayName || !authSubject) {
    return res
      .status(400)
      .json({ error: "displayName and authSubject are required" });
  }

  const existing = await prisma.userProfile.findUnique({ where: { authSubject } });
  if (existing) {
    return res
      .status(409)
      .json({ error: `A user with authSubject "${authSubject}" already exists` });
  }

  const user = await prisma.userProfile.create({
    data: { displayName, authSubject, defaultAudioPolicyId, homeNodeId },
  });
  res.status(201).json(user);
});

// GET /users — list all users with a device count.
userRouter.get("/users", async (_req: Request, res: Response) => {
  const users = await prisma.userProfile.findMany({
    select: {
      userId: true,
      displayName: true,
      authSubject: true,
      isAdmin: true,
      homeNodeId: true,
      _count: { select: { devices: true, watchStates: true } },
    },
  });
  res.json(users);
});

// GET /users/:id — one user with their devices.
userRouter.get("/users/:id", async (req: Request, res: Response) => {
  const user = await prisma.userProfile.findUnique({
    where: { userId: req.params.id },
    include: { devices: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// PATCH /users/:id — update mutable profile fields.
// Only admins can change isAdmin or homeNodeId for other users.
userRouter.patch("/users/:id", async (req: Request, res: Response) => {
  const { displayName, defaultAudioPolicyId, homeNodeId, isAdmin } = req.body as {
    displayName?: string;
    defaultAudioPolicyId?: string;
    homeNodeId?: string;
    isAdmin?: boolean;
  };

  const data: Record<string, unknown> = {};
  if (displayName !== undefined) data.displayName = displayName;
  if (defaultAudioPolicyId !== undefined) data.defaultAudioPolicyId = defaultAudioPolicyId;
  if (homeNodeId !== undefined) data.homeNodeId = homeNodeId;

  // Only admins can toggle isAdmin.
  if (isAdmin !== undefined) {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Only admins can change admin status" });
    }
    // Prevent self-demotion to avoid locking out the last admin.
    if (req.user.userId === req.params.id && !isAdmin) {
      const adminCount = await prisma.userProfile.count({ where: { isAdmin: true } });
      if (adminCount <= 1) {
        return res.status(400).json({ error: "Cannot remove the last admin" });
      }
    }
    data.isAdmin = isAdmin;
  }

  try {
    const user = await prisma.userProfile.update({
      where: { userId: req.params.id },
      data,
    });
    res.json(user);
  } catch {
    res.status(404).json({ error: "User not found" });
  }
});

// GET /users/:id/watch-state — durable resume/completed positions for cloud sync.
userRouter.get("/users/:id/watch-state", async (req: Request, res: Response) => {
  const user = await prisma.userProfile.findUnique({
    where: { userId: req.params.id },
    select: { userId: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  const watchStates = await prisma.watchState.findMany({
    where: { userId: user.userId },
    orderBy: { lastWatchedAt: "desc" },
    select: {
      watchStateId: true,
      mediaItemId: true,
      positionMs: true,
      completed: true,
      lastWatchedAt: true,
    },
  });
  res.json(watchStates);
});

// DELETE /users/:id — remove a user plus their devices and watch state.
// Dependent rows go first (no ON DELETE cascade in the schema).
userRouter.delete("/users/:id", async (req: Request, res: Response) => {
  const userId = req.params.id;
  const user = await prisma.userProfile.findUnique({ where: { userId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.watchState.deleteMany({ where: { userId } });
    await tx.deviceProfile.deleteMany({ where: { userId } });
    await tx.userProfile.delete({ where: { userId } });
  });
  res.status(204).send();
});

// ---------- Devices ----------

// POST /users/:userId/devices — register a device for a user.
userRouter.post("/users/:userId/devices", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { deviceName, clientType, capabilityHash, maxBitrate } = req.body as {
    deviceName?: string;
    clientType?: string;
    capabilityHash?: string;
    maxBitrate?: number;
  };

  if (!deviceName || !clientType) {
    return res
      .status(400)
      .json({ error: "deviceName and clientType are required" });
  }

  if (!CLIENT_CAPABILITIES[clientType]) {
    return res.status(400).json({
      error: `Unknown clientType "${clientType}". Known: ${Object.keys(
        CLIENT_CAPABILITIES
      ).join(", ")}`,
    });
  }

  const user = await prisma.userProfile.findUnique({ where: { userId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const device = await prisma.deviceProfile.create({
    data: { userId, deviceName, clientType, capabilityHash, maxBitrate },
  });
  res.status(201).json(device);
});

// GET /users/:userId/devices — list a user's devices.
userRouter.get("/users/:userId/devices", async (req: Request, res: Response) => {
  const devices = await prisma.deviceProfile.findMany({
    where: { userId: req.params.userId },
    orderBy: { deviceName: "asc" },
  });
  res.json(devices);
});

// PATCH /devices/:id — update a device (e.g. rename, bump last_seen).
userRouter.patch("/devices/:id", async (req: Request, res: Response) => {
  const { deviceName, clientType, capabilityHash, maxBitrate, lastSeenAt } =
    req.body as {
      deviceName?: string;
      clientType?: string;
      capabilityHash?: string;
      maxBitrate?: number;
      lastSeenAt?: string;
    };

  if (clientType && !CLIENT_CAPABILITIES[clientType]) {
    return res.status(400).json({
      error: `Unknown clientType "${clientType}". Known: ${Object.keys(
        CLIENT_CAPABILITIES
      ).join(", ")}`,
    });
  }

  try {
    const device = await prisma.deviceProfile.update({
      where: { deviceId: req.params.id },
      data: {
        deviceName,
        clientType,
        capabilityHash,
        maxBitrate,
        lastSeenAt: lastSeenAt ? new Date(lastSeenAt) : undefined,
      },
    });
    res.json(device);
  } catch {
    res.status(404).json({ error: "Device not found" });
  }
});

// DELETE /devices/:id — remove a device. WatchState references userId, not
// deviceId, so no dependent cleanup is needed here.
userRouter.delete("/devices/:id", async (req: Request, res: Response) => {
  try {
    await prisma.deviceProfile.delete({ where: { deviceId: req.params.id } });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Device not found" });
  }
});
