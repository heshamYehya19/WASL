import { deflateRawSync } from "node:zlib"

// Small, real files for tests that upload documents — built with node:zlib only.

/** A zip archive holding the given text entries (what .docx and .pptx files are). */
export function zip(entries: { name: string; text: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, text } of entries) {
    const nameBytes = Buffer.from(name)
    const raw = Buffer.from(text)
    const body = deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    const localPart = Buffer.concat([local, nameBytes, body])
    locals.push(localPart)
    centrals.push(Buffer.concat([central, nameBytes]))
    offset += localPart.length
  }
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralPart, eocd])
}

export const docx = (paragraphs: string[]) =>
  zip([{ name: "word/document.xml", text: `<w:document><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>` }])

export const pptx = (slides: string[][]) =>
  zip(slides.map((lines, i) => ({ name: `ppt/slides/slide${i + 1}.xml`, text: `<p:sld>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("")}</p:sld>` })))

export const notebook = (cells: { type: "code" | "markdown"; source: string }[]) =>
  Buffer.from(JSON.stringify({ nbformat: 4, cells: cells.map((c) => ({ cell_type: c.type, source: c.source.split("\n").map((l, i, a) => (i < a.length - 1 ? `${l}\n` : l)) })) }))

/** A valid 1×1 PNG. */
export const png = () => Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")

export const upload = (name: string, data: Buffer) => ({ name, data: data.toString("base64") })
