import { Router } from 'express';
import { Nomination, Post, getSettings } from '../models/index.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

// Home page data: posts (with their approved candidates) and the election phase.
router.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const [posts, approved, settings] = await Promise.all([
      Post.find().sort({ createdAt: 1 }).lean(),
      Nomination.find({ status: 'approved' }).sort({ createdAt: 1 }).lean(),
      getSettings(),
    ]);

    const byPost = new Map();
    for (const n of approved) {
      const key = String(n.post);
      if (!byPost.has(key)) byPost.set(key, []);
      byPost.get(key).push({
        id: n._id,
        fullName: n.fullName,
        department: n.department,
        year: n.year,
        manifesto: n.manifesto,
      });
    }

    res.json({
      posts: posts.map((p) => ({
        id: p._id,
        name: p.name,
        eligibility: p.eligibility,
        responsibilities: p.responsibilities,
        candidates: byPost.get(String(p._id)) || [],
      })),
      settings: { nominationsOpen: settings.nominationsOpen, votingState: settings.votingState },
    });
  }),
);

export default router;
