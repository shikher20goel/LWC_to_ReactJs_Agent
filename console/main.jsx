import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import graph from '../knowledge/graph.json';

/**
 * Migration console.
 *
 * Answers, per component, the five questions a developer actually asks:
 *   1. What does it depend on TODAY?           (Salesforce graph)
 *   2. What does the converted version depend on?  (target graph)
 *   3. What did NOT survive the crossing?      (coverage — edge-level)
 *   4. What did the codemod refuse, and why?   (review items)
 *   5. What does the generated code look like? (source)
 *
 * Question 3 is the one worth building a UI for. A percentage nobody can trace
 * is not useful; "this still depends on platformWorkspaceApi, which has no
 * off-platform equivalent" is.
 */

const KIND = { lwc: 'k-lwc', apex: 'k-apex', base: 'k-base', react: 'k-react', spring: 'k-spring', module: 'k-module' };
const Node = ({ kind, label, muted }) => (
    <div className="node">
        <span className={`k ${KIND[kind] || 'k-base'}`}>{kind}</span>
        <span style={muted ? { color: '#5e6d82' } : undefined}>{label}</span>
    </div>
);

function Sidebar({ items, sel, onSel, q, setQ, filter, setFilter }) {
    const counts = graph.totals;
    return (
        <div className="side">
            <h1>Migration Console
                <small>{counts.components} components · {counts.generated} generated · {counts.lostEdges} lost edges</small>
            </h1>
            <div className="filter">
                <input placeholder="Filter components…" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="chips">
                    {['all', 'clean', 'review', 'escalated'].map((f) => (
                        <span key={f} className={`chip ${filter === f ? 'on' : ''}`}
                            onClick={() => setFilter(f)}>{f}</span>
                    ))}
                </div>
            </div>
            <div className="list">
                {items.map((c) => (
                    <div key={c.name} className={`item ${sel === c.name ? 'sel' : ''}`}
                        onClick={() => onSel(c.name)}>
                        <span className={`dot d-${c.status === 'not-generated' ? 'none' : c.status}`} />
                        <span className="nm">{c.name}</span>
                        <span className={`t t-${c.tier}`}>{c.tier}</span>
                    </div>
                ))}
                {!items.length && <div style={{ padding: 16 }} className="empty">No components match.</div>}
            </div>
        </div>
    );
}

function Dependencies({ c }) {
    const sf = c.salesforce;
    return (
        <div className="grid">
            <div className="card">
                <h3>Salesforce — what exists today</h3>
                <div className="body">
                    <Node kind="lwc" label={c.name} />
                    <div className="indent">
                        {sf.children.map((x) => <Node key={x} kind="lwc" label={x} />)}
                        {sf.baseComponents.map((x) => <Node key={x} kind="base" label={x} />)}
                        {sf.apexClasses.map((x) => <Node key={x} kind="apex" label={x} />)}
                        {sf.wires.map((w) => <Node key={w.module + w.adapter} kind="module" label={`${w.adapter} ← ${w.module}`} />)}
                        {!sf.children.length && !sf.baseComponents.length && !sf.apexClasses.length
                            && !sf.wires.length && <div className="empty">No dependencies.</div>}
                    </div>
                </div>
            </div>

            <div className="card">
                <h3>Target — React / Spring Boot</h3>
                <div className="body">
                    {c.status === 'not-generated'
                        ? <div className="empty">Not generated yet — press Generate.</div>
                        : (
                            <>
                                <Node kind="react" label={`${c.component}.jsx`} />
                                <div className="indent">
                                    {sf.children.map((x) => (
                                        <Node key={x} kind="react"
                                            label={x.replace(/^c-/, '').replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase())} />
                                    ))}
                                    {sf.apexClasses.map((x) => <Node key={x} kind="spring" label={`${x}Service`} />)}
                                    {sf.baseComponents
                                        .filter((b) => !c.coverage.lost.some((l) => l.edge === `base:${b}`))
                                        .map((b) => <Node key={b} kind="base" label={`shim: ${b}`} muted />)}
                                </div>
                            </>
                        )}
                </div>
            </div>
        </div>
    );
}

