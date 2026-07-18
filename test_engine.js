#!/usr/bin/env node
/**
 * test_engine.js — behavioural conformance tests for the viewer engine.
 *
 * Requires ./engine.js — the same file index.html loads — so the CI hits the
 * code the public demo executes, not a parallel reimplementation.
 *
 * Layers:
 *  1. FIXTURES  Every sampleQuery in <dataDir>/*.json is executed.
 *               getValidVersions is compared as a SET (order is not part of
 *               the contract); getItemHistory as an ORDERED list.
 *  2. BOUNDARY  For every Action that terminates v_old and produces v_new on
 *               the same Item, the engine is probed with full RFC 3339
 *               timestamps at:
 *                 t = start(v_new)      -> v_new IN, v_old OUT
 *                 t - 1s                -> v_old IN, v_new OUT
 *                 t + 1ms               -> v_new IN, v_old OUT
 *               and the probe at t is repeated with equivalent offset
 *               representations (-03:00 and +01:00), which must yield an
 *               identical result set.
 *  3. INPUT     parseQueryInstant accepts YYYY-MM-DD and offset-qualified
 *               RFC 3339 (incl. milliseconds and leap days), and throws on:
 *               offset-less date-times, impossible dates, and garbage.
 *
 * Usage: node test_engine.js [dataDir]     (default: data)
 * Exit:  0 on success, 1 on any failure.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseQueryInstant, getValidVersions, getItemHistory } =
  require(path.join(__dirname, 'engine.js'));

const dataDir = process.argv[2] || 'data';
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error(`nenhum .json em ${dataDir}`);
  process.exit(1);
}

let pass = 0;
const failures = [];
const ok = () => pass++;
const fail = msg => failures.push(msg);

const sameSet = (a, b) => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const sameList = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Same instant re-expressed at a given offset in minutes (e.g. -180 -> -03:00). */
const offsetForm = (isoZ, offMin) => {
  const t = new Date(isoZ).getTime();
  const sign = offMin < 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const wall = new Date(t + offMin * 60000).toISOString().slice(0, 19);
  return `${wall}${sign}${hh}:${mm}`;
};

for (const f of files) {
  const ds = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
  const versions = new Map((ds.versions || []).map(v => [v.id, v]));

  // ── Layer 1: fixtures ─────────────────────────────────────────────
  for (const q of ds.sampleQueries || []) {
    const m = /^(getValidVersions|getItemHistory)\('([^']+)'(?:,\s*'([^']+)')?\)$/
      .exec(q.query || '');
    if (!m) { fail(`${f}: sampleQuery não parseável: ${q.query}`); continue; }
    const [, fn, item, at] = m;
    let exp = q.expectedResult || [];
    if (typeof exp === 'string') exp = JSON.parse(exp.replace(/'/g, '"'));
    let got;
    try {
      got = fn === 'getValidVersions'
        ? getValidVersions(item, at, ds).map(v => v.id)
        : getItemHistory(item, ds).map(a => a.id);
    } catch (e) { fail(`${f}: ${q.query} lançou ${e.message}`); continue; }
    const same = fn === 'getItemHistory' ? sameList(got, exp) : sameSet(got, exp);
    if (same) ok();
    else fail(`${f}: fixture divergente: ${q.query}\n` +
              `      esperado: ${JSON.stringify(exp)}\n` +
              `      obtido  : ${JSON.stringify(got)}`);
  }

  // ── Layer 2: boundary probes at every transition ──────────────────
  for (const a of ds.actions || []) {
    for (const tid of a.terminatesVersionIds || []) {
      for (const pid of a.producesVersionIds || []) {
        const vOld = versions.get(tid);
        const vNew = versions.get(pid);
        if (!vOld || !vNew || vOld.itemId !== vNew.itemId) continue;

        const item = vNew.itemId;
        const tNew = vNew.validityInterval[0];           // raw RFC 3339 (Z)
        const idsAt = at => getValidVersions(item, at, ds).map(v => v.id);

        const atT = idsAt(tNew);
        if (atT.includes(pid) && !atT.includes(tid)) ok();
        else fail(`${f}: fronteira violada em t=${tNew}\n      obtido: ` +
                  JSON.stringify(atT));

        const tPlus = new Date(new Date(tNew).getTime() + 1).toISOString();
        const atP = idsAt(tPlus);
        if (atP.includes(pid) && !atP.includes(tid)) ok();
        else fail(`${f}: pós-fronteira (t+1ms) violada em ${tPlus}\n      obtido: ` +
                  JSON.stringify(atP));

        const tMinus = new Date(new Date(tNew).getTime() - 1000).toISOString();
        if (new Date(tMinus) >= new Date(vOld.validityInterval[0])) {
          const atM = idsAt(tMinus);
          if (atM.includes(tid) && !atM.includes(pid)) ok();
          else fail(`${f}: pré-fronteira violada em ${tMinus}\n      obtido: ` +
                    JSON.stringify(atM));
        }

        for (const off of [-180, 60]) {                  // -03:00 e +01:00
          const rep = offsetForm(tNew, off);
          if (sameSet(idsAt(rep), atT)) ok();
          else fail(`${f}: representação equivalente divergiu: ${rep} vs ${tNew}`);
        }
      }
    }
  }
}

// ── Layer 3: input contract ─────────────────────────────────────────
const mustAccept = ['2019-11-07', '2019-11-07T00:00:00Z',
  '2019-11-06T21:00:00-03:00', '2019-11-07T00:00:00.500Z', '2020-02-29'];
const mustReject = ['2019-11-07T00:00:00',   // sem offset -> hora local
  '2019-02-30', '2019-02-29', 'not-a-date'];
for (const v of mustAccept) {
  try { parseQueryInstant(v); ok(); }
  catch (e) { fail(`entrada válida rejeitada: ${v} (${e.message})`); }
}
for (const v of mustReject) {
  try { parseQueryInstant(v); fail(`entrada inválida aceita: ${v}`); }
  catch { ok(); }
}

console.log(`test_engine: ${pass} verificações passaram, ${failures.length} falharam`);
for (const msg of failures) console.log('  FALHA', msg);
process.exit(failures.length ? 1 : 0);
