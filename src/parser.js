const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

function parseFile(filePath, maxRows = 1000) {
  const ext = path.extname(filePath).toLowerCase()

  switch (ext) {
    case '.csv':
    case '.tsv':
      return parseDelimited(filePath, ext === '.tsv' ? '\t' : ',', maxRows)

    case '.xlsx':
    case '.xls':
      return parseExcel(filePath, maxRows)

    case '.json':
      return parseJson(filePath, maxRows)

    case '.txt':
    case '.log':
    case '.md':
    case '.html':
    case '.xml':
    case '.yaml':
    case '.yml':
      return parseText(filePath, maxRows)

    default:
      return parseText(filePath, maxRows)
  }
}

function parseDelimited(filePath, delimiter, maxRows) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/).filter(l => l.trim())

  if (lines.length === 0) return { type: 'table', columns: [], rows: [], total_rows: 0 }

  const headers = splitLine(lines[0], delimiter)
  const rows = lines
    .slice(1, maxRows + 1)
    .map(line => {
      const values = splitLine(line, delimiter)
      const row = {}
      headers.forEach((h, i) => {
        row[h] = coerce(values[i] ?? '')
      })
      return row
    })

  return {
    type: 'table',
    columns: headers,
    rows,
    total_rows: lines.length - 1,
    truncated: lines.length - 1 > maxRows,
  }
}

function splitLine(line, delimiter) {
  // Handle quoted fields
  if (!line.includes('"')) return line.split(delimiter)
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delimiter && !inQuotes) {
      result.push(current); current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function parseExcel(filePath, maxRows) {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  if (raw.length === 0) return { type: 'table', columns: [], rows: [], total_rows: 0, sheets: workbook.SheetNames }

  const headers = raw[0].map(String)
  const dataRows = raw.slice(1, maxRows + 1).map(row => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = coerce(row[i] ?? '') })
    return obj
  })

  return {
    type: 'table',
    columns: headers,
    rows: dataRows,
    total_rows: raw.length - 1,
    truncated: raw.length - 1 > maxRows,
    sheets: workbook.SheetNames,
    active_sheet: sheetName,
  }
}

function parseJson(filePath, maxRows) {
  const content = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(content)

  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
    const columns = [...new Set(parsed.flatMap(Object.keys))]
    const rows = parsed.slice(0, maxRows)
    return {
      type: 'table',
      columns,
      rows,
      total_rows: parsed.length,
      truncated: parsed.length > maxRows,
    }
  }

  return {
    type: 'json',
    content: parsed,
  }
}

function parseText(filePath, maxRows) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  const truncated = lines.length > maxRows
  return {
    type: 'text',
    content: truncated ? lines.slice(0, maxRows).join('\n') : content,
    total_lines: lines.length,
    truncated,
  }
}

function coerce(val) {
  if (val === '' || val === null || val === undefined) return val
  const str = String(val).trim()
  const num = Number(str)
  if (!isNaN(num) && str !== '') return num
  if (str.toLowerCase() === 'true') return true
  if (str.toLowerCase() === 'false') return false
  return str
}

module.exports = { parseFile }
