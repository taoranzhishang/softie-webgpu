import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

// A real WebGPU browser test. There is deliberately no WebGL or software-GPU fallback.
const baseURL = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
const artifactDir = path.resolve('artifacts');
const report = { url: baseURL, browser: 'headless installed Chrome', startedAt: new Date().toISOString(), checks: [], screenshots: [], errors: [], warnings: [], requestsFailed: [], viewports: {} };
const url = new URL(baseURL);
url.searchParams.set('test', '1');
await mkdir(artifactDir, { recursive: true });
const check = (name, passed, evidence = null) => {
  report.checks.push({ name, passed: Boolean(passed), evidence });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
};
const diagnostics = page => page.evaluate(() => window.__SOFTIE__.getDiagnostics());
const screenshot = async (page, name, locator) => {
  const file = path.join(artifactDir, `test-${name}.png`);
  const buffer = await (locator ?? page).screenshot({ path: file, animations: 'disabled', ...(locator ? {} : { fullPage: true }) });
  report.screenshots.push(file);
  return buffer;
};
function recordErrors(page, label) {
  page.on('pageerror', error => report.errors.push({ label, type: 'page', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push({ label, type: 'console', message: message.text() });
    if (message.type() === 'warning') report.warnings.push({ label, message: message.text() });
  });
  page.on('requestfailed', request => report.requestsFailed.push({ label, url: request.url(), error: request.failure()?.errorText }));
}
async function instrument(context) {
  await context.addInitScript(() => {
    window.__contextCalls = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      window.__contextCalls.push(kind);
      return getContext.call(this, kind, ...rest);
    };
  });
}
async function ready(page) {
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__SOFTIE__?.getDiagnostics?.().frames > 10, null, { timeout: 45000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800);
}
async function pixelMetrics(page, png) {
  // Inspect a screenshot, not a second rendering path. This offscreen 2D canvas only decodes PNG pixels.
  return page.evaluate(async data => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = 192;
    sample.height = Math.max(1, Math.round(192 * image.height / image.width));
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, sample.width, sample.height);
    const rgba = ctx.getImageData(0, 0, sample.width, sample.height).data;
    const buckets = new Map();
    const luminance = [];
    let min = 255, max = 0, colored = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      min = Math.min(min, r, g, b);
      max = Math.max(max, r, g, b);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 22) colored++;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
      luminance.push(.2126 * r + .7152 * g + .0722 * b);
    }
    luminance.sort((a, b) => a - b);
    const total = luminance.length;
    let entropy = 0, dominant = 0;
    for (const n of buckets.values()) { const p = n / total; entropy -= p * Math.log2(p); dominant = Math.max(dominant, p); }
    return { width: image.width, height: image.height, range: max - min, colorBuckets: buckets.size, colorEntropyBits: entropy, dominantColorShare: dominant, coloredShare: colored / total, luminanceContrast: luminance[Math.floor(total * .95)] - luminance[Math.floor(total * .05)], nonblank: max - min > 40 && buckets.size > 20 && colored / total > .005 };
  }, png.toString('base64'));
}
async function layout(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#slime-canvas');
    const rect = canvas.getBoundingClientRect();
    const controls = [...document.querySelectorAll('button,input')].filter(el => el.getBoundingClientRect().width > 0).map(el => {
      const r = el.getBoundingClientRect();
      return { id: el.id, label: el.getAttribute('aria-label') || el.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height, clipped: r.left < -1 || r.right > innerWidth + 1 };
    });
    return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bufferWidth: canvas.width, bufferHeight: canvas.height }, controls, contextCalls: [...new Set(window.__contextCalls)] };
  });
}
async function targetPoint(page) {
  return page.evaluate(() => {
    const api = window.__SOFTIE__, body = api.slime.body, canvas = document.querySelector('#slime-canvas');
    const rect = canvas.getBoundingClientRect();
    body.geometry.computeBoundingBox();
    body.updateWorldMatrix(true, false);
    const point = body.position.clone();
    body.geometry.boundingBox.getCenter(point);
    point.applyMatrix4(body.matrixWorld).project(api.camera);
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 };
  });
}
async function slider(page, selector, fraction) {
  const element = page.locator(selector);
  const before = await element.inputValue();
  const box = await element.boundingBox();
  await page.mouse.click(box.x + 9 + (box.width - 18) * fraction, box.y + box.height / 2);
  const after = await element.inputValue();
  check(`${selector} real pointer input`, before !== after, { before, after });
}
function center(state) {
  const value = state?.physics?.center ?? state?.physics?.position;
  return Array.isArray(value) ? value : value ? [value.x, value.y, value.z] : null;
}
function displacement(a, b) {
  const start = center(a), end = center(b);
  return start && end ? Math.hypot(...start.map((n, i) => end[i] - n)) : null;
}

