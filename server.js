const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cache to avoid hammering APIs
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// ── Reddit Search ──────────────────────────────────────────────────────────
app.get('/api/reddit', async (req, res) => {
  const { q, sub, limit = 25 } = req.query;
  const cacheKey = `reddit:${q}:${sub}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    let url;
    if (sub) {
      url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${limit}&raw_json=1`;
    } else {
      url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=${limit}&t=month&raw_json=1`;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LeadFinder/1.0 (commission lead finder)',
        'Accept': 'application/json',
      },
      timeout: 8000,
    });

    if (!response.ok) throw new Error('Reddit error: ' + response.status);
    const data = await response.json();

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const posts = (data?.data?.children || [])
      .map(c => c.data)
      .filter(p => new Date(p.created_utc * 1000) > thirtyDaysAgo)
      .map(p => ({
        id: p.id,
        title: p.title || '',
        body: (p.selftext || '').slice(0, 300),
        author: p.author || '',
        sub: p.subreddit || '',
        url: 'https://reddit.com' + (p.permalink || ''),
        score: p.score || 0,
        comments: p.num_comments || 0,
        time: new Date(p.created_utc * 1000).toISOString(),
      }));

    setCache(cacheKey, posts);
    res.json(posts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Bluesky Search ─────────────────────────────────────────────────────────
app.get('/api/bluesky', async (req, res) => {
  const { q, limit = 25 } = req.query;
  const cacheKey = `bluesky:${q}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=${limit}&sort=latest`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      timeout: 8000,
    });

    if (!response.ok) throw new Error('Bluesky error: ' + response.status);
    const data = await response.json();

    const posts = (data.posts || []).map(p => ({
      id: p.uri,
      text: p.record?.text || '',
      author: p.author?.displayName || p.author?.handle || '',
      handle: p.author?.handle || '',
      avatar: p.author?.avatar || '',
      time: p.indexedAt,
      url: `https://bsky.app/profile/${p.author?.handle}/post/${p.uri.split('/').pop()}`,
      likes: p.likeCount || 0,
      reposts: p.repostCount || 0,
    }));

    setCache(cacheKey, posts);
    res.json(posts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Twitter/X Search ───────────────────────────────────────────────────────
// Twitter requires authentication - agents use OldTweetDeck for this
// This endpoint is a placeholder that returns helpful info
app.get('/api/twitter', async (req, res) => {
  res.json({
    message: 'For Twitter search, use OldTweetDeck which handles authentication automatically.',
    tip: 'OldTweetDeck is already installed and working on your agents PCs.'
  });
});

// ── Log to Google Sheets ───────────────────────────────────────────────────
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbyfE_CVAPP7J6BzSWsKFWPF4vPa7jkoHerCtp9p1zNc65OFdVRPLXusaZyDCffNxWWU8g/exec';

app.post('/api/log', async (req, res) => {
  try {
    const response = await fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify(req.body),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Serve frontend ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LeadFinder server running on port ${PORT}`);
});
