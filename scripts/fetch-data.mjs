import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const registry = JSON.parse(await readFile(path.join(root, 'data/source-registry.json'), 'utf8'))
const rawDirectory = path.join(root, 'data/raw')
const includeLarge = process.argv.includes('--include-large')
const includeOptional = process.argv.includes('--include-optional')

await mkdir(rawDirectory, { recursive: true })

const selected = registry.sources.filter((source) =>
  (source.required || includeOptional) && (!source.large || includeLarge),
)

if (!includeLarge) {
  console.log('Skipping large sources. Add --include-large to fetch Bike Share 2024 (206 MB).')
}

const downloads = []

for (const source of selected) {
  const target = path.join(rawDirectory, source.output)
  const temporary = `${target}.part`
  console.log(`Fetching ${source.id}...`)
  const response = await fetch(source.download_url)
  if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`)
  if (!response.body) throw new Error(`${source.id}: empty response body`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
  await rename(temporary, target)
  const fileStat = await stat(target)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(target)) hash.update(chunk)
  downloads.push({
    id: source.id,
    file: source.output,
    bytes: fileStat.size,
    sha256: hash.digest('hex'),
    fetched_at: new Date().toISOString(),
  })
}

await writeFile(
  path.join(rawDirectory, 'download-report.json'),
  `${JSON.stringify({ schema_version: registry.schema_version, downloads }, null, 2)}\n`,
)
console.log(`Downloaded ${downloads.length} source(s) into data/raw/.`)
