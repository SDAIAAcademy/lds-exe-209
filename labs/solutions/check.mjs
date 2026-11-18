// Verifies the labs of LDS-EXE-209. Node 20 or later, no dependency. From the repository root:
//   node labs/solutions/check.mjs                      the course files and the reference answers
//   node labs/solutions/check.mjs --log <your log.csv>  a team's decision log against the procedure
//   node labs/solutions/check.mjs --facts <sheet.csv>   a fact sheet: categories and evidence filled
// It prints paths relative to the labs folder only, and never stops on an empty template.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const labs = join(dirname(fileURLToPath(import.meta.url)), '..');
const show = (p) => relative(labs, p).split('\\').join('/') || '.';
let failures = 0;
const ok = (cond, what) => { console.log((cond ? 'PASS ' : 'FAIL ') + what); if (!cond) failures++; };

function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const [h, ...b] = rows;
  return b.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] || '').trim()])));
}
const readCsv = (p) => parseCsv(readFileSync(p, 'utf8'));
const file = (rel) => join(labs, rel);

// ---------- a decision log against the case's procedure ----------
const DECIDER = [
  // [pattern in the decision, role that must decide]
  [/استئناف|رفع الحجب/, 'التنفيذي المسؤول'],
  [/^تصنيف م[12]/, 'التنفيذي المسؤول'],
  [/إشعار الجهة المختصة|الرد على رسالة الجهة المختصة|إشعار أصحاب البيانات/, 'التنفيذي المسؤول'],
  [/^بيان/, 'التنفيذي المسؤول'],
  [/^إيقاف|^تثبيت/, 'قائد الحادثة'],
  [/الهيئة الوطنية للأمن السيبراني/, 'مدير الأمن السيبراني']
];
function checkLog(path, label) {
  const rows = existsSync(path) ? readCsv(path) : [];
  const filled = rows.filter((r) => r.decision);
  if (!filled.length) { console.log('NOTE ' + label + ': no decision written yet in ' + show(path) + ', nothing to check'); return; }
  let missing = 0, self = 0, wrong = 0, order = 0, prev = -Infinity;
  for (const r of filled) {
    for (const k of ['case_hour', 'decided_by', 'rationale', 'facts_known_then', 'severity_then']) if (!r[k]) { missing++; console.log('  ' + r.entry + ': empty ' + k); }
    if (r.proposed_by && r.proposed_by !== '-' && r.proposed_by === r.decided_by) { self++; console.log('  ' + r.entry + ': proposed and decided by the same role (' + r.decided_by + ')'); }
    for (const [re, role] of DECIDER) if (re.test(r.decision) && r.decided_by && r.decided_by !== role) { wrong++; console.log('  ' + r.entry + ': the procedure gives this decision to ' + role + ', not ' + r.decided_by); break; }
    const h = parseFloat(r.case_hour);
    if (!Number.isNaN(h)) { if (h < prev) order++; prev = h; }
  }
  ok(missing === 0, label + ': every line has its hour, decider, rationale, facts known and severity');
  ok(self === 0, label + ': no role decides what it proposed');
  ok(wrong === 0, label + ': each decision is taken by the role the procedure names');
  ok(order === 0, label + ': lines are in the order of the case hours');
}
function checkFacts(path, label) {
  const rows = existsSync(path) ? readCsv(path) : [];
  const filled = rows.filter((r) => r.statement);
  if (!filled.length) { console.log('NOTE ' + label + ': no statement written yet in ' + show(path) + ', nothing to check'); return; }
  const bad = filled.filter((r) => !['confirmed', 'assumption', 'open'].includes(r.category));
  const noEv = filled.filter((r) => r.category === 'confirmed' && !r.evidence);
  ok(bad.length === 0, label + ': every statement is confirmed, assumption or open' + (bad.length ? ' (' + bad.map((r) => r.id).join(', ') + ')' : ''));
  ok(noEv.length === 0, label + ': every confirmed statement names its evidence' + (noEv.length ? ' (' + noEv.map((r) => r.id).join(', ') + ')' : ''));
  const counts = ['confirmed', 'assumption', 'open'].map((c) => c + ' ' + filled.filter((r) => r.category === c).length).join(', ');
  console.log('  ' + counts);
}

const args = process.argv.slice(2);
const ix = (flag) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : null; };
if (ix('--log') || ix('--facts')) {
  if (ix('--log')) checkLog(ix('--log'), 'your log');
  if (ix('--facts')) checkFacts(ix('--facts'), 'your fact sheet');
  process.exit(failures ? 1 : 0);
}

// ---------- 1. the files are what the generator writes ----------
const gen = spawnSync(process.execPath, [file('_tools/build_files.mjs'), '--check'], { encoding: 'utf8' });
ok(gen.status === 0, 'the committed files match the generator' + (gen.status ? ': ' + gen.stdout.trim() : ''));

