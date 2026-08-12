import { parse } from '@lwc/template-compiler';
const P = (s, c = {}) => parse(s, { name: 'p', namespace: 'c', ...c });

console.log('=== F: complex expressions ===');
for (const cfg of [{ experimentalComplexExpressions: true }, { experimentalComplexExpressions: true, apiVersion: 62 }, { experimentalComplexExpressions: true, apiVersion: 65 }]) {
  const f = P(`<template><div title={a ? b : c}>{n + 1}</div></template>`, cfg);
  console.log('cfg', JSON.stringify(cfg), '=> warnings:', JSON.stringify(f.warnings.map(w => w.message.slice(0, 110))));
  if (f.root && f.root.children[0]) {
    const fe = f.root.children[0];
    console.log('   attrs:', JSON.stringify(fe.attributes.map(x => [x.name, x.value.type])),
      'children:', JSON.stringify((fe.children || []).map(c => [c.type, c.value && c.value.type])));
  }
}

console.log('\n=== G: arrow fn handler ===');
for (const cfg of [{ experimentalComplexExpressions: true, apiVersion: 65 }]) {
  try {
    const g = P(`<template><div onclick={()=>go(1)}></div></template>`, cfg);
    console.log('root?', !!g.root, 'warnings:', JSON.stringify(g.warnings.map(w => w.message.slice(0, 100))));
    if (g.root && g.root.children[0]) console.log('handler type:', g.root.children[0].listeners[0].handler.type);
  } catch (e) { console.log('THREW', e.message.slice(0, 140)); }
}

console.log('\n=== H: root directives ===');
const h = P(`<template lwc:render-mode="light" lwc:preserve-comments><div></div></template>`);
console.log('root.directives:', JSON.stringify(h.root.directives.map(x => ({ name: x.name, value: x.value.value }))));

console.log('\n=== I: element-level (non-<template>) directives ===');
const i = P(`<template><div lwc:if={x}>inline</div><div for:each={xs} for:item="q"><span key={q.id}>{q}</span></div></template>`);
console.log('children types:', i.root.children.map(c => c.type));
console.log('grandchildren:', JSON.stringify(i.root.children.map(c => (c.children || []).map(k => k.type + (k.name ? ':' + k.name : '')))));
console.log('directiveLocation present:', i.root.children.map(c => !!c.directiveLocation));

console.log('\n=== J: error behavior on invalid template ===');
for (const bad of [`<template><template for:item="x"></template></template>`,
                   `<template><template for:each={x}><li></li></template></template>`,
                   `<template><div>{</div></template>`,
                   `<div>not a template root</div>`]) {
  try { const j = parse(bad, { name: 'p', namespace: 'c' });
    console.log(bad.slice(0,50).padEnd(52), '=> root?', !!j.root, 'warn:', JSON.stringify(j.warnings.map(w => w.message.slice(0, 70)))); }
  catch (e) { console.log(bad.slice(0,50).padEnd(52), '=> THREW', e.constructor.name, e.message.slice(0, 90)); }
}

console.log('\n=== K: serializability / no parent refs ===');
const k = P('<template><div><span>{x}</span></div></template>');
console.log('root keys:', Object.keys(k.root).join(','));
console.log('div keys:', Object.keys(k.root.children[0]).join(','));
console.log('"parent" in div?', 'parent' in k.root.children[0]);
try { const s = JSON.stringify(k.root); console.log('JSON.stringify OK, bytes=', s.length); }
catch (e) { console.log('JSON.stringify FAILED:', e.message.slice(0, 60)); }

console.log('\n=== L: SourceLocation shape ===');
console.log(JSON.stringify(k.root.children[0].location, null, 0).slice(0, 300));

console.log('\n=== M: for:each without key -> warning/error? ===');
const m = parse(`<template><template for:each={xs} for:item="q"><li>{q}</li></template></template>`, { name:'p', namespace:'c' });
console.log('root?', !!m.root, 'warnings:', JSON.stringify(m.warnings.map(w => w.message.slice(0, 100))));

console.log('\n=== N: iterator:* full shape ===');
const nn = P(`<template><template iterator:it={xs}><li key={it.value.id}>{it.value.n}</li></template></template>`);
const f0 = nn.root.children[0];
console.log('type=', f0.type, 'iterator.name=', f0.iterator.name, 'expression=', JSON.stringify(f0.expression));

console.log('\n=== O: nested member expression depth ===');
const o = P('<template><div>{a.b.c.d}</div></template>');
console.log(JSON.stringify(o.root.children[0].children[0].value, (kk,v)=> kk==='location'?undefined:v));

console.log('\n=== P: boolean literal attr / empty attr ===');
const p = P('<template><c-x flag disabled="" n="3"></c-x><div hidden contenteditable></div></template>');
console.log('c-x props:', JSON.stringify(p.root.children[0].properties.map(x=>[x.name, x.value.type, x.value.value])));
console.log('c-x attrs:', JSON.stringify(p.root.children[0].attributes.map(x=>[x.name, x.value.type, x.value.value])));
console.log('div attrs:', JSON.stringify(p.root.children[1].attributes.map(x=>[x.name, x.value.type, x.value.value])));
