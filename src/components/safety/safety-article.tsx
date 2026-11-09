import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  body: string
  videoUrl?: string | null
  videoLinkLabel?: string
}

function safeLink(raw: string, allowLocal: boolean): string | undefined {
  const value = raw.trim()
  // Browsers normalize backslashes and control characters before navigation.
  if (!value || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || value.includes('\\') || /%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(value)) return undefined
  if (allowLocal && value.startsWith('/') && !value.startsWith('//') && !/^\/%2f/i.test(value)) return value
  if (!/^https?:\/\//i.test(value)) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return value
  } catch {
    return undefined
  }
}

export function SafetyArticleContent({ body, videoUrl, videoLinkLabel }: Props) {
  const video = videoUrl ? safeLink(videoUrl, false) : undefined
  return (
    <div className="min-w-0 space-y-4 break-words text-sm leading-7 [overflow-wrap:anywhere]">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img', 'iframe', 'script', 'style', 'video', 'audio', 'source', 'picture', 'object', 'embed']}
        urlTransform={(url) => safeLink(url, true)}
        components={{
          h1: ({ children }) => <h3 className="mt-5 text-lg font-semibold">{children}</h3>,
          h2: ({ children }) => <h4 className="mt-4 text-base font-semibold">{children}</h4>,
          h3: ({ children }) => <h5 className="mt-4 text-base font-semibold">{children}</h5>,
          h4: ({ children }) => <h6 className="mt-3 font-semibold">{children}</h6>,
          h5: ({ children }) => <h6 className="mt-3 font-semibold">{children}</h6>,
          h6: ({ children }) => <h6 className="mt-3 font-semibold">{children}</h6>,
          p: ({ children }) => <p className="my-3">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="my-4 border-l-4 border-gray-300 pl-4 text-gray-700">{children}</blockquote>,
          pre: ({ children }) => <pre className="my-3 max-w-full overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs">{children}</pre>,
          code: ({ children }) => <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]">{children}</code>,
          table: ({ children }) => <div className="my-4 max-w-full overflow-x-auto"><table className="w-full border-collapse text-left">{children}</table></div>,
          th: ({ children }) => <th className="border border-gray-300 bg-gray-50 px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-gray-300 px-3 py-2">{children}</td>,
          a: ({ href, children }) => {
            const safe = href ? safeLink(href, true) : undefined
            if (!safe) return <span>{children}</span>
            const external = /^https?:\/\//i.test(safe)
            return <a href={safe} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">{children}</a>
          },
        }}
      >{body}</Markdown>
      {video && videoLinkLabel && (
        <a href={video} target="_blank" rel="noopener noreferrer" className="inline-block text-blue-700 underline underline-offset-2 hover:text-blue-900">
          {videoLinkLabel}
        </a>
      )}
    </div>
  )
}

