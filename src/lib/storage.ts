import 'server-only'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '@/env'

function makeClient(): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // MinIO requires path-style addressing
  })
}

type StorageMutationOptions = { signal?: AbortSignal }

async function withMutationClient<T>(
  options: StorageMutationOptions | undefined,
  operation: (client: S3Client, signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const signal = options?.signal
  if (signal?.aborted) throw downloadAborted()
  const client = makeClient()
  const onAbort = () => client.destroy?.()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal?.aborted) throw downloadAborted()
    const result = await operation(client, signal)
    if (signal?.aborted) throw downloadAborted()
    return result
  } catch (error) {
    if (signal?.aborted) throw downloadAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    client.destroy?.()
  }
}

export async function putObject(key: string, body: Buffer, contentType: string, options?: StorageMutationOptions): Promise<void> {
  await withMutationClient(options, async (client, signal) => {
    const command = new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType })
    if (signal) await client.send(command, { abortSignal: signal })
    else await client.send(command)
  })
}

// RFC 5987 §3.2: encode non-attr-char characters
function encodeRfc5987(str: string): string {
  return (
    "UTF-8''" +
    encodeURIComponent(str).replace(
      /[!'()]/g,
      c => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    )
  )
}

export const SIGNED_URL_EXPIRES_SECONDS = 300

export async function getSignedDownloadUrl(key: string, fileName: string): Promise<string> {
  const client = makeClient()
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename*=${encodeRfc5987(fileName)}`,
  })
  return awsGetSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRES_SECONDS })
}

export async function getSignedDisplayUrl(key: string): Promise<string> {
  const client = makeClient()
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  })
  return awsGetSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRES_SECONDS })
}

type DownloadBody = {
  transformToByteArray(): Promise<Uint8Array>
  destroy?: () => unknown
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>
}

function downloadAborted(): Error {
  return Object.assign(new Error('Object download aborted'), { name: 'AbortError' })
}

export async function getObjectBytes(
  key: string,
  opts?: { maxBytes?: number; signal?: AbortSignal },
): Promise<Buffer> {
  const signal = opts?.signal
  if (signal?.aborted) throw downloadAborted()
  const client = makeClient()
  const command = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key })
  let body: DownloadBody | undefined
  const onAbort = () => {
    body?.destroy?.()
    client.destroy?.()
  }
  const checkSize = (size: number) => {
    if (opts?.maxBytes !== undefined && size > opts.maxBytes) {
      throw Object.assign(new Error('S3 object exceeds maxBytes'), { code: 'FILE_TOO_LARGE' })
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal?.aborted) throw downloadAborted()
    const response = signal
      ? await client.send(command, { abortSignal: signal })
      : await client.send(command)
    if (!response.Body) throw new Error('Empty S3 response body')
    body = response.Body as DownloadBody
    if (signal?.aborted) throw downloadAborted()
    if (response.ContentLength !== undefined) checkSize(response.ContentLength)

    // The Node SDK returns a Readable. Bound actual bytes as well as ContentLength,
    // and await its completion/close so cancellation cannot leave a reader running.
    if (body[Symbol.asyncIterator]) {
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        if (signal?.aborted) throw downloadAborted()
        total += chunk.byteLength
        checkSize(total)
        chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      }
      if (signal?.aborted) throw downloadAborted()
      return Buffer.concat(chunks, total)
    }

    const bytes = await body.transformToByteArray()
    if (signal?.aborted) throw downloadAborted()
    checkSize(bytes.byteLength)
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  } catch (error) {
    body?.destroy?.()
    if (signal?.aborted) throw downloadAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    client.destroy?.()
  }
}

export async function deleteAllVersions(key: string, options?: StorageMutationOptions): Promise<void> {
  await withMutationClient(options, async (client, signal) => {
    const bucket = env.S3_BUCKET
    const listCommand = new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key })
    const list = signal ? await client.send(listCommand, { abortSignal: signal }) : await client.send(listCommand)
    if (signal?.aborted) throw downloadAborted()
    const toDelete = [...(list.Versions ?? []), ...(list.DeleteMarkers ?? [])]
      .filter(v => v.Key === key)
      .map(v => ({ Key: v.Key!, VersionId: v.VersionId }))
    if (toDelete.length === 0) return
    const command = new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: toDelete } })
    const result = signal ? await client.send(command, { abortSignal: signal }) : await client.send(command)
    if (result.Errors?.length) throw new Error('Object deletion failed')
  })
}
