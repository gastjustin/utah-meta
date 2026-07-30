/**
 * UtahMeta - Library Browse & Search Routes
 *
 * Read-side endpoints against the durable Postgres schema: list
 * libraries, list items in a library, get a single item's detail
 * (including its watch state for a given user), and a basic title
 * search. This is the "Search and metadata services" piece of Phase 4's
 * "Core Platform Services."
 *
 * Deliberately simple — title search only, no fuzzy matching or full
 * text indexes yet. Fine for a personal library's scale; revisit with
 * Postgres full-text search (tsvector) if the catalog grows large.
 */

import { Router, Request, Response } from "express";
import { prisma } from "./db";

export const libraryRouter = Router();

// ---------- List libraries ----------

libraryRouter.get("/libraries", async (_req: Request, res: Response) => {
  const libraries = await prisma.library.findMany({
    select: {
      libraryId: true,
      name: true,
      kind: true,
      rootPath: true,
      _count: { select: { mediaItems: true } },
    },
  });
  res.json(libraries);
});

// ---------- List series in a library ----------

libraryRouter.get("/libraries/:id/series", async (req: Request, res: Response) => {
  const series = await prisma.series.findMany({
    where: { libraryId: req.params.id },
    select: {
      seriesId: true,
      title: true,
      status: true,
      _count: { select: { seasons: true } },
    },
    orderBy: { sortTitle: "asc" },
  });
  res.json(series);
});

// ---------- Series detail: seasons + episodes, properly ordered ----------

libraryRouter.get("/series/:id", async (req: Request, res: Response) => {
  const series = await prisma.series.findUnique({
    where: { seriesId: req.params.id },
    include: {
      seasons: {
        orderBy: { seasonNumber: "asc" },
        include: {
          mediaItems: {
            orderBy: { episodeNumber: "asc" },
            select: {
              mediaItemId: true,
              title: true,
              episodeNumber: true,
              runtimeMs: true,
            },
          },
        },
      },
    },
  });

  if (!series) {
    return res.status(404).json({ error: "Series not found" });
  }

  res.json(series);
});

// ---------- List items in a library ----------

libraryRouter.get("/libraries/:id/items", async (req: Request, res: Response) => {
  const items = await prisma.mediaItem.findMany({
    where: { libraryId: req.params.id },
    select: {
      mediaItemId: true,
      title: true,
      itemType: true,
      releaseYear: true,
      runtimeMs: true,
    },
    orderBy: { title: "asc" },
  });
  res.json(items);
});

// ---------- Single item detail ----------
// Optional ?userId=<external auth subject> to include that user's
// watch state (resume position / completed flag) for this item.

libraryRouter.get("/media/:id", async (req: Request, res: Response) => {
  const mediaItem = await prisma.mediaItem.findUnique({
    where: { mediaItemId: req.params.id },
    include: {
      fileAssets: true,
      artworkAssets: true,
      mediaGenres: { include: { genre: true } },
      mediaCredits: { include: { person: true } },
    },
  });

  if (!mediaItem) {
    return res.status(404).json({ error: "Media item not found" });
  }

  const externalUserId = req.query.userId as string | undefined;
  let watchState = null;

  if (externalUserId) {
    const user = await prisma.userProfile.findUnique({
      where: { authSubject: externalUserId },
      select: { userId: true },
    });

    if (user) {
      watchState = await prisma.watchState.findUnique({
        where: {
          userId_mediaItemId: {
            userId: user.userId,
            mediaItemId: mediaItem.mediaItemId,
          },
        },
      });
    }
  }

  res.json({ ...mediaItem, watchState });
});

// ---------- Search ----------
// GET /search?q=dune

libraryRouter.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: "Query param 'q' is required" });
  }

  const results = await prisma.mediaItem.findMany({
    where: {
      title: { contains: q, mode: "insensitive" },
    },
    select: {
      mediaItemId: true,
      title: true,
      itemType: true,
      releaseYear: true,
    },
    take: 25,
    orderBy: { title: "asc" },
  });

  res.json(results);
});
