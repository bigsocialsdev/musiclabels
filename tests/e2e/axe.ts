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
  // Name the boxes that stick out, so a failure on another machine can be fixed without reproducing it.
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= limit) return [];
    const describe = (el: Element) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} left=${Math.round(r.left)} width=${Math.round(r.width)} display=${getComputedStyle(el).display}`;
    };
    const first = [...document.body.querySelectorAll('*')].find((el) => el.getBoundingClientRect().right > limit + 0.5);
    const chain: string[] = [];
    for (let el = first; el && el !== document.body; el = el.parentElement as Element) chain.push(describe(el));
    return chain;
  });
  expect(wide, `${name} scrolls sideways (the widest box and its ancestors, limit is the screen width)`).toEqual([]);
}