let browser, activePage;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  report.browserVersion = browser.version();
  const browserCDP = await browser.newBrowserCDPSession();
  const system = await browserCDP.send('SystemInfo.getInfo');
  report.systemGPU = system.gpu;
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });
  await instrument(context);
  const page = await context.newPage();
  activePage = page;
  recordErrors(page, 'desktop');
  await ready(page);
  check('first visit defaults to Chinese', await page.locator('html').getAttribute('lang') === 'zh-CN'
    && await page.locator('[data-language="zh"]').getAttribute('aria-pressed') === 'true');
  report.nativeGPU = await page.evaluate(async () => {
    const api = window.__SOFTIE__;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const info = adapter?.info ?? (adapter?.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
    return { backend: api.renderer.backend.isWebGPUBackend === true, fallbackAdapter: adapter?.isFallbackAdapter ?? info?.isFallbackAdapter ?? null, adapter: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null, contexts: [...new Set(window.__contextCalls)] };
  });
  const gpuText = JSON.stringify([report.nativeGPU.adapter, report.systemGPU.devices]);
  const softwareGPU = /swiftshader|llvmpipe|software rasterizer|microsoft basic render/i.test(gpuText);
  check('native WebGPU backend, no WebGL contexts', report.nativeGPU.backend && !report.nativeGPU.contexts.some(kind => /^webgl|experimental-webgl/.test(kind)), report.nativeGPU);
  check('hardware adapter, not software rendering', !softwareGPU && report.nativeGPU.fallbackAdapter !== true && /apple|metal|nvidia|amd|intel|qualcomm/i.test(gpuText), gpuText);
  const canvasPNG = await screenshot(page, 'desktop-canvas', page.locator('#slime-canvas'));
  report.pixelMetrics = await pixelMetrics(page, canvasPNG);
  check('canvas screenshot is nonblank and colored', report.pixelMetrics.nonblank, report.pixelMetrics);
  for (const [name, viewport] of Object.entries({ desktop: { width: 1536, height: 1024 }, laptop: { width: 1366, height: 768 } })) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(700);
    report.viewports[name] = await layout(page);
    await screenshot(page, name);
    check(`${name}: canvas and controls fit horizontally`, !report.viewports[name].horizontalOverflow && report.viewports[name].controls.every(control => !control.clipped), report.viewports[name]);
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.waitForTimeout(500);
  await page.mouse.move(50, 400);
  await page.waitForTimeout(350);
  const gazeLeft = (await diagnostics(page)).face;
  await page.mouse.move(1480, 460);
  await page.waitForTimeout(350);
  const gazeRight = (await diagnostics(page)).face;
  await screenshot(page, 'gaze-right');
  check('eyes follow real mouse movement in both directions with bounded gaze', gazeLeft.gazeX < -.8
    && gazeRight.gazeX > .8 && Math.abs(gazeRight.gazeY) <= 1, { gazeLeft, gazeRight });
  await page.mouse.move(-10, -10);
  await page.waitForTimeout(650);
  const gazeLeftPage = (await diagnostics(page)).face;
  check('eyes smoothly recenter when the mouse leaves the page', Math.abs(gazeLeftPage.gazeX) < .01
    && Math.abs(gazeLeftPage.gazeY) < .01, gazeLeftPage);
  const beforeDrag = await diagnostics(page);
  const point = await targetPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const pressed = await diagnostics(page);
  check('holding the gel triggers a squinty expression', pressed.face.expression === 'squish' && pressed.face.squish > .85, pressed.face);
  check('press indents elastic body instead of moving a rigid sphere', pressed.physics.dragging === true && pressed.physics.deformation > .005, pressed.physics);
  report.skinAttachment = await page.evaluate(() => {
    const { slime, physics } = window.__SOFTIE__;
    const out = { x: 0, y: 0, z: 0 };
    let maxError = 0, maximumDeformation = 0;
    for (const mesh of [slime.body, slime.face]) {
      const rest = mesh.geometry.userData.posed ?? mesh.geometry.userData.rest, positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 32))) {
        physics.deform(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], out);
        maxError = Math.max(maxError, Math.hypot(positions.getX(i) - out.x, positions.getY(i) - out.y, positions.getZ(i) - out.z));
        maximumDeformation = Math.max(maximumDeformation, Math.hypot(out.x - rest[i * 3], out.y - rest[i * 3 + 1], out.z - rest[i * 3 + 2]));
      }
    }
    return { maxError, maximumDeformation, sharedParent: slime.body.parent === slime.face.parent };
  });
  check('face vertices follow exactly the body deformation field', report.skinAttachment.sharedParent && report.skinAttachment.maxError < .00001 && report.skinAttachment.maximumDeformation > .005, report.skinAttachment);
  await screenshot(page, 'pressed');
  await page.mouse.move(point.x + 150, point.y - 105, { steps: 20 });
  await page.waitForTimeout(500);
  const dragged = await diagnostics(page);
  await screenshot(page, 'dragged');
  await page.mouse.up();
  await page.waitForTimeout(250);
  const released = await diagnostics(page);
  check('release triggers a happy expression', released.face.expression === 'happy' && released.face.happy > .7, released.face);
  await screenshot(page, 'happy');
  await page.waitForTimeout(3200);
  const settled = await diagnostics(page);
  report.interaction = { target: point, beforeDrag, pressed, dragged, released, settled, dragDisplacement: displacement(beforeDrag, dragged) };
  check('real pointer drag moves soft body', report.interaction.dragDisplacement > .08, report.interaction);
  check('release clears drag state', settled.physics.dragging === false, settled.physics);
  check('gravity returns body to table and damping reduces energy', settled.physics.grounded && settled.physics.energy < released.physics.energy && Math.abs(settled.physics.volumeScale - 1) < .00001, { released: released.physics, settled: settled.physics });
  const poke = page.getByRole('button', { name: /戳一下/ });
  const beforePoke = await diagnostics(page);
  await poke.click();
  await page.waitForTimeout(130);
  const afterPoke = await diagnostics(page);
  report.poke = { before: beforePoke, after: afterPoke };
  check('poke causes visible physics change', displacement(beforePoke, afterPoke) > .01 && afterPoke.physics.energy > beforePoke.physics.energy, report.poke);
  check('poke triggers wide eyes and an O-mouth reaction', afterPoke.face.expression === 'surprised' && afterPoke.face.surprised > .4, afterPoke.face);
  await screenshot(page, 'poke');
  await page.getByRole('button', { name: '薄荷史莱姆，青绿色', exact: true }).click();
  await page.waitForTimeout(600);
  report.mint = await diagnostics(page);
  check('changing color triggers a playful wink', report.mint.face.expression === 'wink' && report.mint.face.wink > .2, report.mint.face);
  await screenshot(page, 'mint');
  check('mint color selected', await page.getByRole('button', { name: '薄荷史莱姆，青绿色', exact: true }).getAttribute('aria-pressed') === 'true', report.mint);
  await slider(page, '#stiffness', .81);
  await slider(page, '#damping', .22);
  report.changedParameters = await diagnostics(page);
  const selectedTint = await page.evaluate(() => window.__SOFTIE__.slime.gel.attenuationColor.toArray());
  await page.locator('[data-language="en"]').click();
  const translated = await diagnostics(page);
  check('English switch translates visible text and accessibility labels', await page.locator('html').getAttribute('lang') === 'en'
    && await page.locator('#page-title').innerText() === 'Softie.'
    && await page.locator('#color-name').innerText() === 'Mint slime'
    && /Interactive slime/.test(await page.locator('#slime-canvas').getAttribute('aria-label'))
    && await page.getByRole('button', { name: 'Reset', exact: true }).count() === 1);
  check('language switching preserves selected color and physics settings', JSON.stringify(translated.physics.config) === JSON.stringify(report.changedParameters.physics.config)
    && JSON.stringify(selectedTint) === JSON.stringify(await page.evaluate(() => window.__SOFTIE__.slime.gel.attenuationColor.toArray())));
  await screenshot(page, 'english-desktop');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(400);
  const englishLaptop = await layout(page);
  check('English laptop layout fits', !englishLaptop.horizontalOverflow && englishLaptop.controls.every(control => !control.clipped), englishLaptop);
  await screenshot(page, 'english-laptop');
  await ready(page);
  check('explicit language choice survives reload', await page.locator('html').getAttribute('lang') === 'en');
  await page.locator('[data-language="zh"]').focus();
  await page.keyboard.press('Enter');
  check('language switch is keyboard accessible', await page.locator('html').getAttribute('lang') === 'zh-CN');
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.waitForTimeout(600);
  report.reset = await diagnostics(page);
  check('reset leaves finite non-dragging physics', report.reset.physics.dragging === false && center(report.reset)?.every(Number.isFinite), report.reset);
  check('reset restores the neutral smile', report.reset.face.expression === 'idle' && report.reset.face.surprised === 0
    && report.reset.face.wink === 0 && report.reset.face.happy === 0, report.reset.face);
  await page.waitForFunction(() => window.__SOFTIE__.getDiagnostics().face.blink > .3, null, { timeout: 8000 });
  check('idle blink animates automatically', (await diagnostics(page)).face.blink > 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(1480, 440);
  await page.waitForTimeout(650);
  const reducedFace = (await diagnostics(page)).face;
  check('reduced motion disables idle blink and gaze', reducedFace.blink === 0 && Math.abs(reducedFace.gazeX) < .01, reducedFace);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Warm up before sampling completed app render frames. RAF alone is not rendering FPS.
  await page.waitForTimeout(3000);
  const performanceRun = page.evaluate(async () => {
    const get = () => window.__SOFTIE__.getDiagnostics();
    const before = get(), started = performance.now(), intervals = [];
    let previous = started;
    await new Promise(resolve => {
      function tick(now) {
        intervals.push(now - previous); previous = now;
        if (now - started >= 10000) resolve(); else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    const elapsedMs = performance.now() - started, after = get();
    intervals.sort((a, b) => a - b);
    return { before, after, elapsedMs, completedRenderFrames: after.frames - before.frames, renderedFPS: (after.frames - before.frames) * 1000 / elapsedMs, rafSamples: intervals.length, frameMsP50: intervals[Math.floor(intervals.length * .5)], frameMsP95: intervals[Math.floor(intervals.length * .95)], framesOver25ms: intervals.filter(ms => ms > 25).length };
  });
  await delay(1800); await poke.click();
  await delay(2700); await poke.click();
  await delay(2700); await poke.click();
  report.performance = await performanceRun;
  report.performance.evidenceValid = !softwareGPU && report.nativeGPU.backend && report.nativeGPU.fallbackAdapter !== true;
  check('10-second active native WebGPU performance sample >= 58 rendered fps', report.performance.evidenceValid && report.performance.renderedFPS >= 58, report.performance);

  // Continue a two-minute real-input soak when requested. No score/failure mechanics exist.
  const soakSeconds = Number(process.env.SOAK_SECONDS ?? 0);
  if (soakSeconds > 0) {
    const started = Date.now(), before = await diagnostics(page);
    let cycles = 0;
    while (Date.now() - started < soakSeconds * 1000) {
      const p = await targetPoint(page);
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + (cycles % 2 ? -100 : 100), p.y - 80, { steps: 12 });
      await page.mouse.up(); await poke.click(); await delay(2500); cycles++;
    }
    const after = await diagnostics(page);
    report.soak = { seconds: (Date.now() - started) / 1000, cycles, before, after };
    check('real-input soak remains finite and renders', center(after)?.every(Number.isFinite) && after.frames > before.frames && after.physics.dragging === false, report.soak);
  }
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await instrument(mobileContext);
  const mobile = await mobileContext.newPage();
  activePage = mobile;
  recordErrors(mobile, 'mobile');
  await ready(mobile);
  report.viewports.mobile = await layout(mobile);
  await screenshot(mobile, 'mobile');
  check('390 × 844 mobile has no horizontal overflow', !report.viewports.mobile.horizontalOverflow && report.viewports.mobile.controls.every(control => !control.clipped), report.viewports.mobile);
  await mobile.locator('[data-language="en"]').click();
  await mobile.setViewportSize({ width: 320, height: 740 });
  await mobile.waitForTimeout(400);
  const narrowEnglish = await layout(mobile);
  check('English controls fit a 320px phone', !narrowEnglish.horizontalOverflow && narrowEnglish.controls.every(control => !control.clipped), narrowEnglish);
  await screenshot(mobile, 'english-mobile-small');
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.locator('[data-language="zh"]').click();
  const touchPoint = await targetPoint(mobile);
  const mobileBefore = await diagnostics(mobile);
  await mobile.touchscreen.tap(touchPoint.x, touchPoint.y);
  await mobile.waitForTimeout(120);
  const mobileAfter = await diagnostics(mobile);
  report.mobileTouch = { before: mobileBefore, after: mobileAfter };
  check('touch tap reaches slime physics', mobileAfter.physics.deformation > mobileBefore.physics.deformation + .0001 || mobileAfter.physics.energy > mobileBefore.physics.energy + .0001, report.mobileTouch);
  const touchCDP = await mobileContext.newCDPSession(mobile);
  await touchCDP.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y }] });
  for (let i = 1; i <= 10; i++) {
    await touchCDP.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchPoint.x + i * 6, y: touchPoint.y - i * 5 }] });
    await mobile.waitForTimeout(25);
  }
  await mobile.waitForTimeout(300);
  const mobileDragged = await diagnostics(mobile);
  await screenshot(mobile, 'mobile-dragged');
  await touchCDP.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await mobile.waitForTimeout(150);
  const mobileCancelled = await diagnostics(mobile);
  report.mobileDrag = { before: mobileBefore, dragged: mobileDragged, cancelled: mobileCancelled, displacement: displacement(mobileBefore, mobileDragged) };
  check('touch drag moves slime and cancel releases it', report.mobileDrag.displacement > .04 && mobileCancelled.physics.dragging === false, report.mobileDrag);
  check('touch keeps gaze neutral and cancellation clears the expression', Math.abs(mobileCancelled.face.gazeX) < .001 && Math.abs(mobileCancelled.face.gazeY) < .001
    && mobileCancelled.face.expression === 'idle', mobileCancelled.face);
  await mobileContext.close();

  const unsupportedContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await instrument(unsupportedContext);
  await unsupportedContext.addInitScript(() => Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true }));
  await unsupportedContext.addInitScript(() => Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('Storage blocked', 'SecurityError'); }, configurable: true }));
  const unsupported = await unsupportedContext.newPage();
  activePage = unsupported;
  await unsupported.goto(url.href, { waitUntil: 'networkidle' });
  await unsupported.waitForTimeout(1000);
  report.unsupported = await unsupported.evaluate(() => ({ text: document.body.innerText, contexts: [...new Set(window.__contextCalls)], diagnosticsExposed: Boolean(window.__SOFTIE__) }));
  await screenshot(unsupported, 'unsupported');
  check('unsupported browser shows WebGPU explanation without WebGL fallback', /WebGPU/i.test(report.unsupported.text) && /支持|启用|开启|浏览器/.test(report.unsupported.text) && !report.unsupported.contexts.some(kind => /^webgl|experimental-webgl/.test(kind)), report.unsupported);
  await unsupported.locator('[data-language="en"]').click();
  check('error and disconnected status translate even without WebGPU', /not enabled/.test(await unsupported.locator('#error-message').innerText())
    && await unsupported.locator('#status-text').innerText() === 'WebGPU disconnected'
    && await unsupported.locator('#poke').isDisabled() && await unsupported.locator('#stiffness').isDisabled());
  check('language switching also works with blocked storage', await unsupported.locator('html').getAttribute('lang') === 'en');
  await screenshot(unsupported, 'unsupported-english');
  await unsupportedContext.close();
  check('no console or uncaught page errors', report.errors.length === 0, report.errors);
  check('no failed requests', report.requestsFailed.length === 0, report.requestsFailed);
} catch (error) {
  report.fatal = { message: error.message, stack: error.stack };
  if (activePage && !activePage.isClosed()) {
    report.fatal.pageText = await activePage.locator('body').innerText().catch(() => 'Page body unavailable');
    await screenshot(activePage, 'fatal').catch(() => {});
  }
  check('browser suite completed', false, report.fatal);
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.length > 0 && report.checks.every(item => item.passed);
  await writeFile(path.join(artifactDir, 'test-results.json'), JSON.stringify(report, null, 2));
  console.log(`Evidence: ${path.join(artifactDir, 'test-results.json')}`);
  if (!report.passed) process.exitCode = 1;
}
