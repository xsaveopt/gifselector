const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const fsPromises = fs.promises;
const { authMiddleware, credentialsAreValid, issueToken, cookieOptions, verifyToken } = require('./auth');
const {
  addGif,
  listGifs,
  findGifBySlug,
  deleteGifBySlug,
  listCategories,
  addCategory,
  deleteCategoryById,
  setGifCategories
} = require('./database');
const config = require('./config');

const router = express.Router();

const ALLOWED_MIME_TYPES = new Set(['image/gif', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.gif', '.webp']);
const MIME_EXTENSION_MAP = {
  'image/gif': '.gif',
  'image/webp': '.webp'
};
const EXTENSION_MIME_MAP = {
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

function resolveFileExtension(file) {
  const originalExt = path.extname(file.originalname || '').toLowerCase();
  if (ALLOWED_EXTENSIONS.has(originalExt)) {
    return originalExt;
  }
  const mappedExt = MIME_EXTENSION_MAP[file.mimetype];
  return mappedExt || '.gif';
}

function extensionFromFilename(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) {
    return ext.slice(1);
  }
  return 'gif';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = resolveFileExtension(file);
    const uniqueName = `${Date.now()}-${nanoid(6)}${safeExt}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Only GIF or WebP uploads are allowed.'));
    }
    cb(null, true);
  }
});

function buildShareUrl(req, slug, filename) {
  const extension = extensionFromFilename(filename);
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto ? forwardedProto.split(',')[0] : req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}${config.BASE_PATH}/share/${slug}.${extension}`;
}

router.post('/api/login', express.json(), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (!credentialsAreValid(username, password)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const token = issueToken(username);
  res.cookie('authToken', token, cookieOptions());
  return res.json({ success: true });
});

router.post('/api/logout', (req, res) => {
  res.clearCookie('authToken', { ...cookieOptions(), maxAge: 0 });
  return res.json({ success: true });
});

router.get('/api/session', (req, res) => {
  const token = req.cookies?.authToken;
  if (!token) {
    return res.json({ authenticated: false });
  }
  try {
    const payload = verifyToken(token);
    return res.json({ authenticated: true, username: payload.username });
  } catch (error) {
    return res.json({ authenticated: false });
  }
});

router.get('/api/gifs', authMiddleware, async (req, res, next) => {
  try {
    const storedGifs = await listGifs();
    const gifs = storedGifs.map((gif) => ({
      id: gif.id,
      slug: gif.slug,
      originalName: gif.originalName,
      sizeBytes: gif.sizeBytes,
      createdAt: gif.createdAt,
      shareUrl: buildShareUrl(req, gif.slug, gif.filename),
      categories: Array.isArray(gif.categories)
        ? gif.categories.map((category) => ({ id: category.id, name: category.name }))
        : []
    }));
    return res.json({ gifs, total: storedGifs.length });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/categories', authMiddleware, async (req, res, next) => {
  try {
    const categories = await listCategories();
    return res.json({ categories });
  } catch (error) {
    return next(error);
  }
});

router.post('/api/categories', authMiddleware, express.json(), async (req, res, next) => {
  const { name } = req.body || {};
  try {
    const category = await addCategory(name);
    if (!category) {
      return res.status(500).json({ error: 'Failed to create category.' });
    }
    return res.status(201).json({ category });
  } catch (error) {
    if (error?.code === 'CATEGORY_NAME_REQUIRED') {
      return res.status(400).json({ error: error.message });
    }
    if (error?.code === 'CATEGORY_NAME_DUPLICATE') {
      return res.status(409).json({ error: error.message });
    }
    return next(error);
  }
});

router.delete('/api/categories/:id', authMiddleware, async (req, res, next) => {
  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(400).json({ error: 'Invalid category id.' });
  }
  try {
    const deleted = await deleteCategoryById(categoryId);
    if (!deleted) {
      return res.status(404).json({ error: 'Category not found.' });
    }
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.put('/api/gifs/:slug/categories', authMiddleware, express.json(), async (req, res, next) => {
  const { slug } = req.params;
  const { categoryIds } = req.body || {};
  try {
    const categories = await setGifCategories(slug, categoryIds);
    if (categories === null) {
      return res.status(404).json({ error: 'GIF not found.' });
    }
    return res.json({ categories });
  } catch (error) {
    if (error?.code === 'CATEGORY_NOT_FOUND') {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.post('/api/upload', authMiddleware, (req, res, next) => {
  upload.single('gif')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const slug = nanoid(10);
    return addGif({
      slug,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size
    })
      .then(() => {
        res.status(201).json({
          slug,
          shareUrl: buildShareUrl(req, slug, req.file.filename)
        });
      })
      .catch((dbError) => {
        fs.unlink(path.resolve(config.UPLOAD_DIR, req.file.filename), () => {
          // best-effort cleanup
        });
        next(dbError);
      });
  });
});

async function serveSharedGif(req, res, next) {
  const { slug, ext: requestedExtParam } = req.params;
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown-ip';
  const referer = req.get('referer') || req.get('referrer') || 'no-referer';
  console.log(`[share-access] slug=${slug} from ${clientIp} referer=${referer}`);
  try {
    const gif = await findGifBySlug(slug);
    if (!gif) {
      return res.status(404).json({ error: 'GIF not found.' });
    }
    const filePath = path.resolve(config.UPLOAD_DIR, gif.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'GIF file missing.' });
    }
    const storedExtension = path.extname(gif.filename).toLowerCase();
    const requestedExtension = requestedExtParam ? `.${requestedExtParam.toLowerCase()}` : null;
    if (requestedExtension && storedExtension && requestedExtension !== storedExtension) {
      return res.redirect(301, buildShareUrl(req, gif.slug, gif.filename));
    }
    const mimeType = gif.mimeType || EXTENSION_MIME_MAP[storedExtension] || 'image/gif';
    res.type(mimeType);
    return res.sendFile(filePath);
  } catch (error) {
    return next(error);
  }
}

router.get('/share/:slug.:ext', serveSharedGif);

router.get('/share/:slug', async (req, res, next) => {
  try {
    const gif = await findGifBySlug(req.params.slug);
    if (!gif) {
      return res.status(404).json({ error: 'GIF not found.' });
    }
    const shareUrl = buildShareUrl(req, gif.slug, gif.filename);
    return res.redirect(301, shareUrl);
  } catch (error) {
    return next(error);
  }
});

router.delete('/api/gifs/:slug', authMiddleware, async (req, res, next) => {
  const { slug } = req.params;
  try {
    const gif = await findGifBySlug(slug);
    if (!gif) {
      return res.status(404).json({ error: 'GIF not found.' });
    }
    const filePath = path.resolve(config.UPLOAD_DIR, gif.filename);
    const deleted = await deleteGifBySlug(slug);
    if (!deleted) {
      return res.status(404).json({ error: 'GIF not found.' });
    }
    await fsPromises.unlink(filePath).catch(() => {});
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
