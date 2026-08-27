import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
const gap = async (sel, a, bb) => p.evaluate(([s, x, y]) => {
  const root = document.querySelector(s);
  const l = root.querySelector(x).getBoundingClientRect(), r = root.querySelector(y).getBoundingClientRect();
  return Math.round(r.left - l.right);
}, [sel, a, bb]);
console.log('plan  gap', await gap('.plan-stage', '.plan-column-rail', '.plan-column-rail + *'));
console.log('build gap', await gap('.hx-stage', '.hx-rail', '.hx-desk'));
const top = await p.evaluate(() => document.querySelector('.hx-stage').getBoundingClientRect().top + window.scrollY);
await p.evaluate((y) => window.scrollTo(0, y - 120), top); await p.waitForTimeout(2300);
const s = await p.locator('.hx-stage').boundingBox();
await p.screenshot({ path: 'g.png', clip: { x: s.x - 8, y: s.y - 8, width: s.width + 16, height: s.height + 16 } });
await b.close();
