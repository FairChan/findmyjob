import type { Page } from '@playwright/test'

// Cloudflare 公开的测试 token：服务端用测试 secret 去 siteverify 时必定 success（带 result_with_testing_key）
export const DUMMY_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

/**
 * 把 Cloudflare 的 api.js 换成一个可控替身：render 之后过 delayMs 毫秒，用测试 token 调 callback。
 * 真实脚本在几个页面并行加载时，token 什么时候到、隐藏输入框是否生成都不确定，E2E 会随机失败。
 * 服务端校验不受影响：仍然用测试 secret 调 siteverify。
 */
export async function stubTurnstile(page: Page, { delayMs = 200 }: { delayMs?: number } = {}) {
  const script = `(function () {
    var n = 0;
    window.turnstile = {
      render: function (el, opts) {
        var id = 'stub-' + (++n);
        setTimeout(function () { if (opts && opts.callback) opts.callback(${JSON.stringify(DUMMY_TURNSTILE_TOKEN)}); }, ${delayMs});
        return id;
      },
      reset: function () {},
      remove: function () {},
      getResponse: function () { return ${JSON.stringify(DUMMY_TURNSTILE_TOKEN)}; }
    };
    var src = (document.currentScript && document.currentScript.src) || '';
    var m = src.match(/[?&]onload=([^&]+)/);
    if (m && typeof window[m[1]] === 'function') setTimeout(window[m[1]], 0);
  })();`
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: script }),
  )
}
