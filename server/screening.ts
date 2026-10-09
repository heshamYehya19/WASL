import { inflateRawSync } from "node:zlib"
import type { ChallengeFileKind, ScreeningFinding, ScreeningKind } from "../src/types.ts"

// WASL's automatic privacy screening. A company's brief is scanned for personal data before it is stored (contact details,
// IDs and card numbers stop the brief; names and addresses are only warned about — see parseBrief in
// services/challenges.ts), and a candidate's CV is validated and read here too.

// ------------------------------------------------------------------- uploads

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_DATASET_FILES = 3

/**
 * What a file is for: a challenge's description or datasets, or one kind of student evidence —
 * a document or report, a notebook, a presentation, or a screenshot.
 */
export type UploadKind = ChallengeFileKind | "evidence" | "notebook" | "presentation" | "image"

interface FileFormat {
  mime: string
  /** First bytes the file must start with, so a renamed file can't slip through. */
  magic?: number[]
  tabular?: boolean
}

const FORMATS: Record<UploadKind, Record<string, FileFormat>> = {
  description: {
    ".pdf": { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
    ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [0x50, 0x4b] },
    ".doc": { mime: "application/msword", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  },
  evidence: {
    ".pdf": { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
    ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [0x50, 0x4b] },
    ".doc": { mime: "application/msword", magic: [0xd0, 0xcf, 0x11, 0xe0] },
    ".txt": { mime: "text/plain" },
    ".md": { mime: "text/markdown" },
  },
  notebook: {
    ".ipynb": { mime: "application/x-ipynb+json" },
  },
  presentation: {
    ".pdf": { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
    ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", magic: [0x50, 0x4b] },
  },
  image: {
    ".png": { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
    ".jpg": { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
    ".jpeg": { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
    ".webp": { mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46] },
  },
  dataset: {
    ".csv": { mime: "text/csv", tabular: true },
    ".tsv": { mime: "text/tab-separated-values", tabular: true },
    ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: [0x50, 0x4b], tabular: true },
    ".json": { mime: "application/json" },
    ".txt": { mime: "text/plain" },
  },
}

export const ACCEPTED_EXTENSIONS: Record<UploadKind, string[]> = {
  description: Object.keys(FORMATS.description),
  dataset: Object.keys(FORMATS.dataset),
  evidence: Object.keys(FORMATS.evidence),
  notebook: Object.keys(FORMATS.notebook),
  presentation: Object.keys(FORMATS.presentation),
  image: Object.keys(FORMATS.image),
}

export interface PreparedFile {
  kind: UploadKind
  name: string
  mime: string
  data: Buffer
  /** Extracted text ("" if none could be read). Description files feed the AI relevance check. */
  text: string
  /** Set when WASL couldn't (fully) read the file, so it can't vouch for what's inside. */
  unreadable: string | null
  table: string[][] | null
}

export class UploadError extends Error {}

/** Validates an uploaded file and extracts its text. Throws UploadError on anything malformed. */
export async function prepareFile(kind: UploadKind, rawName: string, data: Buffer): Promise<PreparedFile> {
  // oxlint-disable-next-line no-control-regex -- stripping control characters from file names is the point
  const name = rawName.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200)
  if (!name) throw new UploadError("Every file needs a name.")
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase()
  const format = FORMATS[kind][ext]
  if (!format) {
    const what =
      kind === "description" ? "Challenge description" : kind === "evidence" ? "Documents" : kind === "notebook" ? "Notebooks" : kind === "presentation" ? "Presentations" : kind === "image" ? "Screenshots" : "Dataset"
    throw new UploadError(`${what} files must be ${ACCEPTED_EXTENSIONS[kind].join(", ")} — “${name}” isn't.`)
  }
  if (data.length === 0) throw new UploadError(`“${name}” is empty.`)
  if (data.length > MAX_FILE_BYTES) throw new UploadError(`“${name}” is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
  if (format.magic && !format.magic.every((b, i) => data[i] === b)) {
    throw new UploadError(`“${name}” isn't a valid ${ext.slice(1).toUpperCase()} file.`)
  }

  let text = ""
  let table: string[][] | null = null
  let unreadable: string | null = null
  try {
    switch (ext) {
      case ".pdf":
        text = await pdfText(data)
        break
      case ".docx":
        text = docxText(data)
        break
      case ".pptx":
        text = pptxText(data)
        break
      case ".ipynb":
        text = notebookText(data)
        break
      case ".png":
      case ".jpg":
      case ".jpeg":
      case ".webp":
        break // an image has no text to read — it is kept for the reviewer to look at
      case ".doc":
        text = legacyDocText(data)
        if (text) unreadable = "WASL could only partly read this older Word format — save it as .docx or .pdf for a full check."
        break
      case ".xlsx":
        table = xlsxTable(data)
        break
      case ".csv":
      case ".tsv":
        table = parseDelimited(decodeText(data), ext === ".tsv" ? "\t" : undefined)
        break
      default:
        text = decodeText(data)
    }
  } catch {
    unreadable = "WASL couldn't open this file to check it — it may be damaged or password-protected."
  }
  if (table) text = table.map((r) => r.join("\t")).join("\n")
  if (!unreadable && kind !== "image" && text.replace(/\s/g, "").length < 20) {
    unreadable = "WASL couldn't find readable text in this file (it may be a scanned image), so it couldn't check it for personal data."
  }
  return { kind, name, mime: format.mime, data, text, unreadable, table }
}

// ---------------------------------------------------------- text extraction

function decodeText(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString("utf16le")
  return data.toString("utf8").replace(/^﻿/, "")
}

async function pdfText(data: Buffer): Promise<string> {
  // Loaded lazily — it's only needed when someone actually uploads a PDF.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const doc = await getDocument({ data: new Uint8Array(data), verbosity: 0, useSystemFonts: false }).promise
  const pages: string[] = []
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      pages.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "")).join(""))
    }
  } finally {
    await doc.destroy()
  }
  return pages.join("\n")
}

