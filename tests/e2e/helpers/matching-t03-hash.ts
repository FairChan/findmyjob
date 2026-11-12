// Invoked only in a short child with the repository's installed tsx + react-server condition.
// Uses real canonical projection; no DB, env loader, worker, provider or duplicated hash implementation.
import { buildJobMatchingText, buildStudentMatchingText, type JobMatchingInput, type StudentMatchingInput } from '../../../src/server/lib/matching-text'
async function main() {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 65_536) throw new Error('Synthetic projection input too large')
    chunks.push(chunk)
  }
  const { kind, input } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { kind: string; input: JobMatchingInput | StudentMatchingInput }
  const result = kind === 'JOB' ? buildJobMatchingText(input as JobMatchingInput) : kind === 'STUDENT' ? buildStudentMatchingText(input as StudentMatchingInput) : null
  if (!result || !/^[a-f0-9]{64}$/.test(result.sourceHash)) throw new Error('Synthetic source hash unavailable')
  process.stdout.write(result.sourceHash)
}
main().catch(() => { process.stderr.write('Synthetic projection failed\n'); process.exitCode = 1 })
