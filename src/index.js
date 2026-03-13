const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const { parseFile } = require('./parser')
const { loadConfig, saveConfig, generateToken } = require('./config')

const PORT = 7842
const ONOPS_URL = 'https://app.onops.ai'
const app = express()

// ── CORS: only allow onOPS origins ────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://app.onops.ai',
  'http://localhost:3000',  // local dev
  'http://localhost:3001',
]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-onops-token'],
}))

app.use(express.json())

// ── Token auth middleware ─────────────────────────────────────────
function requireAuth(req, res, next) {
  const config = loadConfig()
  const token = req.headers['x-onops-token']
  if (!token || token !== config.token) {
    return res.status(401).json({ error: 'Invalid or missing token' })
  }
  next()
}

// ── Path safety check ─────────────────────────────────────────────
function isPathAllowed(targetPath, config) {
  const resolved = path.resolve(targetPath)
  return config.allowed_paths.some(allowed => {
    const resolvedAllowed = path.resolve(allowed)
    return resolved.startsWith(resolvedAllowed)
  })
}

// ── Routes ────────────────────────────────────────────────────────

// Health check — no auth required, just confirms bridge is running
app.get('/ping', (req, res) => {
  const config = loadConfig()
  res.json({
    status: 'ok',
    version: '1.0.0',
    platform: os.platform(),
    hostname: os.hostname(),
    allowed_paths: config.allowed_paths,
  })
})

// System info
app.get('/system', requireAuth, (req, res) => {
  const config = loadConfig()
  res.json({
    platform: os.platform(),
    hostname: os.hostname(),
    username: os.userInfo().username,
    home: os.homedir(),
    allowed_paths: config.allowed_paths,
    version: '1.0.0',
  })
})

// Browse a directory
app.get('/browse', requireAuth, (req, res) => {
  const config = loadConfig()
  let targetPath = req.query.path

  // Support ?folder=Desktop shortcut — finds the matching allowed path
  if (!targetPath && req.query.folder) {
    const folderName = req.query.folder.toString()
    targetPath = config.allowed_paths.find(p =>
      path.basename(p).toLowerCase() === folderName.toLowerCase()
    )
  }

  if (!targetPath) {
    // Return allowed root paths if no path given
    const roots = config.allowed_paths.map(p => ({
      name: path.basename(p) || p,
      path: p,
      type: 'directory',
      exists: fs.existsSync(p),
    }))
    return res.json({ path: '/', entries: roots })
  }

  if (!isPathAllowed(targetPath, config)) {
    return res.status(403).json({ error: 'Path not in allowed directories' })
  }

  try {
    const resolved = path.resolve(targetPath)
    const stat = fs.statSync(resolved)

    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' })
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .map(entry => {
        const fullPath = path.join(resolved, entry.name)
        let size = null
        let modified = null
        try {
          const s = fs.statSync(fullPath)
          size = s.size
          modified = s.mtime.toISOString()
        } catch {}

        return {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          extension: entry.isFile() ? path.extname(entry.name).toLowerCase() : null,
          size,
          modified,
          readable: isReadableFile(entry.name),
        }
      })
      .filter(e => !e.name.startsWith('.')) // hide hidden files
      .sort((a, b) => {
        // Directories first, then files
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    res.json({ path: resolved, entries })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Read a file and return parsed content
app.get('/read', requireAuth, (req, res) => {
  const config = loadConfig()
  const targetPath = req.query.path
  const maxRows = parseInt(req.query.max_rows || '1000')

  if (!targetPath) {
    return res.status(400).json({ error: 'path parameter required' })
  }

  if (!isPathAllowed(targetPath, config)) {
    return res.status(403).json({ error: 'Path not in allowed directories' })
  }

  try {
    const resolved = path.resolve(targetPath)
    const stat = fs.statSync(resolved)

    if (!stat.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' })
    }

    if (stat.size > 50 * 1024 * 1024) { // 50MB limit
      return res.status(413).json({ error: 'File too large (50MB max)' })
    }

    const result = parseFile(resolved, maxRows)
    res.json({
      path: resolved,
      name: path.basename(resolved),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      ...result,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update config (allowed paths)
app.post('/config', requireAuth, (req, res) => {
  const { allowed_paths } = req.body
  if (!Array.isArray(allowed_paths)) {
    return res.status(400).json({ error: 'allowed_paths must be an array' })
  }
  const config = loadConfig()
  config.allowed_paths = allowed_paths.map(p => path.resolve(p))
  saveConfig(config)
  res.json({ ok: true, allowed_paths: config.allowed_paths })
})

// ── Helpers ───────────────────────────────────────────────────────
const READABLE_EXTENSIONS = new Set([
  '.csv', '.tsv', '.txt', '.log', '.json', '.xml',
  '.xlsx', '.xls', '.md', '.html', '.yaml', '.yml',
])

function isReadableFile(filename) {
  return READABLE_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

// ── Start ─────────────────────────────────────────────────────────
const config = loadConfig()
if (!config.token) {
  config.token = generateToken()
  saveConfig(config)
}

app.listen(PORT, '127.0.0.1', () => {
  const connectUrl = `${ONOPS_URL}/dashboard/data-bridge?token=${config.token}&autoconnect=1`

  console.log(`\nonOPS Bridge v1.0.0 is running.`)
  console.log(`Opening onOPS in your browser...\n`)

  // Auto-open browser to onOPS with token pre-filled
  try {
    const platform = os.platform()
    if (platform === 'darwin') execSync(`open "${connectUrl}"`)
    else if (platform === 'win32') execSync(`start "" "${connectUrl}"`)
    else execSync(`xdg-open "${connectUrl}"`)
  } catch {
    console.log(`Open this URL in your browser:\n${connectUrl}\n`)
  }

  console.log(`Keep this window open while using onOPS.`)
  console.log(`Close this window to disconnect.\n`)
})