/** Reads the named entries of a zip archive (docx/xlsx are zips) using only node:zlib. */
function unzip(data: Buffer, wanted: (name: string) => boolean): Map<string, string> {
  let eocd = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("not a zip archive")
  const entries = data.readUInt16LE(eocd + 10)
  let ptr = data.readUInt32LE(eocd + 16)
  const out = new Map<string, string>()
  let budget = 64 * 1024 * 1024 // guards against zip bombs
  for (let n = 0; n < entries; n++) {
    if (data.readUInt32LE(ptr) !== 0x02014b50) throw new Error("corrupt zip directory")
    const method = data.readUInt16LE(ptr + 10)
    const compressedSize = data.readUInt32LE(ptr + 20)
    const nameLen = data.readUInt16LE(ptr + 28)
    const extraLen = data.readUInt16LE(ptr + 30)
    const commentLen = data.readUInt16LE(ptr + 32)
    const localOffset = data.readUInt32LE(ptr + 42)
    const name = data.toString("utf8", ptr + 46, ptr + 46 + nameLen)
    ptr += 46 + nameLen + extraLen + commentLen
    if (!wanted(name)) continue
    const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28)
    const raw = data.subarray(start, start + compressedSize)
    const bytes = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: budget }) : null
    if (!bytes) throw new Error("unsupported zip compression")
    budget -= bytes.length
    out.set(name, bytes.toString("utf8"))
  }
  return out
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")

function docxText(data: Buffer): string {
  const parts = unzip(data, (n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n))
  if (!parts.has("word/document.xml")) throw new Error("not a Word document")
  return [...parts.values()]
    .map((xml) =>
      decodeXml(
        xml
          .replace(/<w:tab\/>/g, "\t")
          .replace(/<w:br\/>|<\/w:p>/g, "\n")
          .replace(/<[^>]+>/g, ""),
      ),
    )
    .join("\n")
}

