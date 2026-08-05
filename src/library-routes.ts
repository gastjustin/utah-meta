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
import { probeMediaFile } from "./ffprobe-integration";

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
  const authSubject = (req.query.userId as string) || req.user?.authSubject;

  let userId: string | undefined;
  if (authSubject) {
    const user = await prisma.userProfile.findUnique({
      where: { authSubject },
      select: { userId: true },
    });
    userId = user?.userId;
  }

  const series = await prisma.series.findUnique({
    where: { seriesId: req.params.id },
    select: {
      seriesId: true,
      title: true,
      status: true,
      firstAirYear: true,
      posterUri: true,
      backdropUri: true,
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
              artworkAssets: { select: { artworkAssetId: true, kind: true } },
            },
          },
        },
      },
    },
  });

  if (!series) {
    return res.status(404).json({ error: "Series not found" });
  }

  // Attach watch state per episode if we have a userId
  if (userId) {
    const watchStates = await prisma.watchState.findMany({
      where: {
        userId,
        mediaItemId: { in: series.seasons.flatMap((s: { mediaItems: { mediaItemId: string }[] }) => s.mediaItems.map((m: { mediaItemId: string }) => m.mediaItemId)) },
      },
      select: { mediaItemId: true, positionMs: true, completed: true },
    });
    const wsMap = new Map(watchStates.map((w: { mediaItemId: string; positionMs: number; completed: boolean }) => [w.mediaItemId, w]));
    for (const season of series.seasons) {
      for (const ep of season.mediaItems) {
        (ep as Record<string, unknown>).watchState = wsMap.get(ep.mediaItemId) || null;
      }
    }
  }

  res.json(series);
});

// ---------- List all items across libraries ----------
// GET /items?moviesOnly=true

libraryRouter.get("/items", async (req: Request, res: Response) => {
  const moviesOnly = req.query.moviesOnly === "true";
  const items = await prisma.mediaItem.findMany({
    where: moviesOnly ? { seasonId: null } : {},
    select: {
      mediaItemId: true,
      title: true,
      itemType: true,
      releaseYear: true,
      runtimeMs: true,
      artworkAssets: { select: { artworkAssetId: true, kind: true } },
    },
    orderBy: { title: "asc" },
    take: 200,
  });
  res.json(items);
});

// ---------- List all series across libraries ----------

libraryRouter.get("/series", async (_req: Request, res: Response) => {
  const series = await prisma.series.findMany({
    select: {
      seriesId: true,
      title: true,
      status: true,
      _count: { select: { seasons: true } },
    },
    orderBy: { title: "asc" },
  });
  res.json(series);
});

// ---------- List items in a library ----------

