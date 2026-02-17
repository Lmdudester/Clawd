/**
 * E2E Playwright test: Clawd session creates a plan and verifies markdown view.
 *
 * Workflow:
 *   1. Log in to the test Clawd instance
 *   2. Create a new session
 *   3. Switch to Plan mode in settings
 *   4. Send a message asking Claude to make a plan
 *   5. Verify the PlanCard appears (border-l-sky-500 styling)
 *   6. Verify markdown is rendered inside the plan
 */

process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/playwright-browsers';
const { chromium } = await import('/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs');

const BASE_URL = process.env.TEST_CLAWD_URL || 'http://test-clawd-1771299633:5000';
const USERNAME = 'test';
const PASSWORD = 'test';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

try {
  console.log(`\nConnecting to: ${BASE_URL}\n`);

  // ── Step 1: Login ────────────────────────────────────────────────
  console.log('Step 1: Login');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[placeholder="Username"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.href.includes('login'), { timeout: 15000 });
  assert(true, 'Logged in successfully');

  // ── Step 2: Open New Session Dialog ─────────────────────────────
  console.log('\nStep 2: Create new session');
  // Wait for session list to load
  await page.waitForSelector('button:has-text("+")', { timeout: 15000 });
  await page.click('button:has-text("+")');
  await page.waitForSelector('text=New Session', { timeout: 10000 });
  assert(true, 'New Session dialog opened');

  // Fill session name
  await page.fill('input[placeholder="Session name"]', 'Plan Markdown Test');
  assert(true, 'Session name filled');

  // Fill repo URL (no repos configured in test instance)
  await page.fill('input[placeholder*="Repository URL"]', 'https://github.com/Lmdudester/Clawd.git');
  assert(true, 'Repository URL filled');

  // Fill branch
  await page.fill('input[placeholder*="Branch"]', 'self-testing');
  assert(true, 'Branch filled');

  await page.waitForTimeout(500);

  // Click Create
  const createBtn = page.locator('button:has-text("Create")').last();
  await createBtn.click();
  assert(true, 'Session created');

  // ── Step 3: Wait for chat view to load ──────────────────────────
  console.log('\nStep 3: Wait for chat view');
  await page.waitForSelector('textarea[placeholder="Message Claude..."]', { timeout: 90000 });
  assert(true, 'Chat view loaded');

  // ── Step 4: Open settings and switch to Plan mode ────────────────
  console.log('\nStep 4: Enable Plan mode');
  await page.click('button[title="Session settings"]');
  await page.waitForSelector('text=Session Settings', { timeout: 5000 });
  assert(true, 'Settings dialog opened');

  // Click "Plan" mode button
  await page.click('button:has-text("Plan")');
  await page.waitForTimeout(300);
  assert(true, 'Plan mode selected');

  // Close settings
  await page.click('button:has-text("Close")');
  await page.waitForSelector('text=Session Settings', { state: 'hidden', timeout: 5000 });
  assert(true, 'Settings dialog closed');

  // Verify plan mode indicator appears in chat (text "Plan Mode" badge)
  const hasPlanBadge = await page.locator('text=Plan Mode').isVisible().catch(() => false);
  assert(hasPlanBadge, 'Plan Mode badge visible in chat header');

  // ── Step 5: Send a message ───────────────────────────────────────
  console.log('\nStep 5: Send message requesting a plan');
  // Wait for textarea to be enabled (session container may still be starting)
  const textarea = page.locator('textarea[placeholder="Message Claude..."]');
  await textarea.waitFor({ state: 'visible', timeout: 120000 });
  // Poll until enabled
  await page.waitForFunction(() => {
    const ta = document.querySelector('textarea[placeholder="Message Claude..."]');
    return ta && !ta.disabled;
  }, { timeout: 120000 });
  assert(true, 'Chat input is ready (session connected)');
  await textarea.fill('Please create a detailed implementation plan for adding a dark mode toggle to this Clawd application. The plan should include headings, bullet points, and code examples.');
  await page.click('button:has-text("Send")');
  assert(true, 'Message sent');

  // ── Step 6: Wait for plan card ───────────────────────────────────
  console.log('\nStep 6: Waiting for plan response (up to 3 minutes)...');

  // The PlanCard has class border-l-sky-500
  await page.waitForSelector('.border-l-sky-500, [class*="border-l-sky-500"]', {
    timeout: 180000,
  });
  assert(true, 'PlanCard appeared (border-l-sky-500 styling)');

  // Verify "Plan" or "Plan Updated" header text in the card
  const planHeader = await page.locator('.border-l-sky-500 >> text=Plan').first().isVisible().catch(() => false) ||
                     await page.locator('text=Plan Updated').isVisible().catch(() => false) ||
                     await page.locator('text=Plan').filter({ hasNot: page.locator('button') }).first().isVisible().catch(() => false);
  assert(planHeader, 'Plan card shows "Plan" or "Plan Updated" header');

  // ── Step 7: Verify markdown rendering ───────────────────────────
  console.log('\nStep 7: Verify markdown rendering inside plan card');

  // Click to expand/open the plan card overlay
  const planCard = page.locator('.border-l-sky-500').first();
  await planCard.click();
  await page.waitForTimeout(1000);

  // The plan card shows markdown content inline (collapsed by default)
  // Check for markdown elements in the page
  const headingCount = await page.locator('h1, h2, h3, h4, h5, h6').count();
  const listCount = await page.locator('ul > li, ol > li').count();
  const codeCount = await page.locator('code, pre').count();

  assert(headingCount > 0, `Markdown headings rendered (${headingCount} found)`);
  assert(listCount > 0, `Markdown list items rendered (${listCount} found)`);
  console.log(`  (code blocks found: ${codeCount})`);

  // Look for the full-screen overlay (sky-300 text for "Plan" header)
  const overlayPlanHeader = await page.locator('.text-sky-300:has-text("Plan")').isVisible().catch(() => false);
  if (overlayPlanHeader) {
    assert(true, 'Plan overlay opened with sky-300 "Plan" header');
  } else {
    // Maybe the click just toggled collapse — check inline content
    const inlineMarkdown = await page.locator('.border-l-sky-500 h1, .border-l-sky-500 h2, .border-l-sky-500 h3, .border-l-sky-500 ul').count() > 0;
    assert(inlineMarkdown, 'Markdown rendered inline within PlanCard');
  }

  // Take final screenshot
  await page.screenshot({ path: '/workspace/scripts/plan-test-result.png', fullPage: false });
  console.log('\n  Screenshot saved: /workspace/scripts/plan-test-result.png');

} catch (err) {
  console.error(`\nFATAL ERROR: ${err.message}`);
  await page.screenshot({ path: '/workspace/scripts/plan-test-error.png', fullPage: false }).catch(() => {});
  failed++;
} finally {
  await browser.close();
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
