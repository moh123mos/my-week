// The client repeats a few facts the server and the page own. These fail when one side changes alone.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { LIMITS, PERIODS, WEEK_FIELDS } from '../../public/js/config.js';

const require = createRequire(import.meta.url);
const serverLimits = require('../../server/limits.js');
const { cleanItems, cleanWeek } = require('../../server/validate.js');
const publicFile = name => readFileSync(new URL(`../../public/${name}`, import.meta.url), 'utf8');
const arabicNumber = n => n.toLocaleString('ar-EG', { useGrouping: false });

test('limits match server/limits.js', () => {
  for (const [name, value] of Object.entries(LIMITS)) assert.equal(serverLimits[name], value, name);
});

test('the limits written in the page match', () => {
  const html = publicFile('index.html');
  assert.ok(html.includes(`id="authName" type="text" autocomplete="name" maxlength="${LIMITS.MAX_USER_NAME}"`));
  assert.ok(html.includes(`الأقصى (${arabicNumber(LIMITS.MAX_ITEMS)} بند)`));
  assert.ok(html.includes(`${arabicNumber(LIMITS.PASSWORD_MIN)} أحرف`));
  assert.ok(publicFile('js/ui/auth.js').includes(`${arabicNumber(LIMITS.PASSWORD_MIN)} أحرف`));
});

test('every period is accepted by the server and has a colour', () => {
  const css = publicFile('style.css');
  for (const period of Object.keys(PERIODS)) {
    assert.equal(cleanItems([{ id: 'a', period }])[0].period, period);
    assert.ok(css.includes(`--p-${period}:`), period);
  }
});

test('week fields match what the server keeps', () => {
  assert.deepEqual(Object.keys(cleanWeek({})), WEEK_FIELDS);
});

test('every module is preloaded, and every preload exists', () => {
  const dir = new URL('../../public/js/', import.meta.url);
  const modules = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => join(e.parentPath, e.name).replaceAll('\\', '/').split('/public/')[1])
    .sort();
  const preloaded = [...publicFile('index.html').matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(preloaded, modules);
});
