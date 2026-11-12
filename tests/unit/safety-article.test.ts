// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SafetyArticleContent } from '@/components/safety/safety-article'

type ContentProps = Parameters<typeof SafetyArticleContent>[0]

function render(body: string, extra: Omit<ContentProps, 'body'> = {}) {
  const html = renderToStaticMarkup(createElement(SafetyArticleContent, { body, ...extra }))
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.replaceChildren(root)
  return root
}

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(globalThis, '__m6RendererUnsafe')
})

describe('SafetyArticleContent', () => {
  it('renders useful Markdown semantics while dropping raw HTML', () => {
    const root = render([
      '**Never pay for a job.**',
      '*Verify the employer.*',
      '- Check the company',
      '- Keep a record',
      '> Ask for a written offer.',
      '\u0060company.example.test\u0060',
      '<script>globalThis.__m6RendererUnsafe = true</script>',
      '<div data-injected="raw-html"><strong>Injected HTML</strong></div>',
      '<iframe src="https://example.test/embed"></iframe>',
      '<img src="https://example.test/tracker.png" onerror="globalThis.__m6RendererUnsafe = true">',
      '<style>body { display: none }</style>',
    ].join('\n\n'))

    expect(Array.from(root.querySelectorAll('strong'), (element) => element.textContent)).toEqual(['Never pay for a job.'])
    expect(root.querySelector('em')?.textContent).toBe('Verify the employer.')
    expect(root.querySelectorAll('li')).toHaveLength(2)
    expect(root.querySelector('blockquote')?.textContent).toContain('Ask for a written offer.')
    expect(root.querySelector('code')?.textContent).toBe('company.example.test')
    expect(root.querySelectorAll('script, iframe, img, style, [data-injected], [onerror]')).toHaveLength(0)
    expect('__m6RendererUnsafe' in globalThis).toBe(false)
  })

  it('emits no remote-image resource elements or preload hints', () => {
    const root = render([
      '![inline](https://example.test/inline-tracker.png)',
      '![reference][tracker]',
      '[tracker]: https://example.test/reference-tracker.png',
      '<picture><source srcset="https://example.test/source-tracker.png"><img src="https://example.test/raw-tracker.png"></picture>',
    ].join('\n\n'))

    // No emitted resource URL means a browser cannot start an image request.
    // The companion E2E additionally intercepts the actual preview network.
    expect(root.querySelectorAll('img, picture, source, iframe, link[rel="preload"], link[rel="prefetch"]')).toHaveLength(0)
    expect(root.querySelectorAll('[src], [srcset]')).toHaveLength(0)
    expect(root.querySelectorAll('a[href]')).toHaveLength(0)
  })

  it.each([
    ['javascript', 'javascript:alert%281%29'],
    ['mixed-case script', 'JaVaScRiPt:alert%281%29'],
    ['HTML data', 'data:text/html;base64,PHNjcmlwdD4='],
    ['VBScript', 'vbscript:msgbox%281%29'],
    ['file URL', 'file:///tmp/synthetic.txt'],
    ['mail URL', 'mailto:synthetic@example.test'],
    ['protocol relative', '//example.test/tracker'],
    ['backslash authority', '/\\example.test/tracker'],
    ['encoded backslash authority', '/%5Cexample.test/tracker'],
    ['backslash scheme separator', 'https:\\example.test/tracker'],
    ['credentials', 'https://synthetic:password@example.test/path'],
    ['username only', 'http://synthetic@example.test/path'],
  ])('renders %s links as non-clickable text', (_label, url) => {
    const root = render('[Blocked link](' + url + ')')
    expect(root.textContent).toContain('Blocked link')
    expect(root.querySelectorAll('a[href]')).toHaveLength(0)
  })

  it('rejects character-reference scheme obfuscation after Markdown decoding', () => {
    const root = render('[Obfuscated link](javascript&#58;alert%281%29)')
    expect(root.textContent).toContain('Obfuscated link')
    expect(root.querySelectorAll('a[href]')).toHaveLength(0)
  })

  it.each([
    'https://example.test/safety?source=guide#checks',
    'http://example.test/safety',
  ])('allows external %s links with explicit new-tab protections', (url) => {
    const root = render('[Read the guide](' + url + ')')
    const link = root.querySelector('a')
    expect(link?.getAttribute('href')).toBe(url)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')?.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(link?.textContent).toBe('Read the guide')
  })

  it('keeps an explicit local path local without remote navigation or prefetch', () => {
    const root = render('[Local guide](/zh/safety?category=GUIDE#checks)')
    const link = root.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/zh/safety?category=GUIDE#checks')
    expect(link?.getAttribute('target')).not.toBe('_blank')
    expect(root.querySelectorAll('link[rel="prefetch"], link[rel="preload"]')).toHaveLength(0)
  })

  it('renders a valid video as a protected external link with the supplied label', () => {
    const root = render('**Watch after reading.**', {
      videoUrl: 'https://example.test/synthetic-video',
      videoLinkLabel: '在新标签页观看视频',
    })
    const link = root.querySelector('a')
    expect(link?.textContent).toBe('在新标签页观看视频')
    expect(link?.getAttribute('href')).toBe('https://example.test/synthetic-video')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')?.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(root.querySelectorAll('iframe, video, audio, embed, object')).toHaveLength(0)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>unsafe</h1>',
    '//example.test/video',
    '/\\example.test/video',
    'https:\\example.test/video',
    'https://synthetic:password@example.test/video',
    '/zh/safety',
    '',
    null,
  ])('omits an invalid or absent video link: %s', (videoUrl) => {
    const root = render('Safe body', { videoUrl, videoLinkLabel: 'Watch video' })
    expect(root.textContent).toContain('Safe body')
    expect(root.querySelectorAll('a[href], iframe, video, audio, embed, object')).toHaveLength(0)
  })

  it('keeps authored headings below the page h1 and article h2', () => {
    const root = render('# First\n\n## Second\n\n### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth')
    const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    const levels = headings.map((heading) => Number(heading.tagName.slice(1)))
    expect(headings.map((heading) => heading.textContent)).toEqual(['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'])
    expect(root.querySelectorAll('h1, h2')).toHaveLength(0)
    expect(levels[0]).toBe(3)
    expect(levels.every((level, index) => level >= 3 && level <= 6 && (index === 0 || level <= levels[index - 1] + 1))).toBe(true)
  })
})