// ---------- 2. the numbers of lab 1.1, recomputed from the files ----------
const minhal = readFileSync(file('files/minhal_traces.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const unsafe = (x) => x.answer.startsWith('محجوب في ملفات المقرر');
const drain = (x) => /مسدود|تصرّف/.test(x.question);
const on = (v) => minhal.filter((x) => x.model === v);
const u42 = on('ostr-chat-4.2').filter(unsafe).length;
ok(on('ostr-chat-4.1').filter(unsafe).length === 0, 'no unsafe answer on ostr-chat-4.1 (' + on('ostr-chat-4.1').length + ' traces)');
ok(u42 === 36, 'unsafe answers on ostr-chat-4.2: ' + u42 + ' of ' + on('ostr-chat-4.2').filter(drain).length + ' drain questions');
ok(minhal.filter(unsafe).every((x) => x.spans.some((s) => s.name === 'safety_filter' && s.result === 'pass')), 'the provider filter passed every unsafe answer');
const mails = JSON.parse(readFileSync(file('files/muqtani_inbox.json'), 'utf8'));
const look = mails.filter((m) => m.from.endsWith('@jazl-om-billing.example'));
ok(look.length === 2 && look[1].t_min - look[0].t_min === 72 * 60, 'two emails from the lookalike domain, 72 hours apart (' + look.map((m) => m.id).join(', ') + ')');
ok(look.filter((m) => m.hidden_white_text).length === 1, 'one of them carries hidden text');
const gw = readCsv(file('files/mail_gateway_log.csv'));
const out = gw.filter((g) => g.to_domain === 'jazl-om-billing.example');
ok(out.length === 2 && out.every((g) => g.status === 'delivered'), 'two deliveries to the lookalike domain: ' + out.map((g) => g.attachment).join(', '));
const bk = readCsv(file('files/sandbox_outbox/bookings_reconciliation.csv'));
const assisted = bk.filter((b) => b.assisted_pickup === 'نعم').length;
const mobility = bk.filter((b) => b.assisted_reason === 'إعاقة حركية').length;
ok(bk.length === 1284 && Object.keys(bk[0]).length === 9, 'the bookings attachment: ' + bk.length + ' rows, ' + Object.keys(bk[0]).length + ' fields');
ok(assisted === 98 && mobility === 55, 'assisted pickups ' + assisted + ', of which a mobility disability ' + mobility);
ok(readCsv(file('files/sandbox_outbox/supplier_contacts.csv')).length === 14, 'the earlier attachment: 14 supplier contacts');
const rq = readCsv(file('files/review_queue.csv'));
ok(rq.every((w) => w.sampled === '0'), 'no weekly sample was drawn (' + rq.reduce((a, w) => a + +w.replies_sent_in_inbox_extract, 0) + ' replies sent in the two weeks)');

// ---------- 3. the reference answers ----------
const facts = readCsv(file('solutions/reference/fact_sheet_reference.csv'));
ok(facts.some((f) => f.statement.includes('36 ')) && facts.some((f) => f.statement.includes('1,284')) && facts.some((f) => f.statement.includes(' 55 ')), 'the reference fact sheet quotes 36, 1,284 and 55');
checkFacts(file('solutions/reference/fact_sheet_reference.csv'), 'reference fact sheet');
checkLog(file('solutions/reference/decision_log_reference.csv'), 'reference log');
const log = readCsv(file('solutions/reference/decision_log_reference.csv'));
const hourOf = (re) => { const r = log.find((x) => re.test(x.decision)); return r ? parseFloat(r.case_hour) : NaN; };
ok(hourOf(/^إشعار الجهة المختصة|^الرد على رسالة الجهة المختصة/) <= 92 && hourOf(/^الرد على رسالة الجهة المختصة/) <= 92, 'the competent authority is notified before hour 92 (awareness 20 + 72)');
ok(hourOf(/^إشعار جَزْل/) <= 44, 'Jazl is notified within 24 hours of hour 20');
ok(hourOf(/^إبلاغ رئيس مجلس الإدارة/) <= 45, 'the board chair is told within 24 hours of the S1 classification at hour 21');
ok(hourOf(/^إشعار «أوسترالِس»/) <= 48, 'Ostralis is told within 48 hours');
const evidence = log.find((x) => /حفظ الأدلة/.test(x.decision) && x.phase === '2');
const pause = log.find((x) => /^إيقاف «مُقتَني»/.test(x.decision));
ok(evidence && pause && parseFloat(evidence.case_hour) <= parseFloat(pause.case_hour) + 0.01, 'evidence is preserved no later than the pause of the agent');
const notif = readCsv(file('solutions/reference/notification_table_reference.csv'));
ok(['سدايا', 'أصحاب البيانات', 'الهيئة الوطنية للأمن السيبراني', 'جَزْل', 'أوسترالِس', 'رئيس مجلس الإدارة'].every((k) => notif.some((n) => n.recipient.includes(k))), 'the notification table names the six recipients');
ok(notif.every((n) => n.trigger && n.deadline_type && n.owner), 'each notification has a trigger, a deadline type and an owner');
// blank templates do not stop the checks
checkLog(file('files/decision_log.csv'), 'blank decision log');
checkFacts(file('files/fact_sheet.csv'), 'blank fact sheet');

// ---------- 4. the sandbox page ----------
const page = readFileSync(file('tools/sandbox.html'), 'utf8');
const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
let compiles = true;
try { new Function(script); } catch (e) { compiles = false; console.log('  ' + e.message); }
ok(compiles, 'the sandbox script compiles');
const data = JSON.parse(script.slice(script.indexOf('const DATA = ') + 13, script.indexOf(';\nconst $')));
ok(data.minhal.length === minhal.length && data.mails.length === mails.length && data.gateway.length === gw.length, 'the sandbox holds the same traces, mail and gateway lines as the files');
ok(data.minhal.every((x) => !('answer_kind' in x)), 'the sandbox carries no answer label');

console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