/** The text on a PowerPoint's slides, in slide order. */
function pptxText(data: Buffer): string {
  const slides = unzip(data, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  if (slides.size === 0) throw new Error("not a PowerPoint file")
  const number = (name: string) => Number(/slide(\d+)\.xml$/.exec(name)![1])
  return [...slides.entries()]
    .sort((a, b) => number(a[0]) - number(b[0]))
    .map(([, xml]) => decodeXml([...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join(" ")))
    .join("\n")
}

/** A Jupyter notebook's code and markdown cells, as plain text. */
function notebookText(data: Buffer): string {
  const nb = JSON.parse(decodeText(data)) as { cells?: { cell_type?: string; source?: string | string[] }[] }
  if (!Array.isArray(nb.cells)) throw new Error("not a notebook")
  return nb.cells
    .map((c) => {
      const src = Array.isArray(c.source) ? c.source.join("") : String(c.source ?? "")
      return c.cell_type === "markdown" ? src.split("\n").map((l) => `# ${l}`).join("\n") : src
    })
    .filter((s) => s.trim())
    .join("\n\n")
}

/** Old binary .doc: no parser, so pull out runs of readable UTF-16 / ASCII text. */
function legacyDocText(data: Buffer): string {
  const utf16 = data.toString("utf16le").match(/[\p{L}\p{N}\p{P}\p{Zs}]{4,}/gu) ?? []
  const ascii = data.toString("latin1").match(/[\x20-\x7e]{6,}/g) ?? []
  return [...utf16, ...ascii].join("\n")
}

function xlsxTable(data: Buffer): string[][] {
  const parts = unzip(data, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const shared = [...(parts.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  )
  const rows: string[][] = []
  for (const [name, xml] of parts) {
    if (!name.startsWith("xl/worksheets/")) continue
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1]
        const col = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]
        const idx = col ? [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length
        const inner = cell[2] ?? ""
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        const type = /t="(\w+)"/.exec(attrs)?.[1]
        cells[idx] =
          type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? decodeXml(inner.replace(/<[^>]+>/g, "")) : decodeXml(v ?? "")
      }
      rows.push(Array.from(cells, (c) => c ?? ""))
    }
  }
  return rows
}

function parseDelimited(text: string, delimiter?: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") >>> 0)
  const delim = delimiter ?? [",", ";", "\t"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",")
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') field += text[++i]
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === "") quoted = true
    else if (ch === delim) {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += ch
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}

// ------------------------------------------------------------------- scanning

const LABELS: Record<ScreeningKind, string> = {
  phone: "Phone numbers",
  email: "Email addresses",
  nationalId: "National ID / passport numbers",
  address: "Home or street addresses",
  birthDate: "Dates of birth",
  card: "Payment card numbers",
  iban: "Bank account numbers (IBAN)",
  personName: "Personal names",
  unreadable: "Files WASL couldn't fully check",
}

interface Detector {
  kind: ScreeningKind
  pattern: RegExp
  /** Extra validation for patterns that would otherwise match ordinary numbers. */
  valid?: (match: RegExpExecArray) => boolean
  /** Which capture group holds the sensitive value (defaults to the whole match). */
  group?: number
}

const ID_CONTEXT = String.raw`(?:national\s*(?:id|no\.?|number)|id\s*(?:number|no\.?|#)|identity\s*(?:card|number|no\.?)?|civil\s*id|passport(?:\s*(?:no\.?|number|#))?|ssn|social\s*security(?:\s*number)?|الرقم\s*الوطني|رقم\s*الهوية|جواز\s*السفر)`

// Test data shows up constantly in QA sheets and specs, and flagging it just teaches companies to ignore findings.
/** Published sandbox card numbers (Visa/Mastercard/Amex/Discover/JCB/Diners test cards) — never real accounts. */
const TEST_CARDS = new Set([
  "4111111111111111", "4242424242424242", "4012888888881881", "4000056655665556", "4222222222222",
  "5555555555554444", "5105105105105100", "5200828282828210", "2223003122003222",
  "378282246310005", "371449635398431", "378734493671000",
  "6011111111111117", "6011000990139424", "3530111333300000", "3566002020360505", "30569309025904", "38520000023237",
])
const PLACEHOLDER_WORD = /\b(test|testing|example|sample|fake|dummy|demo|placeholder)\b/i
/** An instruction verb right before the label ("enter date of birth …", "e.g. DOB …"). */
const TEST_STEP_BEFORE = /\b(enter|enters|entered|entering|type|typed|input|fill(?:\s+in)?|set|select|choose|use|e\.g\.?|example)\b[^.\n]{0,15}$/i

const DETECTORS: Detector[] = [
  { kind: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  // Jordanian mobiles (07X / +962 7X / 00962 7X) and landlines (06, 02, 03, 05).
  { kind: "phone", pattern: /(?<![\d+])(?:(?:\+|00)962[\s.-]?|0)7[\s.-]?[789](?:[\s.-]?\d){7}(?!\d)/g },
  { kind: "phone", pattern: /(?<![\d+.,])(?:(?:\+|00)962[\s.-]?|0)[2356][\s.-]?\d{3}[\s.-]?\d{4}(?!\d|[.,]\d)/g },
  // Any other international number written with a + prefix, and US-style (555) 123-4567.
  { kind: "phone", pattern: /(?<![\w+])\+(?!962)[1-9]\d{0,2}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d){6,10}(?!\d)/g },
  { kind: "phone", pattern: /\(\d{3}\)\s?\d{3}[\s.-]\d{4}(?!\d)/g },
  { kind: "nationalId", pattern: new RegExp(String.raw`${ID_CONTEXT}\s*[:#=-]?\s*([A-Z]{0,2}\d[\d -]{4,16}\d)`, "giu"), group: 1 },
  { kind: "nationalId", pattern: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g },
  {
    kind: "card",
    pattern: /(?<![\d.-])(?:\d[ -]?){12,18}\d(?!\d|\.\d)/g,
    valid: (m) => {
      const digits = m[0].replace(/\D/g, "")
      return luhn(digits) && !TEST_CARDS.has(digits)
    },
  },
  { kind: "iban", pattern: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, valid: (m) => ibanValid(m[0]) },
  {
    kind: "birthDate",
    pattern: /(?:date\s*of\s*birth|d\.?o\.?b\.?|birth\s*date|born\s*(?:on)?|تاريخ\s*الميلاد)\s*[:#-]?\s*(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4})/giu,
    group: 1,
    // "enter date of birth 9/13/2016" is a test step describing input, not someone's record.
    valid: (m) => !TEST_STEP_BEFORE.test(m.input.slice(Math.max(0, m.index - 40), m.index)),
  },
  { kind: "address", pattern: /\b(?:P\.?\s?O\.?\s?Box|POB)\s*\d+/gi },
  {
    kind: "address",
    pattern: /\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][\w'-]*\.?\s+){1,4}(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Circle)(?![\w])/g,
    valid: (m) => !PLACEHOLDER_WORD.test(m[0]),
  },
  { kind: "address", pattern: /\b(?:Building|Bldg\.?|Apartment|Apt\.?|Flat)\s*(?:No\.?|Number|#)?\s*\d+[A-Za-z]?/gi },
  // \b doesn't work on Arabic letters, so word edges are checked with \p{L}. "ص.ب" (P.O. Box) must be followed
  // by a number — otherwise it matches inside everyday words like الصباح ("morning"). Tabs are cell borders in sheets.
  { kind: "address", pattern: /(?<!\p{L})ص[ ]?\.?[ ]?ب\.?[ ]*:?[ ]*\d+/gu },
  {
    kind: "address",
    pattern: /(?<!\p{L})(?:شارع|عمارة[ ]+رقم|بناية[ ]+رقم|شقة[ ]+رقم)(?!\p{L})[ ]*[؀-ۿ\d][^\n\t,،.]{1,40}/gu,
    // Like the English pattern's house number: "شارع المطار مزدحم" names a public road, not where someone lives.
    valid: (m) => /\d/.test(m[0]),
  },
]

/** Column headers that mark a whole column as personal data, whatever its values look like. */
const HEADER_RULES: { kind: ScreeningKind; pattern: RegExp }[] = [
  { kind: "phone", pattern: /\b(phone|mobile|cell|tel|telephone|whatsapp|contact\s?(no|number))\b|هاتف|جوال|موبايل/u },
  { kind: "email", pattern: /\be\s?mail\b|بريد/u },
  { kind: "nationalId", pattern: /\b(national\s?(id|no|number)|nid|nin|id\s?(number|no)|ssn|passport|identity|civil\s?id)\b|الرقم\s?الوطني|هوية|جواز/u },
  { kind: "address", pattern: /\b(address|addr|street|home\s?location|postal\s?code|zip\s?code)\b|عنوان/u },
  { kind: "birthDate", pattern: /\b(dob|date\s?of\s?birth|birth\s?date|birthday)\b|تاريخ\s?الميلاد/u },
  { kind: "card", pattern: /\b(card\s?(number|no)|credit\s?card|cc\s?(number|no))\b/ },
  { kind: "iban", pattern: /\b(iban|account\s?(number|no)|bank\s?account)\b/ },
  { kind: "personName", pattern: /^(name|full\s?name|first\s?name|last\s?name|surname|family\s?name)$|\b(customer|client|patient|employee|student|person|contact|guardian)\s?name\b|^الاسم/u },
]

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2
    sum += d
  }
  return sum % 10 === 0
}

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s/g, "")
  if (iban.length < 15 || iban.length > 34) return false
  const rearranged = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rem = 0
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97
  return rem === 1
}