libraryRouter.get("/libraries/:id/items", async (req: Request, res: Response) => {
  const moviesOnly = req.query.moviesOnly === "true";
  const items = await prisma.mediaItem.findMany({
    where: {
      libraryId: req.params.id,
      ...(moviesOnly ? { seasonId: null } : {}),
    },
    select: {
      mediaItemId: true,
      title: true,
      itemType: true,
      releaseYear: true,
      runtimeMs: true,
      artworkAssets: { select: { artworkAssetId: true, kind: true } },
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
      season: { include: { series: { select: { seriesId: true, title: true } } } },
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

// ---------- Technical specs (resolution / HDR / codecs) ----------
// GET /media/:id/probe — runs ffprobe against the primary file asset.
// Fails soft (available: false) if ffprobe isn't installed or the file
// isn't reachable from this process, since the UI treats this as an
// optional enhancement rather than a hard dependency.

libraryRouter.get("/media/:id/probe", async (req: Request, res: Response) => {
  const mediaItem = await prisma.mediaItem.findUnique({
    where: { mediaItemId: req.params.id },
    select: { fileAssets: { select: { sourcePath: true }, take: 1 } },
  });

  const sourcePath = mediaItem?.fileAssets[0]?.sourcePath;
  if (!sourcePath) {
    return res.json({ available: false });
  }

  try {
    const profile = await probeMediaFile(sourcePath);
    res.json({
      available: true,
      container: profile.container,
      videoCodec: profile.videoCodec,
      audioCodec: profile.audioCodec,
      resolution: profile.resolution,
      isHDR: profile.isHDR,
      bitrateMbps: profile.bitrateMbps,
      audioTracks: profile.audioTracks,
      subtitleTracks: profile.subtitleTracks,
    });
  } catch {
    res.json({ available: false });
  }
});

// ---------- Mark watched / rate ----------
// POST /media/:id/watch-state — body: { completed?: boolean, rating?: 1-5 }
// Upserts the caller's WatchState row. Used by the "Mark Watched" button
// and the star rating control on the media detail page.

libraryRouter.post("/media/:id/watch-state", async (req: Request, res: Response) => {
  const authSubject = req.user?.authSubject;
  if (!authSubject) return res.status(401).json({ error: "Authentication required" });

  const { completed, rating } = req.body as { completed?: boolean; rating?: number };
  if (rating !== undefined && (rating < 1 || rating > 5)) {
    return res.status(400).json({ error: "rating must be between 1 and 5" });
  }

  const user = await prisma.userProfile.findUnique({ where: { authSubject }, select: { userId: true } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const mediaItem = await prisma.mediaItem.findUnique({
    where: { mediaItemId: req.params.id },
    select: { mediaItemId: true, runtimeMs: true },
  });
  if (!mediaItem) return res.status(404).json({ error: "Media item not found" });

  const watchState = await prisma.watchState.upsert({
    where: { userId_mediaItemId: { userId: user.userId, mediaItemId: mediaItem.mediaItemId } },
    update: {
      ...(completed !== undefined
        ? { completed, positionMs: completed ? mediaItem.runtimeMs ?? 0 : 0 }
        : {}),
      ...(rating !== undefined ? { rating } : {}),
      lastWatchedAt: new Date(),
    },
    create: {
      userId: user.userId,
      mediaItemId: mediaItem.mediaItemId,
      positionMs: completed ? mediaItem.runtimeMs ?? 0 : 0,
      completed: completed ?? false,
      rating: rating ?? null,
      lastWatchedAt: new Date(),
    },
  });

  res.json(watchState);
});

// ---------- Continue Watching ----------
// GET /continue-watching?userId=<authSubject>
// Returns in-progress items sorted by last watched, with resume position.

libraryRouter.get("/continue-watching", async (req: Request, res: Response) => {
  const authSubject = (req.query.userId as string) || req.user?.authSubject;
  if (!authSubject) return res.json([]);

  const user = await prisma.userProfile.findUnique({
    where: { authSubject },
    select: { userId: true },
  });
  if (!user) return res.json([]);

  const watchStates = await prisma.watchState.findMany({
    where: {
      userId: user.userId,
      completed: false,
      positionMs: { gt: 0 },
    },
    orderBy: { lastWatchedAt: "desc" },
    take: 20,
    include: {
      mediaItem: {
        select: {
          mediaItemId: true,
          title: true,
          itemType: true,
          releaseYear: true,
          runtimeMs: true,
          episodeNumber: true,
          season: { select: { seasonNumber: true, series: { select: { title: true } } } },
        },
      },
    },
  });

  res.json(
    watchStates.map((ws: { mediaItemId: string; positionMs: number; completed: boolean; lastWatchedAt: Date; mediaItem: { mediaItemId: string; title: string; itemType: string; releaseYear: number | null; runtimeMs: number | null; episodeNumber: number | null; season: { seasonNumber: number; series: { title: string } } | null } }) => ({
      mediaItemId: ws.mediaItem.mediaItemId,
      title: ws.mediaItem.title,
      itemType: ws.mediaItem.itemType,
      releaseYear: ws.mediaItem.releaseYear,
      runtimeMs: ws.mediaItem.runtimeMs,
      episodeNumber: ws.mediaItem.episodeNumber,
      seasonNumber: ws.mediaItem.season?.seasonNumber,
      seriesTitle: ws.mediaItem.season?.series?.title,
      positionMs: ws.positionMs,
      completed: ws.completed,
      lastWatchedAt: ws.lastWatchedAt,
    }))
  );
});

// ---------- Similar / More Like This ----------
// GET /media/:id/similar
// Returns up to 12 items that share at least one genre with the given item,
// excluding the item itself. Sorted by number of shared genres (desc).

libraryRouter.get("/media/:id/similar", async (req: Request, res: Response) => {
  const item = await prisma.mediaItem.findUnique({
    where: { mediaItemId: req.params.id },
    select: { mediaItemId: true, libraryId: true },
  });
  if (!item) return res.status(404).json({ error: "Media item not found" });

  // Get genre IDs for this item
  const genreLinks = await prisma.mediaGenre.findMany({
    where: { mediaItemId: req.params.id },
    select: { genreId: true },
  });
  const genreIds = genreLinks.map((g: { genreId: string }) => g.genreId);
  if (genreIds.length === 0) return res.json([]);

  // Find other items that share any of these genres
  const similar = await prisma.mediaItem.findMany({
    where: {
      mediaItemId: { not: req.params.id },
      mediaGenres: { some: { genreId: { in: genreIds } } },
    },
    select: {
      mediaItemId: true,
      title: true,
      itemType: true,
      releaseYear: true,
      runtimeMs: true,
      artworkAssets: { select: { artworkAssetId: true, kind: true } },
      mediaGenres: { select: { genreId: true } },
    },
    take: 30,
  });

  // Sort by number of shared genres (desc), then take 12
  type SimilarItem = (typeof similar)[number];
  const sharedCount = (m: SimilarItem) =>
    m.mediaGenres.filter((g: { genreId: string }) => genreIds.includes(g.genreId)).length;

  similar.sort((a: SimilarItem, b: SimilarItem) => sharedCount(b) - sharedCount(a));

  res.json(similar.slice(0, 12).map((m: SimilarItem) => ({
    mediaItemId: m.mediaItemId,
    title: m.title,
    itemType: m.itemType,
    releaseYear: m.releaseYear,
    runtimeMs: m.runtimeMs,
    artworkAssets: m.artworkAssets,
  })));
});

// ---------- Ready variants for a media item ----------
// GET /media/:id/variants

libraryRouter.get("/media/:id/variants", async (req: Request, res: Response) => {
  const mediaItem = await prisma.mediaItem.findUnique({
    where: { mediaItemId: req.params.id },
    select: { mediaItemId: true },
  });
  if (!mediaItem) return res.status(404).json({ error: "Media item not found" });

  const variants = await prisma.versionVariant.findMany({
    where: { mediaItemId: req.params.id },
    include: {
      compatibilityProfile: true,
      sourceFileAsset: true,
      outputStorageVolume: true,
    },
    orderBy: { prepState: "desc" },
  });
  res.json(variants);
});

// ---------- Collections ----------
// GET /collections — list all collections

libraryRouter.get("/collections", async (_req: Request, res: Response) => {
  const collections = await prisma.collection.findMany({
    select: {
      collectionId: true,
      name: true,
      collectionType: true,
      _count: { select: { items: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json(collections);
});

// POST /collections — create a new collection

libraryRouter.post("/collections", async (req: Request, res: Response) => {
  const { name, collectionType } = req.body as {
    name: string;
    collectionType: string;
  };
  if (!name || !collectionType) {
    return res.status(400).json({ error: "name and collectionType are required" });
  }
  const collection = await prisma.collection.create({
    data: { name, collectionType },
  });
  res.status(201).json(collection);
});

// GET /collections/:id — get collection with items

libraryRouter.get("/collections/:id", async (req: Request, res: Response) => {
  const collection = await prisma.collection.findUnique({
    where: { collectionId: req.params.id },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          mediaItem: {
            select: {
              mediaItemId: true,
              title: true,
              itemType: true,
              releaseYear: true,
              runtimeMs: true,
              artworkAssets: { select: { artworkAssetId: true, kind: true } },
            },
          },
        },
      },
    },
  });
  if (!collection) return res.status(404).json({ error: "Collection not found" });
  res.json(collection);
});

// POST /collections/:id/items — add item to collection

libraryRouter.post("/collections/:id/items", async (req: Request, res: Response) => {
  const { mediaItemId } = req.body as { mediaItemId: string };
  if (!mediaItemId) {
    return res.status(400).json({ error: "mediaItemId is required" });
  }
  const maxOrder = await prisma.collectionItem.aggregate({
    where: { collectionId: req.params.id },
    _max: { sortOrder: true },
  });
  const item = await prisma.collectionItem.create({
    data: {
      collectionId: req.params.id,
      mediaItemId,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });
  res.status(201).json(item);
});

// DELETE /collections/:id/items/:itemId — remove item from collection

libraryRouter.delete("/collections/:id/items/:itemId", async (req: Request, res: Response) => {
  await prisma.collectionItem.delete({
    where: { collectionItemId: req.params.itemId },
  });
  res.status(204).send();
});

// DELETE /collections/:id — delete entire collection

libraryRouter.delete("/collections/:id", async (req: Request, res: Response) => {
  await prisma.collection.delete({
    where: { collectionId: req.params.id },
  });
  res.status(204).send();
});

// ---------- Search ----------
// GET /search?q=dune

libraryRouter.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: "Query param 'q' is required" });
  }

  const [items, series] = await Promise.all([
    prisma.mediaItem.findMany({
      where: {
        title: { contains: q, mode: "insensitive" },
      },
      select: {
        mediaItemId: true,
        title: true,
        itemType: true,
        releaseYear: true,
        runtimeMs: true,
        seasonId: true,
        episodeNumber: true,
      },
      take: 25,
      orderBy: { title: "asc" },
    }),
    prisma.series.findMany({
      where: {
        title: { contains: q, mode: "insensitive" },
      },
      select: {
        seriesId: true,
        title: true,
        status: true,
        _count: { select: { seasons: true } },
      },
      take: 10,
      orderBy: { sortTitle: "asc" },
    }),
  ]);

  res.json({ items, series });
});
