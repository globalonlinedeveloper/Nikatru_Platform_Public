/* ============================================================================
   channel-lib.mjs — start a Chromium-family browser WITH the extension loaded,
   on whichever channel the run asks for (EXB-12, 2026-09-29). A library, not
   a suite: the e2e-suite step classifies any .mjs another file imports as one.

   WHY IT EXISTS. Every e2e suite in this directory launched Playwright's
   BUNDLED Chromium with `--load-extension`, on ubuntu-24.04, and nothing else.
   Edge and branded Chrome had never run the extension at all; that Edge gets
   "the same zip" was a declaration with no check behind it. The branded leg in
   .github/workflows/extensions.yml (`e2e-branded`) runs run.mjs (one capture)
   and real-copy.mjs through THIS function with FS_E2E_CHANNEL=msedge|chrome.

   HOW A BRANDED BUILD LOADS AN UNPACKED EXTENSION — MEASURED, NOT ASSUMED.
   Branded Chrome removed the `--load-extension` switch in 137 and Playwright's
   own documentation says Chrome and Edge both did; passed anyway, it is
   ignored in silence and the run waits 20 s for a service worker that never
   comes. What replaced it is the CDP method `Extensions.loadUnpacked`, which a
   browser serves only to a client on `--remote-debugging-pipe` (Playwright's
   transport) with `--enable-unsafe-extension-debugging` set, and only when
   Playwright's default `--disable-extensions` is dropped. MEASURED 2026-09-29,
   Linux, run.mjs with FS_E2E_ONLY=appshell, each browser both ways:
     Google Chrome 154.0.8037.57   flag -> exit 2, no service worker in 20 s
                                   cdp  -> exit 0, the capture graded green
     Microsoft Edge 154.0.4258.37  flag -> exit 0 (Edge still honours it)
                                   cdp  -> exit 0
     Chromium 141.0.7390.37        flag -> exit 0 · cdp -> exit 0
   Edge accepting the flag today is not a promise that it will tomorrow, and
   one load path for every branded build is one less thing to diverge, so:
     · channel `chromium` (the default)  -> `flag`, byte-for-byte what every
       suite here did before this file existed;
     · any branded channel               -> `cdp`.
   FS_E2E_LOAD=flag|cdp overrides the choice, which is how the cdp path is
   exercised on the bundled Chromium where no branded build is installed.

   THE LEG MUST PROVE WHICH BROWSER IT RAN. A channel that silently fell back
   to something else would print green over a browser nobody asked about, so
   the identity is READ (browser version, user agent, UA-CH brands), printed on
   a BROWSER line, and a branded channel whose identity does not carry its own
   brand is COVERAGE LOST (exit 2 via the caller's handler), never a pass.

   Env: FS_E2E_CHANNEL  chromium (default) | chrome | msedge | <-beta/-dev/-canary>
        FS_E2E_CHROMIUM a local binary to use instead of a channel (chromium only)
        FS_E2E_LOAD     flag | cdp (default: by channel, above)
   ========================================================================== */
import { chromium } from 'playwright';

export const CHANNEL = String(process.env.FS_E2E_CHANNEL || 'chromium').trim();

/* The brand a channel has to show, read from the user agent or the UA-CH
   brand list. `chromium` shows none on purpose: the bundled build is the one
   whose identity nobody is claiming anything about. */
