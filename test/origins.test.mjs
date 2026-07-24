// Unit tests for the agent's origin allow-listing (wildcard matcher + store).
import assert from 'node:assert';
import { compileMatcher, parsePatterns, createOriginStore } from '../agent/origins.js';

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}`);
    fail++;
  }
}

// --- exact ---
let m = compileMatcher(['https://app.company.com']);
ok('exact match', m('https://app.company.com'));
ok('exact rejects other', !m('https://evil.com'));

// --- single-label wildcard ---
m = compileMatcher(['https://*.company.com']);
ok('wildcard matches one label', m('https://app.company.com'));
ok('wildcard rejects apex', !m('https://company.com'));
ok('wildcard does NOT cross a dot', !m('https://a.b.company.com'));
ok('wildcard rejects foreign domain', !m('https://app.evil.com'));

// --- multi-level ** ---
m = compileMatcher(['https://**.company.com']);
ok('** matches deep subdomain', m('https://a.b.company.com'));
ok('** matches one label too', m('https://app.company.com'));
ok('** still domain-scoped', !m('https://evil.com'));

// --- http + wildcard (internal network) ---
m = compileMatcher(['http://*.corp']);
ok('http wildcard matches', m('http://intra.corp'));
ok('scheme is enforced (https not allowed by http pattern)', !m('https://intra.corp'));

// --- port wildcard ---
m = compileMatcher(['http://intra.corp:*']);
ok('port wildcard matches any port', m('http://intra.corp:8080'));
ok('port wildcard requires a port', !m('http://intra.corp'));

// --- allow-all escape hatch ---
m = compileMatcher(['*']);
ok('"*" allows anything', m('https://whatever.example') && m('http://x.y.z'));

// --- empty / no origin ---
m = compileMatcher([]);
ok('empty list rejects', !m('https://app.company.com'));
ok('null origin is not matched here', !m(''));

// --- parsePatterns ---
ok('parsePatterns splits comma+space+newline', JSON.stringify(parsePatterns('a, b\n c,,d')) === JSON.stringify(['a', 'b', 'c', 'd']));

// --- store: static only ---
const store = createOriginStore({ staticPatterns: ['https://*.company.com'] });
ok('store allows static wildcard', store.allowed('https://x.company.com'));
ok('store rejects foreign', !store.allowed('https://x.evil.com'));
ok('store reports counts', store.staticCount === 1 && store.remoteCount === 0 && store.remoteEnabled === false);

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} origin tests passed`);
process.exit(fail ? 1 : 0);