/** Arabic-Indic digits (٠١٢ / ۰۱۲) are scanned like Latin ones. */
const normalizeDigits = (s: string) =>
  s.replace(/[٠-٩۰-۹]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10))

/** Masks a value for display, keeping just enough to recognise it: "07••••••567", "s•••@g•••.com". */
function mask(kind: ScreeningKind, value: string): string {
  const v = value.trim().replace(/\s+/g, " ").slice(0, 48)
  if (kind === "email") {
    const [user, domain = ""] = v.split("@")
    const dot = domain.lastIndexOf(".")
    return `${user[0]}•••@${domain[0] ?? ""}•••${dot >= 0 ? domain.slice(dot) : ""}`
  }
  if (kind === "address" || kind === "personName") {
    return v
      .split(" ")
      .map((w) => (/^(street|st\.?|road|rd\.?|avenue|ave\.?|building|bldg\.?|apartment|apt\.?|flat|p\.?o\.?|box|no\.?)$/i.test(w) ? w : w[0] + "•".repeat(Math.min(w.length - 1, 4))))
      .join(" ")
  }
  const keep = 3
  let alnumSeen = 0
  const total = (v.match(/[\p{L}\p{N}]/gu) ?? []).length
  return [...v]
    .map((ch) => {
      if (!/[\p{L}\p{N}]/u.test(ch)) return ch
      alnumSeen++
      return alnumSeen <= 2 && total > 8 ? ch : alnumSeen > total - keep ? ch : "•"
    })
    .join("")
}

