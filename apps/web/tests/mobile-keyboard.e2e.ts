/** A phone keyboard's layout resize keeps the composer inside the visible area. */
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, revealNavigationDrawer, saveFailureShot } from './support.ts'

/** Portrait phone at the responsive acceptance minimum. */
const PHONE = { width: 390, height: 844 }

/** A Gboard-height keyboard: the layout viewport keeps this much below the top. */
const KEYBOARD_HEIGHT = 336
const KEYBOARD_VIEWPORT = { width: PHONE.width, height: PHONE.height - KEYBOARD_HEIGHT }

/** Android Chrome, where the keyboard changes the layout viewport under the app. */
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

/**
 * Read the geometry a user with an open keyboard would see: the app box, the
 * page scroll, and the composer card's place in the viewport.
 * @param page - page showing a live composer.
 * @returns Viewport, document, scroll and composer measurements in CSS pixels.
 */
async function measure(page: Page) {
  return await page.evaluate(() => {
    const card = document.querySelector('[data-composer-card]')
    if (card === null) throw new Error('composer card is missing')
    const box = card.getBoundingClientRect()
    return {
      viewport: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      top: box.top,
      bottom: box.bottom,
      height: box.height,
    }
  })
}

/**
 * Read the transcript's own scroll position and the screen offset of the row carrying one marker.
 * @param page - page showing a conversation transcript.
 * @param marker - text painted by the tracked row.
 * @returns Scroll position, the physical floor, and the row's viewport offset.
 */
async function transcript(page: Page, marker: string) {
  return await page.evaluate((text) => {
    const scroller = document.querySelector('[data-conversation-scroll]')
    if (scroller === null) throw new Error('conversation scrollport is missing')
    const row = [...scroller.querySelectorAll('[data-chat-flow-key]')]
      .find(element => (element.textContent ?? '').includes(text))
    return {
      scrollTop: scroller.scrollTop,
      floor: scroller.scrollHeight - scroller.clientHeight,
      rowTop: row === undefined ? null : row.getBoundingClientRect().top,
    }
  }, marker)
}

/**
 * Select a seeded Session through the phone's navigation drawer.
 * @param page - phone page with the mounted app.
 * @param marker - first-prompt marker the Session search matches.
 */
async function openSeededSession(page: Page, marker: string): Promise<void> {
  await revealNavigationDrawer(page, 'en')
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.count() > 0 && await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search session names', exact: true })
  await search.fill(marker)
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => results.count(), { timeout: 60_000 }).toBe(1)
  await results.click()
  await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 30_000 })
  // The drawer stays open over the transcript on a phone; close it before touching the composer.
  const collapse = page.locator('[data-shell-leading]').getByRole('button', { name: 'Collapse sidebar', exact: true })
  if (await collapse.count() > 0) await collapse.click()
  await page.locator('[data-sidebar-drawer][data-sidebar-collapsed]').waitFor({ timeout: 10_000 })
}

it('keeps the composer inside a layout viewport an on-screen keyboard shortened', async () => {
  const scaffold = await launchWebScaffold({})
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({
        viewport: PHONE,
        hasTouch: true,
        isMobile: true,
        userAgent: ANDROID_UA,
        locale: 'en-US',
      })
      const tripwire = watchConsole(page)
      try {
        await page.goto(scaffold.authenticatedUrl)
        // The declaration that makes Android Chromium resize the layout
        // viewport instead of shrinking only the visual viewport, which would
        // leave the composer behind the keyboard.
        expect(await page.locator('meta[name="viewport"]').getAttribute('content'))
          .toBe('width=device-width, initial-scale=1, interactive-widget=resizes-content')
        await connectFreshWorkspace(page, scaffold.workspaceCwd, 'keyboard')
        await page.locator('[data-composer-input][contenteditable="true"]').tap()

        const phone = await measure(page)
        expect(phone.viewport).toBe(PHONE.height)
        expect(phone.bottom).toBeLessThanOrEqual(PHONE.height)
        expect(phone.documentHeight).toBeLessThanOrEqual(PHONE.height)

        // A keyboard resizes the layout viewport; the composer's sticky floor
        // has to follow it, without the page gaining scrollable overflow.
        await page.setViewportSize(KEYBOARD_VIEWPORT)
        await expect.poll(async () => (await measure(page)).viewport).toBe(KEYBOARD_VIEWPORT.height)
        const typing = await measure(page)
        expect(typing.top).toBeGreaterThanOrEqual(0)
        expect(typing.height).toBeGreaterThan(0)
        expect(typing.bottom).toBeLessThanOrEqual(KEYBOARD_VIEWPORT.height)
        expect(typing.documentHeight).toBeLessThanOrEqual(KEYBOARD_VIEWPORT.height)
        expect(typing.scrollY).toBe(0)
        expect(await page.locator('[data-composer-card]').isVisible()).toBe(true)

        await page.setViewportSize(PHONE)
        await expect.poll(async () => (await measure(page)).bottom).toBeLessThanOrEqual(PHONE.height)
        expect(tripwire.pageErrors).toEqual([])
      } catch (error) {
        await saveFailureShot(page, 'web-e2e-mobile-keyboard')
        throw error
      } finally {
        await page.close()
      }
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
}, 180_000)

