import { parse } from '@lwc/template-compiler';
const P = (s, c = {}) => parse(s, { name: 'p', namespace: 'c', ...c });

console.log('=== A: if/elseif/else chain shape ===');
const a = P(`<template>
<template lwc:if={a}><p>A</p></template>
<template lwc:elseif={b}><p>B</p></template>
<template lwc:else><p>C</p></template>
</template>`);
console.log('root.children.length =', a.root.children.length);
console.log('root.children types =', a.root.children.map(c => c.type));
let n = a.root.children[0];
while (n) { console.log(' chain:', n.type, n.condition ? '(cond)' : '', '-> else:', n.else ? n.else.type : 'NONE'); n = n.else; }

console.log('\n=== B: kebab-case props on custom element ===');
const b = P(`<template><c-child my-prop={x} class="k" style="color:red" data-foo="1" aria-hidden={h} key={k}></c-child></template>`);
const el = b.root.children[0];
console.log('type=', el.type);
console.log('properties:', JSON.stringify(el.properties.map(p => ({ name: p.name, attributeName: p.attributeName, v: p.value.type }))));
console.log('attributes:', JSON.stringify(el.attributes.map(x => ({ name: x.name, v: x.value.type, lit: x.value.value }))));
console.log('directives:', JSON.stringify(el.directives.map(d => d.name)));

console.log('\n=== C: attribute vs property on plain HTML elements ===');
for (const t of ['<div class={c}></div>', '<div class="s"></div>', '<div style={s}></div>', '<label for={f}></label>',
  '<a href={h}></a>', '<img src={s} alt={a}/>', '<input value={v} checked={c} disabled={d} readonly={r} maxlength={m}/>',
  '<div id={i} title={t} hidden={h} tabindex={ti} role={r} data-x={d} aria-label={al}></div>',
  '<option selected={s}></option>', '<button type="submit" onclick={go}></button>',
  '<textarea value={v}></textarea>', '<select value={v}></select>']) {
  const r = P(`<template>${t}</template>`);
  const e = r.root.children[0];
  console.log(t.padEnd(62),
    'P:' + JSON.stringify(e.properties.map(p => p.name + '<-' + p.attributeName)),
    'A:' + JSON.stringify(e.attributes.map(x => x.name)),
    'L:' + JSON.stringify(e.listeners.map(x => x.name)));
}

console.log('\n=== D: ScopedSlotFragment detail ===');
const d = P(`<template><c-list><template lwc:slot-data="kv" slot="row"><span>{kv.n}</span></template></c-list></template>`);
const ssf = d.root.children[0].children[0];
console.log('type=', ssf.type, 'slotData.name=', ssf.slotData.value.name, 'slotName=', JSON.stringify(ssf.slotName));

console.log('\n=== E: event name casing ===');
for (const t of ['<div onclick={h}></div>', '<div onmouseover={h}></div>', '<c-x onmycustomevent={h}></c-x>', '<c-x ontest-event={h}></c-x>']) {
  try { const r = P(`<template>${t}</template>`);
    console.log(t.padEnd(42), 'listeners:', JSON.stringify(r.root.children[0].listeners.map(l => l.name)), 'warn:', r.warnings.length); }
  catch (e) { console.log(t.padEnd(42), 'THREW', e.message.slice(0, 80)); }
}

console.log('\n=== F: complex expressions (no arrow) ===');
const f = P(`<template><div title={a ? b : c}>{n}</div></template>`, { experimentalComplexExpressions: true });
console.log('warnings:', f.warnings.length);
const fe = f.root.children[0];
console.log('attr title value.type =', fe.attributes[0].value.type);
console.log('text value.type =', fe.children[0].value.type);

console.log('\n=== G: arrow fn handler w/ complex expressions ===');
try {
  const g = parse(`<template><div onclick={() => go(1)}></div></template>`, { name:'p', namespace:'c', experimentalComplexExpressions: true });
  console.log('root?', !!g.root, 'warnings:', JSON.stringify(g.warnings.map(w=>w.message.slice(0,90))));
  if (g.root) console.log('handler type:', g.root.children[0].listeners[0].handler.type);
} catch (e) { console.log('THREW', e.message.slice(0,120)); }

console.log('\n=== H: root directives ===');
const h = P(`<template lwc:render-mode="light" lwc:preserve-comments><div></div></template>`);
console.log('root.directives:', JSON.stringify(h.root.directives.map(x => ({ name: x.name, value: x.value.value }))));

console.log('\n=== I: template-tag vs element-level directives ===');
const i = P(`<template><div lwc:if={x}>inline</div><div for:each={xs} for:item="q"><span key={q.id}>{q}</span></div></template>`);
console.log('children types:', i.root.children.map(c => c.type));
console.log('nested:', i.root.children.map(c => (c.children||[]).map(k => k.type)));
console.log('directiveLocation present:', i.root.children.map(c => !!c.directiveLocation));

console.log('\n=== J: error behavior on invalid template ===');
try { const j = parse(`<template><template for:item="x"></template></template>`, {name:'p',namespace:'c'});
  console.log('root?', !!j.root, 'warnings:', JSON.stringify(j.warnings.map(w=>w.message.slice(0,100)))); }
catch (e) { console.log('THREW:', e.constructor.name, e.message.slice(0,120)); }

console.log('\n=== K: parent/circular refs + JSON serializability ===');
const k = P('<template><div><span>{x}</span></div></template>');
console.log('root has "parent" key?', 'parent' in k.root);
console.log('child keys:', Object.keys(k.root.children[0]).join(','));
try { JSON.stringify(k.root); console.log('JSON.stringify: OK (no circular refs)'); }
catch (e) { console.log('JSON.stringify FAILED:', e.message.slice(0,60)); }
