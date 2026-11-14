import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// WCAG 2.1 AA (PLAN S4-M11): no serious or critical violation, and no sideways scroll at the viewport in use.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function expectAccessible(page: Page, url: string, name = url) {
  const res = await page.goto(url);
  expect(res?.status(), `${name} answered ${res?.status()}`).toBeLessThan(400);
  expect(new URL(page.url()).pathname, `${name} was redirected`).toBe(new URL(url, 'http://x').pathname);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${name}: ${v.id} ${v.nodes.map((n) => `${n.target} ${n.any[0]?.message ?? ''}`).join('; ')}`), name).toEqual([]);
  // Name the elements that stick out, so a failure on another machine can be fixed without reproducing it.
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= limit) return [];
    return [...document.body.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > limit + 0.5)
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
  });
  expect(wide, `${name} scrolls sideways`).toEqual([]);
}