it('holds the transcript in place while the composer clears the keyboard', async () => {
  const scaffold = await launchWebScaffold({})
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'KEYBOARD', title: 'Keyboard layout', turns: 3 })
    await seedSession(scaffold, fixture.log, 'mobile-keyboard-transcript-e2e')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({
        viewport: PHONE,
        hasTouch: true,
        isMobile: true,
        userAgent: ANDROID_UA,
        locale: 'en-US',
      })
      const tripwire = watchConsole(page)
      const marker = fixture.markers.assistant(fixture.turns)
      try {
        await page.goto(scaffold.authenticatedUrl)
        await openSeededSession(page, fixture.markers.user(1))
        await page.getByText(marker, { exact: false }).last().waitFor({ timeout: 30_000 })
        const tail = await transcript(page, marker)
        expect(tail.rowTop).not.toBeNull()
        // Opening a Session with no saved position lands at the tail.
        expect(tail.scrollTop).toBe(tail.floor)

        // Tapping the draft raises the keyboard: the composer moves up with it.
        await page.locator('[data-composer-input][contenteditable="true"]').tap()
        await page.setViewportSize(KEYBOARD_VIEWPORT)
        await expect.poll(async () => (await measure(page)).viewport).toBe(KEYBOARD_VIEWPORT.height)
        const typing = await measure(page)
        const held = await transcript(page, marker)
        expect(typing.bottom).toBeLessThanOrEqual(KEYBOARD_VIEWPORT.height)
        expect(typing.top).toBeGreaterThanOrEqual(0)
        expect(typing.scrollY).toBe(0)
        // The keyboard lifts only the composer: the transcript keeps the content
        // it painted at the same screen offset instead of following the tail.
        expect(held.scrollTop).toBe(tail.scrollTop)
        expect(Math.abs(held.rowTop! - tail.rowTop!)).toBeLessThanOrEqual(1)

        // Closing the keyboard restores the port without moving what the reader sees.
        await page.setViewportSize(PHONE)
        await expect.poll(async () => (await measure(page)).viewport).toBe(PHONE.height)
        const restored = await transcript(page, marker)
        expect(restored.scrollTop).toBe(tail.scrollTop)
        expect(Math.abs(restored.rowTop! - tail.rowTop!)).toBeLessThanOrEqual(1)

        // Without composer focus the same shrink is an ordinary layout resize: the
        // reader who was at the tail stays at the tail.
        await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
        await page.setViewportSize(KEYBOARD_VIEWPORT)
        await expect.poll(async () => (await measure(page)).viewport).toBe(KEYBOARD_VIEWPORT.height)
        await expect.poll(async () => (await transcript(page, marker)).scrollTop).toBe(tail.floor + KEYBOARD_HEIGHT)
        expect(tripwire.pageErrors).toEqual([])
      } catch (error) {
        await saveFailureShot(page, 'web-e2e-mobile-keyboard-transcript')
        throw error
      } finally {
        await page.close()
      }
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
}, 180_000)
