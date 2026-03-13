const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const CONFIG_DIR = path.join(os.homedir(), '.onops-bridge')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

const DEFAULT_CONFIG = {
  token: null,
  allowed_paths: [
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Downloads'),
  ],
  version: '1.0.0',
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    if (!fs.existsSync(CONFIG_PATH)) {
      saveConfig(DEFAULT_CONFIG)
      return { ...DEFAULT_CONFIG }
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to save config:', err.message)
  }
}

function generateToken() {
  return 'obr_' + crypto.randomBytes(24).toString('hex')
}

module.exports = { loadConfig, saveConfig, generateToken }