const BRANDS = [
  { re: /^msedge(-beta|-dev|-canary)?$/, brand: 'Microsoft Edge', ua: /\bEdg\// },
  { re: /^chrome(-beta|-dev|-canary)?$/, brand: 'Google Chrome', ua: null }
];
const brandOf = ch => BRANDS.find(b => b.re.test(ch)) || null;

export const LOAD = String(process.env.FS_E2E_LOAD || (brandOf(CHANNEL) ? 'cdp' : 'flag')).trim();

function launchTarget() {
  if (process.env.FS_E2E_CHROMIUM) {
    if (CHANNEL !== 'chromium') {
      throw new Error('FS_E2E_CHROMIUM and FS_E2E_CHANNEL=' + CHANNEL + ' are both set; a local binary ' +
        'and a branded channel cannot both be the browser under test.');
    }
    return { executablePath: process.env.FS_E2E_CHROMIUM };
  }
  return { channel: CHANNEL };
}

/**
 * Launch a persistent context with `extDir` loaded as an unpacked extension.
 * Resolves { ctx, sw, identity }; `sw` is that extension's service worker.
 * Throws with a named reason when the extension did not load, or when a
 * branded channel's browser does not carry its brand — callers report either
 * as COVERAGE LOST, because nothing about the product has been measured yet.
 */
export async function launchWithExtension(extDir, { userDataDir, headless, viewport, args = [] }) {
  if (LOAD !== 'flag' && LOAD !== 'cdp') throw new Error('FS_E2E_LOAD=' + LOAD + ' is neither flag nor cdp');
  const base = { ...launchTarget(), headless, viewport };
  let ctx, extensionId = null;
  if (LOAD === 'flag') {
    ctx = await chromium.launchPersistentContext(userDataDir, {
      ...base,
      args: ['--disable-extensions-except=' + extDir, '--load-extension=' + extDir, ...args]
    });
  } else {
    ctx = await chromium.launchPersistentContext(userDataDir, {
      ...base,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', ...args]
    });
    const browser = ctx.browser();
    if (!browser) { await ctx.close(); throw new Error('the persistent context exposes no Browser, so there is no pipe to send Extensions.loadUnpacked on'); }
    const s = await browser.newBrowserCDPSession();
    try {
      ({ id: extensionId } = await s.send('Extensions.loadUnpacked', { path: extDir }));
    } catch (e) {
      await ctx.close();
      throw new Error('Extensions.loadUnpacked refused ' + extDir + ': ' + (e && e.message || e));
    } finally {
      await s.detach().catch(() => {});
    }
  }

  const ours = w => /^chrome-extension:\/\//.test(w.url()) && (!extensionId || w.url().includes('://' + extensionId + '/'));
  let sw = ctx.serviceWorkers().find(ours);
  if (!sw) {
    sw = await ctx.waitForEvent('serviceworker', { predicate: ours, timeout: 20000 }).catch(() => null);
  }
  if (!sw) {
    await ctx.close();
    throw new Error('no extension service worker within 20 s (channel=' + CHANNEL + ', load=' + LOAD + '). ' +
      (LOAD === 'flag' && brandOf(CHANNEL) ? 'A branded build ignores --load-extension; use FS_E2E_LOAD=cdp.' : ''));
  }

  const seen = await sw.evaluate(() => ({
    ua: navigator.userAgent,
    brands: (navigator.userAgentData && navigator.userAgentData.brands || []).map(b => b.brand + ' ' + b.version)
  }));
  const browser = ctx.browser();
  const identity = {
    channel: CHANNEL, load: LOAD, extensionId: extensionId || new URL(sw.url()).host,
    version: browser ? browser.version() : '?', ua: seen.ua, brands: seen.brands
  };
  console.log('BROWSER  channel=' + identity.channel + '  load=' + identity.load + '  version=' + identity.version +
    '  brands=[' + identity.brands.join(', ') + ']  ua=' + identity.ua);

  const want = brandOf(CHANNEL);
  if (want) {
    const shows = identity.brands.some(b => b.startsWith(want.brand + ' ')) || (want.ua ? want.ua.test(identity.ua) : false);
    if (!shows) {
      await ctx.close();
      throw new Error('channel ' + CHANNEL + ' was asked for and the browser that answered does not carry the ' +
        want.brand + ' brand (brands=[' + identity.brands.join(', ') + '], ua=' + identity.ua + '). ' +
        'A leg that cannot say which browser it measured has measured nothing.');
    }
  }
  return { ctx, sw, identity };
}
