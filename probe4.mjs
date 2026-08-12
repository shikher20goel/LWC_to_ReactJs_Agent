import { parse } from '@lwc/template-compiler';
const P = (s, c = {}) => parse(s, { name: 'p', namespace: 'c', ...c });

console.log('=== Q: complex expressions with QUOTED attribute values ===');
for (const cfg of [{}, { experimentalComplexExpressions: true }]) {
  const q = P(`<template><div title="{a ? b : c}" onclick="{() => go(1)}">{n + 1}</div></template>`, cfg);
  console.log('cfg', JSON.stringify(cfg), 'root?', !!q.root, 'warn:', JSON.stringify(q.warnings.map(w => w.message.slice(0, 95))));
  if (q.root && q.root.children[0]) {
    const e = q.root.children[0];
    console.log('   attrs:', JSON.stringify(e.attributes.map(x => [x.name, x.value.type])),
      'listeners:', JSON.stringify(e.listeners.map(l => [l.name, l.handler.type])),
      'text:', JSON.stringify((e.children || []).map(c => [c.type, c.value && c.value.type])));
  }
}

console.log('\n=== R: CompilerDiagnostic shape ===');
const r = P(`<template><template for:each={xs} for:item="q"><li>{q}</li></template></template>`);
console.log(JSON.stringify(r.warnings[0], null, 1));

console.log('\n=== S: does parse() ever throw? malformed inputs ===');
for (const bad of ['', '<template>', 'not html at all', '<template><template lwc:elseif={x}></template></template>']) {
  try { const j = parse(bad, { name: 'p', namespace: 'c' });
    console.log(JSON.stringify(bad).slice(0,50).padEnd(56), 'root?', !!j.root, 'warn#:', j.warnings.length, j.warnings[0] ? j.warnings[0].message.slice(0,60) : ''); }
  catch (e) { console.log(JSON.stringify(bad).slice(0,50).padEnd(56), 'THREW', e.constructor.name, e.message.slice(0, 80)); }
}

console.log('\n=== T: Text node with expression only vs mixed ===');
const t = P('<template><div>{only}</div><div>a{mid}b</div><div>plain</div></template>');
t.root.children.forEach(d => console.log(' ', JSON.stringify(d.children.map(c => [c.type, c.value.type, c.value.value !== undefined ? c.value.value : c.value.name, c.raw]))));

console.log('\n=== U: slot with fallback content + slot attr on child ===');
const u = P('<template><slot name="hdr"><span>fallback</span></slot><c-x><p slot="body">B</p><p>default</p></c-x></template>');
const s0 = u.root.children[0];
console.log('Slot slotName=', JSON.stringify(s0.slotName), 'children:', JSON.stringify(s0.children.map(c => c.type)));
const cx = u.root.children[1];
console.log('c-x children:', JSON.stringify(cx.children.map(c => [c.type, c.name, JSON.stringify(c.attributes.map(a => [a.name, a.value.value]))])));

console.log('\n=== V: exports actually available at runtime ===');
const mod = await import('@lwc/template-compiler');
console.log(Object.keys(mod).sort().join(', '));