function Coverage({ c }) {
    const cov = c.coverage;
    const pct = cov.totalEdges ? Math.round((cov.survived / cov.totalEdges) * 100) : 100;
    return (
        <>
            <div className="card" style={{ marginBottom: 16 }}>
                <h3>Dependency coverage — which edges survived</h3>
                <div className="body">
                    <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                    <div className="kv"><span>Dependencies today</span><b>{cov.totalEdges}</b></div>
                    <div className="kv"><span>Carried across</span><b>{cov.survived}</b></div>
                    <div className="kv"><span>Not carried across</span><b>{cov.lostEdges}</b></div>
                    <p style={{ fontSize: 12, color: '#5e6d82', marginBottom: 0 }}>
                        Edge-level, not line-level. “80% of lines converted” is not
                        actionable; a named dependency that did not survive is.
                    </p>
                </div>
            </div>

            {cov.lost.map((l) => (
                <div className="lost" key={l.edge}>
                    <b>{l.edge}</b> — {l.why}
                </div>
            ))}

            {!cov.lost.length && (
                <div className="card">
                    <h3>Nothing lost</h3>
                    <div className="body">Every Salesforce dependency has a target equivalent.</div>
                </div>
            )}
        </>
    );
}

function Logic({ c }) {
    if (!c.todos.length) {
        return (
            <div className="card"><h3>Converted with no review items</h3>
                <div className="body">
                    Every construct in this component had a deterministic mapping.
                    The oracle still decides whether it behaves the same — see the
                    differential test.
                </div>
            </div>
        );
    }
    const refusal = (k) => k === 'tier-h' || k === 'platform-escalate';
    return (
        <>
            <div className="banner">
                <b>Refusals are not gaps.</b> A <code>tier-h</code> or
                <code> platform-escalate</code> item means the codemod declined to emit
                something plausible and wrong. Those need a product decision, not a
                better converter.
            </div>
            {c.todos.map((t, i) => (
                <div key={i} className={`todo ${refusal(t.kind) ? 'esc' : ''}`}>
                    <div className="kd">{t.kind}</div>{t.detail}
                </div>
            ))}
        </>
    );
}

function Source({ c, code, onLoad }) {
    useEffect(() => { onLoad(); }, [c.name]);   // eslint-disable-line react-hooks/exhaustive-deps
    if (c.status === 'not-generated') return <div className="empty">Not generated yet.</div>;
    return <pre>{code || 'Loading…'}</pre>;
}

function App() {
    const [sel, setSel] = useState(graph.components[0]?.name);
    const [tab, setTab] = useState('deps');
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState('all');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const items = useMemo(() => graph.components.filter((c) =>
        (filter === 'all' || c.status === filter)
        && c.name.toLowerCase().includes(q.toLowerCase())), [q, filter]);

    const c = graph.components.find((x) => x.name === sel);

    async function loadCode() {
        if (!c || c.status === 'not-generated') return;
        setCode('');
        try {
            const r = await fetch(`/api/source/${c.name}`);
            setCode(r.ok ? await r.text() : `Could not load source (${r.status}).`);
        } catch (e) { setCode(String(e)); }
    }

    async function generate() {
        setBusy(true); setMsg('');
        try {
            const r = await fetch('/api/generate', { method: 'POST' });
            const j = await r.json();
            setMsg(j.ok
                ? `Regenerated ${j.total ?? ''} component(s). Reload to see updated graph.`
                : `Generation reported problems — ${j.error || 'see terminal'}`);
        } catch (e) { setMsg(String(e)); }
        setBusy(false);
    }

    if (!c) return <div style={{ padding: 24 }}>No components. Run <code>npm run graph</code>.</div>;

    return (
        <>
            <Sidebar items={items} sel={sel} onSel={setSel} q={q} setQ={setQ}
                filter={filter} setFilter={setFilter} />
            <div className="main">
                <div className="hd">
                    <h2>{c.name}</h2>
                    <span className={`t t-${c.tier}`}>Tier {c.tier}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        <button className="btn" onClick={generate} disabled={busy}>
                            {busy ? 'Generating…' : 'Generate'}
                        </button>
                        <button className="btn ghost" onClick={() => window.location.reload()}>Reload</button>
                    </div>
                </div>
                <div className="sub">
                    → {c.component}.jsx · status <b>{c.status}</b>
                    {c.tierReasons?.length ? ` · ${c.tierReasons.join(', ')}` : ''}
                    {msg ? ` — ${msg}` : ''}
                </div>

                <div className="tabs">
                    {[['deps', 'Dependencies'], ['cov', 'Coverage'], ['logic', 'What converted'], ['src', 'Generated code']]
                        .map(([k, label]) => (
                            <div key={k} className={`tab ${tab === k ? 'on' : ''}`}
                                onClick={() => setTab(k)}>{label}</div>
                        ))}
                </div>

                {tab === 'deps' && <Dependencies c={c} />}
                {tab === 'cov' && <Coverage c={c} />}
                {tab === 'logic' && <Logic c={c} />}
                {tab === 'src' && <Source c={c} code={code} onLoad={loadCode} />}
            </div>
        </>
    );
}

createRoot(document.getElementById('root')).render(<App />);
