import { parse } from '@lwc/template-compiler';

const src = `<template>
  <div class="card" data-id="x" title={dynTitle} onclick={handleClick} lwc:ref="box">
    Hello {greeting} world
  </div>
  <ul>
    <template for:each={items} for:item="it" for:index="i">
      <li key={it.id} onmouseover={onHover}>{it.name} - {i}</li>
    </template>
  </ul>
  <template iterator:iter={items}>
    <li key={iter.value.id}>{iter.value.name}{iter.first}{iter.last}{iter.index}</li>
  </template>
  <template if:true={isOpen}><p>open</p></template>
  <template if:false={isOpen}><p>closed</p></template>
  <template lwc:if={a}><p>A</p></template>
  <template lwc:elseif={b}><p>B</p></template>
  <template lwc:else><p>C</p></template>
  <c-child message={msg} title="static" onnotify={handleNotify} lwc:spread={props}></c-child>
  <slot></slot>
  <slot name="header"></slot>
  <div lwc:inner-html={html}></div>
  <div lwc:dom="manual"></div>
  <input value={val} disabled required aria-label={lbl} for="x"/>
  <!-- a comment -->
</template>`;

function pad(n) { return ' '.repeat(n); }

function summarize(node, depth = 0) {
  const t = node.type;
  let extra = '';
  switch (t) {
    case 'Element': case 'Component': case 'Slot': case 'ExternalComponent': case 'Lwc':
      extra = ` name=${node.name}`;
      if (t === 'Slot') extra += ` slotName="${node.slotName}"`;
      if (node.attributes?.length) extra += ` attrs=[${node.attributes.map(a => a.name + ':' + a.value.type).join(',')}]`;
      if (node.properties?.length) extra += ` props=[${node.properties.map(p => p.name + '<-' + p.attributeName + ':' + p.value.type).join(',')}]`;
      if (node.listeners?.length) extra += ` on=[${node.listeners.map(l => l.name + '=' + expr(l.handler)).join(',')}]`;
      if (node.directives?.length) extra += ` dirs=[${node.directives.map(d => d.name + '=' + (d.value.type === 'Literal' ? JSON.stringify(d.value.value) : expr(d.value))).join(',')}]`;
      break;
    case 'Text': extra = ` value=${node.value.type}:${node.value.type === 'Literal' ? JSON.stringify(node.value.value) : expr(node.value)}`; break;
    case 'Comment': extra = ` value=${JSON.stringify(node.value)}`; break;
    case 'If': extra = ` modifier=${node.modifier} condition=${expr(node.condition)}`; break;
    case 'IfBlock': case 'ElseifBlock': extra = ` condition=${expr(node.condition)} hasElse=${!!node.else}${node.else ? ' elseType=' + node.else.type : ''}`; break;
    case 'ForEach': extra = ` expr=${expr(node.expression)} item=${node.item.name} index=${node.index ? node.index.name : '-'}`; break;
    case 'ForOf': extra = ` expr=${expr(node.expression)} iterator=${node.iterator.name}`; break;
    case 'Root': extra = ` dirs=[${node.directives.map(d => d.name).join(',')}]`; break;
  }
  console.log(pad(depth * 2) + t + extra);
  (node.children || []).forEach(c => summarize(c, depth + 1));
}

function expr(e) {
  if (!e) return 'null';
  if (e.type === 'Identifier') return e.name;
  if (e.type === 'MemberExpression') return expr(e.object) + '.' + e.property.name;
  if (e.type === 'Literal') return JSON.stringify(e.value);
  return e.type;
}

const res = parse(src, {
  name: 'probe', namespace: 'c',
  experimentalDynamicDirective: true,
  enableDynamicComponents: true,
  enableLwcOn: true,
  preserveHtmlComments: true,
});
console.log('--- warnings:', JSON.stringify(res.warnings.map(w => w.message)), '\n');
summarize(res.root);

// second probe: lwc:component / lwc:is / lwc:dynamic / scoped slots
const src2 = `<template>
  <lwc:component lwc:is={ctor} foo={bar}></lwc:component>
  <x-legacy lwc:dynamic={ctor2}></x-legacy>
  <c-list><template lwc:slot-data="kv"><span>{kv.name}</span></template></c-list>
  <c-x lwc:on={handlers} lwc:external></c-x>
</template>`;
const res2 = parse(src2, { name:'p2', namespace:'c', experimentalDynamicDirective:true, enableDynamicComponents:true, enableLwcOn:true });
console.log('\n=== PROBE 2 ===');
console.log('--- warnings:', JSON.stringify(res2.warnings.map(w => w.message)), '\n');
summarize(res2.root);

// third: no-config call + complex expressions
console.log('\n=== PROBE 3: parse() with no config ===');
try {
  const r3 = parse('<template><div>{x}</div></template>');
  console.log('OK root type:', r3.root.type, 'warnings:', r3.warnings.length);
} catch (e) { console.log('THREW:', e.message); }

console.log('\n=== PROBE 4: complex expressions ===');
const r4 = parse('<template><div title={a ? b : c} onclick={() => go(1)}>{n + 1}</div></template>', { name:'p4', namespace:'c', experimentalComplexExpressions:true });
console.log('warnings:', JSON.stringify(r4.warnings.map(w=>w.message)));
const d = r4.root.children[0];
console.log('attr/prop value node types:', JSON.stringify((d.properties||[]).map(p=>[p.name,p.value.type])), JSON.stringify((d.attributes||[]).map(a=>[a.name,a.value.type])));
console.log('listener handler type:', d.listeners[0].handler.type);
console.log('text child value type:', d.children[0].value.type);
