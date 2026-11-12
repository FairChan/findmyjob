import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-8 text-headline text-balance">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-4 mt-12 text-title">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-8 text-body font-semibold">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-4 text-body text-foreground/80">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 ml-6 list-outside list-disc space-y-1 text-body text-foreground/80">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 ml-6 list-outside list-decimal space-y-1 text-body text-foreground/80">
      {children}
    </ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-6 rounded-card bg-warning-muted px-5 py-4 text-warning [&_p]:mb-0 [&_p]:text-sm [&_p]:text-warning">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-border" />,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted text-foreground">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border">{children}</tbody>
  ),
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-medium text-xs uppercase tracking-wide border border-border">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-muted-foreground border border-border align-top">
      {children}
    </td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-brand underline underline-offset-4 hover:text-brand/80"
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  ),
}

interface LegalProseProps {
  content: string
}

export default function LegalProse({ content }: LegalProseProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