class FindingSet {
  private byKind = new Map<ScreeningKind, ScreeningFinding>()

  add(kind: ScreeningKind, source: string, example: string | null, count = 1) {
    let f = this.byKind.get(kind)
    if (!f) {
      f = { kind, label: LABELS[kind], count: 0, sources: [], examples: [] }
      this.byKind.set(kind, f)
    }
    f.count += count
    if (!f.sources.includes(source)) f.sources.push(source)
    if (example && f.examples.length < 3) {
      const masked = mask(kind, example)
      if (!f.examples.includes(masked)) f.examples.push(masked)
    }
  }

  list(): ScreeningFinding[] {
    return [...this.byKind.values()].sort((a, b) => (a.kind === "unreadable" ? 1 : b.kind === "unreadable" ? -1 : b.count - a.count))
  }
}

const MAX_SCAN_CHARS = 8 * 1024 * 1024

function scanText(raw: string, source: string, findings: FindingSet) {
  const text = normalizeDigits(raw.slice(0, MAX_SCAN_CHARS))
  // A span claimed by one detector (e.g. a card number) isn't re-reported by another (e.g. as a phone).
  const claimed: [number, number][] = []
  const overlaps = (s: number, e: number) => claimed.some(([a, b]) => s < b && e > a)
  for (const d of [...DETECTORS].sort((a, b) => order(a.kind) - order(b.kind))) {
    d.pattern.lastIndex = 0
    for (let m = d.pattern.exec(text); m; m = d.pattern.exec(text)) {
      const start = m.index
      const end = start + m[0].length
      if (overlaps(start, end) || (d.valid && !d.valid(m))) continue
      claimed.push([start, end])
      findings.add(d.kind, source, m[d.group ?? 0] ?? m[0])
    }
  }
}
// Most specific detectors first, so e.g. an IBAN isn't half-claimed as a phone number.
const order = (k: ScreeningKind) => ["email", "iban", "card", "nationalId", "birthDate", "phone", "address"].indexOf(k)

