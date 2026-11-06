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

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = makeClient()
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
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

export async function deleteAllVersions(key: string): Promise<void> {
  const client = makeClient()
  const bucket = env.S3_BUCKET

  const list = await client.send(
    new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }),
  )

  const toDelete = [
    ...(list.Versions ?? []),
    ...(list.DeleteMarkers ?? []),
  ]
    .filter(v => v.Key === key)
    .map(v => ({ Key: v.Key!, VersionId: v.VersionId }))

  if (toDelete.length === 0) return

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: toDelete as { Key: string; VersionId?: string }[] },
    }),
  )
}