function scanTable(rows: string[][], source: string, findings: FindingSet) {
  const header = (rows[0] ?? []).map((h) =>
    normalizeDigits(h)
      .toLowerCase()
      .replace(/[_\-./]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
  const flagged = new Map<number, ScreeningKind>()
  header.forEach((h, i) => {
    const rule = HEADER_RULES.find((r) => r.pattern.test(h))
    if (rule) flagged.set(i, rule.kind)
  })
  const body = rows.slice(1)
  for (const [col, kind] of flagged) {
    const values = body.map((r) => (r[col] ?? "").trim()).filter(Boolean)
    if (values.length === 0) continue
    findings.add(kind, `${source} (column “${rows[0][col].trim()}”)`, null, values.length)
    for (const v of values.slice(0, 3)) findings.add(kind, `${source} (column “${rows[0][col].trim()}”)`, v, 0)
  }
  // Every other cell is still scanned for recognisable values (a phone number in a "notes" column, say).
  const rest = rows.map((r, i) => (i === 0 ? r : r.filter((_, c) => !flagged.has(c))).join("\t")).join("\n")
  scanText(rest, source, findings)
}

export interface ScreeningInput {
  fields: { label: string; text: string }[]
  files: PreparedFile[]
}

/** Scans every text field and attached file. An empty result means nothing personal was found. */
export function screenChallenge({ fields, files }: ScreeningInput): ScreeningFinding[] {
  const findings = new FindingSet()
  for (const f of fields) if (f.text.trim()) scanText(f.text, f.label, findings)
  for (const file of files) {
    if (file.table) scanTable(file.table, file.name, findings)
    else scanText(file.text, file.name, findings)
    if (file.unreadable) findings.add("unreadable", `${file.name} — ${file.unreadable}`, null)
  }
  return findings.list()
}

/** "3 phone numbers, 1 email address" — for history notes. */
export function summarizeFindings(findings: { kind: ScreeningKind; label: string; count: number }[]): string {
  return findings
    .map((f) => (f.kind === "unreadable" ? `${f.count} file${f.count === 1 ? "" : "s"} WASL couldn't fully check` : `${f.count} × ${f.label.toLowerCase()}`))
    .join(", ")
}
