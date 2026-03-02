
"use strict";
// ═══════════════════════════════════════════════════════════════════
//  © 2026 Kaat Claerman — Alle rechten voorbehouden.
//  DataShop CEO — SQL Story Game (Educatieve versie)
//  Ongeautoriseerde reproductie, distributie of aanpassing is
//  verboden zonder schriftelijke toestemming van de auteur.
// ═══════════════════════════════════════════════════════════════════

// ── UTILITY ───────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe getElementById: never returns null — returns a no-op proxy when element missing.
// Prevents crashes on .style / .classList / .textContent on absent DOM elements.
function $(id) {
  const el = document.getElementById(id);
  if (el) return el;
  // Return a harmless proxy object so callers don't need to null-check every time
  const noop = new Proxy({}, {
    get(_, prop) {
      if (prop === 'style')     return new Proxy({}, { set() { return true; } });
      if (prop === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (prop === 'addEventListener') return () => {};
      if (typeof prop === 'string') return typeof {}[prop] === 'function' ? () => {} : '';
      return undefined;
    },
    set() { return true; }
  });
  return noop;
}

// ── Query history for terminal (↑↓ navigation) ──────────────────
const _qHistory = [];
let _qHistIdx = -1;

// ── DOM element cache (avoids repeated getElementById lookups) ──
const EL = {};
['free-sql','free-out','free-fb','s-boot','s-game','s-cin',
 'boot-name','tut-ex-sql','sc-list','kpi-rep','sc-search-clear',
 'completion-overlay','chapter-recap-overlay','key-help',
 'key-help-backdrop','set-reset-confirm'].forEach(id => {
  Object.defineProperty(EL, id, { get: () => document.getElementById(id), enumerable: true });
});
function err(msg) { return { ok: false, msg }; }

// Geeft een pedagogische foutmelding zonder de volledige oplossing prijs te geven.
// Verwijdert kant-en-klare queries uit foutmeldingen zodat leerlingen zelf moeten nadenken.
function stripSolution(msg) {
  // Verwijder backtick-code die 3+ SQL-keywords bevat (= volledige query)
  return msg.replace(/`([^`]{20,})`/g, (match, code) => {
    const kws = (code.match(/\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|ADD|COLUMN|GROUP BY|ORDER BY|HAVING|LIMIT|PRIMARY KEY|AUTO_INCREMENT)\b/gi) || []);
    return kws.length >= 3 ? '<code>…</code>' : match;
  });
}

// ── STATE ─────────────────────────────────────────────────────────
const G = {
  name: '',
  xp: 0,
  rep: 100,
  streak: 0,
  done: new Set(),
  ach: new Set(),
  events: [],
  tutDone: new Set(),
  hintsUsedChs: new Set(),
  seenConcepts: new Set(),
  seenKeywords: new Set(),
  chRecapSeen: new Set(), // welke hoofdstuk-recaps al getoond
  consecutiveErrors: 0,  // reeks reset pas na 2 fouten op rij
  xpHistory: [],  // XP earned per session (last 7)
  stepsDone: {},  // multi-step scenario progress: {scenarioId: completedStepCount}
  streakShields: 0,       // Feature 7: shields beschermen de reeks
  weekStreak: 0,          // Feature 7: wekelijkse reeks
  correctThisWeek: 0,     // Feature 7: teller voor shield generatie
};

// ── STORAGE ───────────────────────────────────────────────────────
// ── OPEN SCENARIO HERSTEL ────────────────────────────────────────
// Sla het laatste open scenario op bij elke wisssel, herstel bij laden
function saveOpenSc(id) {
  try { localStorage.setItem('datashop_opensc', id || ''); } catch(e) {}
}
function loadOpenSc() {
  try { return localStorage.getItem('datashop_opensc') || ''; } catch(e) { return ''; }
}

function save() {
  try {
    localStorage.setItem('datashop_v3', JSON.stringify({
      name: G.name, xp: G.xp, rep: G.rep, streak: G.streak,
      done: [...G.done], ach: [...G.ach],
      tutDone: [...G.tutDone],
      hintsUsedChs: [...G.hintsUsedChs],
      seenConcepts: [...G.seenConcepts],
      seenKeywords: G.seenKeywords ? [...G.seenKeywords] : [],
      xpHistory: G.xpHistory||[],
      chRecapSeen:  [...G.chRecapSeen],
      stepsDone: G.stepsDone || {},
      streakShields: G.streakShields || 0,
      weekStreak: G.weekStreak || 0,
      correctThisWeek: G.correctThisWeek || 0,
    }));
  } catch(e) { /* localStorage unavailable (private mode etc.) */ }
}

function load() {
  try {
    const raw = localStorage.getItem('datashop_v3');
    if (!raw) return false;
    const d = JSON.parse(raw);
    G.name    = d.name   || '';
    G.xp      = d.xp     || 0;
    G.rep     = d.rep    ?? 100;
    G.streak  = d.streak || 0;
    G.done    = new Set(d.done    || []);
    G.ach     = new Set(d.ach     || []);
    G.tutDone      = new Set(d.tutDone      || []);
    G.hintsUsedChs = new Set(d.hintsUsedChs || []);
    G.seenConcepts = new Set(d.seenConcepts || []);
    G.seenKeywords = new Set(d.seenKeywords || []);
    G.chRecapSeen  = new Set(d.chRecapSeen  || []);
    G.stepsDone    = d.stepsDone || {};
    G.streakShields   = d.streakShields   || 0;
    G.weekStreak      = d.weekStreak      || 0;
    G.correctThisWeek = d.correctThisWeek || 0;
    return !!G.name;
  } catch(e) { return false; }
}

// ── DATABASE ──────────────────────────────────────────────────────
const DB = {
  klant: {
    cols: [
      {n:'klant_id',t:'INT',pk:true},
      {n:'naam',t:'VARCHAR(100)',nn:true},
      {n:'email',t:'VARCHAR(150)',uq:true},
      {n:'stad',t:'VARCHAR(80)'},
      {n:'actief',t:'BOOLEAN'}
    ],
    rows: [
      {klant_id:1,naam:'Jana Pieters',email:'jana@mail.be',stad:'Gent',actief:1},
      {klant_id:2,naam:'Bram Declercq',email:'bram@shop.be',stad:'Antwerpen',actief:1},
      {klant_id:3,naam:'Lena Maes',email:'lena@web.be',stad:'Brugge',actief:1},
      {klant_id:4,naam:'Kobe Janssen',email:'kobe@net.be',stad:'Leuven',actief:0},
      {klant_id:5,naam:'Fatima El Asri',email:'fatima@shop.be',stad:'Mechelen',actief:1},
      {klant_id:6,naam:'Pieter Wouters',email:null,stad:'Gent',actief:1},
    ], nid: 7
  },
  product: {
    cols: [
      {n:'product_id',t:'INT',pk:true},
      {n:'naam',t:'VARCHAR(100)',nn:true},
      {n:'prijs',t:'DECIMAL(8,2)',nn:true},
      {n:'stock',t:'INT'},
      {n:'categorie',t:'VARCHAR(60)'}
    ],
    rows: [
      {product_id:1,naam:'Draadloze muis',prijs:24.99,stock:15,categorie:'Elektronica'},
      {product_id:2,naam:'USB-C Hub',prijs:49.99,stock:8,categorie:'Elektronica'},
      {product_id:3,naam:'Notitieboek A5',prijs:7.50,stock:42,categorie:'Kantoor'},
      {product_id:4,naam:'Ergonomische stoel',prijs:299.00,stock:3,categorie:'Meubelen'},
      {product_id:5,naam:'Webcam HD',prijs:79.99,stock:0,categorie:'Elektronica'},
      {product_id:6,naam:'Koffiekop 350ml',prijs:12.50,stock:25,categorie:'Keuken'},
      {product_id:7,naam:'Laptop sleeve 15"',prijs:34.99,stock:0,categorie:'Elektronica'},
    ], nid: 8
  },
  bestelling: {
    cols: [
      {n:'bestelling_id',t:'INT',pk:true},
      {n:'klant_id',t:'INT',fk:true},
      {n:'product_id',t:'INT',fk:true},
      {n:'datum',t:'DATE',nn:true},
      {n:'aantal',t:'INT'},
      {n:'status',t:'VARCHAR(30)'}
    ],
    rows: [
      {bestelling_id:1,klant_id:1,product_id:1,datum:'2024-11-10',aantal:2,status:'geleverd'},
      {bestelling_id:2,klant_id:2,product_id:3,datum:'2024-11-15',aantal:5,status:'onderweg'},
      {bestelling_id:3,klant_id:1,product_id:4,datum:'2024-11-20',aantal:1,status:'verwerking'},
      {bestelling_id:4,klant_id:5,product_id:2,datum:'2024-12-03',aantal:1,status:'onderweg'},
    ], nid: 5
  },
  review: {
    cols: [
      {n:'review_id',t:'INT',pk:true},
      {n:'klant_id',t:'INT',fk:true},
      {n:'product_id',t:'INT',fk:true},
      {n:'score',t:'INT'},
      {n:'commentaar',t:'VARCHAR(255)'}
    ],
    rows: [
      {review_id:1,klant_id:1,product_id:1,score:5,commentaar:'Uitstekende muis!'},
      {review_id:2,klant_id:2,product_id:3,score:4,commentaar:'Goed papier.'},
      {review_id:3,klant_id:3,product_id:2,score:2,commentaar:'Hub werkt niet op Mac.'},
      {review_id:4,klant_id:1,product_id:4,score:5,commentaar:'Zeer comfortabel.'},
    ], nid: 5
  },
  kortingscode: {
    cols: [
      {n:'code_id',t:'INT',pk:true},
      {n:'code',t:'VARCHAR(20)',uq:true},
      {n:'korting',t:'INT'},
      {n:'actief',t:'BOOLEAN'},
      {n:'gebruik',t:'INT'}
    ],
    rows: [
      {code_id:1,code:'WELKOM10',korting:10,actief:1,gebruik:42},
      {code_id:2,code:'ZOMER20',korting:20,actief:0,gebruik:7},
      {code_id:3,code:'TROUW15',korting:15,actief:1,gebruik:3},
      {code_id:4,code:'FOUT999',korting:99,actief:1,gebruik:0},
    ], nid: 5
  },
};

// Deep-clone the initial database so it can be reset at any time
const DB_INITIAL = JSON.parse(JSON.stringify(DB));

function resetDB() {
  const fresh = JSON.parse(JSON.stringify(DB_INITIAL));
  for (const k of Object.keys(DB)) { if (!fresh[k]) delete DB[k]; }
  for (const [k,v] of Object.entries(fresh)) { DB[k] = v; }
  // Re-add any tables created by CREATE TABLE missions since they won't be in DB_INITIAL
  // (they are handled by the missions themselves before runSQL)
}

function dbStats() {
  const b=DB.bestelling.rows, p=DB.product.rows, k=DB.klant.rows;
  const rev=b.reduce((s,o)=>{const pr=p.find(x=>x.product_id===o.product_id);return s+(pr?pr.prijs*o.aantal:0);},0);
  return {
    klanten:   k.length,
    actief:    k.filter(x=>x.actief).length,
    producten: p.length,
    uitverkocht: p.filter(x=>x.stock===0).length,
    orders:    b.length,
    open:      b.filter(x=>x.status!=='geleverd').length,
    revenue:   rev.toFixed(2),
    avgScore:  DB.review.rows.length
      ? (DB.review.rows.reduce((s,r)=>s+r.score,0)/DB.review.rows.length).toFixed(1)
      : '—',
  };
}

// ── SQL ENGINE ────────────────────────────────────────────────────
function splitTop(str, kw) {
  const parts=[]; let buf='', depth=0;
  for (let i=0; i<str.length; i++) {
    if (str[i]==='(') depth++;
    else if (str[i]===')') depth--;
    if (depth===0 && kw.toUpperCase()==='AND') {
      // Don't split AND that belongs to a BETWEEN ... AND ... expression
      const rest=str.slice(i);
      const andM=rest.match(/^\s+AND\s+/i);
      if (andM) {
        // Check if the buffer ends with a BETWEEN clause (i.e. "col BETWEEN x")
        const isBetween = /\bBETWEEN\s+\S+\s*$/i.test(buf.trimEnd());
        if (!isBetween) { parts.push(buf); buf=''; i+=andM[0].length-1; continue; }
      }
    } else if (depth===0) {
      const rest=str.slice(i);
      const m=rest.match(new RegExp('^\\s+'+kw+'\\s+','i'));
      if (m) { parts.push(buf); buf=''; i+=m[0].length-1; continue; }
    }
    buf+=str[i];
  }
  parts.push(buf);
  return parts.length>1 ? parts : [str];
}

function evalWhere(row, clause) {
  clause=clause.trim();
  if (clause.startsWith('(')&&clause.endsWith(')')) {
    let d=0,ok=true;
    for(let i=0;i<clause.length-1;i++){
      if(clause[i]==='(')d++;
      else if(clause[i]===')'){d--;if(d===0){ok=false;break;}}
    }
    if(ok) clause=clause.slice(1,-1).trim();
  }
  const ands=splitTop(clause,'AND');
  if(ands.length>1) return ands.every(p=>evalWhere(row,p.trim()));
  const ors=splitTop(clause,'OR');
  if(ors.length>1) return ors.some(p=>evalWhere(row,p.trim()));
  let m;
  m=clause.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i); if(m) return row[m[1]]!=null;
  m=clause.match(/^(\w+)\s+IS\s+NULL$/i);        if(m) return row[m[1]]==null;
  m=clause.match(/^(\w+)\s+(NOT\s+LIKE|LIKE)\s+'([^']*)'$/i);
  if(m){const notL=/NOT\s+LIKE/i.test(m[2]),v=String(row[m[1]]||'').toLowerCase(),pat=m[3].toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.');const r=new RegExp('^'+pat+'$').test(v);return notL?!r:r;}
  m=clause.match(/^(\w+)\s+NOT\s+IN\s*\(([^)]+)\)$/i);
  if(m){const rv=row[m[1]];const rn=Number(rv);const vals=m[2].split(',').map(v=>{const t=v.trim().replace(/^'|'$/g,'');return isNaN(Number(t))?t.toLowerCase():Number(t);});return !vals.some(v=>typeof v==='number'?v===rn:v===String(rv||'').toLowerCase());}
  m=clause.match(/^(\w+)\s+IN\s*\(([^)]+)\)$/i);
  if(m){const rv=row[m[1]];const rn=Number(rv);const vals=m[2].split(',').map(v=>{const t=v.trim().replace(/^'|'$/g,'');return isNaN(Number(t))?t.toLowerCase():Number(t);});return vals.some(v=>typeof v==='number'?v===rn:v===String(rv||'').toLowerCase());}
  m=clause.match(/^(\w+)\s+BETWEEN\s+['"]?([^'">\s]+)['"]?\s+AND\s+['"]?([^'">\s]+)['"]?$/i);
  if(m){const rv=row[m[1]],n=Number(rv),lo=Number(m[2]),hi=Number(m[3]);if(!isNaN(n)&&!isNaN(lo)&&!isNaN(hi))return n>=lo&&n<=hi;return String(rv)>=m[2]&&String(rv)<=m[3];}
  m=clause.match(/^(?:\w+\.)?(\w+)\s*(>=|<=|!=|<>|>|<|=)\s*'?([^']*?)'?$/);
  if(m){
    const[,col,op,raw]=m,rv=row[col];
    const cv=typeof rv==='number'&&raw!==''&&!isNaN(Number(raw))?Number(raw):raw;
    // Case-insensitive string comparison for = and !=
    const eq=(a,b)=>typeof a==='string'&&typeof b==='string'?a.toLowerCase()===b.toLowerCase():a==b;
    switch(op){case'=':return eq(rv,cv);case'!=':case'<>':return !eq(rv,cv);case'>':return rv>cv;case'<':return rv<cv;case'>=':return rv>=cv;case'<=':return rv<=cv;}
  }
  return true;
}

function evalWhereJoin(row, clause) {
  clause=clause.trim();
  const ands=splitTop(clause,'AND'); if(ands.length>1) return ands.every(p=>evalWhereJoin(row,p.trim()));
  const ors=splitTop(clause,'OR');   if(ors.length>1)  return ors.some(p=>evalWhereJoin(row,p.trim()));
  const resolve=ref=>{
    let v=row[ref];
    if(v===undefined){const bare=ref.replace(/^\w+\./,'');const k=Object.keys(row).find(k=>k.endsWith('.'+bare));v=k?row[k]:undefined;}
    return v;
  };
  let m;
  // IS NOT NULL / IS NULL support (missing in original)
  m=clause.match(/^([\w.]+)\s+IS\s+NOT\s+NULL$/i); if(m) return resolve(m[1])!=null;
  m=clause.match(/^([\w.]+)\s+IS\s+NULL$/i);        if(m) return resolve(m[1])==null;
  m=clause.match(/^([\w.]+)\s*(=|!=|<>|>|<|>=|<=)\s*([\w.]+)$/);
  if(m){const lv=resolve(m[1]),rv=resolve(m[3]);const eq=(a,b)=>typeof a==='string'&&typeof b==='string'?a.toLowerCase()===b.toLowerCase():a==b;switch(m[2]){case'=':return eq(lv,rv);case'!=':case'<>':return !eq(lv,rv);case'>':return lv>rv;case'<':return lv<rv;case'>=':return lv>=rv;case'<=':return lv<=rv;}}
  m=clause.match(/^([\w.]+)\s*(=|!=|<>|>|<|>=|<=)\s*'?([^']*?)'?$/);
  if(m){const rv2=resolve(m[1]),cv=typeof rv2==='number'&&!isNaN(Number(m[3]))?Number(m[3]):m[3];const eq=(a,b)=>typeof a==='string'&&typeof b==='string'?a.toLowerCase()===b.toLowerCase():a==b;switch(m[2]){case'=':return eq(rv2,cv);case'!=':case'<>':return !eq(rv2,cv);case'>':return rv2>cv;case'<':return rv2<cv;case'>=':return rv2>=cv;case'<=':return rv2<=cv;}}
  return true;
}

function parseVals(str) {
  const vals=[]; let cur='',inStr=false,sc='';
  for(const ch of str){
    if(inStr){if(ch===sc)inStr=false;else cur+=ch;}
    else if(ch==='"'||ch==="'"){inStr=true;sc=ch;}
    else if(ch===','){vals.push(coerce(cur.trim()));cur='';}
    else cur+=ch;
  }
  vals.push(coerce(cur.trim()));
  return vals;
}

function coerce(v) { return v===''||isNaN(Number(v))?v:Number(v); }

function runSQL(rawSql) {
  try {
  // Normalize: strip comments, collapse whitespace, trim
  const s = rawSql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const sl = s.toLowerCase();
  // Subquery support: resolve innermost (SELECT ...) before outer query
  if(sl.startsWith('select'))       return doSelect(s);
  if(sl.startsWith('insert'))       return doInsert(s);
  if(sl.startsWith('update'))       return doUpdate(s);
  if(sl.startsWith('delete'))       return doDelete(s);
  if(sl.startsWith('create table')) return doCreate(s);
  if(sl.startsWith('alter table'))  return doAlter(s);
  if(sl.startsWith('drop'))         return err('DROP verboden — jij bent CEO, geen brandstichter! 🔥');
  return err(stripSolution('Gebruik SELECT, INSERT, UPDATE, DELETE, CREATE TABLE of ALTER TABLE.'));
  } catch(e) {
    console.error('[DataShop] runSQL error:', e);
    return err('Onverwachte fout bij uitvoeren van de query. Controleer je syntax.');
  }
}

// ── SUBQUERY RESOLVER ─────────────────────────────────────────────
function resolveSubqueries(sql) {
  // Resolve scalar subqueries: col OP (SELECT ...) → col OP value
  // Also IN (SELECT ...) → IN (v1,v2,...)
  let out = sql;
  for (let i = 0; i < 5; i++) {
    // Find innermost subquery: allow nested parens inside (for AVG(col), COUNT(*), etc.)
    // Strategy: find "(SELECT" then scan forward counting parens to find the matching ")"
    const startIdx = out.search(/\(\s*SELECT\s/i);
    if (startIdx === -1) break;
    let depth = 0, endIdx = -1;
    for (let j = startIdx; j < out.length; j++) {
      if (out[j] === '(') depth++;
      else if (out[j] === ')') { depth--; if (depth === 0) { endIdx = j; break; } }
    }
    if (endIdx === -1) break;
    const inner = out.slice(startIdx + 1, endIdx).trim(); // without outer parens
    const res = runSQL(inner);
    if (res.ok && res.rows && res.rows.length) {
      const vals = res.rows.map(r => {
        const v = Object.values(r)[0];
        // Don't quote numeric values — so "prijs > 72.71" works, not "prijs > '72.71'"
        if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)))) return String(Number(v));
        return typeof v === 'string' ? `'${v}'` : String(v ?? 'NULL');
      });
      const beforeSubq = out.slice(0, startIdx).trimEnd().toUpperCase();
      const isInContext = /\bNOT\s+IN\s*$/.test(beforeSubq) || /\bIN\s*$/.test(beforeSubq);
      const replacement = isInContext ? `(${vals.join(',')})` : vals[0];
      out = out.slice(0, startIdx) + replacement + out.slice(endIdx + 1);
    } else break;
  }
  return out;
}

function doSelect(sql) {
  // Resolve subqueries first
  if (/\(\s*SELECT/i.test(sql)) sql = resolveSubqueries(sql);
  // Detect ANSI JOIN syntax: INNER JOIN, LEFT JOIN, RIGHT JOIN, JOIN
  if (/\b(INNER|LEFT|RIGHT|CROSS)?\s*JOIN\b/i.test(sql)) return doExplicitJoin(sql);
  // Detect implicit JOIN (comma-separated tables)
  const fm=sql.match(/\bfrom\s+([\w\s,]+?)(?:\s+(?:where|order|limit|group|having)\b|$)/i);
  if(fm&&fm[1].includes(',')) return doJoin(sql)||doSingleSelect(sql);
  return doSingleSelect(sql);
}

// ── EXPLICIT JOIN ENGINE (INNER JOIN / LEFT JOIN / RIGHT JOIN ... ON) ──────
function doExplicitJoin(sql) {
  // Parseer: SELECT kolommen FROM tabel1 [alias] [INNER|LEFT|RIGHT] JOIN tabel2 [alias] ON conditie [JOIN ...] [WHERE ...] [GROUP BY] [HAVING] [ORDER BY] [LIMIT]
  const selM = sql.match(/^select\s+(.*?)\s+from\s+/i);
  if (!selM) return err('Controleer je SELECT ... FROM ... JOIN ... ON syntax.');
  const colStr = selM[1];

  // Extract everything after FROM
  const afterFrom = sql.slice(selM[0].length);

  // Parseer stap voor stap
  let remaining = afterFrom.trim();

  // Parseer eerste tabel + optioneel alias
  const firstTblM = remaining.match(/^(\w+)(?:\s+(\w+))?\s*/i);
  if (!firstTblM) return err('Tafelnaam ontbreekt na FROM.');
  const firstTblName = firstTblM[1].toLowerCase();
  const firstTblAlias = (firstTblM[2] && !/^(inner|left|right|cross|join|where|on|order|group|having|limit)$/i.test(firstTblM[2]))
    ? firstTblM[2].toLowerCase() : firstTblName;

  if (!DB[firstTblName]) return err(`Tabel '${esc(firstTblName)}' bestaat niet. Beschikbaar: ${Object.keys(DB).join(', ')}.`);

  // Advance remaining past table name + alias only (not JOIN keywords that follow)
  const firstTblConsumed = firstTblAlias !== firstTblName
    ? firstTblName.length + 1 + firstTblAlias.length
    : firstTblName.length;
  remaining = remaining.slice(firstTblConsumed).trimStart();

  // Parse JOIN ... ON ... blocks
  const joinSteps = []; // [{joinType, tblName, alias, onLeft, op, onRight}]
  const joinBlockRe = /^(INNER\s+JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|CROSS\s+JOIN|JOIN)\s+(\w+)(?:\s+(\w+))?\s+ON\s+(\S+)\s*(=|!=|<>|<=|>=|<|>)\s*(\S+)\s*/i;
  while (true) {
    const jm = remaining.match(joinBlockRe);
    if (!jm) break;
    const joinType = jm[1].toUpperCase().replace(/\s+/g,' ').includes('LEFT') ? 'LEFT'
                   : jm[1].toUpperCase().includes('RIGHT') ? 'RIGHT'
                   : jm[1].toUpperCase().includes('CROSS') ? 'CROSS' : 'INNER';
    const tblName = jm[2].toLowerCase();
    const rawAlias = jm[3];
    const alias = (rawAlias && !/^(on|where|inner|left|right|join|group|order|having|limit)$/i.test(rawAlias))
      ? rawAlias.toLowerCase() : tblName;
    const onLeft = jm[4], op = jm[5], onRight = jm[6];
    if (!DB[tblName]) return err(`Tabel '${esc(tblName)}' bestaat niet in JOIN.`);
    joinSteps.push({joinType, tblName, alias, onLeft, op, onRight});
    remaining = remaining.slice(jm[0].length);
  }

  if (!joinSteps.length) return err('JOIN-syntax fout. Gebruik: tabel1 INNER JOIN tabel2 ON tabel1.sleutel = tabel2.sleutel');

  // Parseer optionele clausules (WHERE / GROUP BY / HAVING / ORDER BY / LIMIT)
  let where=null, grpBy=null, having=null, orderBy=null, limit=null;
  let rm = remaining.trim();

  const whereM = rm.match(/^where\s+(.+?)(?:\s+(?:group\s+by|order\s+by|having|limit)\b|$)/i);
  if (whereM) { where = whereM[1].trim(); rm = rm.slice(whereM[0].length).trim(); }
  const grpM = rm.match(/^group\s+by\s+(\w+)/i);
  if (grpM) { grpBy = grpM[1]; rm = rm.slice(grpM[0].length).trim(); }
  const havM = rm.match(/^having\s+(.+?)(?:\s+(?:order\s+by|limit)\b|$)/i);
  if (havM) { having = havM[1].trim(); rm = rm.slice(havM[0].length).trim(); }
  const ordM = rm.match(/^order\s+by\s+(\S+)(?:\s+(asc|desc))?/i);
  if (ordM) { orderBy = ordM[1] + (ordM[2] ? ' '+ordM[2] : ''); rm = rm.slice(ordM[0].length).trim(); }
  const limM = rm.match(/^limit\s+(\d+)/i);
  if (limM) { limit = Number(limM[1]); }

  // Resolve column reference: "alias.col" or "col" → row value
  function resolveCol(ref, row) {
    if (row[ref] !== undefined) return row[ref];
    const bare = ref.replace(/^\w+\./, '');
    const key = Object.keys(row).find(k => k === bare || k.endsWith('.'+bare));
    return key !== undefined ? row[key] : undefined;
  }

  // Evaluate ON condition: left op right (both column refs)
  function evalOn(row, leftRef, op, rightRef) {
    const lv = resolveCol(leftRef, row);
    const rv = resolveCol(rightRef, row);
    switch(op) {
      case '=':  return lv == rv;
      case '!=': case '<>': return lv != rv;
      case '>':  return lv > rv;
      case '<':  return lv < rv;
      case '>=': return lv >= rv;
      case '<=': return lv <= rv;
    }
    return false;
  }

  // Prefix all columns with alias
  function prefixRow(r, alias) {
    const o = {};
    Object.keys(r).forEach(k => { o[alias+'.'+k] = r[k]; o[k] = r[k]; });
    return o;
  }

  // Start with first table
  let rows = DB[firstTblName].rows.map(r => prefixRow(r, firstTblAlias));

  // Apply each JOIN step
  for (const step of joinSteps) {
    const rightRows = DB[step.tblName].rows;
    const newRows = [];
    for (const leftRow of rows) {
      const matches = rightRows.filter(rr => {
        const combined = {...leftRow, ...prefixRow(rr, step.alias)};
        return evalOn(combined, step.onLeft, step.op, step.onRight);
      });
      if (matches.length > 0) {
        matches.forEach(rr => newRows.push({...leftRow, ...prefixRow(rr, step.alias)}));
      } else if (step.joinType === 'LEFT') {
        // LEFT JOIN: include left row with NULLs for right side
        const nullRight = {};
        DB[step.tblName].cols.forEach(c => { nullRight[step.alias+'.'+c.n] = null; nullRight[c.n] = null; });
        newRows.push({...leftRow, ...nullRight});
      }
      // RIGHT JOIN en CROSS JOIN: vereenvoudigd — CROSS heeft geen ON-conditie nodig
    }
    rows = newRows;
  }

  // Apply WHERE filter
  if (where) {
    let whereErr = null;
    rows = rows.filter(r => {
      try { return evalWhereJoin(r, where); } catch(e) { whereErr = e; return false; }
    });
    if (whereErr) return err(`Ongeldige WHERE-conditie: ${esc(where)}. Controleer kolomnamen.`);
  }

  // Apply GROUP BY + COUNT(*) / aggregates + HAVING
  if (grpBy) {
    const grpKey = grpBy.replace(/^\w+\./, '');
    const grps = {};
    rows.forEach(r => {
      const k = resolveCol(grpBy, r) ?? resolveCol(grpKey, r) ?? 'NULL';
      if (!grps[k]) grps[k] = [];
      grps[k].push(r);
    });
    // Build result rows with aggregates
    const colParts = colStr.split(',').map(c => c.trim());
    rows = Object.entries(grps).map(([k, grpRows]) => {
      const out = {};
      colParts.forEach(p => {
        const cntM = p.match(/count\s*\(\s*\*\s*\)/i);
        const aggM = p.match(/^(AVG|SUM|MAX|MIN)\s*\(\s*(\S+?)\s*\)(?:\s+as\s+(\w+))?$/i);
        const aliasM = p.match(/^(\S+)\s+as\s+(\w+)$/i);
        if (cntM) {
          out['COUNT(*)'] = grpRows.length;
        } else if (aggM) {
          const fn = aggM[1].toUpperCase(), col = aggM[2], alias = aggM[3];
          const vals = grpRows.map(r => Number(resolveCol(col,r))).filter(v => !isNaN(v));
          let v;
          switch(fn) {
            case 'AVG': v = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null; break;
            case 'SUM': v = vals.reduce((a,b)=>a+b,0).toFixed(2); break;
            case 'MAX': v = vals.length ? Math.max(...vals) : null; break;
            case 'MIN': v = vals.length ? Math.min(...vals) : null; break;
          }
          out[alias || `${fn}(${col})`] = v;
        } else {
          const bare = p.replace(/^\w+\./, '');
          const alias = aliasM ? aliasM[2] : null;
          out[alias || bare] = resolveCol(p, grpRows[0]) ?? resolveCol(bare, grpRows[0]) ?? k;
        }
      });
      return out;
    });

    // HAVING filter
    if (having) {
      const hm = having.match(/count\s*\(\s*\*\s*\)\s*(>|<|>=|<=|=|!=)\s*(\d+)/i);
      if (hm) {
        const op = hm[1], n = Number(hm[2]);
        rows = rows.filter(r => {
          const v = r['COUNT(*)'];
          switch(op){ case'>':return v>n; case'<':return v<n; case'>=':return v>=n; case'<=':return v<=n; case'=':return v==n; case'!=':return v!=n; }
          return true;
        });
      }
    }
  } else {
    // Project columns (no GROUP BY)
    if (colStr.trim() !== '*') {
      // Split on commas but NOT inside CASE...END blocks
      function splitColParts(str) {
        const parts = []; let cur = '', depth = 0;
        for (let i = 0; i < str.length; i++) {
          const ahead = str.slice(i).toUpperCase();
          if (/^CASE\b/.test(ahead)) depth++;
          if (/^END\b/.test(ahead) && depth > 0) { depth--; cur += 'END'; i += 2; continue; }
          if (str[i] === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
          cur += str[i];
        }
        if (cur.trim()) parts.push(cur.trim());
        return parts;
      }
      // Evaluate a CASE WHEN ... END expression against a row
      function evalCase(expr, row) {
        const norm = expr.replace(/\s+/g,' ').trim();
        const branches = [];
        const whenRe = /WHEN\s+(.*?)\s+THEN\s+'([^']*)'/gi;
        let wm;
        while ((wm = whenRe.exec(norm)) !== null) branches.push({ cond: wm[1], val: wm[2] });
        const elseM = norm.match(/ELSE\s+'([^']*)'/i);
        const elseVal = elseM ? elseM[1] : null;
        for (const b of branches) { try { if (evalWhere(row, b.cond)) return b.val; } catch(e) {} }
        return elseVal;
      }
      const colParts = splitColParts(colStr);
      rows = rows.map(r => {
        const o = {};
        colParts.forEach(p => {
          // CASE WHEN ... END [AS alias]
          const caseM = p.match(/^(CASE\s+.*?END)\s*(?:AS\s+(\w+))?$/i);
          if (caseM) { o[caseM[2] || 'case'] = evalCase(caseM[1], r); return; }
          const aliasM = p.match(/^(\S+)\s+as\s+(\w+)$/i);
          const ref = aliasM ? aliasM[1] : p;
          const alias = aliasM ? aliasM[2] : p.replace(/^\w+\./, '');
          o[alias] = resolveCol(ref, r) ?? resolveCol(ref.replace(/^\w+\./, ''), r);
        });
        return o;
      });
    }
  }

  // ORDER BY
  if (orderBy) {
    const [col, dir] = orderBy.trim().split(/\s+/);
    const bare = col.replace(/^\w+\./, '');
    const asc = !dir || dir.toUpperCase() === 'ASC';
    rows.sort((a,b) => {
      const av = a[bare]??a[col], bv = b[bare]??b[col];
      if(av<bv) return asc?-1:1; if(av>bv) return asc?1:-1; return 0;
    });
  }

  // LIMIT
  if (limit) rows = rows.slice(0, limit);

  return {ok:true, type:'select', rows};
}

function doSingleSelect(sql) {
  const m=sql.match(/^select\s+(.*?)\s+from\s+(\w+)(?:\s+(?:as\s+)?\w+)?(?:\s+where\s+(.*?))?(?:\s+group\s+by\s+(\w+))?(?:\s+having\s+(.*?))?(?:\s+order\s+by\s+([\w.]+(?:\s+(?:asc|desc))?))?(?:\s+limit\s+(\d+))?$/i);
  if(!m) return err(stripSolution('Controleer je SELECT-syntax. Voorbeeld: SELECT naam FROM klant WHERE actief = 1'));
  let[,colStr,tbl,where,grpBy,having,orderBy,limit]=m;
  tbl=tbl.toLowerCase();
  if(!DB[tbl]) return err(`Tabel '${esc(tbl)}' bestaat niet. Beschikbaar: ${Object.keys(DB).join(', ')}.`);
  let rows=[...DB[tbl].rows];
  if(where) {
    let whereErr = null;
    rows = rows.filter(r => { try { return evalWhere(r, where.trim()); } catch(e) { whereErr = e; return false; } });
    if (whereErr) return err(`Ongeldige WHERE-conditie: ${esc(where.trim())}. Controleer kolomnamen en syntax.`);
  }

  // Multiple aggregates: SELECT MIN(x), MAX(x), AVG(x), SUM(x), COUNT(*), COUNT(DISTINCT x)
  const multiAggParts = colStr.match(/((?:AVG|SUM|MAX|MIN)\s*\(\s*\w+\s*\)|COUNT\s*\(\s*(?:DISTINCT\s+)?\w+|\*\s*\))/gi);
  if (multiAggParts && multiAggParts.length >= 1 && !grpBy) {
    const resultRow = {};
    for (const part of colStr.split(',')) {
      const p = part.trim();
      const cntDist = p.match(/^COUNT\s*\(\s*DISTINCT\s+(\w+)\s*\)$/i);
      if (cntDist) {
        const col = cntDist[1];
        const uniq = new Set(rows.map(r=>r[col]));
        resultRow['COUNT(DISTINCT '+col+')'] = uniq.size;
      } else {
        const agg = p.match(/^(AVG|SUM|MAX|MIN)\s*\(\s*(\w+)\s*\)$/i);
        if (agg) {
          const fn=agg[1].toUpperCase(), col=agg[2];
          const vals = rows.map(r=>Number(r[col])).filter(v=>!isNaN(v));
          let res;
          switch(fn) {
            case'AVG': res=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2):null; break;
            case'SUM': res=vals.reduce((a,b)=>a+b,0).toFixed(2); break;
            case'MAX': res=vals.length?Math.max(...vals):null; break;
            case'MIN': res=vals.length?Math.min(...vals):null; break;
          }
          resultRow[fn+'('+col+')'] = res;
        } else if (/count\s*\(\s*\*\s*\)/i.test(p)) {
          resultRow['COUNT(*)'] = rows.length;
        }
      }
    }
    if (Object.keys(resultRow).length > 0) return {ok:true,type:'select',rows:[resultRow]};
  }

  if(grpBy) {
    // Full GROUP BY: support COUNT(*), AVG, SUM, MAX, MIN
    const grps = {};
    rows.forEach(r => { const k = r[grpBy] ?? 'NULL'; if (!grps[k]) grps[k] = []; grps[k].push(r); });
    const colParts = colStr.split(',').map(c => c.trim());
    let gRows = Object.entries(grps).map(([k, grpRows]) => {
      const out = {};
      colParts.forEach(p => {
        const aliasM = p.match(/^(.+?)\s+as\s+(\w+)$/i);
        const expr = aliasM ? aliasM[1].trim() : p;
        const label = aliasM ? aliasM[2] : expr;
        if (/^count\s*\(\s*\*\s*\)$/i.test(expr)) {
          out[label] = grpRows.length;
        } else {
          const aggM = expr.match(/^(AVG|SUM|MAX|MIN)\s*\(\s*(\w+)\s*\)$/i);
          if (aggM) {
            const fn = aggM[1].toUpperCase(), col = aggM[2];
            const vals = grpRows.map(r => Number(r[col])).filter(v => !isNaN(v));
            switch(fn) {
              case 'AVG': out[label] = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null; break;
              case 'SUM': out[label] = vals.reduce((a,b)=>a+b,0).toFixed(2); break;
              case 'MAX': out[label] = vals.length ? Math.max(...vals) : null; break;
              case 'MIN': out[label] = vals.length ? Math.min(...vals) : null; break;
            }
          } else {
            // Plain column (the GROUP BY key)
            out[label] = grpRows[0][expr] ?? k;
          }
        }
      });
      return out;
    });
    if(having) {
      // Support: COUNT(*) > n, AVG(col) > n, SUM(col) > n etc
      const hm = having.match(/(count\s*\(\s*\*\s*\)|(?:AVG|SUM|MAX|MIN)\s*\(\s*\w+\s*\))\s*(>|<|>=|<=|=|!=)\s*([\d.]+)/i);
      if(hm) {
        const havExprRaw = hm[1].toUpperCase().replace(/\s+/g,''), op = hm[2], n = Number(hm[3]);
        gRows = gRows.filter(r => {
          // Find matching key: exact match first, then partial, then COUNT(*) fallback
          let key = Object.keys(r).find(k => k.toUpperCase().replace(/\s+/g,'') === havExprRaw);
          if(!key) key = Object.keys(r).find(k => k.toUpperCase().replace(/\s+/g,'').includes(havExprRaw));
          if(!key && havExprRaw.includes('COUNT')) key = Object.keys(r).find(k => k === 'COUNT(*)');
          if(key === undefined) return true;
          const v = Number(r[key]);
          switch(op){case'>':return v>n;case'<':return v<n;case'>=':return v>=n;case'<=':return v<=n;case'=':return v==n;case'!=':return v!=n;}
          return true;
        });
      }
    }
    if(orderBy){const[col2,dir]=orderBy.trim().split(/\s+/);const asc=!dir||dir.toUpperCase()==='ASC';gRows.sort((a,b)=>{const av=a[col2]??a[col2.replace(/^\w+\./,'')],bv=b[col2]??b[col2.replace(/^\w+\./,'')];if(av<bv)return asc?-1:1;if(av>bv)return asc?1:-1;return 0;});}
    if(limit) gRows=gRows.slice(0,Number(limit));
    return {ok:true,type:'select',rows:gRows};
  }
  if(/count\s*\(\s*\*\s*\)/i.test(colStr)){
    return {ok:true,type:'select',rows:[{'COUNT(*)':rows.length}]};
  }

  // DISTINCT support
  const distinctMatch = colStr.match(/^distinct\s+(.*)/i);
  if (distinctMatch) {
    colStr = distinctMatch[1];
    const cols2 = colStr.split(',').map(c=>c.trim().replace(/^\w+\./,''));
    rows = rows.map(r=>{const o={};cols2.forEach(c=>{if(r[c]!==undefined)o[c]=r[c];});return o;});
    const seen2 = new Set();
    rows = rows.filter(r=>{const k=JSON.stringify(r);if(seen2.has(k))return false;seen2.add(k);return true;});
    if(orderBy){const[col,dir]=orderBy.trim().split(/\s+/);const asc=!dir||dir.toUpperCase()==='ASC';rows.sort((a,b)=>{if(a[col]<b[col])return asc?-1:1;if(a[col]>b[col])return asc?1:-1;return 0;});}
    if(limit) rows=rows.slice(0,Number(limit));
    return {ok:true,type:'select',rows,tbl};
  }

  // Parse columns with aliases: col AS alias
  const rawCols = colStr.trim()==='*' ? null : colStr.split(',').map(c=>{
    const parts = c.trim().split(/\s+as\s+/i);
    const raw = parts[0].trim();
    const alias = parts[1]?.trim() || null;
    const bare = raw.replace(/^\w+\./,'');
    return {raw, alias, bare};
  });
  if(rawCols) {
    rows = rows.map(r => {
      const o = {};
      rawCols.forEach(({raw,alias,bare}) => {
        const v = r[bare] !== undefined ? r[bare] : r[raw];
        o[alias || bare] = v;
      });
      return o;
    });
  }
  if(orderBy){
    const[col,dir]=orderBy.trim().split(/\s+/);
    const bare=col.replace(/^\w+\./,'');
    const asc=!dir||dir.toUpperCase()==='ASC';
    rows.sort((a,b)=>{
      const av=a[bare]??a[col], bv=b[bare]??b[col];
      if(av<bv)return asc?-1:1;if(av>bv)return asc?1:-1;return 0;
    });
  }
  if(limit) rows=rows.slice(0,Number(limit));
  return {ok:true,type:'select',rows,tbl};
}

function doJoin(sql) {
  const m=sql.match(/select\s+(.*?)\s+from\s+([\w\s,]+?)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(.+?))?(?:\s+limit\s+(\d+))?$/i);
  if(!m) return null;
  let[,colStr,tblStr,where,orderBy,limit]=m;
  const tbls=tblStr.split(',').map(t=>{const p=t.trim().split(/\s+/);return{name:p[0].toLowerCase(),alias:p[1]||p[0].toLowerCase()};});
  for(const t of tbls) if(!DB[t.name]) return null;
  let rows=DB[tbls[0].name].rows.map(r=>{const o={};Object.keys(r).forEach(k=>o[tbls[0].alias+'.'+k]=r[k]);return o;});
  for(let i=1;i<tbls.length;i++){const t=tbls[i];const nr=[];rows.forEach(ex=>{DB[t.name].rows.forEach(r=>{const c={...ex};Object.keys(r).forEach(k=>c[t.alias+'.'+k]=r[k]);nr.push(c);});});rows=nr;}
  if(where) {
    let whereErr = null;
    rows = rows.filter(r => { try { return evalWhereJoin(r, where); } catch(e) { whereErr = e; return false; } });
    if (whereErr) return err(`Ongeldige WHERE-conditie in JOIN: ${esc(where.trim())}. Controleer kolomnamen (gebruik alias.kolom).`);
  }
  let proj;
  if(colStr.trim()==='*'){proj=rows;}
  else{
    const cols=colStr.split(',').map(c=>{const[raw,al]=c.trim().split(/\s+as\s+/i);return{raw:raw.trim(),al:al||null};});
    proj=rows.map(r=>{const o={};cols.forEach(({raw,al})=>{let v=r[raw];if(v===undefined){const bare=raw.replace(/^\w+\./,'');const key=Object.keys(r).find(k=>k.endsWith('.'+bare));v=key?r[key]:undefined;}o[al||raw.replace(/^\w+\./,'')]=v;});return o;});
  }
  if(orderBy){const[col,dir]=orderBy.trim().split(/\s+/);const asc=!dir||dir.toUpperCase()==='ASC';const bare=col.replace(/^\w+\./,'');proj.sort((a,b)=>{const av=a[bare]??a[col],bv=b[bare]??b[col];if(av<bv)return asc?-1:1;if(av>bv)return asc?1:-1;return 0;});}
  if(limit) proj=proj.slice(0,Number(limit));
  return {ok:true,type:'select',rows:proj};
}

function doInsert(sql) {
  const m=sql.match(/insert\s+into\s+(\w+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
  if(!m) return err(stripSolution('Syntax: INSERT INTO tabel (kolom1, ...) VALUES (waarde1, ...)'));
  const[,tbl,cs,vs]=m,t=DB[tbl.toLowerCase()];
  if(!t) return err(`Tabel '${esc(tbl)}' bestaat niet. Beschikbaar: ${Object.keys(DB).join(', ')}.`);
  const cols=cs.split(',').map(c=>c.trim()),vals=parseVals(vs);
  if(cols.length!==vals.length) return err(`${cols.length} kolommen ≠ ${vals.length} waarden.`);
  const pk=t.cols.find(c=>c.pk);
  const row={};if(pk) row[pk.n]=t.nid++;
  cols.forEach((c,i)=>row[c]=vals[i]);
  for(const col of t.cols.filter(c=>c.nn&&!c.pk)){if(row[col.n]===undefined||row[col.n]==='')return err(`'${esc(col.n)}' mag niet leeg zijn (NOT NULL).`);}
  for(const col of t.cols.filter(c=>c.uq)){if(t.rows.some(r=>r[col.n]===row[col.n]))return err(`'${esc(row[col.n])}' bestaat al in '${esc(col.n)}' (UNIQUE).`);}
  t.rows.push(row);
  UI.addEvent('ok',`INSERT → <strong>${esc(tbl)}</strong>: rij ${row[pk?.n]||''} toegevoegd.`);
  UI.refreshUI();
  return {ok:true,type:'insert',affectedRows:1,rowId:row[pk?.n]};
}

function doUpdate(sql) {
  // Split on the last unquoted WHERE to avoid false splits inside quoted strings
  let tblSetPart=sql, where=null;
  const whereIdx=(function(){
    let inStr=false,sc='',last=-1;
    for(let i=0;i<sql.length-5;i++){
      if(!inStr&&(sql[i]==="'"||sql[i]==='"')){inStr=true;sc=sql[i];}
      else if(inStr&&sql[i]===sc&&sql[i-1]!=='\\')inStr=false;
      else if(!inStr&&/\bwhere\b/i.test(sql.slice(i,i+5))){last=i;}
    }
    return last;
  })();
  if(whereIdx!==-1){where=sql.slice(whereIdx+5).trim();tblSetPart=sql.slice(0,whereIdx).trim();}
  const m2=tblSetPart.match(/^update\s+(\w+)\s+set\s+(.*?)$/i);
  if(!m2) return err(stripSolution('Syntax: UPDATE tabel SET kolom = waarde WHERE conditie'));
  const[,tbl,setStr]=m2,t=DB[tbl.toLowerCase()];
  if(!t) return err(`Tabel '${esc(tbl)}' bestaat niet. Beschikbaar: ${Object.keys(DB).join(', ')}.`);
  if(!where) return err('⚠️ Geen WHERE! Dit zou ALLE rijen aanpassen. Voeg een WHERE-clausule toe.');
  // Parseer SET-toewijzingen — verwerkt ook geciteerde strings met komma's
  // en relatieve expressies zoals col = col + 10 of col = col - 1
  const set={};
  const assignRegex=/(\w+)\s*=\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\S+(?:\s*[+\-\*\/]\s*\S+)?)/gi;
  let am;
  while((am=assignRegex.exec(setStr))!==null){
    const col=am[1], raw=am[2].replace(/^['"]|['"]$/g,'');
    // Detect relative expression: col = col +/- n  (e.g. stock = stock + 10)
    const relExpr=raw.match(/^(\w+)\s*([+\-\*\/])\s*([\d.]+)$/);
    if(relExpr && relExpr[1].toLowerCase()===col.toLowerCase()){
      set[col]={__expr:true,op:relExpr[2],val:Number(relExpr[3])};
    } else {
      set[col]=raw==='true'?1:raw==='false'?0:coerce(raw);
    }
  }
  if(!Object.keys(set).length) return err('Geen geldige SET-toewijzingen gevonden.');
  let n=0;
  t.rows.forEach((r,i)=>{
    try{
      if(evalWhere(r,where.trim())){
        const resolved={};
        for(const[k,v] of Object.entries(set)){
          if(v&&v.__expr){
            const cur=Number(r[k])||0;
            switch(v.op){case'+':resolved[k]=cur+v.val;break;case'-':resolved[k]=cur-v.val;break;case'*':resolved[k]=cur*v.val;break;case'/':resolved[k]=v.val!==0?cur/v.val:cur;break;default:resolved[k]=cur;}
          } else { resolved[k]=v; }
        }
        Object.assign(t.rows[i],resolved);n++;
      }
    }catch(e){}
  });
  UI.addEvent('warn',`UPDATE <strong>${esc(tbl)}</strong>: ${n} rij(en) bijgewerkt.`);
  UI.refreshUI();
  return {ok:true,type:'update',affectedRows:n};
}

function doDelete(sql) {
  const m=sql.match(/delete\s+from\s+(\w+)(?:\s+where\s+(.+))?$/i);
  if(!m) return err(stripSolution('Syntax: DELETE FROM tabel WHERE conditie'));
  const[,tbl,where]=m,t=DB[tbl.toLowerCase()];
  if(!t) return err(`Tabel '${esc(tbl)}' bestaat niet.`);
  if(!where) return err('⚠️ Geen WHERE! Dit zou ALLE rijen verwijderen.');
  const before=t.rows.length;
  let delErr = null;
  t.rows = t.rows.filter(r => { try { return !evalWhere(r, where); } catch(e) { delErr = e; return false; } });
  if (delErr) return err(`Ongeldige WHERE-conditie: ${esc(where.trim())}. Geen rijen verwijderd.`);
  UI.addEvent('err',`DELETE <strong>${esc(tbl)}</strong>: ${before-t.rows.length} rij(en) verwijderd.`);
  UI.refreshUI();
  return {ok:true,type:'delete',affectedRows:before-t.rows.length};
}

function doCreate(sql) {
  const m=sql.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([^)]+)\)/i);
  if(!m) return err('Ongeldige CREATE TABLE syntax.');
  const[,tbl,colDefs]=m,name=tbl.toLowerCase();
  if(DB[name]) return err(`Tabel '${esc(tbl)}' bestaat al.`);
  const cols=colDefs.split(',').map(def=>{def=def.trim();const pts=def.split(/\s+/);const c={n:pts[0],t:pts[1]||'VARCHAR(100)'};if(/primary\s+key/i.test(def)){c.pk=true;c.ai=/auto_increment/i.test(def);}if(/not\s+null/i.test(def))c.nn=true;if(/unique/i.test(def))c.uq=true;return c;}).filter(c=>c.n&&!/^(primary|foreign|constraint|unique|index)/i.test(c.n));
  DB[name]={cols,rows:[],nid:1};
  UI.renderSchema();UI.renderDBTabs();
  UI.addEvent('info',`CREATE TABLE <strong>${esc(tbl)}</strong> aangemaakt.`);
  return {ok:true,type:'ddl',msg:`Tabel '${esc(tbl)}' aangemaakt.`};
}

function doAlter(sql) {
  const m=sql.match(/alter\s+table\s+(\w+)\s+add\s+(?:column\s+)?(\w+)\s+(\S+)/i);
  if(!m) return err(stripSolution('Ondersteund: ALTER TABLE tabel ADD COLUMN kolom datatype'));
  const[,tbl,col,type]=m,t=DB[tbl.toLowerCase()];
  if(!t) return err(`Tabel '${esc(tbl)}' bestaat niet.`);
  if(t.cols.find(c=>c.n===col)) return err(`Kolom '${esc(col)}' bestaat al.`);
  t.cols.push({n:col,t:type});t.rows.forEach(r=>r[col]=null);
  UI.renderSchema();UI.renderCurrentTable();
  UI.addEvent('info',`ALTER TABLE: kolom <strong>${esc(col)}</strong> toegevoegd.`);
  return {ok:true,type:'ddl',msg:`Kolom '${esc(col)}' (${esc(type)}) toegevoegd.`};
}

// ── TABLE RENDERER ────────────────────────────────────────────────
function renderTableHTML(name) {
  const t=DB[name];
  if(!t) return `<div class="table-not-found">Tabel '${esc(name)}' niet gevonden.</div>`;
  const hdrs=t.cols.map(c=>`<th>
    ${c.pk?'<span class="schema-pk-badge">PK</span>':''}
    ${c.fk?'<span class="schema-fk-badge">FK</span>':''}
    ${esc(c.n)} <span class="schema-col-type">${esc(c.t)}</span>
  </th>`).join('');
  const body=t.rows.map(r=>`<tr>${t.cols.map(c=>`<td class="${c.pk?'pk':c.fk?'fk':''}">${r[c.n]==null?'<span class="u-muted">NULL</span>':esc(String(r[c.n]))}</td>`).join('')}</tr>`).join('');
  return `<div class="tv-header"><span class="tv-name">${esc(name)}</span><span class="tv-badge">${t.rows.length} rijen</span></div>
    <div class="tv-scroll"><table class="data-table"><thead><tr>${hdrs}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ── DATA ──────────────────────────────────────────────────────────
// ── FEATURE 2: COACHING FEEDBACK DETECTORS ─────────────────────────
function detectMissingFrom(sql) {
  const s = sql.trim().toLowerCase();
  if (!s.startsWith('select')) return null;
  if (/\bfrom\b/.test(s)) return null;
  return { line1: '✔ Je SELECT is goed, maar je mist een <strong>FROM</strong>-clausule.', line2: '→ Voeg toe: <code>FROM tabelnaam</code> na je kolomnamen.' };
}
function detectMissingGroupBy(sql) {
  const s = sql.trim().toLowerCase();
  if (!/\bhaving\b/.test(s)) return null;
  if (/\bgroup\s+by\b/.test(s)) return null;
  return { line1: '⚠️ <code>HAVING</code> werkt alleen <strong>samen met GROUP BY</strong>.', line2: '→ Voeg <code>GROUP BY kolom</code> toe vóór HAVING.' };
}
function detectJoinWithoutOn(sql) {
  const s = sql.trim().toLowerCase();
  if (!/\bjoin\b/.test(s)) return null;
  if (/\bon\b/.test(s)) return null;
  return { line1: '⚠️ Je hebt een <code>JOIN</code> maar geen <strong>ON</strong>-conditie.', line2: '→ Voeg toe: <code>ON tabel1.id = tabel2.id</code> na elke JOIN.' };
}
function detectUpdateWithoutWhere(sql) {
  const s = sql.trim().toLowerCase();
  if (!s.startsWith('update')) return null;
  if (/\bwhere\b/.test(s)) return null;
  return { line1: '🚨 <strong>UPDATE zonder WHERE</strong> past <em>alle rijen</em> tegelijk aan!', line2: '→ Voeg <code>WHERE kolom = waarde</code> toe om slechts één rij te targeten.' };
}
// Combineer coaching checks — max 2 lijnen tegelijk
function buildCoachFeedback(sql, sc) {
  const detectors = [
    detectMissingFrom,
    detectMissingGroupBy,
    detectJoinWithoutOn,
    detectUpdateWithoutWhere,
  ];
  for (const d of detectors) {
    const r = d(sql);
    if (r) return `<div class="coach-feedback-box"><div class="coach-line">${r.line1}</div><div class="coach-next">${r.line2}</div></div>`;
  }
  return '';
}

// ── FEATURE 3: RESULTAAT-GEBASEERDE VALIDATIE ───────────────────────
// Controleert na een geslaagde check: rijen en kolommen
function validateResult(sql, validation) {
  if (!validation) return null;
  const res = runSQL(sql);
  if (!res.ok || !res.rows) return null;
  const rows = res.rows;
  if (validation.expectedRowCount !== undefined) {
    if (rows.length !== validation.expectedRowCount) {
      return `Resultaat heeft ${rows.length} rij(en), verwacht ${validation.expectedRowCount}. Controleer je WHERE-filter of JOIN.`;
    }
  }
  if (validation.expectedColumns && validation.expectedColumns.length) {
    const resultCols = rows.length ? Object.keys(rows[0]).map(c => c.toLowerCase()) : [];
    const missing = validation.expectedColumns.filter(ec => {
      const ecL = ec.toLowerCase();
      // Tolerant voor aliassen: kijk of kolomnaam of alias voorkomt
      return !resultCols.some(rc => rc === ecL || rc.endsWith('.' + ecL) || rc.includes(ecL));
    });
    if (missing.length) {
      return `Kolom(men) ontbreken in resultaat: <strong>${missing.join(', ')}</strong>. Controleer je SELECT-lijst.`;
    }
  }
  return null; // validatie geslaagd
}

// ── FEATURE 4: SKILL MASTERY ─────────────────────────────────────────
const SKILL_TYPES = [
  { key: 'select',  label: 'SELECT',   color: '#22d3ee' },
  { key: 'where',   label: 'WHERE',    color: '#a78bfa' },
  { key: 'join',    label: 'JOIN',     color: '#f472b6' },
  { key: 'groupby', label: 'GROUP BY', color: '#fbbf24' },
  { key: 'ddl',     label: 'DDL',      color: '#4ade80' },
  { key: 'case',    label: 'CASE',     color: '#fb923c' },
];
const MASTERY_BADGES = [
  { id: 'join_specialist',   label: '🔗 Join Specialist',     skill: 'join',    threshold: 80 },
  { id: 'safe_updater',      label: '🛡️ Safe Updater',        skill: 'update',  threshold: 80 },
  { id: 'agg_master',        label: '📊 Aggregation Master',  skill: 'groupby', threshold: 80 },
  { id: 'case_wizard',       label: '🧙 Case Wizard',         skill: 'case',    threshold: 80 },
];
function skillMastery() {
  const map = {};
  SKILL_TYPES.forEach(st => {
    // Determine which scenarios belong to each skill key
    const matching = SCENARIOS.filter(s => {
      if (st.key === 'select')  return s.sqlType === 'select' && !s.check?.toString().includes('group') && !s.check?.toString().includes('join');
      if (st.key === 'where')   return s.sqlType === 'select' && (s.obj||'').toLowerCase().includes('where');
      if (st.key === 'join')    return s.sqlType === 'join'   || (s.obj||'').toLowerCase().includes('join');
      if (st.key === 'groupby') return (s.obj||'').toLowerCase().includes('group by') || (s.obj||'').toLowerCase().includes('count') || (s.obj||'').toLowerCase().includes('sum') || (s.obj||'').toLowerCase().includes('avg');
      if (st.key === 'ddl')     return s.sqlType === 'ddl';
      if (st.key === 'case')    return (s.obj||'').toLowerCase().includes('case') || s.sqlType === 'case';
      return false;
    });
    const done   = matching.filter(s => G.done.has(s.id));
    const pct    = matching.length ? Math.round(done.length / matching.length * 100) : 0;
    map[st.key] = { done: done.length, total: matching.length, pct };
  });
  return map;
}

// ── FEATURE 7: STREAK SHIELDS ─────────────────────────────────────────
// earnStreakShield: called from runSc() on correct answer
function earnStreakShield() {
  G.correctThisWeek = (G.correctThisWeek || 0) + 1;
  if (G.correctThisWeek >= 7) {
    G.streakShields = Math.min(3, (G.streakShields || 0) + 1);
    G.correctThisWeek = 0;
    UI.addEvent('info', `🛡️ Streak Shield verdiend! Je hebt er nu ${G.streakShields}.`);
  }
}
// useStreakShield: reserved for future streak-protect feature

const CHAPTERS = [
  {id:0,title:'🏠 H1: De Startup',unlock:0,cin:{ch:'HOOFDSTUK 1',title:'De Startup 🚀',lines:[
    {av:'👔',who:'Thomas — Adviseur',txt:'Gefeliciteerd, <strong>CEO</strong>! Je hebt €50.000 opgehaald. DataShop gaat live. Maar je klantendatabank is een puinhoop.'},
    {av:'💻',who:'System',txt:'Eerste klanten wachten. Elke fout kost <strong>reputatiepunten</strong>.'},
    {av:'🤔',who:'CEO — jij',txt:'Oké. Ik pak dit aan.',right:true},
  ]}},
  {id:1,title:'⚡ H2: Crisis Mode',unlock:6,cin:{ch:'HOOFDSTUK 2',title:'Crisis Mode 🚨',lines:[
    {av:'😱',who:'Ines — PR Manager',txt:'CEO, we hebben een crisis! Een kortingscode van 99% staat actief. <strong>Social media ontploft!</strong>'},
    {av:'📱',who:'Klantenservice',txt:'Reviews over defecte USB-C Hub komen binnen. Webcam al weken uitverkocht.'},
    {av:'🤔',who:'CEO — jij',txt:'Ik regel het. Geef me database-toegang.',right:true},
  ]}},
  {id:2,title:'🔗 H3: Data Expert',unlock:14,cin:{ch:'HOOFDSTUK 3',title:'Data Expert 🧠',lines:[
    {av:'📊',who:'Alex — Data Analyst',txt:'Investeerders willen rapporten. Welke klanten bestellen het meest? Beste categorieën?'},
    {av:'🏢',who:'Raad van Bestuur',txt:'We willen de database uitbreiden met nieuwe tabellen.'},
    {av:'🤔',who:'CEO — jij',txt:'Laat me de queries schrijven.',right:true},
  ]}},
  {id:3,title:'🧬 H4: Expert Modus',unlock:22,cin:{ch:'HOOFDSTUK 4',title:'Expert Modus 🧬',lines:[
    {av:'🤖',who:'AI Systeem',txt:'Proficiat CEO! Je beheerst de basis volledig. Tijd voor <strong>gevorderde SQL</strong>: DISTINCT, aliassen, subqueries.'},
    {av:'📈',who:'Venture Capitalist',txt:'We overwegen €500.000 te investeren. We willen rapporten die onze analistensoftware niet aankan. Imponeer ons.'},
    {av:'🤔',who:'CEO — jij',txt:'Ik schrijf queries die jullie nooit eerder gezien hebben.',right:true},
  ]}},
  {id:4,title:'🏗️ H5: Data Architect',unlock:32,cin:{ch:'HOOFDSTUK 5',title:'Data Architect 🏗️',lines:[
    {av:'🌍',who:'Boardroom',txt:'DataShop expandeert internationaal. We hebben <strong>professionele JOINs, gegroepeerde rapporten en een strakke database-architectuur</strong> nodig.'},
    {av:'🧑‍💼',who:'Lena — Lead Engineer',txt:'We schakelen over naar ANSI-standaard JOIN-syntax. Schrijf queries die echte databases aankunnen: INNER JOIN, LEFT JOIN, GROUP BY met HAVING, en DDL voor nieuwe structuren.'},
    {av:'🤔',who:'CEO — jij',txt:'Ik bouw de databank die DataShop naar de beurs brengt.',right:true},
  ]}},
];

// ── SMART CHECK HELPERS ───────────────────────────────────────────
// Normalize SQL for comparison
function norm(sql) { return sql.toLowerCase().replace(/\s+/g,' ').trim(); }
// Controleer of het resultaat rijen bevat
function hasRows(res) { return res.ok && res.rows && res.rows.length > 0; }
// Controleer of het resultaat minstens n rijen heeft
function rowCount(res, min=1) { return res.ok && res.rows && res.rows.length >= min; }
// Detect common beginner mistake: missing quotes around text
function missingQuotes(sql, val) {
  const s = sql.toLowerCase();
  return s.includes(val.toLowerCase()) && !s.includes(`'${val.toLowerCase()}'`);
}
// Geef slimme feedback bij syntaxfouten van de engine
function smartRunMsg(sql) {
  const res = runSQL(sql);
  if (res.ok) return res;
  const msg = res.msg || '';
  // Enhance generic error messages
  if (msg.includes('Controleer je SELECT')) return err('Controleer je SELECT-syntax. Vergeet geen FROM, en gebruik komma\'s tussen kolomnamen.');
  if (msg.includes('bestaat niet')) return err(msg + ' — Let op de spelling van tabelnamen (kleine letters).');
  return res;
}

// ── CONCEPT SCAFFOLDING ──────────────────────────────────────────────
// Mini-uitleg die verschijnt bij het EERSTE gebruik van een nieuw concept
const CONCEPT_INTRO = {
  select: {
    icon: '🔍',
    title: 'SELECT — Gegevens opvragen',
    body: 'Met <strong>SELECT</strong> haal je rijen op uit een tabel. De basisvorm is:<br><code>SELECT kolom1, kolom2 FROM tabel WHERE conditie</code><br>Gebruik <code>*</code> voor alle kolommen.',
    tip: 'De volgorde is altijd: SELECT → FROM → WHERE → ORDER BY → LIMIT',
  },
  insert: {
    icon: '➕',
    title: 'INSERT — Nieuwe rij toevoegen',
    body: 'Met <strong>INSERT INTO</strong> voeg je een nieuwe rij toe.<br><code>INSERT INTO tabel (kolom1, kolom2) VALUES (waarde1, waarde2)</code><br>Tekst staat altijd tussen enkele aanhalingstekens.',
    tip: 'Vermeld de kolomnamen expliciet — dan hoef je de volgorde in de tabel niet te kennen.',
  },
  update: {
    icon: '✏️',
    title: 'UPDATE — Bestaande rij wijzigen',
    body: 'Met <strong>UPDATE … SET … WHERE</strong> pas je bestaande rijen aan.<br><code>UPDATE tabel SET kolom = nieuwewaarde WHERE conditie</code>',
    tip: '⚠️ Altijd WHERE gebruiken! Zonder WHERE pas je ALLE rijen tegelijk aan.',
  },
  delete: {
    icon: '🗑️',
    title: 'DELETE — Rij(en) verwijderen',
    body: 'Met <strong>DELETE FROM … WHERE</strong> verwijder je rijen.<br><code>DELETE FROM tabel WHERE conditie</code>',
    tip: '⚠️ DELETE is onomkeerbaar. Overweeg UPDATE SET actief = 0 als alternatief.',
  },
  ddl: {
    icon: '🏗️',
    title: 'DDL — Database structuur aanpassen',
    body: 'DDL-commando\'s (Data Definition Language) wijzigen de <em>structuur</em> van de database, niet de data zelf.<br><code>CREATE TABLE naam (kolom datatype, ...)</code><br><code>ALTER TABLE naam ADD COLUMN kolom datatype</code>',
    tip: 'Bestaande rijen krijgen automatisch NULL voor een nieuwe kolom via ALTER TABLE.',
  },
  like: {
    icon: '🔎',
    title: 'LIKE — Zoeken op patroon',
    body: 'Met <strong>LIKE</strong> filter je op een tekstpatroon.<br><code>WHERE naam LIKE \'%Jan%\'</code> — bevat "Jan"<br><code>WHERE naam LIKE \'J%\'</code> — begint met J<br><code>WHERE email LIKE \'%@gmail%\'</code> — Gmail-adressen',
    tip: '% staat voor nul of meer willekeurige tekens. _ staat voor precies één teken.',
  },
  between: {
    icon: '📏',
    title: 'BETWEEN — Bereikfilter',
    body: 'Met <strong>BETWEEN a AND b</strong> filter je op een bereik — inclusief de grenzen zelf.<br><code>WHERE prijs BETWEEN 10 AND 50</code><br>Werkt ook voor datums: <code>WHERE datum BETWEEN \'2024-01-01\' AND \'2024-12-31\'</code>',
    tip: 'BETWEEN a AND b is gelijk aan: WHERE kolom >= a AND kolom <= b',
  },
  isnull: {
    icon: '🕳️',
    title: 'IS NULL — Ontbrekende waarden',
    body: 'NULL is de <em>afwezigheid</em> van een waarde. Je kan er NIET op vergelijken met =.<br><code>WHERE kolom IS NULL</code> — geen waarde ingevuld<br><code>WHERE kolom IS NOT NULL</code> — waarde wél ingevuld<br>❌ <code>WHERE kolom = NULL</code> werkt nooit!',
    tip: 'Anti-join: LEFT JOIN + WHERE rechtertabel.id IS NULL → vindt rijen die NIET in de rechtertabel staan.',
  },
  casewhen: {
    icon: '🏷️',
    title: 'CASE WHEN — Conditionele labels',
    body: 'Met <strong>CASE WHEN</strong> maak je een nieuwe kolom op basis van condities — als een if/else in SQL.<br><code>CASE WHEN stock = 0 THEN \'Uitverkocht\' WHEN stock &lt; 5 THEN \'Bijna op\' ELSE \'Op voorraad\' END AS status</code>',
    tip: 'Sluit altijd af met END. Geef de kolom een naam via AS. Gebruik ELSE als standaardwaarde.',
  },
};

// Track welke concepten de speler al gezien heeft
// Sla op in G en in localStorage, zodat de introductie maar één keer getoond wordt
function seenConcept(type) {
  if (!G.seenConcepts) G.seenConcepts = new Set();
  return G.seenConcepts.has(type);
}
function markConceptSeen(type) {
  if (!G.seenConcepts) G.seenConcepts = new Set();
  G.seenConcepts.add(type);
  save();
}

// ── CONCEPT MASTERY ───────────────────────────────────────────────
// Hoeveel missies per sqlType heeft de speler voltooid?
function conceptMastery() {
  const types = ['select','insert','update','delete','ddl'];
  return types.map(t => {
    const all  = SCENARIOS.filter(s => s.sqlType === t);
    const done = all.filter(s => G.done.has(s.id));
    return { type: t, done: done.length, total: all.length, pct: all.length ? Math.round(done.length / all.length * 100) : 0 };
  });
}

// ── HOOFDSTUK RECAP ───────────────────────────────────────────────
const CHAPTER_RECAP = {
  0: {
    title: 'De Startup voltooid! 🚀',
    learned: [
      { icon: '🔍', concept: 'SELECT', desc: 'Gegevens opvragen met filters (WHERE), sortering (ORDER BY) en limieten (LIMIT).' },
      { icon: '➕', concept: 'INSERT', desc: 'Nieuwe rijen toevoegen aan een tabel met INSERT INTO … VALUES.' },
      { icon: '✏️', concept: 'UPDATE', desc: 'Bestaande rijen aanpassen met UPDATE … SET … WHERE.' },
      { icon: '🗑️', concept: 'DELETE', desc: 'Rijen verwijderen met DELETE FROM … WHERE.' },
      { icon: '🔢', concept: 'COUNT(*)', desc: 'Het aantal rijen tellen met een aggregatiefunctie.' },
    ],
    nextPreview: 'In het volgende hoofdstuk ga je complexere queries schrijven: GROUP BY, JOIN, en meer.',
  },
  1: {
    title: 'Crisis Mode overleefd! 🚨',
    learned: [
      { icon: '📊', concept: 'GROUP BY', desc: 'Rijen groeperen per waarde en aggregaten per groep berekenen.' },
      { icon: '🔗', concept: 'ALTER TABLE', desc: 'Kolommen toevoegen aan bestaande tabellen zonder data te verliezen.' },
      { icon: '⚡', concept: 'URGENT queries', desc: 'Kritische updates en deletes correct uitvoeren onder tijdsdruk.' },
    ],
    nextPreview: 'Volgende stap: tabellen samenvoegen met JOIN en geavanceerde aggregaten.',
  },
  2: {
    title: 'Data Expert bereikt! 🧠',
    learned: [
      { icon: '🔗', concept: 'JOIN', desc: 'Gegevens uit meerdere tabellen combineren via FK = PK.' },
      { icon: '👑', concept: 'HAVING', desc: 'Groepen filteren ná GROUP BY — WHERE werkt vóór groepering, HAVING erna.' },
      { icon: '🏗️', concept: 'CREATE TABLE', desc: 'Nieuwe tabellen aanmaken met kolomdefinities, datatypes en constraints.' },
      { icon: '📐', concept: 'AVG / MIN / MAX', desc: 'Gemiddelde, minimum en maximum berekenen over een kolom.' },
    ],
    nextPreview: 'Nu gevorderde technieken: DISTINCT, aliassen (AS) en subqueries.',
  },
  3: {
    title: 'Expert Modus voltooid! 🧬',
    learned: [
      { icon: '🔎', concept: 'DISTINCT', desc: 'Dubbele waarden uit het resultaat verwijderen.' },
      { icon: '🏷️', concept: 'AS (aliassen)', desc: 'Kolommen en tabellen een leesbare naam geven in de query.' },
      { icon: '🧩', concept: 'Subqueries', desc: 'Een query binnen een andere query — de binnenste wordt eerst uitgevoerd.' },
    ],
    nextPreview: 'Laatste hoofdstuk: ANSI-standaard JOINs, gecombineerde queries en professionele DDL.',
  },
  4: {
    title: 'Data Architect — Meester! 🏗️',
    learned: [
      { icon: '🔗', concept: 'INNER / LEFT JOIN', desc: 'INNER JOIN voor matches, LEFT JOIN voor alle linkerijen ook zonder match.' },
      { icon: '🌐', concept: 'Multi-tabel queries', desc: 'Drie of meer tabellen koppelen met meerdere JOINs gekettend.' },
      { icon: '🎯', concept: 'GROUP BY + HAVING', desc: 'Groeperen én filteren op groepsniveau gecombineerd.' },
      { icon: '🏛️', concept: 'Volledige DDL', desc: 'CREATE TABLE én ALTER TABLE professioneel ingezet voor database-architectuur.' },
    ],
    nextPreview: null,
  },
};

const SCENARIOS = [
  // ══ H1: De Startup ══
  {id:'new_customer',ch:0,title:'Nieuwe klant registreren',icon:'🛍️',av:'👩',who:'Klantenservice',
   story:'<strong>Sophie Vermeersch</strong> uit <strong>Gent</strong> registreerde zich net. Email: <strong>sophie@mail.be</strong>. Actief account. Voeg toe!',
   obj:'INSERT INTO klant (naam, email, stad, actief) VALUES (...)',
   diff:'easy',lpd:'LPD5',xp:50,tbl:'klant',urgent:true,time:60,
   hint:"INSERT INTO klant (naam, email, stad, actief) VALUES ('Sophie Vermeersch', 'sophie@mail.be', 'Gent', 1)",
   sqlType:'insert',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('insert')) return err(stripSolution('Gebruik INSERT INTO klant (kolommen) VALUES (waarden).'));
     if(!s.includes('klant')) return err('Vergeet de tabelnaam niet: INSERT INTO <strong>klant</strong> (...)');
     if(!s.includes('sophie')) return err('Naam "Sophie Vermeersch" ontbreekt in de VALUES.');
     if(!s.includes('sophie@mail.be')) return err('E-mailadres "sophie@mail.be" ontbreekt in de VALUES.');
     if(!s.includes('gent')) return err('Stad "Gent" ontbreekt.');
     if(missingQuotes(sql,'sophie vermeersch')) return err('Tekst moet tussen aanhalingstekens: <code>\'Sophie Vermeersch\'</code>');
     const res=runSQL(sql); if(!res.ok) return res;
     return {ok:true,type:'insert',msg:'Sophie Vermeersch toegevoegd!'};
   },
   win:'Sophie staat in de databank! 🎉'},

  {id:'price_update',ch:0,title:'Prijsaanpassing doorvoeren',icon:'💰',av:'📞',who:'Leverancier',
   story:'USB-C Hub (product_id=2) krijgt nieuwe prijs: <strong>€44.99</strong>. Pas aan vóór de webshop opent.',
   obj:'UPDATE product SET prijs = 44.99 WHERE product_id = 2',
   diff:'easy',lpd:'LPD5',xp:40,tbl:'product',time:45,
   hint:'UPDATE product SET prijs = 44.99 WHERE product_id = 2',
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('update')) return err(stripSolution('Gebruik UPDATE product SET prijs = ... WHERE ...'));
     if(!s.includes('product')) return err('Tabel moet <strong>product</strong> zijn.');
     if(!s.includes('where')) return err('⚠️ WHERE vergeten! Zonder WHERE pas je ALLE producten aan.');
     if(!s.includes('44.99')&&!s.includes('44,99')) return err('Nieuwe prijs is <strong>44.99</strong>. Gebruik een punt als decimaalteken.');
     if(!s.includes('product_id')&&!s.includes('= 2')) return err('Voeg een <strong>WHERE</strong>-clausule toe om slechts één product bij te werken.');
     return smartRunMsg(sql);
   },
   win:'Prijs bijgewerkt. Geen verlies meer. 💶'},

  {id:'query_gent',ch:0,title:'Klanten uit Gent opzoeken',icon:'🔍',av:'📣',who:'Marketing',
   story:"Marketing wil een Gent-campagne. Geef namen en e-mails van klanten uit <strong>Gent</strong>, gesorteerd op naam.",
   obj:"SELECT naam, email FROM klant WHERE stad = 'Gent' ORDER BY naam",
   diff:'easy',lpd:'LPD4',xp:45,tbl:'klant',time:40,
   hint:"SELECT naam, email FROM klant WHERE stad = 'Gent' ORDER BY naam",
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err('Begin met SELECT.');
     if(!s.includes('from klant')) return err('Gebruik FROM klant (niet FROM product of andere tabel).');
     if(!s.includes('gent')) return err("Filter op stad = 'Gent'. Let op: tekst moet tussen aanhalingstekens!");
     if(!s.includes("'gent'")&&!s.includes('"gent"')&&s.includes('gent')) return err("Schrijf Gent tussen aanhalingstekens: WHERE stad = <code>'Gent'</code>");
     const res = runSQL(sql);
     if(!res.ok) return res;
     if(!rowCount(res)) return err("Geen resultaten gevonden. Controleer de schrijfwijze van 'Gent'.");
     return res;
   },
   win:'Lijst verstuurd! Campagne gelanceerd. 📣'},

  {id:'deactivate_gdpr',ch:0,title:'GDPR — Account deactiveren',icon:'🔒',av:'⚖️',who:'Juridische Dienst',
   story:'<strong>Kobe Janssen</strong> (klant_id=4) vraagt deactivering. GDPR verbiedt verwijdering — zet enkel <strong>actief = 0</strong>.',
   obj:'UPDATE klant SET actief = 0 WHERE klant_id = 4',
   diff:'easy',lpd:'LPD5',xp:40,tbl:'klant',time:40,
   hint:'UPDATE klant SET actief = 0 WHERE klant_id = 4',
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(s.startsWith('delete')) return err('❌ NIET VERWIJDEREN! GDPR verplicht bewaarplicht van klantdata. Gebruik UPDATE om de klant te deactiveren.');
     if(!s.startsWith('update')) return err(stripSolution('Gebruik UPDATE klant SET actief = 0 WHERE klant_id = 4'));
     if(!s.includes('klant')) return err('Tabel is <strong>klant</strong>, niet product of bestelling.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Anders deactiveer je ALLE klanten.');
     if(!s.includes('4')&&!s.includes('kobe')) return err('Voeg een WHERE-clausule toe om de juiste klant te filteren.');
     if(!s.includes('actief')) return err('Gebruik SET om de actief-kolom op de juiste waarde te zetten.');
     return smartRunMsg(sql);
   },
   win:'Kobe gedeactiveerd. GDPR correct nageleefd. ✅'},

  {id:'new_product',ch:0,title:'Nieuw product toevoegen',icon:'🆕',av:'📦',who:'Inkoop',
   story:'Nieuw product: <strong>Staande Lamp LED</strong>, prijs <strong>€89.99</strong>, stock <strong>10</strong>, categorie <strong>Wonen</strong>.',
   obj:"INSERT INTO product (naam, prijs, stock, categorie) VALUES ('Staande Lamp LED', 89.99, 10, 'Wonen')",
   diff:'easy',lpd:'LPD5',xp:50,tbl:'product',time:50,
   hint:"INSERT INTO product (naam, prijs, stock, categorie) VALUES ('Staande Lamp LED', 89.99, 10, 'Wonen')",
   sqlType:'insert',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('insert')) return err(stripSolution('Gebruik INSERT INTO product (...) VALUES (...)'));
     if(!s.includes('product')) return err('Tabel is <strong>product</strong>.');
     if(!s.includes('lamp')&&!s.includes('staande')) return err('Naam "Staande Lamp LED" ontbreekt in VALUES.');
     if(!s.includes('89.99')) return err('Prijs moet <strong>89.99</strong> zijn (punt als decimaalteken).');
     if(!s.includes('wonen')) return err('Categorie "Wonen" ontbreekt.');
     const res=runSQL(sql); if(!res.ok) return res;
     return {ok:true,type:'insert',msg:'Staande Lamp LED toegevoegd!'};
   },
   win:'Staande Lamp LED live! 💡'},

  {id:'active_customers',ch:0,title:'Actieve klanten opzoeken',icon:'👥',av:'📣',who:'Marketing',
   story:"Haal alle klanten op waarbij <strong>actief = 1</strong>, gesorteerd op naam. Welke zijn er?",
   obj:"SELECT naam, email, stad FROM klant WHERE actief = 1 ORDER BY naam",
   diff:'easy',lpd:'LPD4',xp:40,tbl:'klant',time:40,
   hint:"SELECT naam, email, stad FROM klant WHERE actief = 1 ORDER BY naam",
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT naam, ... FROM klant WHERE actief = 1'));
     if(!s.includes('from klant')) return err('Gebruik FROM klant.');
     if(!s.includes('actief')) return err('Filter op de kolom <strong>actief</strong> om alleen actieve klanten te tonen.');
     const res = runSQL(sql);
     if(!res.ok) return res;
     // Accept actief=1 OR actief!=0 OR actief>0
     if(res.rows && res.rows.some(r=>String(r.actief)==='0'||r.actief===0||r.actief===false))
       return err('Je haalt te veel klanten op. Filter op de <strong>actief</strong>-kolom om alleen actieve klanten te tonen.');
     return res;
   },
   win:'Actieve klantenlijst klaar! Campagne kan starten. 📣'},

  {id:'count_products',ch:0,title:'Hoeveel producten?',icon:'🔢',av:'📦',who:'Voorraadmanager',
   story:'Hoeveel producten staan er in de databank? Gebruik <strong>COUNT(*)</strong> om het totaal te tellen.',
   obj:'SELECT COUNT(*) FROM product',
   diff:'easy',lpd:'LPD4',xp:35,tbl:'product',time:30,
   hint:'SELECT COUNT(*) FROM product',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT COUNT(*) FROM product'));
     if(!s.includes('count')) return err(stripSolution('Gebruik <strong>COUNT(*)</strong> om te tellen. Voorbeeld: SELECT COUNT(*) FROM product'));
     if(!s.includes('product')) return err('Tel producten: gebruik FROM <strong>product</strong>.');
     return smartRunMsg(sql);
   },
   win:'Productaantal geteld. Voorraadrapport klaar! 📊'},

  // ══ H2: Crisis Mode ══
  {id:'disable_coupon',ch:1,title:'🚨 CRISIS: Kortingscode deactiveren',icon:'🎟️',av:'😱',who:'Ines — PR',
   story:'<strong>ALARM!</strong> Kortingscode <strong>FOUT999</strong> geeft 99% korting. Al 23 klanten misbruiken hem. <strong>DEACTIVEER NU!</strong>',
   obj:"UPDATE kortingscode SET actief = 0 WHERE code = 'FOUT999'",
   diff:'medium',lpd:'LPD5',xp:80,tbl:'kortingscode',urgent:true,time:30,
   hint:"UPDATE kortingscode SET actief = 0 WHERE code = 'FOUT999'",
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('update')) return err('Gebruik UPDATE kortingscode SET actief = 0 WHERE code = \'FOUT999\'');
     if(!s.includes('kortingscode')) return err('Tabel is <strong>kortingscode</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Anders deactiveer je ALLE kortingscodes.');
     if(!s.includes('fout999')) return err("Filter op code = 'FOUT999'. Let op de aanhalingstekens rond de tekst.");
     if(!s.includes('actief')) return err('Gebruik SET om de actief-kolom bij te werken.');
     return smartRunMsg(sql);
   },
   win:'Crisis bezworen! FOUT999 gedeactiveerd. 🎉'},

  {id:'restock_webcam',ch:1,title:'Webcam HD bijvullen',icon:'📦',av:'🏭',who:'Logistiek',
   story:'Webcam HD (product_id=5): stock=0. 20 nieuwe exemplaren zijn binnen. Verwerk dit.',
   obj:'UPDATE product SET stock = 20 WHERE product_id = 5',
   diff:'easy',lpd:'LPD5',xp:40,tbl:'product',urgent:true,time:35,
   hint:'UPDATE product SET stock = 20 WHERE product_id = 5',
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('update')) return err(stripSolution('Gebruik UPDATE product SET stock = 20 WHERE product_id = 5'));
     if(!s.includes('product')) return err('Tabel is <strong>product</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Anders pas je de stock van ALLE producten aan.');
     if(!s.includes('stock')) return err('Gebruik <strong>SET</strong> om de stock-kolom bij te werken naar de gevraagde waarde');
     if(!s.includes('5')&&!s.includes('webcam')) return err('Voeg een WHERE-clausule toe om enkel het gevraagde product te filteren.');
     return smartRunMsg(sql);
   },
   win:'Webcam HD terug in stock! 📷'},

  {id:'new_order',ch:1,title:'Bestelling verwerken',icon:'🛒',av:'📬',who:'Orderverwerking',
   story:'Jana Pieters (klant_id=1) bestelde 3× Notitieboek A5 (product_id=3) op 2024-12-01. Status: "verwerking".',
   obj:"INSERT INTO bestelling (klant_id, product_id, datum, aantal, status) VALUES (1, 3, '2024-12-01', 3, 'verwerking')",
   diff:'medium',lpd:'LPD5',xp:60,tbl:'bestelling',time:55,
   hint:"INSERT INTO bestelling (klant_id, product_id, datum, aantal, status) VALUES (1, 3, '2024-12-01', 3, 'verwerking')",
   sqlType:'insert',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('insert')) return err(stripSolution('Gebruik INSERT INTO bestelling (...) VALUES (...)'));
     if(!s.includes('bestelling')) return err('Tabel is <strong>bestelling</strong>.');
     if(!s.includes('2024-12-01')) return err('Datum 2024-12-01 ontbreekt. Schrijf datums als <code>\'2024-12-01\'</code>');
     if(!s.includes('verwerking')) return err('Status "verwerking" ontbreekt in VALUES.');
     const res=runSQL(sql); if(!res.ok) return res;
     return {ok:true,type:'insert',msg:'Bestelling verwerkt!'};
   },
   win:'Bestelling verwerkt! Jana krijgt een bevestiging. 📧'},

  {id:'count_orders',ch:1,title:'Bestellingen per klant tellen',icon:'📊',av:'📊',who:'Analytics',
   story:'Investeerders willen weten welke klanten het meest actief zijn. Gebruik GROUP BY.',
   obj:'SELECT klant_id, COUNT(*) FROM bestelling GROUP BY klant_id',
   diff:'medium',lpd:'LPD4',xp:65,tbl:'bestelling',time:60,
   hint:'SELECT klant_id, COUNT(*) FROM bestelling GROUP BY klant_id',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT klant_id, COUNT(*) FROM bestelling GROUP BY klant_id'));
     if(!s.includes('count')) return err('Gebruik <strong>COUNT(*)</strong> om bestellingen per klant te tellen.');
     if(!s.includes('bestelling')) return err('Gebruik FROM <strong>bestelling</strong>.');
     if(!s.includes('group by')) return err('Gebruik <strong>GROUP BY</strong> om per klant te groeperen.');
     if(s.includes('where')&&!s.includes('group by')) return err('Tip: gebruik GROUP BY, niet WHERE, om te groeperen.');
     return smartRunMsg(sql);
   },
   win:'Rapport klaar! Investeerders tevreden. 📈'},

  {id:'delete_test',ch:1,title:'Test-bestellingen opruimen',icon:'🗑️',av:'🔍',who:'Auditor',
   story:'Testbestellingen van vóór 2024-11-12 moeten weg. Altijd WHERE bij DELETE!',
   obj:"DELETE FROM bestelling WHERE datum < '2024-11-12'",
   diff:'medium',lpd:'LPD5',xp:60,tbl:'bestelling',time:50,
   hint:"DELETE FROM bestelling WHERE datum < '2024-11-12'",
   sqlType:'delete',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('delete')) return err('Gebruik DELETE FROM bestelling WHERE datum < \'2024-11-12\'');
     if(!s.includes('bestelling')) return err('Tabel is <strong>bestelling</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht bij DELETE! Zonder WHERE verwijder je ALLE bestellingen.');
     if(!s.includes('datum')) return err('Filter op de kolom <strong>datum</strong>. Bestellingen vóór 2024-11-12 moeten weg.');
     if(!s.includes('2024')) return err('Voeg de datum 2024-11-12 toe als grens: WHERE datum < \'2024-11-12\'');
     return smartRunMsg(sql);
   },
   win:'Testdata verwijderd. Database proper voor het fiscale jaar. 🧹'},

  {id:'add_telefoon',ch:1,title:'Telefoon: kolom aanmaken & controleren',icon:'📵',av:'📞',who:'Klantenservice Chef',
   story:'Stap 1: Voeg kolom <strong>telefoon VARCHAR(20)</strong> toe aan <strong>klant</strong>. Stap 2: Zoek daarna alle klanten waarbij <strong>telefoon IS NULL</strong> — dat zijn de klanten die nog gebeld moeten worden.',
   obj:'Stap 1: ALTER TABLE klant ADD COLUMN telefoon · Stap 2: SELECT ... WHERE telefoon IS NULL',
   diff:'medium',lpd:'LPD3',xp:80,tbl:'klant',time:70,
   sqlType:'ddl',
   hint:'ALTER TABLE klant ADD COLUMN telefoon VARCHAR(20)',
   steps:[
     {
       label:'ALTER TABLE — kolom aanmaken',
       sqlType:'ddl',
       placeholder:'ALTER TABLE klant ADD COLUMN telefoon VARCHAR(20)',
       hint:'ALTER TABLE klant ADD COLUMN telefoon VARCHAR(20)',
       check(sql){
         const s=norm(sql);
         if(!s.startsWith('alter')) return err('Begin met <strong>ALTER TABLE klant</strong>.');
         if(!s.includes('klant')) return err('Pas tabel <strong>klant</strong> aan.');
         if(!s.includes('add')) return err('Gebruik <strong>ADD COLUMN</strong> om een kolom toe te voegen.');
         if(!s.includes('telefoon')) return err('De kolom heet <strong>telefoon</strong>.');
         if(!s.includes('varchar')&&!s.includes('text')) return err('Gebruik <strong>VARCHAR(20)</strong> als datatype.');
         const res=runSQL(sql); if(!res.ok) return res;
         return {ok:true,type:'ddl',msg:'Kolom telefoon toegevoegd! Alle klanten hebben nu telefoon = NULL.'};
       },
       successMsg:'Kolom bestaat nu. Merk op: alle bestaande klanten krijgen automatisch NULL. Gebruik dat nu in stap 2.',
     },
     {
       label:'SELECT IS NULL — wie heeft nog geen nummer?',
       sqlType:'select',
       placeholder:'SELECT naam, email FROM klant WHERE telefoon IS NULL',
       hint:'SELECT naam, email\nFROM klant\nWHERE telefoon IS NULL',
       check(sql){
         const s=norm(sql);
         if(!s.startsWith('select')) return err('Begin met <strong>SELECT naam, email FROM klant</strong>.');
         if(!s.includes('telefoon')) return err('Filter op de kolom <strong>telefoon</strong>.');
         if(s.includes('= null')||s.includes('=null')) return err('❌ <code>= NULL</code> werkt nooit! Gebruik <strong>IS NULL</strong>.');
         if(!s.includes('is null')) return err('Gebruik <strong>IS NULL</strong> — nooit = NULL!');
         const res=runSQL(sql); if(!res.ok) return res;
         return res;
       },
     },
   ],
   win:'Kolom aangemaakt én NULL-controle geslaagd! Het outreach-team weet nu wie gebeld moet worden. ☎️'},

  {id:'low_stock',ch:1,title:'Producten met lage stock',icon:'⚠️',av:'🏭',who:'Logistiek',
   story:'Welke producten hebben een <strong>stock van minder dan 5</strong>? Maak een urgentielijst — inclusief stock=0!',
   obj:'SELECT naam, stock FROM product WHERE stock < 5 ORDER BY stock ASC',
   diff:'medium',lpd:'LPD4',xp:55,tbl:'product',time:40,
   hint:'SELECT naam, stock FROM product WHERE stock < 5 ORDER BY stock ASC',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT naam, stock FROM product WHERE stock < 5'));
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong>.');
     if(!s.includes('stock')) return err('Filter op de kolom <strong>stock</strong> met de juiste drempelwaarde.');
     if(!s.includes('<')&&!s.includes('<=4')&&!s.includes('<= 4')) return err('Gebruik de operator < (kleiner dan): WHERE stock <strong>&lt;</strong> 5');
     const res = runSQL(sql);
     if(!res.ok) return res;
     if(res.rows&&res.rows.some(r=>Number(r.stock)>=5)) return err('Je filtert te ruim. Controleer je drempelwaarde in de WHERE-clausule.');
     return res;
   },
   win:'Urgentielijst klaar! Bestelling geplaatst bij leverancier. 📦'},

  {id:'update_order_status',ch:1,title:'Bestellingsstatus bijwerken',icon:'🚚',av:'🚚',who:'Leveringsdienst',
   story:'Bestelling 4 (status "onderweg") is aangekomen! Zet status op <strong>"geleverd"</strong>.',
   obj:"UPDATE bestelling SET status = 'geleverd' WHERE bestelling_id = 4",
   diff:'medium',lpd:'LPD5',xp:50,tbl:'bestelling',time:40,
   hint:"UPDATE bestelling SET status = 'geleverd' WHERE bestelling_id = 4",
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('update')) return err('Gebruik UPDATE bestelling SET status = \'geleverd\' WHERE bestelling_id = 4');
     if(!s.includes('bestelling')) return err('Tabel is <strong>bestelling</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Anders update je ALLE bestellingen.');
     if(!s.includes('geleverd')) return err('Status moet <strong>"geleverd"</strong> zijn. Schrijf: SET status = \'geleverd\'');
     if(!s.includes('4')&&!s.includes('bestelling_id')) return err('Voeg een WHERE-clausule toe om slechts één bestelling bij te werken.');
     return smartRunMsg(sql);
   },
   win:'Bestelling gemarkeerd als geleverd! Klant krijgt bevestiging. ✅'},

  // ══ H3: Data Expert ══
  {id:'create_leverancier',ch:2,title:'Leverancier: tabel aanmaken & eerste rij invoegen',icon:'🏗️',av:'🤝',who:'Inkoopmanager',
   story:'DataShop werkt samen met externe leveranciers. Stap 1: Maak tabel <strong>leverancier</strong> aan (leverancier_id PK AUTO, naam NOT NULL, email, land). Stap 2: Voeg eerste leverancier toe: <strong>TechParts BV</strong>, info@techparts.be, Belgie.',
   obj:'Stap 1: CREATE TABLE leverancier · Stap 2: INSERT INTO leverancier',
   diff:'hard',lpd:'LPD3',xp:110,tbl:null,time:120,
   sqlType:'ddl',
   hint:'CREATE TABLE leverancier (\n  leverancier_id INT PRIMARY KEY AUTO_INCREMENT,\n  naam VARCHAR(100) NOT NULL,\n  email VARCHAR(150),\n  land VARCHAR(80)\n)',
   steps:[
     {
       label:'CREATE TABLE leverancier',
       sqlType:'ddl',
       placeholder:'CREATE TABLE leverancier (...)',
       hint:'CREATE TABLE leverancier (\n  leverancier_id INT PRIMARY KEY AUTO_INCREMENT,\n  naam VARCHAR(100) NOT NULL,\n  email VARCHAR(150),\n  land VARCHAR(80)\n)',
       check(sql){
         const s=norm(sql);
         if(!s.startsWith('create table')) return err('Begin met <strong>CREATE TABLE leverancier</strong> (...)');
         if(!s.includes('leverancier')) return err('Noem de tabel <strong>leverancier</strong>.');
         if(!s.includes('primary key')) return err('Voeg <strong>PRIMARY KEY</strong> toe aan het ID-veld.');
         if(!s.includes('naam')) return err('Kolom <strong>naam</strong> ontbreekt. Vergeet NOT NULL niet.');
         return smartRunMsg(sql);
       },
       successMsg:'Tabel aangemaakt! Nu kun je er meteen data in zetten.',
     },
     {
       label:'INSERT INTO leverancier',
       sqlType:'insert',
       placeholder:"INSERT INTO leverancier (naam, email, land) VALUES (...)",
       hint:"INSERT INTO leverancier (naam, email, land)\nVALUES ('TechParts BV', 'info@techparts.be', 'Belgie')",
       check(sql){
         const s=norm(sql);
         if(!s.startsWith('insert')) return err('Begin met <strong>INSERT INTO leverancier</strong>.');
         if(!s.includes('leverancier')) return err('Voeg in in tabel <strong>leverancier</strong>.');
         if(!s.includes('techparts')) return err('Naam "TechParts BV" ontbreekt.');
         if(!s.includes('info@techparts.be')) return err('E-mailadres "info@techparts.be" ontbreekt.');
         if(!s.includes('belgi')) return err('Land "Belgie" ontbreekt.');
         return smartRunMsg(sql);
       },
     },
   ],
   win:'Tabel aangemaakt en eerste leverancier geregistreerd! DataShop is klaar voor partnerships. 🤝'},

  {id:'avg_review',ch:2,title:'Gemiddelde reviewscore',icon:'⭐',av:'📊',who:'Productmanager',
   story:'Bereken de <strong>gemiddelde score</strong> van alle reviews. Gebruik AVG().',
   obj:'SELECT AVG(score) FROM review',
   diff:'medium',lpd:'LPD4',xp:55,tbl:'review',time:35,
   hint:'SELECT AVG(score) FROM review',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT AVG(score) FROM review'));
     if(!s.includes('avg')) return err('Gebruik de <strong>AVG()</strong>-functie om het gemiddelde te berekenen.');
     if(!s.includes('review')) return err('Gebruik FROM <strong>review</strong> (daar staan de scores).');
     if(!s.includes('score')&&!s.includes('*')) return err('Bereken het gemiddelde van de score-kolom met de juiste aggregatiefunctie.');
     return smartRunMsg(sql);
   },
   win:'Gemiddelde score berekend. ⭐'},

  {id:'expensive',ch:2,title:'Premium producten raadplegen',icon:'💎',av:'📈',who:'CFO',
   story:'Lijst van producten duurder dan <strong>€50</strong>, duurste eerst, voor marge-analyse.',
   obj:'SELECT naam, prijs FROM product WHERE prijs > 50 ORDER BY prijs DESC',
   diff:'easy',lpd:'LPD4',xp:45,tbl:'product',time:45,
   hint:'SELECT naam, prijs FROM product WHERE prijs > 50 ORDER BY prijs DESC',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT naam, prijs FROM product WHERE prijs > 50 ORDER BY prijs DESC'));
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong>.');
     if(!s.includes('50')) return err('Filter op prijs > 50. Vergeet het getal 50 niet.');
     if(!s.includes('>')) return err('Gebruik een vergelijkingsoperator in je WHERE-clausule om op prijs te filteren.');
     const res = runSQL(sql);
     if(!res.ok) return res;
     if(res.rows&&res.rows.some(r=>Number(r.prijs)<=50)) return err('Je lijst bevat ook producten van €50 of minder. Gebruik > (niet >=).');
     return res;
   },
   win:'CFO heeft zijn rapport. Marges goed! 💰'},

  {id:'join_orders',ch:2,title:'JOIN — Bestellingen met klantnamen',icon:'🔗',av:'📊',who:'Analytics',
   story:'Logistiek wil klantnamen, datum en status. Twee tabellen: klant en bestelling. Gebruik impliciete JOIN.',
   obj:'SELECT k.naam, b.datum, b.status FROM bestelling b, klant k WHERE b.klant_id = k.klant_id',
   diff:'hard',lpd:'LPD4',xp:110,tbl:null,time:90,
   hint:'SELECT k.naam, b.datum, b.status\nFROM bestelling b, klant k\nWHERE b.klant_id = k.klant_id',
   sqlType:'join',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT ... FROM bestelling, klant WHERE ...'));
     if(!s.includes('bestelling')) return err('Vergeet tabel <strong>bestelling</strong> niet in FROM.');
     if(!s.includes('klant')) return err('Vergeet tabel <strong>klant</strong> niet in FROM.');
     if(!s.includes('klant_id')) return err('Koppel de tabellen via <strong>klant_id</strong>: WHERE b.klant_id = k.klant_id');
     if(!s.includes('=')&&!s.includes('klant_id')) return err('JOIN-voorwaarde ontbreekt: WHERE b.klant_id = k.klant_id');
     const res = smartRunMsg(sql);
     if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer je JOIN-voorwaarde: b.klant_id = k.klant_id');
     return res;
   },
   win:'JOIN geslaagd! Logistiek heeft overzicht. 🔗'},

  {id:'having',ch:2,title:'VIP-klanten (HAVING)',icon:'👑',av:'🎯',who:'Marketing Director',
   story:'VIP-programma voor klanten met <strong>méér dan 1 bestelling</strong>. Gebruik HAVING.',
   obj:'SELECT klant_id, COUNT(*) FROM bestelling GROUP BY klant_id HAVING COUNT(*) > 1',
   diff:'hard',lpd:'LPD4',xp:110,tbl:'bestelling',time:80,
   hint:'SELECT klant_id, COUNT(*) FROM bestelling GROUP BY klant_id HAVING COUNT(*) > 1',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT klant_id, COUNT(*) FROM bestelling GROUP BY klant_id HAVING COUNT(*) > 1'));
     if(!s.includes('count')) return err('Gebruik <strong>COUNT(*)</strong> om bestellingen per klant te tellen.');
     if(!s.includes('group by')) return err('Gebruik <strong>GROUP BY</strong> om per klant te groeperen.');
     if(!s.includes('having')) return err(stripSolution('Gebruik <strong>HAVING</strong> (niet WHERE) om op groepsresultaten te filteren. HAVING COUNT(*) > 1'));
     if(s.includes('where count')) return err(stripSolution('Gebruik HAVING om op COUNT() te filteren, niet WHERE. WHERE werkt vóór groepering, HAVING erna.'));
     return smartRunMsg(sql);
   },
   win:'VIP-lijst klaar! Jana Pieters is onze trouwste klant. 👑'},

  {id:'max_stock',ch:2,title:'Product met meeste voorraad',icon:'📈',av:'🏭',who:'Warehouse',
   story:'Welk product heeft de <strong>hoogste stock</strong>? Gebruik ORDER BY + LIMIT 1.',
   obj:'SELECT naam, stock FROM product ORDER BY stock DESC LIMIT 1',
   diff:'hard',lpd:'LPD4',xp:80,tbl:'product',time:50,
   hint:'SELECT naam, stock FROM product ORDER BY stock DESC LIMIT 1',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT naam, stock FROM product ORDER BY stock DESC LIMIT 1'));
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong>.');
     if(!s.includes('stock')) return err('Je hebt kolom <strong>stock</strong> nodig.');
     const hasMax = s.includes('max(stock)');
     const hasOrderLimit = s.includes('order by')&&s.includes('limit')&&s.includes('desc');
     if(!hasMax&&!hasOrderLimit) return err(stripSolution('Gebruik ORDER BY stock DESC LIMIT 1 om het hoogste te vinden. Of gebruik MAX(stock).'));
     return smartRunMsg(sql);
   },
   win:'Notitieboek A5 heeft hoogste stock. Opslag geoptimaliseerd! 📦'},

  {id:'products_per_category',ch:2,title:'Producten per categorie',icon:'🗂️',av:'📊',who:'Product Manager',
   story:"Investeerders willen weten hoeveel producten per <strong>categorie</strong> we hebben. Gebruik <strong>GROUP BY</strong>.",
   obj:'SELECT categorie, COUNT(*) FROM product GROUP BY categorie',
   diff:'medium',lpd:'LPD4',xp:70,tbl:'product',time:55,
   hint:'SELECT categorie, COUNT(*) FROM product GROUP BY categorie',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT categorie, COUNT(*) FROM product GROUP BY categorie'));
     if(!s.includes('categorie')) return err('Selecteer de <strong>categorie</strong>-kolom en groepeer erop.');
     if(!s.includes('count')) return err('Gebruik <strong>COUNT(*)</strong> om het aantal per categorie te tellen.');
     if(!s.includes('group by')) return err('Gebruik <strong>GROUP BY</strong> om per categorie te groeperen.');
     return smartRunMsg(sql);
   },
   win:'Categorieoverzicht klaar. Elektronica domineert! 🏆'},

  {id:'min_max_prijs',ch:2,title:'Goedkoopste & duurste product',icon:'💰',av:'💼',who:'CFO',
   story:'De CFO wil de <strong>goedkoopste</strong> én <strong>duurste</strong> prijs weten in één query. Gebruik MIN() en MAX().',
   obj:'SELECT MIN(prijs), MAX(prijs) FROM product',
   diff:'medium',lpd:'LPD4',xp:60,tbl:'product',time:35,
   hint:'SELECT MIN(prijs), MAX(prijs) FROM product',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT MIN(prijs), MAX(prijs) FROM product'));
     if(!s.includes('min')) return err('Gebruik de juiste aggregatiefunctie voor de goedkoopste prijs.');
     if(!s.includes('max')) return err('Voeg ook de aggregatiefunctie voor de duurste prijs toe in dezelfde SELECT.');
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong>.');
     return smartRunMsg(sql);
   },
   win:'Prijsbereik bepaald. Perfecte input voor de winststrategie! 💶'},

  {id:'join_all',ch:2,title:'Megaoverzicht: klant + bestelling + product',icon:'🌐',av:'🌐',who:'Raad van Bestuur',
   story:'De Raad van Bestuur wil <strong>één overzicht</strong>: klantnaam, productnaam en datum. Koppel drie tabellen.',
   obj:'SELECT k.naam, p.naam, b.datum FROM bestelling b, klant k, product p WHERE b.klant_id = k.klant_id AND b.product_id = p.product_id',
   diff:'hard',lpd:'LPD4',xp:130,tbl:null,time:120,
   hint:'SELECT k.naam, p.naam, b.datum\nFROM bestelling b, klant k, product p\nWHERE b.klant_id = k.klant_id\nAND b.product_id = p.product_id',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT ... FROM bestelling, klant, product WHERE ...'));
     if(!s.includes('bestelling')) return err('Voeg tabel <strong>bestelling</strong> toe aan FROM.');
     if(!s.includes('klant')) return err('Voeg tabel <strong>klant</strong> toe aan FROM.');
     if(!s.includes('product')) return err('Voeg tabel <strong>product</strong> toe aan FROM.');
     if(!s.includes('klant_id')) return err('Koppel bestelling ↔ klant via <strong>klant_id</strong>: b.klant_id = k.klant_id');
     if(!s.includes('product_id')) return err('Koppel bestelling ↔ product via <strong>product_id</strong>: b.product_id = p.product_id');
     const res = runSQL(sql);
     if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer beide JOIN-voorwaarden.');
     return res;
   },
   win:'Megaoverzicht geleverd! De raad is onder de indruk. 🌐'},

  // ══ H4: Expert Mode ══
  {id:'distinct_steden',ch:3,title:'Unieke steden (DISTINCT)',icon:'🏙️',av:'📣',who:'Marketing',
   story:'Marketing wil weten in welke <strong>unieke steden</strong> onze klanten wonen — zonder duplicaten. Gebruik <strong>DISTINCT</strong>.',
   obj:'SELECT DISTINCT stad FROM klant',
   diff:'easy',lpd:'LPD4',xp:50,tbl:'klant',time:35,
   hint:'SELECT DISTINCT stad FROM klant',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err('Begin met SELECT DISTINCT stad FROM klant');
     if(!s.includes('distinct')) return err('Gebruik het sleutelwoord <strong>DISTINCT</strong> om duplicaten te verwijderen: SELECT DISTINCT stad FROM klant');
     if(!s.includes('stad')) return err('Selecteer de kolom <strong>stad</strong>.');
     if(!s.includes('klant')) return err('Gebruik FROM <strong>klant</strong>.');
     const res = runSQL(sql);
     if(!res.ok) return res;
     // Check no duplicates
     const vals = res.rows.map(r=>r.stad);
     if(new Set(vals).size !== vals.length) return err('Er zitten nog duplicaten in het resultaat. Gebruik DISTINCT.');
     return res;
   },
   win:'Unieke steden gevonden! Campagne per regio kan starten. 🗺️'},

  {id:'alias_products',ch:3,title:'Kolomaliassen gebruiken (AS)',icon:'🏷️',av:'💼',who:'CFO',
   story:'Het rapport moet leesbare kolomnamen bevatten. Noem <strong>naam</strong> om als <strong>product</strong> en <strong>prijs</strong> als <strong>verkoopprijs</strong>. Gebruik het sleutelwoord <strong>AS</strong>.',
   obj:"SELECT naam AS product, prijs AS verkoopprijs FROM product ORDER BY verkoopprijs DESC",
   diff:'easy',lpd:'LPD4',xp:55,tbl:'product',time:45,
   hint:'SELECT naam AS product, prijs AS verkoopprijs FROM product ORDER BY verkoopprijs DESC',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err('Begin met SELECT naam AS product, prijs AS verkoopprijs FROM product');
     if(!s.includes(' as ')) return err('Gebruik het sleutelwoord <strong>AS</strong> voor aliassen: naam AS product');
     if(!s.includes('product')&&!s.includes('naam')) return err('Gebruik kolom <strong>naam</strong> met alias <strong>product</strong>: naam AS product');
     if(!s.includes('prijs')&&!s.includes('verkoopprijs')) return err('Gebruik kolom <strong>prijs</strong> met alias <strong>verkoopprijs</strong>: prijs AS verkoopprijs');
     const res = runSQL(sql);
     if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten.');
     const cols = res.rows.length ? Object.keys(res.rows[0]) : [];
     if(!cols.some(c=>c.toLowerCase().includes('product')||c.toLowerCase().includes('naam')))
       return err('Kolomnaam "product" niet gevonden in resultaat. Gebruik: naam AS product');
     return res;
   },
   win:'Rapport met leesbare kolomnamen klaar! CFO tevreden. 📋'},

  {id:'subquery_above_avg',ch:3,title:'Producten boven gemiddelde prijs',icon:'📊',av:'📈',who:'Pricing Team',
   story:'Welke producten kosten <strong>meer dan de gemiddelde prijs</strong>? Los dit op met een <strong>subquery</strong> in de WHERE-clausule.',
   obj:'SELECT naam, prijs FROM product WHERE prijs > (SELECT AVG(prijs) FROM product)',
   diff:'hard',lpd:'LPD4',xp:120,tbl:'product',time:100,
   hint:'SELECT naam, prijs FROM product WHERE prijs > (SELECT AVG(prijs) FROM product)',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT naam, prijs FROM product WHERE prijs > (SELECT AVG(prijs) FROM product)'));
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong>.');
     if(!s.includes('avg')) return err(stripSolution('Gebruik een subquery met <strong>AVG(prijs)</strong> als drempel: WHERE prijs > (SELECT AVG(prijs) FROM product)'));
     if(!s.includes('(select')) return err(stripSolution('Gebruik een subquery tussen haakjes: WHERE prijs > <strong>(SELECT AVG(prijs) FROM product)</strong>'));
     const res = runSQL(sql);
     if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Is de subquery correct?');
     // Valideer: alle teruggegeven prijzen moeten boven het gemiddelde liggen
     const avg = DB.product.rows.reduce((s,r)=>s+r.prijs,0)/DB.product.rows.length;
     if(res.rows.some(r=>Number(r.prijs)<=avg)) return err('Resultaat bevat producten onder het gemiddelde. Controleer de WHERE-conditie.');
     return res;
   },
   win:'Subquery geslaagd! Premium producten geïdentificeerd. 🏆'},

  {id:'subquery_in',ch:3,title:'Klanten die ooit besteld hebben',icon:'🛒',av:'📊',who:'Analytics',
   story:'Welke klanten hebben <strong>minstens één bestelling</strong> geplaatst? Gebruik een subquery met <strong>IN</strong> om klant_id\'s op te zoeken in de bestelling-tabel.',
   obj:'SELECT naam, email FROM klant WHERE klant_id IN (SELECT klant_id FROM bestelling)',
   diff:'hard',lpd:'LPD4',xp:120,tbl:null,time:100,
   hint:'SELECT naam, email FROM klant WHERE klant_id IN (SELECT klant_id FROM bestelling)',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT naam, email FROM klant WHERE klant_id IN (SELECT klant_id FROM bestelling)'));
     if(!s.includes('klant')) return err('Gebruik FROM <strong>klant</strong> voor de buitenste query.');
     if(!s.includes('bestelling')) return err('De subquery moet FROM <strong>bestelling</strong> bevatten om klant_id\'s op te zoeken.');
     if(!s.includes(' in ')) return err(stripSolution('Gebruik het sleutelwoord <strong>IN</strong>: WHERE klant_id IN (SELECT klant_id FROM bestelling)'));
     if(!s.includes('(select')) return err(stripSolution('Gebruik een subquery: WHERE klant_id IN <strong>(SELECT klant_id FROM bestelling)</strong>'));
     const res = runSQL(sql);
     if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer de subquery.');
     return res;
   },
   win:'Klanten met bestellingen gevonden via subquery! Gerichte marketing mogelijk. 📧'},

  {id:'distinct_count',ch:3,title:'Hoeveel unieke steden?',icon:'🔢',av:'📣',who:'Marketing Director',
   story:'Hoeveel <strong>verschillende steden</strong> zijn er in de klantendatabank? Gebruik <strong>COUNT(DISTINCT stad)</strong> om unieke steden te tellen.',
   obj:'SELECT COUNT(DISTINCT stad) FROM klant',
   diff:'medium',lpd:'LPD4',xp:70,tbl:'klant',time:40,
   hint:'SELECT COUNT(DISTINCT stad) FROM klant',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT COUNT(DISTINCT stad) FROM klant'));
     if(!s.includes('count')) return err('Gebruik <strong>COUNT()</strong> om te tellen.');
     if(!s.includes('distinct')) return err('Gebruik <strong>DISTINCT</strong> binnen COUNT om enkel unieke steden te tellen: COUNT(DISTINCT stad)');
     if(!s.includes('stad')) return err('Tel de kolom <strong>stad</strong>: COUNT(DISTINCT stad)');
     if(!s.includes('klant')) return err('Gebruik FROM <strong>klant</strong>.');
     return smartRunMsg(sql);
   },
   win:'Unieke steden geteld! Marketinggebieden bepaald. 🗺️'},

  {id:'join_alias_order',ch:3,title:'JOIN met aliassen en sortering',icon:'🔗',av:'🌐',who:'Raad van Bestuur',
   story:'Overzicht van alle bestellingen: <strong>klantnaam als "klant"</strong>, <strong>productnaam als "artikel"</strong>, datum gesorteerd van nieuwste naar oudste. Combineer JOIN + AS + ORDER BY.',
   obj:'SELECT k.naam AS klant, p.naam AS artikel, b.datum FROM bestelling b, klant k, product p WHERE b.klant_id = k.klant_id AND b.product_id = p.product_id ORDER BY b.datum DESC',
   diff:'hard',lpd:'LPD4',xp:140,tbl:null,time:120,
   hint:'SELECT k.naam AS klant, p.naam AS artikel, b.datum\nFROM bestelling b, klant k, product p\nWHERE b.klant_id = k.klant_id AND b.product_id = p.product_id\nORDER BY b.datum DESC',
   sqlType:'join',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err('Begin met SELECT k.naam AS klant, p.naam AS artikel, b.datum FROM ...');
     if(!s.includes('bestelling')) return err('Voeg <strong>bestelling</strong> toe aan FROM.');
     if(!s.includes('klant')) return err('Voeg <strong>klant</strong> toe aan FROM.');
     if(!s.includes('product')) return err('Voeg <strong>product</strong> toe aan FROM.');
     if(!s.includes('klant_id')) return err('Koppelconditie ontbreekt: b.klant_id = k.klant_id');
     if(!s.includes('product_id')) return err('Koppelconditie ontbreekt: b.product_id = p.product_id');
     if(!s.includes('order by')) return err('Sorteer op datum in aflopende volgorde (nieuwste eerst)');
     const res = runSQL(sql);
     if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer de JOIN-voorwaarden.');
     return res;
   },
   win:'Meesterwerk! JOIN + AS + ORDER BY in één query. Raad van Bestuur staat te klappen. 👏'},

  // ══ H5: Data Architect ══
  {id:'inner_join_basic',ch:4,title:'INNER JOIN: klanten en bestellingen',icon:'🔗',av:'🧑‍💼',who:'Lena — Lead Engineer',
   story:'Tijd voor de ANSI-standaard! Haal alle klanten op <strong>samen met hun besteldatum</strong> via een <strong>INNER JOIN</strong>. Alleen klanten die besteld hebben verschijnen in het resultaat.',
   obj:'SELECT klant.naam, bestelling.datum FROM klant INNER JOIN bestelling ON klant.klant_id = bestelling.klant_id',
   diff:'easy',lpd:'LPD4',xp:60,tbl:null,time:90,
   hint:'SELECT klant.naam, bestelling.datum\nFROM klant\nINNER JOIN bestelling ON klant.klant_id = bestelling.klant_id',
   sqlType:'join',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT klant.naam, bestelling.datum FROM klant INNER JOIN bestelling ...'));
     if(!s.includes('inner join')&&!s.includes('join')) return err('Gebruik <strong>INNER JOIN</strong> om de tabellen te koppelen: FROM klant INNER JOIN bestelling');
     if(!s.includes('on')) return err('Voeg een <strong>ON</strong>-conditie toe om de tabellen te koppelen via de gemeenschappelijke sleutel.');
     if(!s.includes('klant_id')) return err('Koppel de tabellen via het gemeenschappelijke <strong>klant_id</strong>-veld.');
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer de ON-conditie.');
     return res;
   },
   win:'Perfecte INNER JOIN! Enkel klanten met bestellingen zichtbaar. ANSI-syntax onder de knie. ✅'},

  {id:'left_join_all',ch:4,title:'LEFT JOIN: ook klanten zonder bestelling',icon:'⬅️',av:'📊',who:'Alex — Data Analyst',
   story:'We willen <strong>ALLE klanten</strong> zien, ook wie nog nooit iets besteld heeft. Gebruik een <strong>LEFT JOIN</strong> zodat klanten zonder bestelling ook verschijnen (met NULL als datum).',
   obj:'SELECT klant.naam, bestelling.datum FROM klant LEFT JOIN bestelling ON klant.klant_id = bestelling.klant_id',
   diff:'easy',lpd:'LPD4',xp:70,tbl:null,time:90,
   hint:'SELECT klant.naam, bestelling.datum\nFROM klant\nLEFT JOIN bestelling ON klant.klant_id = bestelling.klant_id',
   sqlType:'join',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT klant.naam, bestelling.datum FROM klant LEFT JOIN ...'));
     if(!s.includes('left join')) return err('Gebruik <strong>LEFT JOIN</strong> (niet INNER JOIN) om ook klanten zonder bestelling te tonen.');
     if(!s.includes('on')) return err('Voeg een <strong>ON</strong>-conditie toe om de tabellen te koppelen via de gemeenschappelijke sleutel.');
     const res=runSQL(sql); if(!res.ok) return res;
     // LEFT JOIN moet meer rijen geven dan INNER JOIN
     const innerRes=runSQL('SELECT klant.naam, bestelling.datum FROM klant INNER JOIN bestelling ON klant.klant_id = bestelling.klant_id');
     if(res.rows.length<=innerRes.rows.length) return err('Een LEFT JOIN geeft méér rijen dan een INNER JOIN (ook klanten zonder bestelling). Controleer je JOIN-type.');
     return res;
   },
   win:'LEFT JOIN geslaagd! Lena is onder de indruk: ook klanten zonder bestelling zijn zichtbaar. 🎯'},

  {id:'join_three_tables',ch:4,title:'3-weg JOIN: klant + bestelling + product',icon:'🔀',av:'🌍',who:'Boardroom',
   story:'De board wil weten <strong>wie wat besteld heeft</strong>: klantnaam, productnaam en aankoopprijs. Koppel <strong>drie tabellen</strong> via twee INNER JOINs.',
   obj:'SELECT klant.naam, product.naam, product.prijs FROM klant INNER JOIN bestelling ON klant.klant_id = bestelling.klant_id INNER JOIN product ON bestelling.product_id = product.product_id',
   diff:'medium',lpd:'LPD4',xp:100,tbl:null,time:120,
   hint:'SELECT klant.naam, product.naam, product.prijs\nFROM klant\nINNER JOIN bestelling ON klant.klant_id = bestelling.klant_id\nINNER JOIN product ON bestelling.product_id = product.product_id',
   sqlType:'join',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT klant.naam, product.naam, product.prijs FROM klant INNER JOIN ...'));
     if((s.match(/inner join|join/g)||[]).length<2) return err('Je hebt <strong>twee JOINs</strong> nodig: klant→bestelling én bestelling→product.');
     if(!s.includes('klant_id')) return err('Koppel de eerste JOIN via het gemeenschappelijke klant_id-veld.');
     if(!s.includes('product_id')) return err('Koppel de tweede JOIN via het gemeenschappelijke product_id-veld.');
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer beide ON-condities.');
     return res;
   },
   win:'3-tabel JOIN in één query! Dit is enterprise-niveau SQL. Board of Directors applauds. 👏'},

  {id:'join_with_where',ch:4,title:'JOIN + WHERE: Gentse bestellingen',icon:'📍',av:'📣',who:'Marketing Director',
   story:'Marketing wil een lijst van klanten uit <strong>Gent</strong> met hun bestellingen. Combineer een <strong>INNER JOIN</strong> met een <strong>WHERE</strong>-filter op stad.',
   obj:"SELECT klant.naam, bestelling.datum, bestelling.status FROM klant INNER JOIN bestelling ON klant.klant_id = bestelling.klant_id WHERE klant.stad = 'Gent'",
   diff:'medium',lpd:'LPD4',xp:90,tbl:null,time:100,
   hint:"SELECT klant.naam, bestelling.datum, bestelling.status\nFROM klant\nINNER JOIN bestelling ON klant.klant_id = bestelling.klant_id\nWHERE klant.stad = 'Gent'",
   sqlType:'join',
   check(sql){
     const s=norm(sql);
     if(!s.includes('join')) return err('Gebruik een <strong>INNER JOIN</strong> om klant en bestelling te koppelen.');
     if(!s.includes('where')) return err("Filter op stad via <strong>WHERE klant.stad = 'Gent'</strong>");
     if(!s.includes("'gent'")&&!s.includes('"gent"')) return err("Filter op <strong>Gent</strong> (met aanhalingstekens): WHERE klant.stad = 'Gent'");
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten voor Gent. Controleer de WHERE-conditie en de JOIN.');
     // Verify all results are from Gent
     const klantGentIds = new Set(DB.klant.rows.filter(r=>r.stad==='Gent').map(r=>r.klant_id));
     const resultKlantIds = res.rows.map(r=>r['klant.klant_id']||r.klant_id).filter(Boolean);
     if(resultKlantIds.length && resultKlantIds.some(id=>!klantGentIds.has(id)))
       return err('Resultaat bevat klanten die niet uit Gent komen. Controleer de WHERE.');
     return res;
   },
   win:'JOIN + WHERE gecombineerd! Gentse klanten met hun orders in beeld voor gerichte campagnes. 📍'},

  {id:'groupby_category',ch:4,title:'Omzet per categorie',icon:'📊',av:'💰',who:'Financieel Directeur',
   story:'Kwartaalrapport! Bereken de <strong>totale omzet per productcategorie</strong> via <strong>SUM(prijs)</strong> gegroepeerd op categorie. Sorteer van hoog naar laag.',
   obj:'SELECT categorie, SUM(prijs) FROM product GROUP BY categorie ORDER BY SUM(prijs) DESC',
   diff:'medium',lpd:'LPD4',xp:85,tbl:'product',time:80,
   hint:'SELECT categorie, SUM(prijs) FROM product GROUP BY categorie ORDER BY SUM(prijs) DESC',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.includes('sum')) return err('Gebruik de <strong>SUM()</strong>-functie om de totale prijs te berekenen.');
     if(!s.includes('group by')) return err('Gebruik <strong>GROUP BY</strong> om per categorie te berekenen.');
     if(!s.includes('categorie')) return err('Groepeer op de kolom <strong>categorie</strong>.');
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer je GROUP BY-syntax.');
     return res;
   },
   win:'Omzet per categorie berekend! Elektronica loopt duidelijk het best. Financieel rapport klaar. 📈'},

  {id:'groupby_having',ch:4,title:'HAVING: categorieën met hoge gemiddelde prijs',icon:'🎯',av:'📊',who:'Alex — Data Analyst',
   story:'We willen enkel categorieën zien met een <strong>gemiddelde prijs boven €30</strong>. Gebruik <strong>GROUP BY + HAVING</strong> om groepen te filteren na aggregatie.',
   obj:'SELECT categorie, AVG(prijs) FROM product GROUP BY categorie HAVING AVG(prijs) > 30',
   diff:'hard',lpd:'LPD4',xp:120,tbl:'product',time:100,
   hint:'SELECT categorie, AVG(prijs) FROM product GROUP BY categorie HAVING AVG(prijs) > 30',
   sqlType:'select',
   validation: { expectedColumns: ['categorie'] },
   check(sql){
     const s=norm(sql);
     if(!s.includes('avg')) return err('Gebruik de <strong>AVG()</strong>-functie om het gemiddelde te berekenen.');
     if(!s.includes('group by')) return err('Gebruik <strong>GROUP BY</strong> om te groeperen.');
     if(!s.includes('having')) return err(stripSolution('Gebruik <strong>HAVING</strong> (niet WHERE) om op het groepsgemiddelde te filteren: HAVING AVG(prijs) > 30'));
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Is de HAVING-drempel correct? Probeer een lagere waarde om te testen.');
     // Valideer: alle teruggegeven gemiddelden moeten > 30 zijn
     const allAbove = res.rows.every(r => {
       const v = Object.values(r).find(v => typeof v === 'string' && !isNaN(parseFloat(v)));
       return v ? parseFloat(v) > 30 : true;
     });
     if(!allAbove) return err('Resultaat bevat categorieën met gemiddelde prijs ≤ 30. Controleer de HAVING-conditie.');
     return res;
   },
   win:'HAVING gemeisterd! Enkel dure categorieën zichtbaar. Dit is het verschil tussen WHERE en HAVING. 🏆'},

  {id:'groupby_count_status',ch:4,title:'Bestellingen per status tellen',icon:'📦',who:'Logistiek Manager',av:'🚚',
   story:'Logistiek wil weten hoeveel bestellingen er per status zijn (geleverd, onderweg, verwerking). Gebruik <strong>COUNT(*) + GROUP BY status</strong>.',
   obj:'SELECT status, COUNT(*) FROM bestelling GROUP BY status',
   diff:'easy',lpd:'LPD4',xp:65,tbl:'bestelling',time:60,
   hint:'SELECT status, COUNT(*) FROM bestelling GROUP BY status',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.includes('count')) return err('Gebruik <strong>COUNT(*)</strong> om het aantal bestellingen te tellen.');
     if(!s.includes('group by')) return err('Gebruik <strong>GROUP BY</strong> om per status te groeperen.');
     if(!s.includes('status')) return err('Groepeer op de kolom <strong>status</strong>.');
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer je GROUP BY-syntax.');
     return res;
   },
   win:'Logistiek rapport klaar! Per status weten we exact hoeveel bestellingen wachten. 🚚'},

  {id:'create_table_leverancier',ch:4,title:'CREATE TABLE + INSERT: leveranciers beheren',icon:'🏗️',av:'🧑‍💼',who:'Lena — Lead Engineer',
   story:'Herhaling op expert-niveau. Stap 1: Maak tabel <strong>leverancier</strong> opnieuw aan (leverancier_id PK AUTO_INCREMENT, naam NOT NULL, email, land). Stap 2: Voeg meteen een tweede leverancier in: <strong>CloudBase NV</strong>, cloud@cloudbase.be, Nederland.',
   obj:'Stap 1: CREATE TABLE leverancier · Stap 2: INSERT tweede leverancier',
   diff:'medium',lpd:'LPD5',xp:110,tbl:null,time:120,
   sqlType:'ddl',
   hint:'CREATE TABLE leverancier (\n  leverancier_id INT PRIMARY KEY AUTO_INCREMENT,\n  naam VARCHAR(100) NOT NULL,\n  email VARCHAR(150),\n  land VARCHAR(80)\n)',
   steps:[
     {
       label:'CREATE TABLE leverancier',
       sqlType:'ddl',
       placeholder:'CREATE TABLE leverancier (...)',
       hint:'CREATE TABLE leverancier (\n  leverancier_id INT PRIMARY KEY AUTO_INCREMENT,\n  naam VARCHAR(100) NOT NULL,\n  email VARCHAR(150),\n  land VARCHAR(80)\n)',
       check(sql){
         const s=norm(sql);
         // Reset tabel zodat dit scenario altijd werkt, ook als H2-combo al uitgevoerd was
         if(DB.leverancier) delete DB.leverancier;
         if(!s.startsWith('create table')) return err('Begin met <strong>CREATE TABLE leverancier</strong> (...)');
         if(!s.includes('leverancier')) return err('Noem de tabel <strong>leverancier</strong>.');
         if(!s.includes('primary key')) return err('Voeg <strong>PRIMARY KEY</strong> toe aan leverancier_id.');
         if(!s.includes('auto_increment')) return err('Voeg <strong>AUTO_INCREMENT</strong> toe.');
         if(!s.includes('not null')) return err('Maak <strong>naam</strong> verplicht via <strong>NOT NULL</strong>.');
         if(!s.includes('varchar')) return err('Gebruik <strong>VARCHAR</strong> voor tekstvelden.');
         const res=runSQL(sql); if(!res.ok) return res;
         if(!DB.leverancier) return err('Tabel niet aangemaakt. Controleer je syntax.');
         return res;
       },
       successMsg:'Tabel leverancier aangemaakt! Voeg nu een leverancier in.',
     },
     {
       label:'INSERT CloudBase NV',
       sqlType:'insert',
       placeholder:"INSERT INTO leverancier (naam, email, land) VALUES (...)",
       hint:"INSERT INTO leverancier (naam, email, land)\nVALUES ('CloudBase NV', 'cloud@cloudbase.be', 'Nederland')",
       check(sql){
         const s=norm(sql);
         if(!s.startsWith('insert')) return err('Begin met <strong>INSERT INTO leverancier</strong>.');
         if(!s.includes('leverancier')) return err('Voeg in in tabel <strong>leverancier</strong>.');
         if(!s.includes('cloudbase')) return err('Naam "CloudBase NV" ontbreekt.');
         if(!s.includes('cloud@cloudbase.be')) return err('E-mailadres "cloud@cloudbase.be" ontbreekt.');
         if(!s.includes('nederland')) return err('Land "Nederland" ontbreekt.');
         return smartRunMsg(sql);
       },
     },
   ],
   win:'Expert-niveau bereikt! CREATE TABLE + INSERT uitgevoerd als een pro. 🏗️'},

  {id:'alter_add_column',ch:4,title:'ALTER TABLE: kolom toevoegen & vullen',icon:'📞',av:'🧑‍💼',who:'Lena — Lead Engineer',
   story:'Stap 1: Voeg kolom <strong>geboortedatum DATE</strong> toe aan tabel <strong>klant</strong>. Stap 2: Vul het geboortedatum van Jana Pieters (klant_id=1) in: <strong>1990-03-15</strong>. Zo zie je het verschil tussen structuur aanpassen (DDL) en data aanpassen (DML).',
   obj:'Stap 1: ALTER TABLE klant ADD COLUMN geboortedatum · Stap 2: UPDATE klant SET geboortedatum',
   diff:'medium',lpd:'LPD5',xp:90,tbl:'klant',time:90,
   sqlType:'ddl',
   hint:'ALTER TABLE klant ADD COLUMN geboortedatum DATE',
   steps:[
     {
       label:'ALTER TABLE — kolom aanmaken',
       sqlType:'ddl',
       placeholder:'ALTER TABLE klant ADD COLUMN geboortedatum DATE',
       hint:'ALTER TABLE klant ADD COLUMN geboortedatum DATE',
       check(sql){
         const s=norm(sql);
         // Reset kolom als al eerder aangemaakt zodat dit scenario altijd werkt
         const existing = DB.klant.cols.findIndex(c=>c.n==='geboortedatum');
         if(existing !== -1) DB.klant.cols.splice(existing, 1);
         if(!s.startsWith('alter')) return err('Begin met <strong>ALTER TABLE klant</strong>.');
         if(!s.includes('klant')) return err('Pas de tabel <strong>klant</strong> aan.');
         if(!s.includes('add')) return err('Gebruik <strong>ADD COLUMN</strong>.');
         if(!s.includes('geboortedatum')) return err('Geef de kolom de naam <strong>geboortedatum</strong>.');
         if(!s.includes('date')) return err('Gebruik datatype <strong>DATE</strong> voor datumvelden.');
         const res=runSQL(sql); if(!res.ok) return res;
         return {ok:true,type:'ddl',msg:'Kolom geboortedatum toegevoegd! Alle klanten hebben nu geboortedatum = NULL.'};
       },
       successMsg:'DDL geslaagd — de structuur is aangepast. Nu vul je de data in met UPDATE.',
     },
     {
       label:"UPDATE klant SET geboortedatum WHERE klant_id=1",
       sqlType:'update',
       placeholder:"UPDATE klant SET geboortedatum = '1990-03-15' WHERE klant_id = 1",
       hint:"UPDATE klant\nSET geboortedatum = '1990-03-15'\nWHERE klant_id = 1",
       check(sql){
         const s=norm(sql);
         if(!s.startsWith('update')) return err('Begin met <strong>UPDATE klant</strong>.');
         if(!s.includes('geboortedatum')) return err('Stel de kolom <strong>geboortedatum</strong> in via SET.');
         if(!s.includes('1990')) return err("Vul de datum <strong>'1990-03-15'</strong> in.");
         if(!s.includes('klant_id')) return err('Voeg een <strong>WHERE klant_id = 1</strong> toe — anders update je alle klanten!');
         const res=runSQL(sql); if(!res.ok) return res;
         return res;
       },
     },
   ],
   win:'Structuur aangepast én data ingevuld! Je kent nu het verschil tussen DDL (schema) en DML (data). 🧬'},

  {id:'join_having_advanced',ch:4,title:'JOIN + GROUP BY + HAVING: topklanten',icon:'🌟',av:'📈',who:'Venture Capitalist',
   story:'De investeerders willen de <strong>klanten die meer dan 1 bestelling</strong> geplaatst hebben. Koppel klant aan bestelling, groepeer per klant en filter via HAVING. Dit is het meest geavanceerde patroon in SQL.',
   obj:'SELECT klant.naam, COUNT(*) FROM klant INNER JOIN bestelling ON klant.klant_id = bestelling.klant_id GROUP BY klant.naam HAVING COUNT(*) > 1',
   diff:'hard',lpd:'LPD4',xp:150,tbl:null,time:150,
   hint:'SELECT klant.naam, COUNT(*)\nFROM klant\nINNER JOIN bestelling ON klant.klant_id = bestelling.klant_id\nGROUP BY klant.naam\nHAVING COUNT(*) > 1',
   sqlType:'join',
   check(sql){
     const s=norm(sql);
     if(!s.includes('join')) return err('Gebruik een <strong>INNER JOIN</strong> om klant en bestelling te koppelen.');
     if(!s.includes('count')) return err('Gebruik <strong>COUNT(*)</strong> om het aantal bestellingen per klant te tellen.');
     if(!s.includes('group by')) return err('Gebruik <strong>GROUP BY</strong> om per klant te groeperen.');
     if(!s.includes('having')) return err('Gebruik <strong>HAVING COUNT(*) > 1</strong> om enkel klanten met meer dan 1 bestelling te tonen.');
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Zijn er klanten met meer dan 1 bestelling in de data?');
     return res;
   },
   win:'JOIN + GROUP BY + HAVING in één query! Dit is het niveau van een senior data engineer. Investeerders tekenen. 🌟💰'},

  // ── NIEUWE SCENARIO'S: Betere diversiteit voor dagelijkse uitdagingen ──

  // EASY — DELETE
  {id:'delete_review',ch:0,title:'Slechte review verwijderen',icon:'🗑️',av:'😠',who:'Klant',
   story:'Klant Lena Maes dient een verwijderverzoek in voor haar review (review_id=3). Verwijder alleen die review.',
   obj:'DELETE FROM review WHERE review_id = 3',
   diff:'easy',lpd:'LPD5',xp:45,tbl:'review',time:40,
   hint:'DELETE FROM review WHERE review_id = 3',
   sqlType:'delete',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('delete')) return err(stripSolution('Gebruik DELETE FROM review WHERE review_id = 3'));
     if(!s.includes('review')) return err('Tabel is <strong>review</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht bij DELETE! Zonder WHERE verwijder je ALLE reviews.');
     if(!s.includes('3')&&!s.includes('review_id')) return err('Voeg een WHERE-clausule toe om slechts één review te verwijderen.');
     return smartRunMsg(sql);
   },
   win:'Review verwijderd. Verzoek GDPR-conform verwerkt. ✅'},

  // EASY — INSERT (review)
  {id:'insert_review',ch:0,title:'Klantreview toevoegen',icon:'⭐',av:'😊',who:'Tevreden Klant',
   story:'Jana Pieters (klant_id=1) geeft product 3 (Notitieboek A5) een score van <strong>5</strong> met commentaar <strong>"Top kwaliteit!"</strong>.',
   obj:"INSERT INTO review (klant_id, product_id, score, commentaar) VALUES (1, 3, 5, 'Top kwaliteit!')",
   diff:'easy',lpd:'LPD5',xp:50,tbl:'review',time:50,
   hint:"INSERT INTO review (klant_id, product_id, score, commentaar) VALUES (1, 3, 5, 'Top kwaliteit!')",
   sqlType:'insert',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('insert')) return err(stripSolution('Gebruik INSERT INTO review (...) VALUES (...)'));
     if(!s.includes('review')) return err('Tabel is <strong>review</strong>.');
     if(!s.includes('score')) return err('Vergeet kolom <strong>score</strong> niet in de kolomlijst.');
     if(!s.includes('5')) return err('Score is <strong>5</strong>. Voeg die toe in VALUES.');
     if(!s.includes('top')) return err('Commentaar "Top kwaliteit!" ontbreekt in VALUES.');
     return smartRunMsg(sql);
   },
   win:'Review opgeslagen! Jana is blij gehoord te worden. ⭐'},

  // EASY — UPDATE (kortingscode activeren)
  {id:'activate_coupon',ch:0,title:'Kortingscode activeren',icon:'🎟️',av:'💼',who:'Marketing',
   story:'Zomercampagne! Kortingscode <strong>ZOMER20</strong> moet geactiveerd worden (actief = 1).',
   obj:"UPDATE kortingscode SET actief = 1 WHERE code = 'ZOMER20'",
   diff:'easy',lpd:'LPD5',xp:40,tbl:'kortingscode',time:35,
   hint:"UPDATE kortingscode SET actief = 1 WHERE code = 'ZOMER20'",
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('update')) return err("Gebruik UPDATE kortingscode SET actief = 1 WHERE code = 'ZOMER20'");
     if(!s.includes('kortingscode')) return err('Tabel is <strong>kortingscode</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Anders activeer je ALLE kortingscodes.');
     if(!s.includes('zomer20')) return err("Filter op code = 'ZOMER20'. Vergeet de aanhalingstekens niet.");
     if(!s.includes('actief')) return err('Gebruik SET om de actief-kolom op de juiste waarde te zetten.');
     return smartRunMsg(sql);
   },
   win:'ZOMER20 geactiveerd! Campagne kan starten. 🌞'},

  // MEDIUM — DELETE (klant zonder bestellingen)
  {id:'delete_inactive',ch:1,title:'Inactieve klant verwijderen',icon:'🧹',av:'⚖️',who:'Juridische Dienst',
   story:'Audit resultaat: klant_id=4 (Kobe Janssen) is inactief en heeft nooit besteld. Hij mag volledig verwijderd worden.',
   obj:'DELETE FROM klant WHERE klant_id = 4',
   diff:'medium',lpd:'LPD5',xp:65,tbl:'klant',time:45,
   hint:'DELETE FROM klant WHERE klant_id = 4',
   sqlType:'delete',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('delete')) return err(stripSolution('Gebruik DELETE FROM klant WHERE klant_id = 4'));
     if(!s.includes('klant')) return err('Tabel is <strong>klant</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht bij DELETE! Zonder WHERE verwijder je ALLE klanten.');
     if(!s.includes('4')&&!s.includes('klant_id')) return err('Voeg een WHERE-clausule toe om de juiste klant te filteren.');
     return smartRunMsg(sql);
   },
   win:'Kobe correct verwijderd uit de databank. 🧹'},

  // MEDIUM — INSERT (kortingscode)
  {id:'insert_coupon',ch:1,title:'Nieuwe kortingscode aanmaken',icon:'🎁',av:'💼',who:'Marketing Manager',
   story:'Zwarte Vrijdag! Maak kortingscode <strong>BLACK30</strong> aan: <strong>30%</strong> korting, actief (1), gebruik <strong>0</strong>.',
   obj:"INSERT INTO kortingscode (code, korting, actief, gebruik) VALUES ('BLACK30', 30, 1, 0)",
   diff:'medium',lpd:'LPD5',xp:65,tbl:'kortingscode',time:55,
   hint:"INSERT INTO kortingscode (code, korting, actief, gebruik) VALUES ('BLACK30', 30, 1, 0)",
   sqlType:'insert',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('insert')) return err(stripSolution('Gebruik INSERT INTO kortingscode (...) VALUES (...)'));
     if(!s.includes('kortingscode')) return err('Tabel is <strong>kortingscode</strong>.');
     if(!s.includes('black30')) return err('Code "BLACK30" ontbreekt in VALUES. Zet tekst tussen aanhalingstekens.');
     if(!s.includes('30')) return err('Korting van <strong>30</strong> ontbreekt in VALUES.');
     if(!s.includes('gebruik')) return err('Vergeet kolom <strong>gebruik</strong> niet (waarde: 0).');
     return smartRunMsg(sql);
   },
   win:'BLACK30 aangemaakt! Klanten gaan genieten van 30% korting. 🛍️'},

  // MEDIUM — UPDATE (stock verhogen per categorie)
  {id:'update_stock_category',ch:1,title:'Elektronicastock verhogen',icon:'🔋',av:'🏭',who:'Inkoopmanager',
   story:'Grote levering elektronica binnen! Verhoog de stock van <strong>alle Elektronica-producten</strong> met <strong>10</strong>.',
   obj:"UPDATE product SET stock = stock + 10 WHERE categorie = 'Elektronica'",
   diff:'medium',lpd:'LPD5',xp:75,tbl:'product',time:60,
   hint:"UPDATE product SET stock = stock + 10 WHERE categorie = 'Elektronica'",
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('update')) return err("Gebruik UPDATE product SET stock = stock + 10 WHERE categorie = 'Elektronica'");
     if(!s.includes('product')) return err('Tabel is <strong>product</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Anders pas je de stock van ALLE producten aan.');
     if(!s.includes('elektronica')) return err("Filter op categorie = 'Elektronica'. Vergeet de aanhalingstekens niet.");
     if(!s.includes('stock + 10')&&!s.includes('stock+10')&&!s.includes('stock +10')) return err('Gebruik een <strong>relatieve optelling</strong> in SET — voeg het getal bij de huidige waarde op.');
     return smartRunMsg(sql);
   },
   win:'Elektronicastock opgehoogd! Geen tekorten meer. ⚡'},

  // MEDIUM — DELETE (reviews van product)
  {id:'delete_product_reviews',ch:1,title:'Reviews van gestopt product wissen',icon:'🗑️',av:'📦',who:'Productmanager',
   story:'Product 3 (Notitieboek A5) wordt stopgezet. Verwijder alle reviews van product_id=3 vóór het product zelf weg kan.',
   obj:'DELETE FROM review WHERE product_id = 3',
   diff:'medium',lpd:'LPD5',xp:60,tbl:'review',time:45,
   hint:'DELETE FROM review WHERE product_id = 3',
   sqlType:'delete',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('delete')) return err(stripSolution('Gebruik DELETE FROM review WHERE product_id = 3'));
     if(!s.includes('review')) return err('Verwijder uit tabel <strong>review</strong>, niet uit product.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Anders verwijder je ALLE reviews.');
     if(!s.includes('product_id')) return err('Voeg een WHERE-clausule toe om te filteren op het juiste product.');
     if(!s.includes('3')) return err('Filter op product_id = <strong>3</strong> (Notitieboek A5).');
     return smartRunMsg(sql);
   },
   win:'Reviews verwijderd. Product kan nu volledig uit de databank. 🧹'},

  // HARD — DELETE met subquery
  {id:'delete_no_orders',ch:2,title:'Klanten zonder bestelling verwijderen',icon:'🧹',av:'📊',who:'Data Engineer',
   story:'Dataopschoning: verwijder alle klanten die <strong>nooit een bestelling</strong> hebben geplaatst. Gebruik NOT IN met een subquery.',
   obj:'DELETE FROM klant WHERE klant_id NOT IN (SELECT klant_id FROM bestelling)',
   diff:'hard',lpd:'LPD5',xp:115,tbl:'klant',time:90,
   hint:'DELETE FROM klant WHERE klant_id NOT IN (SELECT klant_id FROM bestelling)',
   sqlType:'delete',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('delete')) return err(stripSolution('Gebruik DELETE FROM klant WHERE klant_id NOT IN (SELECT klant_id FROM bestelling)'));
     if(!s.includes('klant')) return err('Verwijder uit tabel <strong>klant</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Filter klanten zonder bestelling via een subquery.');
     if(!s.includes('not in')) return err('Gebruik <strong>NOT IN</strong>: WHERE klant_id NOT IN (...)');
     if(!s.includes('(select')) return err(stripSolution('Gebruik een subquery: WHERE klant_id NOT IN <strong>(SELECT klant_id FROM bestelling)</strong>'));
     if(!s.includes('bestelling')) return err('De subquery haalt klant_ids op uit tabel <strong>bestelling</strong>.');
     return smartRunMsg(sql);
   },
   win:'Klanten zonder bestellingen opgeruimd. Zuivere databank! 🧹'},

  // HARD — INSERT (complexe bestelling)
  {id:'insert_bulk_order',ch:2,title:'Bestelling van topklant verwerken',icon:'🛒',av:'📬',who:'Orderverwerking',
   story:'Fatima El Asri (klant_id=5) bestelde 2x Ergonomische stoel (product_id=4) op <strong>2025-01-15</strong>. Status: <strong>"verwerking"</strong>.',
   obj:"INSERT INTO bestelling (klant_id, product_id, datum, aantal, status) VALUES (5, 4, '2025-01-15', 2, 'verwerking')",
   diff:'hard',lpd:'LPD5',xp:100,tbl:'bestelling',time:70,
   hint:"INSERT INTO bestelling (klant_id, product_id, datum, aantal, status) VALUES (5, 4, '2025-01-15', 2, 'verwerking')",
   sqlType:'insert',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('insert')) return err(stripSolution('Gebruik INSERT INTO bestelling (...) VALUES (...)'));
     if(!s.includes('bestelling')) return err('Tabel is <strong>bestelling</strong>.');
     if(!s.includes('2025-01-15')) return err("Datum 2025-01-15 ontbreekt. Schrijf datums als <code>'2025-01-15'</code>");
     if(!s.includes('verwerking')) return err('Status "verwerking" ontbreekt in VALUES. Tekst hoort tussen aanhalingstekens.');
     if(!s.includes('5')) return err('klant_id = <strong>5</strong> (Fatima El Asri) ontbreekt in VALUES.');
     if(!s.includes('4')) return err('product_id = <strong>4</strong> (Ergonomische stoel) ontbreekt in VALUES.');
     return smartRunMsg(sql);
   },
   win:'Bestellingsverwerking afgerond. Fatima krijgt een bevestiging. 📧'},

  // HARD — UPDATE met meerdere kolommen
  {id:'update_top_discount',ch:2,title:'VIP kortingscode upgraden',icon:'👑',av:'🎯',who:'Marketing Director',
   story:'VIP-actie: verhoog de korting van <strong>TROUW15</strong> naar <strong>25%</strong> én verhoog het gebruik met 1 (loyaliteitsbonus).',
   obj:"UPDATE kortingscode SET korting = 25, gebruik = gebruik + 1 WHERE code = 'TROUW15'",
   diff:'hard',lpd:'LPD5',xp:105,tbl:'kortingscode',time:75,
   hint:"UPDATE kortingscode SET korting = 25, gebruik = gebruik + 1 WHERE code = 'TROUW15'",
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('update')) return err("Gebruik UPDATE kortingscode SET korting = 25, gebruik = gebruik + 1 WHERE code = 'TROUW15'");
     if(!s.includes('kortingscode')) return err('Tabel is <strong>kortingscode</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Anders pas je ALLE kortingscodes aan.');
     if(!s.includes('trouw15')) return err("Filter op code = 'TROUW15'. Vergeet de aanhalingstekens niet.");
     if(!s.includes('25')) return err('Nieuwe korting is <strong>25</strong>. Vergeet dat niet in SET.');
     if(!s.includes('gebruik')) return err('Verhoog ook <strong>gebruik</strong> met 1: gebruik = gebruik + 1');
     return smartRunMsg(sql);
   },
   win:'TROUW15 bijgewerkt naar 25% korting. VIP-klant in de wolken! 👑'},

  // HARD — DELETE (score filter)
  {id:'delete_old_reviews',ch:3,title:'Negatieve reviews opschonen',icon:'🗑️',av:'📈',who:'Reputatiemanager',
   story:'Negatieve reviews (score ≤ 2) schaden de reputatie. Verwijder alle reviews met score <strong>kleiner dan of gelijk aan 2</strong>.',
   obj:'DELETE FROM review WHERE score <= 2',
   diff:'hard',lpd:'LPD5',xp:100,tbl:'review',time:55,
   hint:'DELETE FROM review WHERE score <= 2',
   sqlType:'delete',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('delete')) return err('Schrijf een DELETE-statement met een WHERE-clausule die de gevraagde scores filtert.');
     if(!s.includes('review')) return err('Verwijder uit tabel <strong>review</strong>.');
     if(!s.includes('where')) return err('⚠️ WHERE verplicht! Zonder WHERE verwijder je ALLE reviews.');
     if(!s.includes('score')) return err('Filter op kolom <strong>score</strong>. Reviews met score ≤ 2 moeten weg.');
     if(!s.includes('<=')&&!s.includes('< 3')&&!s.includes('<3')) return err('Gebruik de juiste vergelijkingsoperator in je WHERE-clausule om lage scores te filteren.');
     return smartRunMsg(sql);
   },
   win:'Lage reviews verwijderd. Reputatie hersteld! ⭐'},

  // HARD — INSERT (leverancier)
  // ── NIEUWE MISSIES: LIKE / BETWEEN / IS NULL / NOT IN / CASE WHEN ──

  // H2 — LIKE (easy)
  {id:'like_search',ch:1,title:'Klanten zoeken op naam',icon:'🔎',av:'📣',who:'Marketing',
   story:'Marketing wil een campagne sturen naar alle klanten waarvan de naam begint met de letter <strong>J</strong>. Gebruik <strong>LIKE</strong> om op naampatroon te filteren.',
   obj:"SELECT naam, email FROM klant WHERE naam LIKE 'J%'",
   diff:'easy',lpd:'LPD4',xp:50,tbl:'klant',time:45,conceptType:'like',
   hint:"SELECT naam, email FROM klant WHERE naam LIKE 'J%'",
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err("Begin met SELECT naam, email FROM klant WHERE naam LIKE 'J%'");
     if(!s.includes('from klant')) return err('Gebruik FROM <strong>klant</strong>.');
     if(!s.includes('like')) return err("Gebruik <strong>LIKE</strong> om op patroon te filteren: WHERE naam LIKE 'J%'");
     if(!s.includes("'j%'")&&!s.includes('"j%"')) return err("Gebruik het patroon <code>'J%'</code> — % staat voor nul of meer tekens na de J.");
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err("Geen resultaten. Controleer het LIKE-patroon: 'J%' (hoofdletter of kleine letter).");
     return res;
   },
   win:'J-klanten gevonden! Campagne verstuurd. 📣'},

  // H2 — BETWEEN (easy)
  {id:'between_price',ch:1,title:'Middensegment producten',icon:'💰',av:'📦',who:'Inkoopmanager',
   story:'Inkoop zoekt producten in het middensegment: prijs <strong>tussen €20 en €80</strong> (inclusief). Gebruik <strong>BETWEEN</strong>.',
   obj:'SELECT naam, prijs FROM product WHERE prijs BETWEEN 20 AND 80',
   diff:'easy',lpd:'LPD4',xp:50,tbl:'product',time:40,conceptType:'between',
   hint:'SELECT naam, prijs FROM product WHERE prijs BETWEEN 20 AND 80',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err('Begin met SELECT naam, prijs FROM product WHERE prijs BETWEEN 20 AND 80');
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong>.');
     if(!s.includes('between')) return err('Gebruik <strong>BETWEEN ... AND ...</strong> om een prijsbereik te filteren.');
     if(!s.includes('20')&&!s.includes('and')) return err('Schrijf het bereik als: BETWEEN <strong>20</strong> AND <strong>80</strong>');
     const res=runSQL(sql); if(!res.ok) return res;
     if(res.rows&&res.rows.some(r=>Number(r.prijs)<20||Number(r.prijs)>80)) return err('Resultaat bevat producten buiten het bereik €20–€80. Controleer je BETWEEN-waarden.');
     return res;
   },
   win:'Middensegment in kaart gebracht! Inkoopstrategie klaar. 💼'},

  // H3 — IS NULL (medium)
  {id:'null_email',ch:2,title:'Klanten zonder e-mailadres',icon:'📭',av:'📊',who:'Analytics',
   story:'Dataopschoning: welke klanten hebben <strong>geen e-mailadres</strong> ingevuld? Gebruik <strong>IS NULL</strong> — nooit <code>= NULL</code>!',
   obj:'SELECT naam FROM klant WHERE email IS NULL',
   diff:'medium',lpd:'LPD4',xp:65,tbl:'klant',time:35,conceptType:'isnull',
   hint:'SELECT naam FROM klant WHERE email IS NULL',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err('Begin met SELECT naam FROM klant WHERE email IS NULL');
     if(!s.includes('klant')) return err('Gebruik FROM <strong>klant</strong>.');
     if(s.includes('= null')||s.includes('=null')) return err('❌ <code>= NULL</code> werkt nooit in SQL! Gebruik altijd <strong>IS NULL</strong>.');
     if(!s.includes('is null')) return err('Gebruik <strong>IS NULL</strong> om op ontbrekende waarden te filteren: WHERE email IS NULL');
     if(!s.includes('email')) return err('Filter op kolom <strong>email</strong>: WHERE email IS NULL');
     return smartRunMsg(sql);
   },
   win:'Klanten zonder e-mail gevonden. Klantenservice neemt contact op via post. 📬'},

  // H3 — NOT IN (medium)
  {id:'not_in_products',ch:2,title:'Producten zonder reviews',icon:'⭐',av:'📊',who:'Productmanager',
   story:'Welke producten hebben <strong>nog nooit een review</strong> ontvangen? Gebruik <strong>NOT IN</strong> met een subquery op de review-tabel.',
   obj:'SELECT naam FROM product WHERE product_id NOT IN (SELECT product_id FROM review)',
   diff:'medium',lpd:'LPD4',xp:90,tbl:null,time:80,
   hint:'SELECT naam FROM product WHERE product_id NOT IN (SELECT product_id FROM review)',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err(stripSolution('Begin met SELECT naam FROM product WHERE product_id NOT IN (SELECT product_id FROM review)'));
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong> voor de buitenste query.');
     if(!s.includes('not in')) return err('Gebruik <strong>NOT IN</strong> om producten uit te sluiten die al een review hebben.');
     if(!s.includes('(select')) return err(stripSolution('Gebruik een subquery: WHERE product_id NOT IN <strong>(SELECT product_id FROM review)</strong>'));
     if(!s.includes('review')) return err('De subquery haalt product_ids op uit tabel <strong>review</strong>.');
     const res=runSQL(sql); if(!res.ok) return res;
     // Check: no returned product should have a review
     const reviewedIds=new Set(DB.review.rows.map(r=>r.product_id));
     if(res.rows.some(r=>{const p=DB.product.rows.find(pr=>pr.naam===r.naam||pr.naam===r['naam']);return p&&reviewedIds.has(p.product_id);}))
       return err('Resultaat bevat producten die al een review hebben. Controleer je NOT IN-subquery.');
     return res;
   },
   win:'Producten zonder feedback geïdentificeerd. Inkoopteam stuurt testpakketjes. 📦'},

  // H3 — Anti-JOIN IS NULL (hard)
  {id:'anti_join_no_orders',ch:2,title:'Klanten die nog nooit besteld hebben',icon:'😴',av:'📣',who:'Marketing Director',
   story:'Marketing wil klanten activeren die <strong>nooit een bestelling</strong> hebben geplaatst. Gebruik een <strong>LEFT JOIN + WHERE IS NULL</strong> (anti-join patroon).',
   obj:'SELECT klant.naam, klant.email FROM klant LEFT JOIN bestelling ON klant.klant_id = bestelling.klant_id WHERE bestelling.klant_id IS NULL',
   diff:'hard',lpd:'LPD4',xp:125,tbl:null,time:110,
   hint:'SELECT klant.naam, klant.email\nFROM klant\nLEFT JOIN bestelling ON klant.klant_id = bestelling.klant_id\nWHERE bestelling.klant_id IS NULL',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.includes('left join')) return err('Gebruik <strong>LEFT JOIN</strong> — alle klanten blijven zichtbaar, ook zonder bestelling.');
     if(!s.includes('is null')) return err('Voeg <strong>WHERE bestelling.klant_id IS NULL</strong> toe om enkel klanten zonder bestelling te tonen.');
     if(!s.includes('bestelling')) return err('JOIN de tabel <strong>bestelling</strong> en koppel via het gemeenschappelijke sleutelveld.');
     const res=runSQL(sql); if(!res.ok) return res;
     // All returned klanten should have NO bestelling
     const bestellingIds=new Set(DB.bestelling.rows.map(r=>r.klant_id));
     const klantIdMap=Object.fromEntries(DB.klant.rows.map(r=>[r.naam,r.klant_id]));
     if(res.rows.some(r=>{
       // Support both raw 'naam', aliased 'klant.naam', or any alias like 'klant'
       const nameVal=r.naam||r['klant.naam']||r.klant||Object.values(r)[0];
       const kid=klantIdMap[nameVal];
       return kid&&bestellingIds.has(kid);
     }))
       return err('Resultaat bevat klanten die wél bestellingen hebben. Controleer de IS NULL-conditie.');
     if(!rowCount(res)) return err('Geen klanten gevonden zonder bestelling. Controleer de LEFT JOIN + IS NULL combinatie.');
     return res;
   },
   win:'Slapende klanten gevonden! Win-back campagne gestart. 📧'},

  // H4 — LIKE met JOIN (medium)
  {id:'like_product_search',ch:3,title:'Producten zoeken op sleutelwoord',icon:'🔍',av:'🛒',who:'Webshop Team',
   story:'De zoekbalk van de webshop filtert producten op naam. Zoek alle producten waarvan de naam <strong>"Cam"</strong> bevat — klanten zoeken naar camera\'s en webcams.',
   obj:"SELECT naam, prijs, stock FROM product WHERE naam LIKE '%Cam%'",
   diff:'medium',lpd:'LPD4',xp:70,tbl:'product',time:45,
   hint:"SELECT naam, prijs, stock FROM product WHERE naam LIKE '%Cam%'",
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err("Begin met SELECT naam, prijs, stock FROM product WHERE naam LIKE '%Cam%'");
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong>.');
     if(!s.includes('like')) return err("Gebruik <strong>LIKE</strong> met wildcard: WHERE naam LIKE '%Cam%'");
     if(!s.includes('%cam%')&&!s.includes("'%cam%'")&&!s.includes('"cam"')) return err("Gebruik <code>'%Cam%'</code> — % aan beide kanten betekent 'bevat Cam'.");
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err("Geen producten gevonden. Controleer het patroon '%Cam%'.");
     return res;
   },
   win:'Zoekresultaten gevonden! Webcam HD en Camera-producten zichtbaar. 📷'},

  // H4 — BETWEEN datum (medium)
  {id:'between_dates',ch:3,title:'Bestellingen van Q4 2024',icon:'📅',av:'📊',who:'Alex — Data Analyst',
   story:'Kwartaalrapport: haal alle bestellingen op van <strong>Q4 2024</strong> — van 1 oktober tot en met 31 december 2024. Gebruik <strong>BETWEEN</strong> met datums.',
   obj:"SELECT bestelling_id, datum, status FROM bestelling WHERE datum BETWEEN '2024-10-01' AND '2024-12-31'",
   diff:'medium',lpd:'LPD4',xp:80,tbl:'bestelling',time:60,
   hint:"SELECT bestelling_id, datum, status FROM bestelling WHERE datum BETWEEN '2024-10-01' AND '2024-12-31'",
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err("Begin met SELECT ... FROM bestelling WHERE datum BETWEEN '2024-10-01' AND '2024-12-31'");
     if(!s.includes('bestelling')) return err('Gebruik FROM <strong>bestelling</strong>.');
     if(!s.includes('between')) return err("Gebruik <strong>BETWEEN '2024-10-01' AND '2024-12-31'</strong> voor het datumbereik.");
     if(!s.includes('datum')) return err('Filter op kolom <strong>datum</strong>: WHERE datum BETWEEN ...');
     if(!s.includes('2024-10-01')&&!s.includes('2024-10')) return err("Startdatum is <strong>'2024-10-01'</strong> (begin Q4). Datums schrijf je als tekst tussen aanhalingstekens.");
     if(!s.includes('2024-12-31')&&!s.includes('2024-12')) return err("Einddatum is <strong>'2024-12-31'</strong> (einde Q4).");
     const res=runSQL(sql); if(!res.ok) return res;
     return res;
   },
   win:'Q4-rapport klaar! Alle bestellingen van het laatste kwartaal in beeld. 📊'},

  // H5 — CASE WHEN (hard)
  {id:'case_stock_status',ch:4,title:'Stockstatus labelen met CASE WHEN',icon:'🏷️',av:'📦',who:'Logistiek Manager',
   story:'Logistiek wil een overzicht met een leesbare <strong>stockstatus</strong>: "Uitverkocht" als stock = 0, "Bijna op" als stock < 5, anders "Op voorraad". Gebruik <strong>CASE WHEN</strong>.',
   obj:"SELECT naam, stock, CASE WHEN stock = 0 THEN 'Uitverkocht' WHEN stock < 5 THEN 'Bijna op' ELSE 'Op voorraad' END AS status FROM product",
   diff:'hard',lpd:'LPD4',xp:130,tbl:'product',time:120,conceptType:'casewhen',
   hint:"SELECT naam, stock,\n  CASE\n    WHEN stock = 0 THEN 'Uitverkocht'\n    WHEN stock < 5 THEN 'Bijna op'\n    ELSE 'Op voorraad'\n  END AS status\nFROM product",
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('select')) return err("Begin met SELECT naam, stock, CASE WHEN ... END AS status FROM product");
     if(!s.includes('product')) return err('Gebruik FROM <strong>product</strong>.');
     if(!s.includes('case')) return err("Gebruik <strong>CASE WHEN ... THEN ... ELSE ... END</strong> voor conditionele labels.");
     if(!s.includes('when')) return err("Voeg WHEN-clausules toe: <code>WHEN stock = 0 THEN 'Uitverkocht'</code>");
     if(!s.includes('uitverkocht')&&!s.includes("'uitverkocht'")) return err("Label 'Uitverkocht' ontbreekt in je CASE WHEN (voor stock = 0).");
     if(!s.includes('bijna')&&!s.includes("'bijna")) return err("Label 'Bijna op' ontbreekt (voor stock < 5).");
     if(!s.includes('end')) return err("Sluit het CASE-blok af met <strong>END</strong>. Vergeet ook <code>AS status</code> niet.");
     const res=runSQL(sql);
     if(!res.ok) return err('SQL-fout. Controleer de CASE WHEN structuur: CASE WHEN ... THEN ... ELSE ... END AS status');
     if(!rowCount(res)) return err('Geen resultaten. Controleer je CASE WHEN en FROM product.');
     const hasStatus=res.rows.length&&Object.keys(res.rows[0]).some(k=>k.toLowerCase().includes('status')||k.toLowerCase()==='case');
     if(!hasStatus) return err('Geef de CASE WHEN kolom een naam via <strong>AS status</strong>.');
     return res;
   },
   win:'CASE WHEN gemeisterd! Logistiek heeft nu een leesbaar stockoverzicht. Warehouse team juicht. 🎉'}
,

  // ── NIEUWE SCENARIO'S ─────────────────────────────────────────\n\n  // JOIN scenario (medium)\n  {id:'join_product_review',ch:2,title:'Producten met hun reviews',icon:'⭐',av:'📊',who:'Marketing Manager',\n   story:'Marketing wil een overzicht van <strong>producten met hun gemiddelde reviewscore</strong>. Koppel de tabel product aan review via product_id.',\n   obj:'SELECT p.naam, AVG(r.score) AS gemiddelde FROM product p INNER JOIN review r ON p.product_id = r.product_id GROUP BY p.product_id, p.naam',\n   diff:'medium',lpd:'LPD4',xp:75,tbl:'product',time:60,\n   hint:'SELECT p.naam, AVG(r.score) AS gemiddelde\nFROM product p\nINNER JOIN review r ON p.product_id = r.product_id\nGROUP BY p.product_id, p.naam',\n   sqlType:'join',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT om de gewenste kolommen en aggregatie te definiëren.');\n     if(!s.includes('review')) return err('JOIN de tabel <strong>review</strong> via product_id.');\n     if(!s.includes('join')) return err('Gebruik <strong>INNER JOIN</strong> om product aan review te koppelen.');\n     if(!s.includes('avg')) return err('Gebruik de <strong>AVG()</strong>-functie op de score-kolom.');\n     if(!s.includes('group by')) return err('Groepeer met <strong>GROUP BY</strong> op de productvelden.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Reviewoverzicht klaar! Marketing heeft nu een duidelijk beeld van klanttevredenheid per product. 🌟'},\n\n  // SUBQUERY scenario (hard)\n  {id:'subquery_expensive',ch:3,title:'Producten duurder dan gemiddeld',icon:'💰',av:'💼',who:'Finance Director',\n   story:'Finance wil een lijst van <strong>producten die duurder zijn dan het gemiddelde</strong>. Gebruik een subquery om het gemiddelde te berekenen.',\n   obj:"SELECT naam, prijs FROM product WHERE prijs > (SELECT AVG(prijs) FROM product) ORDER BY prijs DESC",\n   diff:'hard',lpd:'LPD5',xp:110,tbl:'product',time:90,\n   hint:"SELECT naam, prijs\nFROM product\nWHERE prijs > (SELECT AVG(prijs) FROM product)\nORDER BY prijs DESC",\n   sqlType:'select',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT naam, prijs FROM product.');\n     if(!s.includes('select avg') && !s.includes('(select')) return err('Gebruik een <strong>subquery</strong> in de WHERE-clausule om het gemiddelde te berekenen');\n     if(!s.includes('avg')) return err('Bereken het gemiddelde met de <strong>AVG()</strong>-functie in de subquery.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     if(!rowCount(res)) return err('Geen resultaten. Controleer je subquery en WHERE-conditie.');\n     return res;\n   },\n   win:'Subquery gemeisterd! Finance heeft nu een lijst van premium producten boven het gemiddelde. 💎'},\n\n  // UPDATE scenario (easy)  \n  {id:'update_email',ch:0,title:'E-mailadres bijwerken',icon:'📧',av:'👤',who:'Klantenservice',\n   story:'Klant Jana Pieters (klant_id=1) heeft haar e-mailadres gewijzigd naar <strong>jana.pieters@nieuw.be</strong>. Update de database.',\n   obj:"UPDATE klant SET email = 'jana.pieters@nieuw.be' WHERE klant_id = 1",\n   diff:'easy',lpd:'LPD2',xp:30,tbl:'klant',time:35,\n   hint:"UPDATE klant\nSET email = 'jana.pieters@nieuw.be'\nWHERE klant_id = 1",\n   sqlType:'update',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('update')) return err('Begin met <strong>UPDATE klant</strong>.');\n     if(!s.includes('klant')) return err('Werk de tabel <strong>klant</strong> bij.');\n     if(!s.includes('email')) return err('Zet de kolom <strong>email</strong> via SET.');\n     if(!s.includes('klant_id')) return err('Voeg een <strong>WHERE</strong>-clausule toe op klant_id — anders worden alle klanten bijgewerkt!');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'E-mail bijgewerkt! Jana kan nu inloggen met haar nieuwe adres. 📬'},\n\n  // SELECT + LIKE (easy)\n  {id:'search_by_email_domain',ch:1,title:'Klanten op e-maildomein zoeken',icon:'🔍',av:'🛡️',who:'IT Security',\n   story:'IT wil alle klanten vinden met een <strong>@mail.be</strong> e-mailadres voor een security-controle.',\n   obj:"SELECT naam, email FROM klant WHERE email LIKE '%@mail.be'",\n   diff:'easy',lpd:'LPD2',xp:35,tbl:'klant',time:40,\n   hint:"SELECT naam, email\nFROM klant\nWHERE email LIKE '%@mail.be'",\n   sqlType:'select',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT naam, email.');\n     if(!s.includes('like')) return err('Gebruik <strong>LIKE</strong> voor patroonzoekopdrachten.');\n     if(!s.includes('@mail.be')) return err("Zoek op het patroon <strong>'%@mail.be'</strong> — % matcht alles voor het @.");\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Security-controle klaar! Alle @mail.be klanten gevonden. 🔐'},\n\n  // JOIN + GROUP BY (hard)\n  {id:'revenue_per_customer',ch:4,title:'Omzet per klant berekenen',icon:'💹',av:'📈',who:'CFO',\n   story:'De CFO wil weten hoeveel <strong>elke klant totaal heeft besteld</strong> (som van totaal_prijs). Sorteer op omzet aflopend.',\n   obj:'SELECT k.naam, SUM(b.totaal_prijs) AS omzet FROM klant k INNER JOIN bestelling b ON k.klant_id = b.klant_id GROUP BY k.klant_id, k.naam ORDER BY omzet DESC',\n   diff:'hard',lpd:'LPD5',xp:140,tbl:'bestelling',time:120,\n   hint:'SELECT k.naam, SUM(b.totaal_prijs) AS omzet\nFROM klant k\nINNER JOIN bestelling b ON k.klant_id = b.klant_id\nGROUP BY k.klant_id, k.naam\nORDER BY omzet DESC',\n   sqlType:'join',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT om de klantnaam en de berekende totaalwaarde te selecteren.');\n     if(!s.includes('join')) return err('Gebruik <strong>INNER JOIN bestelling b</strong> om klant aan bestelling te koppelen.');\n     if(!s.includes('sum')) return err('Bereken de totale omzet met de <strong>SUM()</strong>-functie.');\n     if(!s.includes('group by')) return err('Groepeer met <strong>GROUP BY</strong> op de klantvelden.');\n     if(!s.includes('order by')) return err('Sorteer het resultaat aflopend op de berekende omzetkolom.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Omzetranking klaar! De CFO ziet nu wie de top-klanten zijn. 🏆'},\n\n  // ── EXTRA SCENARIO'S (v5) ─────────────────────────────────────\n\n  // Easy SELECT – chapter 0 (beginner-friendly intro)\n  {id:'select_all_products',ch:0,title:'Alle producten bekijken',icon:'📦',av:'👔',who:'Thomas — Adviseur',\n   story:'Je hebt net toegang tot de database. Bekijk alle producten om een overzicht te krijgen van het assortiment.',\n   obj:'SELECT * FROM product',\n   diff:'easy',lpd:'LPD1',xp:15,tbl:'product',time:20,\n   hint:'SELECT *\nFROM product',\n   sqlType:'select',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met <strong>SELECT</strong>.');\n     if(!s.includes('product')) return err('Haal gegevens op <strong>FROM product</strong>.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     if(!rowCount(res)) return err('Geen rijen gevonden. Controleer de tabelnaam.');\n     return res;\n   },\n   win:'Perfect! Je ziet nu alle producten. Zo krijg je snel overzicht. 🎉'},\n\n  // Easy SELECT – chapter 0\n  {id:'count_klanten',ch:0,title:'Hoeveel klanten zijn er?',icon:'🔢',av:'💻',who:'System',\n   story:'Een investeerder vraagt hoeveel klanten DataShop heeft. Tel alle rijen in de klant-tabel.',\n   obj:'SELECT COUNT(*) AS aantal_klanten FROM klant',\n   diff:'easy',lpd:'LPD1',xp:20,tbl:'klant',time:25,\n   hint:'SELECT COUNT(*) AS aantal_klanten\nFROM klant',\n   sqlType:'select',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT COUNT(*).');\n     if(!s.includes('count')) return err('Gebruik <strong>COUNT(*)</strong> om rijen te tellen.');\n     if(!s.includes('klant')) return err('Tel rijen in de tabel <strong>klant</strong>.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Geteld! Je weet nu exact hoeveel klanten er zijn. 📊'},\n\n  // Hard JOIN – chapter 3\n  {id:'join_top_products',ch:3,title:'Bestsellers via bestellingen',icon:'🏆',av:'📈',who:'Venture Capitalist',\n   story:'De investeerder wil weten welke producten het vaakst besteld zijn. JOIN product en bestelling, tel bestellingen per product, sorteer aflopend.',\n   obj:'SELECT p.naam, COUNT(b.bestelling_id) AS aantal FROM product p LEFT JOIN bestelling b ON p.product_id = b.product_id GROUP BY p.product_id, p.naam ORDER BY aantal DESC',\n   diff:'hard',lpd:'LPD4',xp:135,tbl:'bestelling',time:120,\n   hint:'SELECT p.naam, COUNT(b.bestelling_id) AS aantal\nFROM product p\nLEFT JOIN bestelling b ON p.product_id = b.product_id\nGROUP BY p.product_id, p.naam\nORDER BY aantal DESC',\n   sqlType:'join',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT om de productnaam en het berekende aantal te selecteren.');\n     if(!s.includes('join')) return err('Gebruik een <strong>JOIN</strong> op bestelling via product_id.');\n     if(!s.includes('count')) return err('Gebruik <strong>COUNT()</strong> om het aantal bestellingen te tellen.');\n     if(!s.includes('group by')) return err('Groepeer met <strong>GROUP BY</strong> op de productvelden.');\n     if(!s.includes('order by')) return err('Sorteer met <strong>ORDER BY aantal DESC</strong>.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Bestseller-ranking klaar! De investor is onder de indruk. 🏆'},\n\n  // Medium UPDATE – chapter 2\n  {id:'update_stock_bulk',ch:2,title:'Stock aanvullen na levering',icon:'🚚',av:'📦',who:'Warehouse Manager',\n   story:'Er is een levering binnengekomen. Verhoog de stock van ALLE producten met categorie "Elektronica" met 10.',\n   obj:"UPDATE product SET stock = stock + 10 WHERE categorie = 'Elektronica'",\n   diff:'medium',lpd:'LPD3',xp:65,tbl:'product',time:55,\n   hint:"UPDATE product\nSET stock = stock + 10\nWHERE categorie = 'Elektronica'",\n   sqlType:'update',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('update')) return err('Begin met <strong>UPDATE product</strong>.');\n     if(!s.includes('stock')) return err('Verhoog de kolom <strong>stock</strong> via SET.');\n     if(!s.includes('+ 10') && !s.includes('+10')) return err('Gebruik <strong>stock + 10</strong> om relatief te verhogen (niet een absoluut getal).');\n     if(!s.includes('elektronica')) return err("Filter op <strong>WHERE categorie = 'Elektronica'</strong>.");\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Voorraad bijgewerkt! Alle elektronica-producten hebben 10 extra stuks. 📦'},\n\n  // Easy SELECT – chapter 1\n  {id:'select_active_products',ch:1,title:'Producten in stock',icon:'✅',av:'🛒',who:'Webshop Team',\n   story:'De webshop toont alleen producten met meer dan 0 stuks op voorraad. Haal alle producten op waar <strong>stock > 0</strong>.',\n   obj:'SELECT naam, prijs, stock FROM product WHERE stock > 0 ORDER BY stock DESC',\n   diff:'easy',lpd:'LPD1',xp:25,tbl:'product',time:30,\n   hint:'SELECT naam, prijs, stock\nFROM product\nWHERE stock > 0\nORDER BY stock DESC',\n   sqlType:'select',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT naam, prijs, stock.');\n     if(!s.includes('product')) return err('Haal op FROM <strong>product</strong>.');\n     if(!s.includes('stock > 0') && !s.includes('stock>0')) return err('Filter op <strong>stock > 0</strong>.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Productoverzicht klaar! De webshop toont nu alleen leverbare producten. ✅'},\n\n  // Hard SELECT subquery – chapter 4\n  {id:'subquery_top_customer',ch:4,title:'Klant met meeste bestellingen',icon:'👑',av:'📈',who:'VIP Manager',\n   story:'Zoek de naam van de klant die de <strong>meeste bestellingen</strong> heeft geplaatst. Gebruik een subquery of GROUP BY + LIMIT.',\n   obj:'SELECT k.naam, COUNT(b.bestelling_id) AS totaal FROM klant k JOIN bestelling b ON k.klant_id = b.klant_id GROUP BY k.klant_id, k.naam ORDER BY totaal DESC LIMIT 1',\n   diff:'hard',lpd:'LPD5',xp:145,tbl:'bestelling',time:110,\n   hint:'SELECT k.naam, COUNT(b.bestelling_id) AS totaal\nFROM klant k\nJOIN bestelling b ON k.klant_id = b.klant_id\nGROUP BY k.klant_id, k.naam\nORDER BY totaal DESC\nLIMIT 1',\n   sqlType:'join',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT om de klantnaam en het berekende aantal te selecteren.');\n     if(!s.includes('join')) return err('Gebruik een <strong>JOIN</strong> op bestelling.');\n     if(!s.includes('count')) return err('Gebruik <strong>COUNT()</strong> om het aantal bestellingen te tellen.');\n     if(!s.includes('group by')) return err('Groepeer met <strong>GROUP BY</strong> op de klantvelden.');\n     if(!s.includes('limit')) return err('Beperk het resultaat tot de eerste rij met <strong>LIMIT</strong>.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'VIP-klant gevonden! Dit is goud voor de marketingafdeling. 👑'},\n\n  // Easy DELETE – chapter 0\n  {id:'delete_test_klant',ch:0,title:'Testklant verwijderen',icon:'🧹',av:'💻',who:'System',\n   story:'Bij de opstart werd een testklant (klant_id=99) aangemaakt. Verwijder die rij.',\n   obj:'DELETE FROM klant WHERE klant_id = 99',\n   diff:'easy',lpd:'LPD2',xp:25,tbl:'klant',time:25,\n   hint:'DELETE FROM klant\nWHERE klant_id = 99',\n   sqlType:'delete',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('delete')) return err('Begin met <strong>DELETE FROM klant</strong>.');\n     if(!s.includes('klant')) return err('Verwijder uit de tabel <strong>klant</strong>.');\n     if(!s.includes('where')) return err('Voeg een <strong>WHERE</strong>-clausule toe op klant_id — anders verwijder je alle klanten!');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Testdata opgeruimd! De database is nu schoon. 🧹'},\n\n  // Medium JOIN – chapter 2\n  {id:'join_klant_review',ch:2,title:'Klanten met hun reviews',icon:'💬',av:'📊',who:'Alex — Data Analyst',\n   story:'Welke klanten hebben reviews geschreven? Gebruik een JOIN om namen en reviewscores samen te tonen.',\n   obj:'SELECT k.naam, r.score, r.tekst FROM klant k INNER JOIN review r ON k.klant_id = r.klant_id ORDER BY r.score DESC',\n   diff:'medium',lpd:'LPD3',xp:75,tbl:'review',time:65,\n   hint:'SELECT k.naam, r.score, r.tekst\nFROM klant k\nINNER JOIN review r ON k.klant_id = r.klant_id\nORDER BY r.score DESC',\n   sqlType:'join',\n   check(sql){\n     const s=norm(sql);\n     if(!s.startsWith('select')) return err('Begin met SELECT k.naam, r.score, r.tekst.');\n     if(!s.includes('join')) return err('Gebruik <strong>INNER JOIN review r</strong>.');\n     if(!s.includes('klant_id')) return err('Koppel de tabellen via het klant_id-veld.');\n     const res=runSQL(sql); if(!res.ok) return err('SQL-fout: '+res.msg);\n     return res;\n   },\n   win:'Review-overzicht per klant klaar! Analysts zijn blij. 📋'},

  // ── FEATURE 5: DEBUG MISSIES ──────────────────────────────────────
  // Studenten krijgen een foutieve query en moeten deze repareren

  {id:'debug_missing_groupby',ch:1,title:'🐛 Debug: GROUP BY vergeten',icon:'🐛',av:'🔧',who:'Lena — Lead Engineer',
   type:'debug',
   story:'Lena heeft een query geschreven om de <strong>totale stock per categorie</strong> te berekenen, maar krijgt een fout. Kun jij de bug vinden en repareren?',
   obj:'Herstel de query zodat de stock per categorie gegroepeerd wordt.',
   buggyQuery:'SELECT categorie, SUM(stock)\nFROM product;',
   diff:'easy',lpd:'LPD4',xp:60,tbl:'product',time:45,
   hint:'SELECT categorie, SUM(stock)\nFROM product\nGROUP BY categorie',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.includes('sum')) return err('De <code>SUM(stock)</code>-aanroep moet behouden blijven.');
     if(!s.includes('group by')) return err('De bug is: <strong>GROUP BY ontbreekt</strong>! Voeg <code>GROUP BY categorie</code> toe aan het einde.');
     if(!s.includes('categorie')) return err('Groepeer op de kolom <strong>categorie</strong>.');
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Controleer de GROUP BY-clausule.');
     return res;
   },
   win:'Bug gevonden! Zonder GROUP BY kan SUM() niet per categorie berekenen. 🐛→✅'},

  {id:'debug_update_no_where',ch:1,title:'🐛 Debug: UPDATE zonder WHERE',icon:'🐛',av:'🚨',who:'Alex — Data Analyst',
   type:'debug',
   story:'Alex stuurde deze UPDATE naar productie en heeft <strong>per ongeluk alle prijzen op €99 gezet</strong>. Repareer de query zodat ze enkel de Ergonomische stoel (product_id=4) aanpast.',
   obj:'Voeg een WHERE-clausule toe zodat enkel product_id = 4 bijgewerkt wordt.',
   buggyQuery:'UPDATE product\nSET prijs = 99;',
   diff:'easy',lpd:'LPD5',xp:55,tbl:'product',time:40,
   hint:'UPDATE product SET prijs = 99 WHERE product_id = 4',
   sqlType:'update',
   check(sql){
     const s=norm(sql);
     if(!s.startsWith('update')) return err('De query moet beginnen met <code>UPDATE product</code>.');
     if(!s.includes('where')) return err('De bug is: <strong>WHERE ontbreekt</strong>! Voeg <code>WHERE product_id = 4</code> toe.');
     if(!s.includes('prijs')) return err('Behou <code>SET prijs = 99</code> in de query.');
     const res=runSQL(sql); if(!res.ok) return res;
     return res;
   },
   win:'Bug gerepareerd! WHERE is verplicht bij UPDATE. Zonder WHERE worden ALLE rijen aangepast. 🛡️'},

  {id:'debug_having_no_groupby',ch:2,title:'🐛 Debug: HAVING zonder GROUP BY',icon:'🐛',av:'📊',who:'Alex — Data Analyst',
   type:'debug',
   story:'Deze query zou klanten moeten tonen met meer dan 1 bestelling, maar gooit een fout. Repareer hem.',
   obj:'Voeg GROUP BY toe zodat HAVING correct werkt.',
   buggyQuery:'SELECT klant_id, COUNT(*) AS bestellingen\nFROM bestelling\nHAVING COUNT(*) > 1;',
   diff:'medium',lpd:'LPD4',xp:80,tbl:'bestelling',time:55,
   hint:'SELECT klant_id, COUNT(*) AS bestellingen\nFROM bestelling\nGROUP BY klant_id\nHAVING COUNT(*) > 1',
   sqlType:'select',
   check(sql){
     const s=norm(sql);
     if(!s.includes('having')) return err('Behou de <code>HAVING COUNT(*) > 1</code>-clausule.');
     if(!s.includes('group by')) return err('De bug is: <strong>HAVING vereist een GROUP BY</strong>! Voeg <code>GROUP BY klant_id</code> toe vóór HAVING.');
     const res=runSQL(sql); if(!res.ok) return res;
     if(!rowCount(res)) return err('Geen resultaten. Zijn er klanten met meer dan 1 bestelling?');
     return res;
   },
   win:'Bug gevonden! HAVING werkt altijd samen met GROUP BY — zo kun je groepen filteren na aggregatie. 🎯'},

  {id:'debug_join_no_on',ch:3,title:'🐛 Debug: JOIN zonder ON',icon:'🐛',av:'🔧',who:'Lena — Lead Engineer',
   type:'debug',
   story:'Deze JOIN-query mist de verbindingsconditie en geeft een verkeerd resultaat (kruis-product). Repareer hem.',
   obj:'Voeg de ON-clausule toe om klant en bestelling correct te koppelen.',
   buggyQuery:'SELECT klant.naam, bestelling.datum\nFROM klant\nINNER JOIN bestelling;',
   diff:'medium',lpd:'LPD4',xp:85,tbl:null,time:60,
   hint:'SELECT klant.naam, bestelling.datum\nFROM klant\nINNER JOIN bestelling ON klant.klant_id = bestelling.klant_id',
   sqlType:'join',
   check(sql){
     const s=norm(sql);
     if(!s.includes('join')) return err('Behou de <code>INNER JOIN bestelling</code>.');
     if(!s.includes(' on ')) return err('De bug is: <strong>ON ontbreekt</strong>! Voeg toe: <code>ON klant.klant_id = bestelling.klant_id</code>');
     if(!s.includes('klant_id')) return err('Koppel via het gemeenschappelijke <strong>klant_id</strong>-veld.');
     const res=runSQL(sql); if(!res.ok) return res;
     return res;
   },
   win:'Bug gevonden! Zonder ON-conditie krijg je een Cartesisch product — elke rij gecombineerd met elke rij. 🔗'},

];

const ACHIEVEMENTS = [
  {id:'first_insert', icon:'🎯', name:'Eerste INSERT',      desc:'Je eerste rij toegevoegd.'},
  {id:'first_update', icon:'✏️', name:'Data Wijziger',      desc:'Je eerste UPDATE uitgevoerd.'},
  {id:'first_delete', icon:'🗑️', name:'Opruimer',           desc:'Je eerste DELETE uitgevoerd.'},
  {id:'first_select', icon:'🔍', name:'Data Analist',       desc:'Je eerste SELECT uitgevoerd.'},
  {id:'ddl_master',   icon:'🏗️', name:'Architect',          desc:'Tabel aangemaakt of gewijzigd.'},
  {id:'speed',        icon:'⚡', name:'Snelheidsdemon',         desc:'Scenario opgelost in < 10 seconden.'},
  {id:'streak3',      icon:'🔥', name:'In Vuur en Vlam',            desc:'3 op rij correct.'},
  {id:'streak5',      icon:'🌋', name:'Vulkaan',            desc:'5 op rij correct.'},
  {id:'gdpr',         icon:'🔒', name:'GDPR-held',          desc:'Klant correct gedeactiveerd.'},
  {id:'join',         icon:'🔗', name:'JOIN Meester',        desc:'JOIN-query geslaagd.'},
  {id:'agg',          icon:'📐', name:'Aggregatie Expert',  desc:'AVG, SUM, MAX of MIN gebruikt.'},
  {id:'security',     icon:'🛡️', name:'Beveiligingschef',   desc:'Foute kortingscode gedeactiveerd.'},
  {id:'ch1',          icon:'🚀', name:'Startup CEO',        desc:'Hoofdstuk 1 voltooid.'},
  {id:'ch2',          icon:'🚨', name:'Crisis Manager',     desc:'Hoofdstuk 2 voltooid.'},
  {id:'ch3',          icon:'🧠', name:'Data Expert',        desc:'Hoofdstuk 3 voltooid.'},
  {id:'rep100',       icon:'⭐', name:'Perfecte CEO',       desc:'Reputatie op 100 gehouden.'},
  {id:'xp500',        icon:'💎', name:'500 XP Elite',       desc:'500 XP bereikt.'},
  {id:'ch4',          icon:'🧬', name:'Expert Modus',         desc:'Hoofdstuk 4 voltooid.'},
  {id:'distinct_pro',  icon:'🔎', name:'DISTINCT Pro',         desc:'DISTINCT query geslaagd.'},
  {id:'subquery_pro',  icon:'🧩', name:'Subquery Tovenaar',      desc:'Subquery in WHERE geslaagd.'},
  {id:'alias_pro',     icon:'🏷️', name:'Alias Artiest',         desc:'AS-alias query geslaagd.'},
  {id:'all_done',      icon:'🌟', name:'Data Legende',         desc:'Alle missies voltooid!'},
  {id:'ch5',           icon:'🏗️', name:'Data Architect',        desc:'Hoofdstuk 5 voltooid.'},
  {id:'inner_join_pro',icon:'🔗', name:'JOIN Meester',            desc:'INNER JOIN met ON-syntax geslaagd.'},
  {id:'left_join_pro', icon:'⬅️', name:'LEFT JOIN Expert',       desc:'LEFT JOIN met nulls geslaagd.'},
  {id:'having_pro',    icon:'🎯', name:'HAVING Tovenaar',          desc:'GROUP BY + HAVING gecombineerd.'},
  {id:'ddl_architect', icon:'🏛️', name:'Database Architect',     desc:'CREATE TABLE én ALTER TABLE uitgevoerd.'},
  {id:'xp1000',        icon:'🚀', name:'1000 XP Legende',        desc:'1000 XP bereikt.'},
  {id:'tut_complete',   icon:'🎓', name:'Tutorial Meester',          desc:'Alle tutoriallessen voltooid.'},
  {id:'sql_polyglot',   icon:'🌐', name:'SQL Polyglot',              desc:'SELECT, INSERT, UPDATE en DELETE gebruikt in missies.'},
  {id:'no_hint_ch1',    icon:'🧠', name:'Geen hints nodig',          desc:'Hoofdstuk 1 voltooid zonder één hint te gebruiken.'},
  {id:'speedster',      icon:'⚡', name:'Snelheidsduivel',           desc:'Een missie met 25+ snelheidsbonus voltooid.'},
  {id:'rep_recovered',  icon:'📈', name:'Comeback',                  desc:'Reputatie hersteld van onder 50% naar boven 80%.'},
  {id:'like_pro',       icon:'🔎', name:'Patroonzoeker',             desc:'LIKE-query met wildcard geslaagd.'},
  {id:'between_pro',    icon:'📏', name:'Bereikfilter',              desc:'BETWEEN-query geslaagd.'},
  {id:'null_hunter',    icon:'🕳️', name:'NULL Hunter',               desc:'IS NULL query geslaagd.'},
  {id:'anti_join_pro',  icon:'🚫', name:'Anti-Join Expert',          desc:'LEFT JOIN + IS NULL anti-join geslaagd.'},
  {id:'not_in_pro',     icon:'🚷', name:'NOT IN Specialist',         desc:'NOT IN subquery geslaagd.'},
  {id:'case_when_pro',  icon:'🏷️', name:'Label Artiest',             desc:'CASE WHEN query geslaagd.'},
];

const OFFICES = [
  {min:0,    e:'🏠', name:'Thuiskantoor',          desc:'Vanuit je slaapkamer. De droom is groot.',           perks:['☕ Eigen koffie']},
  {min:150,  e:'🏪', name:'Gehuurd Kantoor',       desc:'Een echt kantoor in de stad.',                       perks:['🖨️ Printer','📡 Snel WiFi']},
  {min:350,  e:'🏢', name:'DataShop HQ',           desc:'10 medewerkers, investeerders kijken toe.',           perks:['☕ Koffieautomaat','🎮 Gamekamer']},
  {min:650,  e:'🏙️', name:'Glazen Wolkenkrabber',  desc:'30e verdieping, je bent een succesverhaal.',          perks:['🍽️ Restaurant','🚁 Helipad']},
  {min:1000, e:'🌐', name:'Global DataShop',       desc:'Internationaal bedrijf. Forbes schrijft over jou.',  perks:['✈️ Privéjet','🌍 12 landen']},
  {min:1500, e:'🛰️', name:'DataShop Universe',     desc:'Jij bent de standaard. Harvard doceert over jou.',   perks:['🛰️ Eigen satelliet','📡 AI-datacenter','🏆 Nobel Data Prize']},
];

const RANKS = [
  {min:0,    title:'Startup CEO'},
  {min:150,  title:'Junior Data Analist'},
  {min:350,  title:'SQL Specialist'},
  {min:650,  title:'Senior Data Engineer'},
  {min:1000, title:'Chief Data Officer'},
  {min:1500, title:'Data Architect — Legende'},
];

// ── TIMER ─────────────────────────────────────────────────────────
const timers  = {};
const tStart  = {};

function startTimer(id, secs) {
  clearTimer(id);
  tStart[id] = Date.now();
  const end  = Date.now() + secs * 1000;
  function tick() {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    const numEl = $('tn-'+id);
    const barEl = $('tb-'+id);
    if (numEl) {
      numEl.textContent = left + 's';
      numEl.className = 'timer-count' + (left<=10?' danger':left<=20?' warn':'');
    }
    if (barEl) {
      barEl.style.width = (left / secs * 100) + '%';
      barEl.style.background = left<=10?'var(--red)':left<=20?'var(--orange)':'linear-gradient(90deg,var(--green),var(--cyan))';
    }
    if (left <= 0) { clearTimer(id); onTimeout(id); return; }
    timers[id] = requestAnimationFrame(tick);
  }
  timers[id] = requestAnimationFrame(tick);
}

function clearTimer(id) {
  if (timers[id]) cancelAnimationFrame(timers[id]);
  delete timers[id]; delete tStart[id];
}

function clearAllTimers() { Object.keys(timers).forEach(clearTimer); }

// ── TIMER PAUZEREN BIJ TABWISSEL ──────────────────────────────────
// Wanneer een leerling van tab wisselt loopt de timer door in Date.now()
// maar requestAnimationFrame pauzeert → tijd-delta klopt niet meer.
// We bewaren de resterende tijd en hervatten correct bij terugkeer.
const _timerPaused = {};  // id → resterende milliseconden bij pauzeren
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pauzeer: sla resterende tijd op
    Object.keys(timers).forEach(id => {
      const numEl = document.getElementById('tn-' + id);
      if (numEl) {
        const left = parseInt(numEl.textContent) || 0;
        _timerPaused[id] = left;
      }
      cancelAnimationFrame(timers[id]);
      delete timers[id];
    });
  } else {
    // Hervat: start opnieuw met de bewaarde resterende tijd
    Object.keys(_timerPaused).forEach(id => {
      const left = _timerPaused[id];
      delete _timerPaused[id];
      if (left > 0) startTimer(id, left);
      else onTimeout(id);
    });
  }
});

function onTimeout(id) {
  const fb = $('fb-'+id);
  const sc = SCENARIOS.find(s => s.id === id);
  const typeHints = {
    select: 'Begin met <code>SELECT kolommen FROM tabel WHERE …</code>',
    insert: 'Begin met <code>INSERT INTO tabel (kolommen) VALUES (…)</code>',
    update: 'Begin met <code>UPDATE tabel SET kolom = waarde WHERE …</code> — vergeet WHERE niet!',
    delete: 'Begin met <code>DELETE FROM tabel WHERE …</code> — vergeet WHERE niet!',
    ddl:    'Gebruik <code>CREATE TABLE naam (…)</code> of <code>ALTER TABLE naam ADD COLUMN …</code>',
  };
  const nudge = sc ? (typeHints[sc.sqlType] || typeHints.select) : typeHints.select;
  if (fb) {
    fb.className='feedback hint visible';
    fb.innerHTML=`⏰ <strong>Tijd voorbij — geen zorgen!</strong> SQL schrijven kost oefening.<br>
      <span class="u-label-sm">💡 Snelle tip: ${nudge}</span><br>
      <span class="u-muted">Gebruik de 💡 Hint-knop voor begeleiding, of druk op ↩ Oefenen om het opnieuw te proberen.</span>`;
  }
  // Geen reputatieschade bij timeout — tijdsdruk mag niet demotiveren
  UI.addEvent('warn','⏰ Timeout op missie — probeer het opnieuw!');
}

// ── UI ────────────────────────────────────────────────────────────
const UI = {
  activeCh: 0,
  activeFilter: 'all',
  searchQuery: '',
  openSc: null,
  hintUsed: {},  // Bug 1 fix: per-scenario hint tracking, keyed by scenario id
  hintLevel: {},   // id → current hint level (0=concept, 1=direction, 2=solution)
  hintL3Used: {},  // Feature 1: tracks if L3 hint was used (blocks bonuses)
  curTbl: 'klant',

  updateKPIs() {
    const s = dbStats();
    $('kpi-klant').textContent = s.klanten;
    $('kpi-orders').textContent = s.orders;
    EL['kpi-rep'].textContent   = G.rep;
    EL['kpi-rep'].className = 'kpi-val' + (G.rep>=80?' good':G.rep>=50?' warn':' bad');
    $('kpi-xp').textContent    = G.xp;
    $('rep-pct').textContent   = G.rep + '%';
    const fill = $('rep-fill');
    fill.style.width      = G.rep + '%';
    fill.style.background = G.rep<50?'var(--red)':G.rep<75?'var(--orange)':'var(--green)';
  },

  damageRep(n) {
    const was = G.rep;
    G.rep = Math.max(0, G.rep - n);
    this.updateKPIs();
    // Drempel-events: reputatie heeft nu betekenis
    if (was >= 80 && G.rep < 80) {
      this.addEvent('warn', '⚠️ Reputatie onder 80%! Klanten beginnen te twijfelen aan DataShop.');
    }
    if (was >= 50 && G.rep < 50) {
      this.addEvent('err', '🚨 Reputatie kritiek (<50%)! Investeerders overwegen terug te trekken!');
      this.showRepWarning();
    }
    if (G.rep === 0) {
      this.addEvent('err', '💀 Reputatie op nul. DataShop staat op instorten. Herstel via correcte SQL!');
    }
  },

  showRepWarning() {
    const popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0);background:var(--panel);border:2px solid var(--red);border-radius:var(--r2);padding:24px 32px;text-align:center;z-index:9996;transition:transform .35s cubic-bezier(.34,1.56,.64,1);box-shadow:0 0 60px rgba(248,113,113,.3),0 20px 60px rgba(0,0,0,.5);max-width:340px';
    popup.innerHTML = `<div class="rep-critical-popup-emoji">😱</div>
      <div class="rep-critical-popup-title">Reputatie Kritiek!</div>
      <div class="rep-critical-popup-body">DataShop's reputatie is onder de 50%. Klanten vertrekken. Los missies correct op om je reputatie te herstellen.</div>
      <button class="btn btn-danger btn-sm" onclick="this.parentElement.style.transform='translate(-50%,-50%) scale(0)';setTimeout(()=>this.parentElement.remove(),400)">Begrepen, ik herstel dit!</button>`;
    document.body.appendChild(popup);
    setTimeout(() => popup.style.transform = 'translate(-50%,-50%) scale(1)', 50);
    setTimeout(() => { popup.style.transform = 'translate(-50%,-50%) scale(0)'; setTimeout(() => popup.remove(), 400); }, 5000);
  },

  addEvent(type, txt, isBusiness) {
    const t = new Date().toLocaleTimeString('nl-BE',{hour:'2-digit',minute:'2-digit'});
    // Categoriseer: bedrijfsevents vs systeem/debug events
    const biz = isBusiness !== undefined ? isBusiness : (type === 'ok' && !txt.includes('reeks') && !txt.includes('reputatie'));
    G.events.unshift({type, txt, t, biz});
    if (G.events.length > 30) G.events.pop();
    this._renderFeed();
  },

  _renderFeed() {
    const bizEl = $('ev-list-biz');
    const sysEl = $('ev-list-sys');
    const bizEvents = G.events.filter(e => e.biz).slice(0,6);
    const sysEvents = G.events.filter(e => !e.biz).slice(0,6);
    const renderItems = evts => evts.length
      ? evts.map(e => `<div class="feed-item"><div class="feed-dot ${e.type}"></div><div class="feed-text">${e.txt}</div><div class="feed-time">${e.t}</div></div>`).join('')
      : '<div class="feed-item"><div class="feed-text feed-text--muted">Nog geen activiteit...</div></div>';
    if (bizEl) bizEl.innerHTML = renderItems(bizEvents);
    if (sysEl) sysEl.innerHTML = renderItems(sysEvents);
    // Legacy single feed
    const el = $('ev-list');
    if (el && !bizEl) el.innerHTML = G.events.slice(0,8).map(e =>
      `<div class="feed-item"><div class="feed-dot ${e.type}"></div><div class="feed-text">${e.txt}</div><div class="feed-time">${e.t}</div></div>`
    ).join('');
  },

  renderDash() {
    const s = dbStats();
    // Tutorial voortgangskaart op dashboard
    const tutDone  = TUT.totalDone();
    const tutTotal = TUT.totalLessons();
    const tutPct   = tutTotal ? Math.round(tutDone / tutTotal * 100) : 0;
    const tutCard  = $('dash-tut-card');
    if (tutCard) {
      tutCard.querySelector('.dash-tut-fill').style.width = tutPct + '%';
      tutCard.querySelector('.dash-tut-pct').textContent  = tutDone + '/' + tutTotal + ' lessen · ' + tutPct + '%';
    }
    // Feature 4: Skill Mastery Bars + Badges
    const masteryEl = $('mastery-grid');
    if (masteryEl) {
      const icons = { select:'🔍', insert:'➕', update:'✏️', delete:'🗑️', ddl:'🏗️' };
      const labels = { select:'SELECT', insert:'INSERT', update:'UPDATE', delete:'DELETE', ddl:'DDL' };
      masteryEl.innerHTML = conceptMastery().map(m => `
        <div class="mastery-tile">
          <div class="mastery-tile-head">
            <div class="mastery-tile-icon mastery-tile-icon--sql">${icons[m.type]}</div>
            <span class="mastery-tile-type">${labels[m.type]}</span>
          </div>
          <div class="mastery-count">${m.done} / ${m.total} missies</div>
          <div class="mastery-bar-track"><div class="mastery-bar-fill ${m.pct===100?'full':''}" style="width:${m.pct}%"></div></div>
          <div class="mastery-pct">${m.pct}%</div>
        </div>`).join('');
    }
    // Feature 4: Skill Mastery Bars (advanced breakdown)
    const skillEl = $('skill-mastery-panel');
    if (skillEl) {
      const smap = skillMastery();
      const barsHtml = SKILL_TYPES.map(st => {
        const m = smap[st.key] || { done: 0, total: 0, pct: 0 };
        const mastered = m.pct >= 80;
        return `<div class="skill-bar-row">
          <div class="skill-bar-label">${st.label}</div>
          <div class="skill-bar-track"><div class="skill-bar-fill ${mastered?'mastered':''}" style="width:${m.pct}%;background:${mastered?'var(--green)':st.color}"></div></div>
          <div class="skill-bar-pct">${m.pct}%</div>
        </div>`;
      }).join('');
      const badgesHtml = MASTERY_BADGES.map(b => {
        const m = smap[b.skill] || { pct: 0 };
        const isUnlocked = m.pct >= b.threshold;
        return `<span class="mastery-badge ${isUnlocked?'unlocked':''}">${isUnlocked?'✓ ':''} ${b.label}</span>`;
      }).join('');
      skillEl.innerHTML = `<div class="skill-mastery-wrap">${barsHtml}</div><div class="mastery-badge-row">${badgesHtml}</div>`;
    }
    const el = $('stat-grid');
    if (!el) return;
    el.innerHTML = [
      {i:'👥', v:s.klanten,   l:'Klanten',      t:s.actief+' actief',        up:true},
      {i:'🛒', v:s.orders,    l:'Bestellingen', t:s.open+' open',            up:true},
      {i:'💶', v:'€'+Number(s.revenue).toFixed(0), l:'Omzet', t:'Cumulatief', up:true},
      {i:'⭐', v:s.avgScore,  l:'Gem. Review',  t:'Klantbeoordeling',        up:Number(s.avgScore)>=4},
      {i:'📦', v:s.uitverkocht, l:'Uitverkocht', t:s.uitverkocht>0?'⚠️ Actie vereist':'✅ Alles op voorraad', up:s.uitverkocht===0},
      {i:'🏆', v:G.rep+'%',  l:'Reputatie',    t:G.rep>=80?'✅ Uitstekend':'⚠️ Aandacht vereist', up:G.rep>=80},
    ].map(c=>`<div class="stat-tile">
        <div class="stat-icon">${c.i}</div>
        <div class="stat-val">${esc(String(c.v))}</div>
        <div class="stat-label">${esc(c.l)}</div>
        <div class="stat-trend ${c.up?'trend-up':'trend-dn'}">${esc(c.t)}</div>
      </div>`).join('');
  },

  renderOfficeCard() {
    const off = OFFICES.slice().reverse().find(o => G.xp >= o.min) || OFFICES[0];
    const el = $('office-display');
    if (!el) return;
    $('sb-office').textContent = off.e;
    el.innerHTML = `<div class="office-card">
      <div class="office-emoji">${off.e}</div>
      <div class="office-info">
        <h3>${esc(off.name)}</h3>
        <p>${esc(off.desc)}</p>
        <div class="office-perks">${off.perks.map(p=>`<span class="perk">${esc(p)}</span>`).join('')}</div>
      </div>
    </div>`;
  },

  updateXP() {
    const rank  = RANKS.slice().reverse().find(r => G.xp >= r.min) || RANKS[0];
    const next  = RANKS.find(r => r.min > G.xp);
    const pct   = next ? Math.round((G.xp - rank.min) / (next.min - rank.min) * 100) : 100;
    // Defensive: sidebar elements don't exist during boot screen
    const sbRank = document.getElementById('sb-rank');
    const sbXp   = document.getElementById('sb-xp');
    const xpToNext = document.getElementById('xp-to-next');
    const streakVal = document.getElementById('streak-val');
    const streakCard = document.getElementById('streak-card');
    if (sbRank)    sbRank.textContent   = rank.title;
    if (sbXp)      sbXp.textContent     = G.xp + ' XP';
    // XP bar animation
    const xpBar = document.getElementById('xp-fill');
    if (xpBar) {
      xpBar.style.width = Math.min(pct, 100) + '%';
      xpBar.closest('.xp-bar-wrap')?.classList.add('xp-bar-animating');
      setTimeout(() => xpBar.closest('.xp-bar-wrap')?.classList.remove('xp-bar-animating'), 900);
    }
    if (xpToNext)  xpToNext.textContent = next ? (next.min - G.xp) + ' XP → ' + next.title : '✦ MAX LEVEL ✦';
    if (streakVal) streakVal.textContent = G.streak;
    if (streakCard) streakCard.classList.toggle('hot', G.streak >= 3);
    // Feature 7: show streak shields
    const shieldRow   = document.getElementById('shield-row');
    const shieldCount = document.getElementById('shield-count');
    if (shieldRow && shieldCount) {
      shieldCount.textContent = G.streakShields || 0;
      shieldRow.style.display = (G.streakShields > 0) ? '' : 'none';
    }
  },

  xpPop(txt) {
    const el = document.getElementById('xp-popup');
    if (!el) return;
    el.textContent = txt;
    el.classList.remove('animate', 'xp-gain-pop');
    void el.offsetWidth;
    el.classList.add('animate', 'xp-gain-pop');
    setTimeout(() => el.classList.remove('animate', 'xp-gain-pop'), 1600);
  },

  renderScenarios() {
    const done=G.done.size, total=SCENARIOS.length;
    const pct = total ? Math.round(done/total*100) : 0;
    const progFill = document.getElementById('prog-fill');
    const progLbl  = document.getElementById('prog-lbl');
    const badge    = document.getElementById('nav-badge');
    const chTabs   = document.getElementById('ch-tabs');
    if (progFill) progFill.style.width  = pct + '%';
    if (progLbl)  progLbl.textContent   = done+'/'+total+' voltooid · '+pct+'%';
    const pending  = SCENARIOS.filter(s => !G.done.has(s.id)).length;
    if (badge) {
      badge.textContent    = pending;
      badge.style.display  = pending ? '' : 'none';
    }

    if (chTabs) {
      chTabs.innerHTML = CHAPTERS.map(ch => {
        const chDone  = SCENARIOS.filter(s=>s.ch===ch.id&&G.done.has(s.id)).length;
        const chTotal = SCENARIOS.filter(s=>s.ch===ch.id).length;
        const locked  = G.done.size < ch.unlock;
        const allDone = chDone===chTotal;
        return `<button class="ch-tab ${this.activeCh===ch.id?'active':''} ${locked?'locked':''} ${allDone&&!locked?'done':''}"
          onclick="APP.setCh(${ch.id})">${esc(ch.title)} ${locked?'🔒':chDone+'/'+chTotal}</button>`;
      }).join('');
    }

    let list = SCENARIOS.filter(s => s.ch === this.activeCh);
    if (this.activeFilter==='easy')   list = list.filter(s=>s.diff==='easy');
    if (this.activeFilter==='medium') list = list.filter(s=>s.diff==='medium');
    if (this.activeFilter==='hard')   list = list.filter(s=>s.diff==='hard');
    if (this.activeFilter==='done')   list = list.filter(s=>G.done.has(s.id));
    if (['select','insert','update','delete','ddl','join'].includes(this.activeFilter))
      list = list.filter(s=>s.sqlType===this.activeFilter);
    // Zoekfilter
    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) ||
        (s.story||'').toLowerCase().includes(q) ||
        (s.sqlType||'').includes(q) ||
        (s.tbl||'').includes(q)
      );
    }

    // Update count row
    const countRow = $('sc-count-row');
    if (countRow) {
      const total_shown = list.length;
      const done_shown = list.filter(s => G.done.has(s.id)).length;
      countRow.innerHTML = total_shown
        ? `<span class="sc-count-num">${total_shown}</span> missies · <span class="sc-count-num">${done_shown}</span> voltooid`
        : '';
    }

    const diffColor = {easy:'rgba(74,222,128,.12)',medium:'rgba(251,146,60,.12)',hard:'rgba(248,113,113,.12)'};
    const diffTag   = {easy:'tag-easy', medium:'tag-medium', hard:'tag-hard'};
    const diffLabel = {easy:'Makkelijk', medium:'Gemiddeld', hard:'Moeilijk'};
    const typeIconBg     = {select:'rgba(34,211,238,.15)',insert:'rgba(74,222,128,.15)',update:'rgba(251,146,60,.15)',delete:'rgba(248,113,113,.15)',ddl:'rgba(167,139,250,.15)'};
    const typeIconBorder = {select:'rgba(34,211,238,.3)', insert:'rgba(74,222,128,.3)', update:'rgba(251,146,60,.3)', delete:'rgba(248,113,113,.3)', ddl:'rgba(167,139,250,.3)'};

    const scList = document.getElementById('sc-list');
    if (!scList) return;
    if (!list.length) {
      scList.innerHTML = `<div class="sc-empty-state">
        ${UI.searchQuery ? '🔍 Geen missies gevonden voor "'+esc(UI.searchQuery)+'"' : 'Geen missies in deze selectie.'}
        <br><br><button class="btn btn-outline btn-sm" onclick="APP.clearSearch();APP.setFilter('all')">Alle missies tonen</button>
      </div>`;
      return;
    }
    scList.innerHTML = list.map(sc => {
      const isDone = G.done.has(sc.id);
      return `<div class="sc-card ${isDone?'done':''} ${sc.urgent&&!isDone?'urgent':''}" id="sc-${sc.id}" data-sql-type="${(sc.sqlType||'select').toUpperCase()}">
        <div class="sc-header" onclick="APP.toggleSc('${sc.id}')">
          <div class="sc-icon" data-sqltype="${sc.sqlType||''}" data-diff="${sc.diff||''}">${sc.icon}</div>
          <div class="sc-meta">
            <div class="sc-title-row">
              <span class="sc-title">${UI.searchQuery ? esc(sc.title).replace(new RegExp('(' + UI.searchQuery.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi'), '<mark class="search-hl">$1</mark>') : esc(sc.title)}</span>
              ${isDone?'<span class="tag tag-done">✓ Klaar</span>':''}
              ${sc.urgent&&!isDone?'<span class="tag tag-urgent">Urgent</span>':''}
              ${sc.type==='debug'?'<span class="debug-badge">DEBUG</span>':''}
            </div>
            <div class="sc-chapter">${esc(CHAPTERS[sc.ch].title.split(' ').slice(2).join(' '))}</div>
            <div class="sc-tags">
              <span class="tag ${diffTag[sc.diff]}">${diffLabel[sc.diff]}</span>
              <span class="tag tag-xp">+${sc.xp} XP</span>
              <span class="tag tag-lpd">${esc(sc.lpd)}</span>
              ${sc.sqlType?`<span class="tag tag-sql-type">${sc.sqlType.toUpperCase()}</span>`:''}
              ${sc.time?`<span class="tag tag-time">⏱ ${sc.time}s</span>`:''}
            </div>
          </div>
          <div class="sc-chevron" id="chev-${sc.id}">›</div>
        </div>
        <div class="sc-body" id="scb-${sc.id}">
          ${(() => {
            // Concept intro: toon alleen als dit het eerste scenario is van dit sqlType of conceptType
            // en de speler het concept nog niet eerder gezien heeft
            const type = sc.conceptType || sc.sqlType;
            const ci = type && !seenConcept(type) && CONCEPT_INTRO[type];
            if (!ci || isDone) return '';
            return `<div class="concept-intro-box" id="ci-${sc.id}">
              <div class="concept-intro-head">
                <div class="concept-intro-icon">${ci.icon}</div>
                <div>
                  <div class="concept-intro-label">📚 Nieuw concept</div>
                  <div class="concept-intro-title">${ci.title}</div>
                </div>
              </div>
              <div class="concept-intro-body">${ci.body}</div>
              <div class="concept-intro-tip">${ci.tip}</div>
            </div>`;
          })()}
          <div class="story-block">
            <div class="story-avatar">${sc.av}</div>
            <div>
              <div class="story-who">${esc(sc.who)}</div>
              <div class="story-text">${sc.story}</div>
            </div>
          </div>
          ${sc.type==='debug'&&sc.buggyQuery?`<div class="debug-buggy-code"><span style="font-size:11px;color:var(--red);font-weight:700;display:block;margin-bottom:4px">🐛 FOUTIEVE QUERY — repareer dit:</span>${esc(sc.buggyQuery)}</div>`:''}
          ${scTutLink(sc.id)}
          ${sc.time&&!isDone?`
          <div class="timer-bar">
            <div class="timer-count" id="tn-${sc.id}">${sc.time}s</div>
            <span class="timer-icon">⏱</span>
            <div class="timer-track"><div class="timer-fill" id="tb-${sc.id}"></div></div>
          </div>`:''}
          <div class="obj-box">${esc(sc.obj)}</div>
          <div class="penalty-box">⚠️ Foute query = −5 reputatie · Reeks reset na 2 fouten op rij · Hint niveau 1–2 gratis · Hint niveau 3 = geen bonussen · Timeout = geen straf</div>
          ${sc.tbl?`<div class="table-viewer" id="tv-${sc.id}">${renderTableHTML(sc.tbl)}</div>`:''}
          <div class="terminal">
            <div class="term-titlebar">
              <div class="term-dots"><div class="term-dot"></div><div class="term-dot"></div><div class="term-dot"></div></div>
              <span class="term-label ${isDone?'solved':''}">${isDone?'✓ Opgelost':'datashop_db › '+(sc.tbl||'sql')}</span>
            </div>
            ${sc.steps ? (() => {
              // Multi-step scenario — toon stapnavigatie + textarea per stap
              const stepsDone = G.stepsDone?.[sc.id] || 0;
              const stepsNav = sc.steps.map((st, i) => {
                const cls = G.done.has(sc.id) ? 'done' : i < stepsDone ? 'done' : i === stepsDone ? 'active' : '';
                return `<div class="sc-step-btn ${cls}">${i < stepsDone || G.done.has(sc.id) ? '✓ ' : (i === stepsDone ? '▶ ' : '')}Stap ${i+1}: ${esc(st.label)}</div>`;
              }).join('');
              return `<div class="sc-steps-nav">${stepsNav}</div>
              <div class="hl-wrap">
                <div class="hl-backdrop" id="hl-${sc.id}" aria-hidden="true"></div>
                <textarea class="sql-editor" id="sq-${sc.id}"
                  placeholder="-- ${esc(sc.steps[Math.min(stepsDone, sc.steps.length-1)].placeholder || 'Schrijf hier je SQL...')}"
                  ${isDone?'disabled':''}></textarea>
              </div>`;
            })() : `<div class="hl-wrap">
              <div class="hl-backdrop" id="hl-${sc.id}" aria-hidden="true"></div>
              <textarea class="sql-editor" id="sq-${sc.id}"
                placeholder="${sc.type==='debug'?'-- Repareer de query hierboven...&#10;-- Ctrl+Enter om uit te voeren':'-- Schrijf hier je SQL...&#10;-- Ctrl+Enter om uit te voeren'}"
                ${isDone?'disabled':''}></textarea>
            </div>`}
            <div class="term-footer">
              <span class="term-hint">Ctrl+Enter</span>
              ${!isDone?`<button class="btn btn-outline btn-xs" id="hbtn-${sc.id}" onclick="APP.showHint('${sc.id}')">💡 Hint ①②③</button>`:''}
              ${!isDone?`<button class="btn btn-primary btn-sm" onclick="APP.runSc('${sc.id}')">▶ Uitvoeren</button>`:''}
              ${isDone?`<button class="sc-replay-btn" aria-label="Opnieuw oefenen" onclick="APP.replaySc('${sc.id}')">↩ Oefenen</button>`:''}
            </div>
          </div>
          <div class="feedback" id="fb-${sc.id}"></div>
        </div>
      </div>`;
    }).join('');
  },

  renderSchema() {
    const el = $('schema-grid');
    if (!el) return;
    el.innerHTML = Object.entries(DB).map(([n,t])=>`
      <div class="schema-card">
        <div class="schema-head">${esc(n)}</div>
        ${t.cols.map(c=>`<div class="schema-col">${c.pk?'<span class="col-pk">PK</span>':''}${c.fk?'<span class="col-fk">FK</span>':''}<span>${esc(c.n)}</span><span class="col-type">${esc(c.t)}</span></div>`).join('')}
      </div>`
    ).join('');
  },

  renderDBTabs() {
    const el = $('db-tabs');
    if (!el) return;
    el.innerHTML = Object.keys(DB).map(n =>
      `<button class="table-tab ${n===this.curTbl?'active':''}" onclick="APP.renderDBTable('${esc(n)}')">${esc(n)} <span class="table-tab-count">(${DB[n].rows.length})</span></button>`
    ).join('');
  },

  renderDBTable(name) {
    this.curTbl = name;
    this.renderDBTabs();
    const el = $('db-view');
    if (el) el.innerHTML = renderTableHTML(name);
  },

  renderCurrentTable() {
    if (!DB[this.curTbl]) this.curTbl = Object.keys(DB)[0];
    this.renderDBTable(this.curTbl);
  },

  renderAchs() {
    const el = $('ach-grid');
    if (!el) return;
    $('ach-progress').textContent = G.ach.size + ' / ' + ACHIEVEMENTS.length + ' ontgrendeld';
    el.innerHTML = ACHIEVEMENTS.map(a => {
      const got = G.ach.has(a.id);
      const fresh = got && this._justUnlockedAch === a.id;
      return `<div class="ach-tile ${got?'unlocked':''} ${fresh?'just-unlocked':''}">
        <span class="ach-icon">${a.icon}</span>
        <div class="ach-name">${got?esc(a.name):'???'}</div>
        <div class="ach-desc">${got?esc(a.desc):'Geheim...'}</div>
      </div>`;
    }).join('');
  },

  unlockAch(id) {
    if (G.ach.has(id)) return;
    G.ach.add(id);
    const a = ACHIEVEMENTS.find(x => x.id===id);
    if (!a) return;
    $('toast-icon').textContent = a.icon;
    $('toast-name').textContent = a.name;
    const t = $('ach-toast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
    this.addEvent('info', `🏆 Achievement: <strong>${esc(a.name)}</strong>`);
    this._justUnlockedAch = id;
    this.renderAchs();
    this._justUnlockedAch = null;
  },

  refreshUI() {
    this.updateKPIs();
    this.renderDash();
    this.renderOfficeCard();
    this.renderSchema();
    this.renderCurrentTable();
  },

  renderAll() {
    this.updateKPIs();
    this.renderDash();
    TUT.updateSidebarBadge();
    this.renderOfficeCard();
    this.renderScenarios();
    this.renderSchema();
    this.renderDBTabs();
    this.renderCurrentTable();
    this.renderAchs();
    this.updateXP();
  },

  showPanel(name) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));
    const panel = $('panel-'+name);
    if (panel) panel.classList.add('on');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const nb = $('nav-'+name);
    if (nb) nb.classList.add('active');
    if (name==='db') { APP.showDbTab('schema'); this.renderCurrentTable(); }
    if (name==='daily') { DAILY.render(); setTimeout(() => { ['easy','medium','hard'].forEach(d => { const ta = $('daily-sql-'+d); if(ta) initHighlighter(ta); }); }, 80); }
    if (name==='set')   { SET.render(); SET.afterRender(); }
    if (name==='tut')   { TUT.render(); }
    if (name==='sc')    { setTimeout(initAllHighlighters, 80); }
    if (name==='term')  {
      setTimeout(()=>initHighlighter(EL['free-sql']), 50);
      const _ta = EL['free-sql'];
      if (_ta && !_ta._histBound) {
        _ta._histBound = true;
        _ta.addEventListener('keydown', ev => {
          if (ev.key === 'ArrowUp' && _qHistory.length) {
            ev.preventDefault();
            _qHistIdx = Math.min(_qHistIdx + 1, _qHistory.length - 1);
            _ta.value = _qHistory[_qHistIdx];
          } else if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            _qHistIdx = Math.max(_qHistIdx - 1, -1);
            _ta.value = _qHistIdx < 0 ? '' : _qHistory[_qHistIdx];
          }
        });
      }
    }
  },
};

// ── APP ───────────────────────────────────────────────────────────
const APP = {
  cinCb: null,

  cinDone() {
    if (this.cinCb) { const fn = this.cinCb; this.cinCb = null; fn(); }
  },

  showCin(chapId, cb) {
    const cin = CHAPTERS[chapId].cin;
    this.cinCb = cb;
    EL['s-boot'].classList.remove('active');
    EL['s-game'].classList.remove('active');
    $('cin-dlg').innerHTML = '';
    $('cin-act').innerHTML = '';
    $('cin-eyebrow').textContent = cin.ch;
    $('cin-title').textContent   = cin.title;
    EL['s-cin'].classList.add('active');
    // Inject bubbles one-by-one, each with a typewriter effect
    const dlg = $('cin-dlg');

    // Strip HTML tags for plain-text typing, keep rich HTML visible after
    const typeInto = (el, html, speed) => {
      const plain = html.replace(/<[^>]+>/g, '');
      let i = 0;
      el.textContent = '';
      el.classList.add('typing');
      const iv = setInterval(() => {
        i++;
        el.textContent = plain.slice(0, i);
        if (i >= plain.length) {
          clearInterval(iv);
          el.classList.remove('typing');
          el.innerHTML = html;
        }
      }, speed);
    };

    let cursor = 400; // ms from now for first bubble
    cin.lines.forEach((l, i) => {
      setTimeout(() => {
        const div = document.createElement('div');
        div.className = 'cin-line' + (l.right ? ' right' : '');
        const bubble = document.createElement('div');
        bubble.className = 'cin-bubble cin-bubble-in';
        const speaker = document.createElement('div');
        speaker.className = 'cin-speaker';
        speaker.textContent = esc(l.who);
        const txt = document.createElement('div');
        txt.className = 'cin-txt';
        bubble.append(speaker, txt);
        div.append(Object.assign(document.createElement('div'), {className:'cin-avatar', textContent:l.av}), bubble);
        dlg.appendChild(div);
        // Scroll into view
        bubble.scrollIntoView({behavior:'smooth', block:'nearest'});
        // Type the text — speed scales with length so short lines are quick, long are readable
        const plain = l.txt.replace(/<[^>]+>/g, '');
        const speed = Math.max(18, Math.min(38, Math.round(1400 / plain.length)));
        typeInto(txt, l.txt, speed);
      }, cursor);
      // Next bubble starts after this one finishes typing + small pause
      const plain = l.txt.replace(/<[^>]+>/g, '');
      const speed = Math.max(18, Math.min(38, Math.round(1400 / plain.length)));
      cursor += plain.length * speed + 420;
    });

    setTimeout(() => {
      $('cin-act').innerHTML = '<button class="btn btn-primary" onclick="APP.cinDone()">Aan de slag →</button>';
    }, cursor);
  },

  startGameSkipCin() {
    const name = EL['boot-name'].value.trim();
    if (!name) { alert('Voer je naam in, CEO!'); return; }
    G.name = name;
    resetDB();
    EL['s-boot'].classList.remove('active');
    EL['s-cin'].classList.remove('active');
    EL['s-game'].classList.add('active');
    this.initGame();
  },

  startGame() {
    const name = EL['boot-name'].value.trim();
    if (!name) { alert('Voer je naam in, CEO!'); return; }
    G.name = name;
    resetDB(); // Ensure a fresh database for each new game session
    this.showCin(0, () => {
      EL['s-cin'].classList.remove('active');
      EL['s-game'].classList.add('active');
      this.initGame();
    });
  },

  initGame() {
    $('sb-name').textContent = G.name;
    UI.renderAll();
    UI.addEvent('ok',   `Welkom CEO <strong>${esc(G.name)}</strong>! DataShop is live.`);
    UI.addEvent('warn', '⚠️ ALARM: Kortingscode FOUT999 geeft 99% korting!');
    UI.addEvent('warn', '📦 Webcam HD & Laptop Sleeve: stock = 0.');
    UI.addEvent('info', 'Nieuwe klantregistratie wacht op verwerking.');
    DAILY.updateBadge();
    TUT.updateSidebarBadge();
    initAllHighlighters();
    save();
    // Herstel het laatste open scenario
    const lastOpenSc = loadOpenSc();
    if (lastOpenSc && SCENARIOS.find(s => s.id === lastOpenSc)) {
      setTimeout(() => {
        APP.showPanel('sc');
        // Scroll to and open the scenario
        const scEl = document.getElementById('sc-' + lastOpenSc);
        if (scEl) {
          APP.toggleSc(lastOpenSc);
          setTimeout(() => scEl.scrollIntoView({behavior:'smooth', block:'center'}), 200);
        }
      }, 400);
    }
  },

  showPanel(name) { UI.showPanel(name); },
  renderDBTable(name) { UI.renderDBTable(name); },

  showDbTab(tab) {
    ['schema','erd','data'].forEach(t => {
      const el = $('db-tab-'+t);
      const btn = $('dbt-'+t);
      if (el) el.style.display = t===tab ? '' : 'none';
      if (btn) btn.classList.toggle('active', t===tab);
    });
    if (tab === 'erd') this.renderERD();
    if (tab === 'data') { UI.renderDBTabs(); UI.renderCurrentTable(); }
    if (tab === 'schema') UI.renderSchema();
  },

  renderERD() {
    const c = $('erd-container');
    if (!c) return;
    const relations = [
      {from:'bestelling',fk:'klant_id',  to:'klant',   pk:'klant_id'},
      {from:'bestelling',fk:'product_id',to:'product',  pk:'product_id'},
      {from:'review',    fk:'klant_id',  to:'klant',   pk:'klant_id'},
      {from:'review',    fk:'product_id',to:'product',  pk:'product_id'},
    ];
    const relPills = [...new Set(relations.map(r=>`${r.from}.${r.fk} → ${r.to}.${r.pk}`))];
    const tableHtml = Object.entries(DB).map(([name,t]) => {
      const cols = t.cols.map(col => {
        const rel = relations.find(r => r.from===name && r.fk===col.n);
        return `<div class="erd-col-row">
          ${col.pk ? '<span class="erd-pk">🔑 PK</span>' : col.fk ? '<span class="erd-fk">🔗 FK</span>' : '<span class="erd-col-spacer"></span>'}
          <span>${esc(col.n)}</span>
          ${rel ? `<span class="erd-fk-ref">→ ${esc(rel.to)}</span>` : `<span class="erd-type">${esc(col.t)}</span>`}
        </div>`;
      }).join('');
      return `<div class="erd-table">
        <div class="erd-table-head">🗃️ ${esc(name)} <span class="erd-row-count">${t.rows.length} rijen</span></div>
        ${cols}
      </div>`;
    }).join('');
    const pillsHtml = relPills.map(r => `<div class="erd-rel-pill">🔗 ${esc(r)}</div>`).join('');

    // Visual relationship map
    const visualMap = `<div class="erd-visual-map">
      <div class="erd-vis-title">🗺️ Visueel Relatieoverzicht</div>
      <div class="erd-vis-layout">
        <div class="erd-vis-center-col">
          <div class="erd-vis-node erd-vis-center">🛒<br><strong>bestelling</strong><br><small>klant_id → klant<br>product_id → product</small></div>
        </div>
        <div class="erd-vis-right-col">
          <div class="erd-vis-node erd-vis-main">👤<br><strong>klant</strong><br><small>PK: klant_id</small></div>
          <div class="erd-vis-arrow-label">↑ klant_id FK</div>
          <div class="erd-vis-node erd-vis-main">📦<br><strong>product</strong><br><small>PK: product_id</small></div>
          <div class="erd-vis-arrow-label">↑ product_id FK</div>
          <div class="erd-vis-node erd-vis-secondary">⭐<br><strong>review</strong><br><small>klant_id + product_id</small></div>
        </div>
        <div class="erd-vis-extra-col">
          <div class="erd-vis-node erd-vis-secondary">🏷️<br><strong>kortingscode</strong><br><small>zelfstandig</small></div>
          <div class="erd-vis-node erd-vis-secondary">🏭<br><strong>leverancier</strong><br><small>zelfstandig</small></div>
        </div>
      </div>
      <div class="erd-vis-legend">
        <span class="erd-vis-leg-item"><span class="erd-vis-dot erd-vis-dot-center"></span> Koppeltabel (FK naar meerdere tabellen)</span>
        <span class="erd-vis-leg-item"><span class="erd-vis-dot erd-vis-dot-main"></span> Hoofdtabel (PK)</span>
        <span class="erd-vis-leg-item"><span class="erd-vis-dot erd-vis-dot-sec"></span> Zelfstandige tabel</span>
      </div>
    </div>`;

    c.innerHTML = visualMap + `<div class="erd-tables">${tableHtml}</div>
      <div class="erd-rel-label">Relaties</div>
      <div class="erd-relations">${pillsHtml}</div>`;
  },

  setFilter(f) {
    UI.activeFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const btn = $('fc-'+f);
    if (btn) btn.classList.add('active');
    UI.renderScenarios();
  },

  setSearch(val) {
    UI.searchQuery = val.trim().toLowerCase();
    const clearBtn = EL['sc-search-clear'];
    if (clearBtn) clearBtn.style.display = UI.searchQuery ? '' : 'none';
    UI.renderScenarios();
  },

  clearSearch() {
    const inp = $('sc-search');
    if (inp) inp.value = '';
    UI.searchQuery = '';
    const clearBtn = EL['sc-search-clear'];
    if (clearBtn) clearBtn.style.display = 'none';
    UI.renderScenarios();
  },

  setCh(id) {
    const ch = CHAPTERS[id];
    if (G.done.size < ch.unlock) {
      UI.addEvent('warn', `Hoofdstuk ${id+1} vereist ${ch.unlock} missies. Jij hebt er ${G.done.size}.`);
      return;
    }
    if (id > 0 && UI.activeCh < id) {
      UI.activeCh = id;
      this.showCin(id, () => {
        EL['s-cin'].classList.remove('active');
        EL['s-game'].classList.add('active');
        UI.showPanel('sc');
        UI.renderScenarios();
      });
      return;
    }
    UI.activeCh = id;
    UI.renderScenarios();
  },

  toggleSc(id) {
    const body = $('scb-'+id);
    const chev = $('chev-'+id);
    if (!body) return;
    const wasOpen = body.classList.contains('open');

    document.querySelectorAll('.sc-body').forEach(b => b.classList.remove('open'));
    document.querySelectorAll('.sc-chevron').forEach(c => c.classList.remove('open'));
    // Feature 8: clear schema highlights
    document.querySelectorAll('.schema-card').forEach(c => c.classList.remove('schema-highlight'));

    if (UI.openSc) clearTimer(UI.openSc);
    if (!wasOpen) {
      body.classList.add('open');
      chev.classList.add('open');
      UI.openSc = id;
      saveOpenSc(id);
      UI.hintUsed[id] = false; // Bug 1 fix: reset only this scenario's hint flag
      delete UI.hintLevel[id]; // reset hint niveau bij heropenen
      if (!UI.hintL3Used) UI.hintL3Used = {};
      delete UI.hintL3Used[id]; // reset L3 flag bij heropenen
      const sc = SCENARIOS.find(s => s.id===id);
      if (sc && sc.time && !G.done.has(id)) startTimer(id, sc.time);
      // Mark concept as seen so the intro box only appears once per concept type
      const conceptKey = sc && (sc.conceptType || sc.sqlType);
      if (conceptKey && !seenConcept(conceptKey)) {
        markConceptSeen(conceptKey);
      }
      // Feature 8: highlight relevant schema cards
      if (sc && sc.tbl) {
        const tables = Array.isArray(sc.tbl) ? sc.tbl : [sc.tbl];
        tables.forEach(tbl => {
          document.querySelectorAll('.schema-card').forEach(card => {
            const head = card.querySelector('.schema-head');
            if (head && head.textContent.trim() === tbl) {
              card.classList.add('schema-highlight');
            }
          });
        });
      }
      // Attach syntax highlighter to this scenario's textarea
      setTimeout(() => {
        const ta = $('sq-'+id);
        if (ta) initHighlighter(ta);
      }, 60);
    } else {
      UI.openSc = null;
      saveOpenSc('');
    }
  },

  replaySc(id) {
    // Heractiveer een voltooide missie voor extra oefening (telt niet opnieuw mee voor XP)
    const ta   = $('sq-' + id);
    const fb   = $('fb-' + id);
    const lbl  = document.querySelector(`#sc-${id} .term-label`);
    if (!ta || !fb) return;
    ta.disabled = false;
    ta.value    = '';
    if (fb) { fb.className = 'feedback'; fb.innerHTML = ''; }
    // Remove concept-win-box and sql-explain boxes from previous attempt
    let _next = fb?.nextElementSibling;
    while (_next && (_next.classList.contains('sql-explain') || _next.classList.contains('concept-win-box') || _next.classList.contains('why-error-box'))) {
      const _toRemove = _next;
      _next = _next.nextElementSibling;
      _toRemove.remove();
    }
    // Reset hint state for replay
    UI.hintLevel[id] = 0;
    UI.hintUsed[id] = false; // Bug 1 fix: per-scenario hint flag
    // Reset multi-step progress for replay
    if (G.stepsDone && G.stepsDone[id] !== undefined) {
      delete G.stepsDone[id];
      UI.renderScenarios();
    }
    const _hBtn = $('hbtn-' + id);
    if (_hBtn) { _hBtn.innerHTML = '💡 Hint ①②③'; _hBtn.style.opacity = ''; }
    if (lbl) lbl.textContent = 'datashop_db › ' + (SCENARIOS.find(s=>s.id===id)?.tbl||'sql');
    UI.addEvent('info', `↩ Missie <strong>${esc(SCENARIOS.find(s=>s.id===id)?.title||id)}</strong> geopend voor oefening.`);
    // Start fresh timer for practice
    const sc = SCENARIOS.find(s=>s.id===id);
    if (sc?.time) startTimer(id, sc.time);
    // Re-init highlighter: clear the init flag so it re-attaches after textarea re-enable
    ta._hlInit = false;
    setTimeout(() => initHighlighter(ta), 30);
    ta.focus();
  },

  showHint(id) {
    const sc = SCENARIOS.find(s => s.id===id);
    if (!sc) return;
    const fb = $('fb-'+id);
    if (!UI.hintLevel) UI.hintLevel = {};
    if (!UI.hintLevel[id]) UI.hintLevel[id] = 0;
    const level = UI.hintLevel[id];

    // For multi-step scenarios, use the current step's hint
    const stepIdx = (sc.steps && G.stepsDone) ? (G.stepsDone[id] || 0) : null;
    const currentHint = (sc.steps && stepIdx !== null && stepIdx < sc.steps.length)
      ? sc.steps[stepIdx].hint
      : sc.hint;
    const currentSqlType = (sc.steps && stepIdx !== null && stepIdx < sc.steps.length)
      ? (sc.steps[stepIdx].sqlType || sc.sqlType)
      : (sc.sqlType);

    // ── HINT LADDER: 3 niveaus ─────────────────────────────────────
    const sqlType = currentSqlType || sc.sqlType || 'select';

    // Niveau 1 — Structuurhint (welke keywords heb je nodig?)
    const structureHints = {
      select:  '💭 <strong>Niveau 1 — Structuur:</strong> Je hebt <code>SELECT</code>, <code>FROM</code> en eventueel <code>WHERE</code> nodig. Basisvorm: <code>SELECT kolommen FROM tabel WHERE conditie</code>',
      insert:  '💭 <strong>Niveau 1 — Structuur:</strong> Je hebt <code>INSERT INTO</code>, kolomnamen en <code>VALUES</code> nodig. Basisvorm: <code>INSERT INTO tabel (k1, k2) VALUES (v1, v2)</code>',
      update:  '💭 <strong>Niveau 1 — Structuur:</strong> Je hebt <code>UPDATE</code>, <code>SET</code> en <code>WHERE</code> nodig. Basisvorm: <code>UPDATE tabel SET kolom = waarde WHERE conditie</code>',
      delete:  '💭 <strong>Niveau 1 — Structuur:</strong> Je hebt <code>DELETE FROM</code> en <code>WHERE</code> nodig. Basisvorm: <code>DELETE FROM tabel WHERE conditie</code>',
      ddl:     '💭 <strong>Niveau 1 — Structuur:</strong> Je hebt <code>CREATE TABLE naam (kolom datatype, ...)</code> of <code>ALTER TABLE naam ADD COLUMN kolom datatype</code> nodig.',
      join:    '💭 <strong>Niveau 1 — Structuur:</strong> Je hebt <code>SELECT</code>, <code>FROM tabel1</code>, <code>INNER JOIN tabel2</code> en <code>ON tabel1.id = tabel2.id</code> nodig.',
    };

    // Niveau 2 — Kolom/tabel-hint (welke tabel/kolom precies?)
    const tblHint = sc.tbl ? `Gebruik tabel <strong>${sc.tbl}</strong>. ` : '';
    const obj = sc.obj || '';
    const columnHint = `🔍 <strong>Niveau 2 — Kolommen & tabellen:</strong> ${tblHint}${obj ? 'Je doel: <em>' + esc(obj) + '</em>' : 'Bekijk het schema links voor de juiste kolom- en tabelnamen.'}`;

    // Niveau 3 — Bijna-oplossing (kost XP-bonus!)
    const solHint = `🔑 <strong>Niveau 3 — Bijna-oplossing</strong> <span style="color:var(--red);font-weight:800">(geen XP-bonussen bij voltooiing!)</span><br><code class="hint-solution-code">${esc(currentHint || sc.hint || '')}</code>`;

    const hints     = [structureHints[sqlType] || structureHints.select, columnHint, solHint];
    const stepNames = ['Structuur', 'Kolommen', 'Oplossing'];
    const stepIcons = ['①', '②', '③'];
    const costs     = ['gratis', 'gratis', 'geen XP-bonus'];

    // Bouw de visuele hint-ladder
    const stepPills = stepNames.map((name, i) => {
      const isDone    = i < level;
      const isActive  = i === level;
      const isDanger  = i === 2 && isActive;
      const cls = isDone ? 'done' : isActive ? (isDanger ? 'danger' : 'active') : '';
      return `<div class="hint-step-pill ${cls}">${isDone ? '✓' : stepIcons[i]} ${name}</div>`;
    }).join('');

    fb.className = 'feedback hint visible';
    fb.innerHTML = `
      <div class="hint-ladder-wrap">
        <div class="hint-ladder-header">💡 Hint Ladder <span style="color:var(--t4);font-weight:400;font-size:11px;margin-left:auto">${costs[level]}</span></div>
        <div class="hint-ladder-steps">${stepPills}</div>
        <div class="hint-content-box">${hints[level]}${level === 2 ? '<div class="hint-l3-warning">⚠️ Je hebt de volledige oplossing bekeken — XP-snelheids- en reeksbonus zijn geblokkeerd bij voltooiing.</div>' : ''}</div>
        <div class="hint-ladder-footer">
          ${level < 2 ? `<button class="btn btn-outline btn-xs hint-next-btn" onclick="APP.nextHint('${id}')">Meer hint → (${costs[level+1]})</button>` : '<span style="font-size:12px;color:var(--t4)">Maximaal hint-niveau bereikt</span>'}
          <span style="font-size:11px;color:var(--t4)">${stepIcons[level]} Niveau ${level+1}/3</span>
        </div>
      </div>`;

    // Track hint gebruik per hoofdstuk
    G.hintsUsedChs.add(sc.ch);
    if (level === 2) {
      // Niveau 3 gebruikt: markeer zodat XP-bonussen worden geblokkeerd
      if (!UI.hintL3Used) UI.hintL3Used = {};
      UI.hintL3Used[id] = true;
      UI.hintUsed[id] = true;
    }
    UI.hintLevel[id] = Math.min(level + 1, 2);

    // Update hint button
    const hBtn = $('hbtn-' + id);
    if (hBtn) {
      const nextLvl = UI.hintLevel[id];
      const stepLabels = ['② Kolommen', '③ Oplossing', '✓ Max'];
      hBtn.innerHTML = '💡 ' + (stepLabels[nextLvl - 1] || '✓ Max');
      if (nextLvl >= 2) { hBtn.style.opacity = '.6'; hBtn.style.borderColor = 'var(--orange)'; hBtn.style.color = 'var(--orange)'; }
      if (nextLvl > 2)  { hBtn.disabled = true; hBtn.style.opacity = '.4'; }
    }
  },

  nextHint(id) { this.showHint(id); },

  runSc(id) {
    const sc  = SCENARIOS.find(s => s.id===id);
    if (!sc) { console.warn('[DataShop] runSc: unknown scenario id', id); return; }
    const sqEl = document.getElementById('sq-'+id);
    const sql = sqEl ? sqEl.value.trim() : '';
    const fbEl = document.getElementById('fb-'+id);
    // Safe feedback setter — works even if fb element is temporarily missing
    const setFb = (cls, html) => { if (fbEl) { fb.className = cls; fb.innerHTML = html; } };
    if (!sql) { setFb('feedback err visible', 'Schrijf eerst een SQL-statement.'); return; }

    // ── Multi-step scenario handler ────────────────────────────────
    if (sc.steps) {
      if (!G.stepsDone) G.stepsDone = {};
      const stepIdx = G.stepsDone[id] || 0;
      if (stepIdx >= sc.steps.length) return; // all steps already done

      const step = sc.steps[stepIdx];
      const res = step.check(sql);

      if (res.ok) {
        G.stepsDone[id] = stepIdx + 1;
        const isLastStep = G.stepsDone[id] >= sc.steps.length;

        if (isLastStep) {
          // All steps done — award XP and mark complete
          clearTimer(id);
          const elapsed    = tStart[id] ? (Date.now()-tStart[id])/1000 : sc.time||30;
          const speedBonus = sc.time ? Math.max(0, Math.round((sc.time-elapsed)/sc.time*30)) : 0;
          const hintPenalty= UI.hintUsed[id] ? 5 : 0; // Bug 1 fix: per-scenario
          const streakBonus= G.streak>=5?20:G.streak>=3?10:0;
          const totalXP    = Math.max(10, sc.xp + speedBonus + streakBonus - hintPenalty);
          fb.className = 'feedback ok visible';
          fb.innerHTML = `✅ <strong>Alle stappen voltooid!</strong> ${res.msg||''}<br>+${sc.xp} XP${speedBonus?` +${speedBonus} snelheid ⚡`:''}${streakBonus?` +${streakBonus} reeks 🔥`:''}${hintPenalty?` −${hintPenalty} hint`:''} = <strong>${totalXP} XP</strong>${sc.win?`<br><span class="fb-win-story">📖 ${esc(sc.win)}</span>`:''}`;
          if (!G.done.has(id)) {
            G.done.add(id);
            G.xp += totalXP;
            G.streak++;
            G.consecutiveErrors = 0;
            UI.xpPop('+'+totalXP+' XP');
            UI.updateXP();
            this.checkAch(sc, sql, elapsed);
            this.checkChUnlocks();
            this.checkChRecap(sc.ch);
            UI.addEvent('ok', `<strong>${esc(sc.title)}</strong> opgelost! +${totalXP} XP`, true);
            UI.refreshUI();
            UI.renderScenarios();
            save();
            if (G.streak===3||G.streak===5) this.showStreakPop();
            this.checkAllDone();
          }
          const reflectEl = document.createElement('div');
          reflectEl.className = 'concept-win-box';
          reflectEl.innerHTML = buildWinReflection(sc, sql);
          fb.after(reflectEl);
        } else {
          // Step complete, show next step prompt
          fb.className = 'feedback ok visible';
          fb.innerHTML = `✅ <strong>Stap ${stepIdx+1} geslaagd!</strong> ${res.msg||step.successMsg||''}<br><span class="fb-step-next">▶ Nu stap ${stepIdx+2}: ${esc(sc.steps[stepIdx+1].label)}</span>`;
          // Remove stale error tooltip from previous attempt
          const oldTutLinkAdv = fb.parentNode?.querySelector('.sc-tut-err-link');
          if (oldTutLinkAdv) oldTutLinkAdv.remove();
          // Update textarea placeholder for next step
          const ta = $('sq-'+id);
          if (ta) {
            ta.value = '';
            ta.placeholder = '-- ' + (sc.steps[stepIdx+1].placeholder || 'Schrijf hier je SQL...');
          }
          UI.renderScenarios(); // refresh step nav indicators
          // Re-init highlighter for the refreshed textarea
          setTimeout(() => initAllHighlighters(), 50);
        }
        save();
      } else {
        fb.className = 'feedback err visible';
        G.consecutiveErrors = (G.consecutiveErrors || 0) + 1;
        UI.damageRep(3);
        const countdown = res.msg || 'Onjuist. Probeer opnieuw!';
        fb.innerHTML = `❌ ${countdown}`;
        if (G.consecutiveErrors >= 2) {
          fb.innerHTML += `<br><span class="u-mono-muted">2 fouten op rij — reeks gereset</span>`;
          G.streak = 0; G.consecutiveErrors = 0; UI.updateXP();
        }
        // Tutorial link on error
        const oldTutLink = fb.parentNode.querySelector('.sc-tut-err-link');
        if (oldTutLink) oldTutLink.remove();
        const tutLinkHtml = scTutLink(sc.id);
        if (tutLinkHtml) {
          const tutEl = document.createElement('div');
          tutEl.className = 'sc-tut-err-link';
          tutEl.innerHTML = tutLinkHtml;
          fb.after(tutEl);
        }
      }
      return; // don't fall through to regular handler
    }

    const res = sc.check(sql);

    if (res.ok) {
      // Feature 3: Result-based validation
      if (sc.validation) {
        const valErr = validateResult(sql, sc.validation);
        if (valErr) {
          fb.className = 'feedback err visible';
          fb.innerHTML = `⚠️ Query syntactisch correct maar resultaat klopt niet:<br>${valErr}`;
          return;
        }
      }

      clearTimer(id);
      const elapsed    = tStart[id] ? (Date.now()-tStart[id])/1000 : sc.time||30;
      const speedBonus = sc.time ? Math.max(0, Math.round((sc.time-elapsed)/sc.time*30)) : 0;
      if (speedBonus >= 25) UI.unlockAch('speedster');

      // Feature 1: L3 hint blocks ALL bonuses
      const usedL3Hint = UI.hintL3Used && UI.hintL3Used[id];
      const hintPenalty= UI.hintUsed[id] ? 5 : 0;
      const streakBonus= G.streak>=5?20:G.streak>=3?10:0;
      // If L3 used: only base XP, no speed/streak bonuses
      const totalXP = usedL3Hint
        ? Math.max(10, sc.xp)
        : Math.max(10, sc.xp + speedBonus + streakBonus - hintPenalty);

      fb.className = 'feedback ok visible';
      let msg = `✅ <strong>Correct!</strong> `;
      if (res.type==='select' && res.rows) msg += res.rows.length + ' rij(en) gevonden. ';
      if (res.type==='insert') msg += 'Rij toegevoegd. ';
      if (res.type==='update') msg += `${res.affectedRows} rij(en) bijgewerkt. `;
      if (res.type==='delete') msg += `${res.affectedRows} rij(en) verwijderd. `;
      if (res.type==='ddl')    msg += res.msg + ' ';
      msg += `<br>+${sc.xp} XP`;
      if (!usedL3Hint) {
        if (speedBonus)   msg += ` +${speedBonus} snelheid ⚡`;
        if (streakBonus)  msg += ` +${streakBonus} reeks 🔥`;
        if (hintPenalty)  msg += ` −${hintPenalty} hint`;
      } else {
        msg += ` <span style="color:var(--orange);font-size:12px">(Niveau-3 hint gebruikt — bonussen geblokkeerd)</span>`;
      }
      msg += ` = <strong>${totalXP} XP</strong>`;
      if (sc.win) msg += `<br><span class="fb-win-story">📖 ${esc(sc.win)}</span>`;
      fb.innerHTML = msg;

      if (!G.done.has(id)) {
        G.done.add(id);
        G.xp += totalXP;
        G.streak++;
        G.consecutiveErrors = 0; // reset foutenteller bij correct antwoord
        // Reputatieherstel: correct oplossen herstelt reputatie gedeeltelijk
        if (G.rep < 100) {
          const repGain = sc.diff === 'hard' ? 5 : sc.diff === 'medium' ? 3 : 2;
          G.rep = Math.min(100, G.rep + repGain);
          if (repGain > 0) {
            msg += `<br><span class="fb-rep-gain">+${repGain} reputatie hersteld ✨</span>`;
            fb.innerHTML = msg; // Bug 3 fix: re-apply msg to DOM after repGain append
          }
          UI.updateKPIs();
        }
        UI.xpPop('+'+totalXP+' XP');
        UI.updateXP();
        this.checkAch(sc, sql, elapsed);
        earnStreakShield(); // Feature 7: shield generatie
        // no_hint_ch1: hoofdstuk 1 voltooid zonder hints
        const ch1Done = SCENARIOS.filter(s=>s.ch===0).every(s=>G.done.has(s.id));
        if (ch1Done && !G.hintsUsedChs.has(0)) UI.unlockAch('no_hint_ch1');
        // SQL polyglot: check if all 4 SQL types have been used
        const doneTypes = new Set([...G.done].map(id => {
          const s = SCENARIOS.find(x=>x.id===id);
          return s ? s.sqlType : null;
        }).filter(Boolean));
        if (['select','insert','update','delete'].every(t => doneTypes.has(t))) UI.unlockAch('sql_polyglot');
        this.checkChUnlocks();
        this.checkChRecap(sc.ch);
        UI.addEvent('ok', `<strong>${esc(sc.title)}</strong> opgelost! +${totalXP} XP`, true);
        if (sc.tbl) { const t=$('tv-'+id); if(t) t.innerHTML=renderTableHTML(sc.tbl); }
        UI.refreshUI();
        UI.renderScenarios();
        save();
        if (G.streak===3||G.streak===5) this.showStreakPop();
        this.checkAllDone();
      }
      // Show SQL explanation + pedagogic reflection (remove old ones first)
      let nextEl = fb.nextElementSibling;
      while (nextEl && (nextEl.classList.contains('sql-explain') || nextEl.classList.contains('concept-win-box') || nextEl.classList.contains('sc-tut-err-link'))) {
        const toRemove = nextEl;
        nextEl = nextEl.nextElementSibling;
        toRemove.remove();
      }
      // Pedagogic concept reflection
      const reflectEl = document.createElement('div');
      reflectEl.className = 'concept-win-box';
      reflectEl.innerHTML = buildWinReflection(sc, sql);
      fb.after(reflectEl);
      // SQL explain beneath the reflection
      const explainEl = document.createElement('div');
      explainEl.className = 'sql-explain';
      explainEl.innerHTML = `<div class="sql-explain-title">🔍 Wat deed jouw SQL?</div>${explainSQL(sql)}`;
      reflectEl.after(explainEl);
    } else {
      fb.className = 'feedback err visible';
      const isSyntaxErr = res.msg && (
        res.msg.includes('Gebruik') || res.msg.includes('gebruik') ||
        res.msg.includes('Begin met') || res.msg.includes('vergeten') ||
        res.msg.includes('verplicht') || res.msg.includes('ontbreekt')
      );
      if (isSyntaxErr) {
        fb.innerHTML = '⚠️ ' + res.msg + '<br><span class="u-mono-muted">Kleine fout — reeks blijft behouden</span>';
        UI.damageRep(2);
        UI.addEvent('warn','Kleine SQL-fout. −2 reputatie. Reeks intact.');
      } else {
        // Logische fout: reeks reset pas na 2 fouten op rij — bevordert experimenteren
        G.consecutiveErrors = (G.consecutiveErrors || 0) + 1;
        UI.damageRep(5);
        if (G.consecutiveErrors >= 2) {
          fb.innerHTML = '❌ ' + res.msg + `<br><span class="u-mono-muted">2 fouten op rij — reeks gereset (was ${G.streak}) 🔥</span>`;
          G.streak = 0;
          G.consecutiveErrors = 0;
          UI.updateXP();
          UI.addEvent('err','Onjuiste query (2×). Reeks gereset. −5 reputatie.');
        } else {
          fb.innerHTML = '❌ ' + res.msg + `<br><span class="fb-streak-warning">⚠️ Nog één fout en je reeks (${G.streak}🔥) wordt gereset</span>`;
          UI.addEvent('warn','Onjuiste query. −5 reputatie. Nog één kans voor de reeks.');
        }
      }
      // "Waarom" uitleg — leermoment bij elke fout
      const oldWhy = fb.nextElementSibling;
      if (oldWhy && oldWhy.classList.contains('why-error-box')) oldWhy.remove();

      // Feature 2: Coaching feedback (2-fasen) — voeg toe vóór why-error-box
      const oldCoach = fb.parentNode.querySelector('.coach-feedback-box');
      if (oldCoach) oldCoach.remove();
      const coachHtml = buildCoachFeedback(sql, sc);
      if (coachHtml) {
        const coachEl = document.createElement('div');
        coachEl.innerHTML = coachHtml;
        fb.after(coachEl.firstChild);
      }

      const whyHtml = buildWhyError(sql, sc);
      if (whyHtml) {
        const whyEl = document.createElement('div');
        whyEl.innerHTML = whyHtml;
        fb.after(whyEl.firstChild);
      }
      // Tutorial link — stuur leerling naar de bijhorende les bij fout
      const oldTutLink = fb.parentNode.querySelector('.sc-tut-err-link');
      if (oldTutLink) oldTutLink.remove();
      const tutLinkHtml = scTutLink(sc.id);
      if (tutLinkHtml) {
        const tutEl = document.createElement('div');
        tutEl.className = 'sc-tut-err-link';
        tutEl.innerHTML = tutLinkHtml;
        const insertAfter = fb.nextElementSibling || fb;
        insertAfter.after ? insertAfter.after(tutEl) : fb.after(tutEl);
      }
    }
  },

  showStreakPop() {
    $('streak-num-popup').textContent   = G.streak;
    $('streak-bonus-popup').textContent = G.streak>=5?'+20 XP bonus!':'+10 XP bonus!';
    const p = $('streak-popup');
    p.classList.add('show');
    setTimeout(() => p.classList.remove('show'), 2500);
  },

  checkAllDone() {
    const total = SCENARIOS.length;
    if (G.done.size >= total) {
      setTimeout(() => this.showCompletion(), 800);
    }
  },

  showCompletion() {
    UI.unlockAch('all_done');
    const ov = EL['completion-overlay'];
    ov.style.display = 'flex';
    const rank = RANKS.slice().reverse().find(r => G.xp >= r.min) || RANKS[0];
    $('comp-desc').textContent = `Alle ${SCENARIOS.length} missies voltooid als ${rank.title}. Je hebt DataShop van startup naar wereldleider gebracht.`;
    $('comp-stats').innerHTML = [
      {v: G.xp+' XP', l: 'Totaal XP'},
      {v: G.done.size,  l: 'Missies'},
      {v: G.ach.size,   l: 'Badges'},
      {v: G.rep+'%',    l: 'Reputatie'},
    ].map(s=>`<div class="comp-stat"><div class="comp-stat-val">${esc(String(s.v))}</div><div class="comp-stat-label">${esc(s.l)}</div></div>`).join('');
    this.launchConfetti();
  },

  closeCompletion() {
    EL['completion-overlay'].style.display = 'none';
    UI.showPanel('dash');
  },

  launchConfetti() {
    const c = $('comp-confetti');
    c.innerHTML = '';
    const colors = ['#22d3ee','#f472b6','#a78bfa','#4ade80','#fbbf24','#fb923c'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = `
        left:${Math.random()*100}%;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        animation-duration:${2+Math.random()*3}s;
        animation-delay:${Math.random()*2}s;
        width:${6+Math.random()*8}px;
        height:${6+Math.random()*8}px;
        border-radius:${Math.random()>0.5?'50%':'2px'};
        opacity:${.7+Math.random()*.3};
      `;
      c.appendChild(el);
    }
  },

  downloadCertificate() {
    const canvas = $('cert-canvas');
    const ctx = canvas.getContext('2d');
    const W = 800, H = 500;
    // Background
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0,0,W,H);
    // Border gradient
    const grd = ctx.createLinearGradient(0,0,W,H);
    grd.addColorStop(0,'#22d3ee'); grd.addColorStop(.5,'#a78bfa'); grd.addColorStop(1,'#f472b6');
    ctx.strokeStyle = grd; ctx.lineWidth = 3;
    ctx.strokeRect(12,12,W-24,H-24);
    ctx.lineWidth = 1; ctx.globalAlpha = .3;
    ctx.strokeRect(20,20,W-40,H-40);
    ctx.globalAlpha = 1;
    // Title
    ctx.fillStyle = '#f0f6ff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DATASHOP CEO — SQL STORY GAME', W/2, 60);
    // Main text
    ctx.fillStyle = '#8ba3c4';
    ctx.font = '15px sans-serif';
    ctx.fillText('Hiermee wordt bevestigd dat', W/2, 110);
    // Name
    ctx.font = 'bold 42px sans-serif';
    const grd2 = ctx.createLinearGradient(W/2-200, 0, W/2+200, 0);
    grd2.addColorStop(0,'#22d3ee'); grd2.addColorStop(1,'#a78bfa');
    ctx.fillStyle = grd2;
    ctx.fillText(G.name, W/2, 170);
    // Subtitle
    ctx.fillStyle = '#8ba3c4';
    ctx.font = '15px sans-serif';
    ctx.fillText('alle SQL-missies heeft voltooid en de titel verdient van', W/2, 210);
    // Rank
    const rank = RANKS.slice().reverse().find(r => G.xp >= r.min) || RANKS[0];
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(rank.title, W/2, 255);
    // Stats row
    ctx.font = '12px monospace';
    ctx.fillStyle = '#4a6285';
    const stats = [`${G.xp} XP`, `${G.done.size} Missies`, `${G.ach.size} Badges`, `${G.rep}% Reputatie`];
    stats.forEach((s,i) => ctx.fillText(s, 150 + i*130, 310));
    // Date
    ctx.font = '11px monospace';
    ctx.fillStyle = '#2a3d5a';
    ctx.fillText(`Behaald op ${new Date().toLocaleDateString('nl-BE')}  ·  © 2026 Kaat Claerman`, W/2, 460);
    // Trophy
    ctx.font = '56px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏆', W/2, 390);
    // Download
    const a = document.createElement('a');
    a.download = `certificaat-${G.name.replace(/\s+/g,'-')}.png`;
    a.href = canvas.toDataURL();
    canvas.style.display = 'none';
    a.click();
  },

  checkChUnlocks() {
    CHAPTERS.forEach((ch,i) => {
      if (i>0 && G.done.size>=ch.unlock && G.done.size-1<ch.unlock)
        UI.addEvent('info', `🔓 Hoofdstuk ${i+1} "<strong>${esc(ch.title)}</strong>" ontgrendeld!`);
    });
  },

  checkChRecap(chId) {
    // Trigger recap als het hoofdstuk nu volledig voltooid is en we de recap nog niet getoond hebben
    if (G.chRecapSeen.has(chId)) return;
    const chScenarios = SCENARIOS.filter(s => s.ch === chId);
    if (!chScenarios.length) return;
    const allDone = chScenarios.every(s => G.done.has(s.id));
    if (!allDone) return;
    G.chRecapSeen.add(chId);
    save();
    setTimeout(() => this.showRecap(chId), 900);
  },

  showRecap(chId) {
    const data = CHAPTER_RECAP[chId];
    if (!data) return;
    const ov = EL['chapter-recap-overlay'];
    if (!ov) return;
    const emojis = ['🚀','🚨','🧠','🧬','🏗️'];
    $('recap-emoji').textContent   = emojis[chId] || '🎉';
    $('recap-title').textContent   = data.title;
    $('recap-concept-list').innerHTML = data.learned.map(l => `
      <div class="recap-concept-row">
        <div class="recap-concept-icon">${l.icon}</div>
        <div>
          <div class="recap-concept-name">${esc(l.concept)}</div>
          <div class="recap-concept-desc">${esc(l.desc)}</div>
        </div>
      </div>`).join('');
    const nextWrap = $('recap-next-wrap');
    const nextText = $('recap-next-text');
    if (data.nextPreview && nextWrap && nextText) {
      nextText.textContent = data.nextPreview;
      nextWrap.style.display = '';
    } else if (nextWrap) {
      nextWrap.style.display = 'none';
    }
    ov.style.display = 'flex';
  },

  closeRecap() {
    const ov = EL['chapter-recap-overlay'];
    if (ov) ov.style.display = 'none';
  },

  checkAch(sc, sql, elapsed) {
    const s = sql.toLowerCase();
    if (s.includes('insert'))     UI.unlockAch('first_insert');
    if (s.includes('update'))     UI.unlockAch('first_update');
    if (s.includes('delete'))     UI.unlockAch('first_delete');
    if (s.includes('select'))     UI.unlockAch('first_select');
    if (s.includes('create table')||s.includes('alter table')) UI.unlockAch('ddl_master');
    if (s.includes('avg(')||s.includes('sum(')||s.includes('max(')||s.includes('min(')) UI.unlockAch('agg');
    if (s.includes('bestelling')&&s.includes('klant')&&s.includes('klant_id')) UI.unlockAch('join');
    if (s.includes('distinct')) UI.unlockAch('distinct_pro');
    if (s.includes('(select'))  UI.unlockAch('subquery_pro');
    if (s.includes(' as '))     UI.unlockAch('alias_pro');
    if (s.includes(' like '))   UI.unlockAch('like_pro');
    if (s.includes('between'))  UI.unlockAch('between_pro');
    if (s.includes('is null'))  UI.unlockAch('null_hunter');
    if (s.includes('not in'))   UI.unlockAch('not_in_pro');
    if (s.includes('case')&&s.includes('when')) UI.unlockAch('case_when_pro');
    if (s.includes('left join')&&s.includes('is null')) UI.unlockAch('anti_join_pro');
    if (sc.id==='deactivate_gdpr') UI.unlockAch('gdpr');
    if (sc.id==='disable_coupon')  UI.unlockAch('security');
    if (sc.id==='join_orders'||sc.id==='join_all'||sc.id==='join_alias_order') UI.unlockAch('join');
    if (elapsed < 10) UI.unlockAch('speed');
    if (G.rep===100)  UI.unlockAch('rep100');
    if (G.xp>=500)    UI.unlockAch('xp500');
    if (G.streak>=3)  UI.unlockAch('streak3');
    if (G.streak>=5)  UI.unlockAch('streak5');
    const ch1 = SCENARIOS.filter(s=>s.ch===0).every(s=>G.done.has(s.id));
    const ch2 = SCENARIOS.filter(s=>s.ch===1).every(s=>G.done.has(s.id));
    const ch3 = SCENARIOS.filter(s=>s.ch===2).every(s=>G.done.has(s.id));
    const ch4 = SCENARIOS.filter(s=>s.ch===3).every(s=>G.done.has(s.id));
    const ch5 = SCENARIOS.filter(s=>s.ch===4).every(s=>G.done.has(s.id));
    if (ch1) UI.unlockAch('ch1');
    if (ch2) UI.unlockAch('ch2');
    if (ch3) UI.unlockAch('ch3');
    if (ch4) UI.unlockAch('ch4');
    if (ch5) UI.unlockAch('ch5');
    // JOIN ON badges
    if (s.includes('inner join')) UI.unlockAch('inner_join_pro');
    if (s.includes('left join'))  UI.unlockAch('left_join_pro');
    if (s.includes('having'))     UI.unlockAch('having_pro');
    // ddl_architect: ontgrendel wanneer de query DDL is
    // (ddl_master wordt eerst ontgrendeld in dezelfde aanroep, G.ach wordt synchroon bijgewerkt)
    if (s.includes('create table') || s.includes('alter table')) UI.unlockAch('ddl_architect');
    if (G.xp>=1000) UI.unlockAch('xp1000');
    // Eerste gebruik van een geavanceerd keyword — toon een mini-popup
    this.checkNewKeyword(sql);
  },

  checkNewKeyword(sql) {
    const s = sql.toLowerCase();
    const KEYWORD_MILESTONES = [
      { key: 'kw_groupby',   test: s => s.includes('group by'),   icon: '📊', name: 'GROUP BY', desc: 'Groepeert rijen zodat je aggregaten per groep kunt berekenen — bijv. hoeveel bestellingen per klant.' },
      { key: 'kw_having',    test: s => s.includes('having'),     icon: '🎯', name: 'HAVING', desc: 'Filtert groepen ná GROUP BY. Het is de WHERE voor geaggregeerde resultaten.' },
      { key: 'kw_join',      test: s => s.includes('join'),       icon: '🔗', name: 'JOIN', desc: 'Combineert rijen uit twee tabellen via een gedeelde sleutel (FK = PK).' },
      { key: 'kw_distinct',  test: s => s.includes('distinct'),   icon: '🔎', name: 'DISTINCT', desc: 'Verwijdert duplicaten — elke unieke waarde verschijnt maar één keer in het resultaat.' },
      { key: 'kw_subquery',  test: s => s.includes('(select'),    icon: '🧩', name: 'Subquery', desc: 'Een query binnen een andere query. De binnenste wordt eerst uitgevoerd.' },
      { key: 'kw_alias',     test: s => / as /.test(s),           icon: '🏷️', name: 'AS (alias)', desc: 'Geeft een kolom of tabel een leesbare naam in het resultaat.' },
      { key: 'kw_orderby',   test: s => s.includes('order by'),   icon: '↕️', name: 'ORDER BY', desc: 'Sorteert het resultaat op een of meer kolommen, oplopend (ASC) of aflopend (DESC).' },
      { key: 'kw_limit',     test: s => s.includes('limit'),      icon: '🔢', name: 'LIMIT', desc: 'Beperkt het aantal rijen in het resultaat — ideaal voor toptien-lijsten.' },
    ];
    if (!G.seenKeywords) G.seenKeywords = new Set();
    for (const m of KEYWORD_MILESTONES) {
      if (!G.seenKeywords.has(m.key) && m.test(s)) {
        G.seenKeywords.add(m.key);
        this.showKeywordPop(m);
        save();
        break; // Toon maar één popup per keer
      }
    }
  },

  showKeywordPop(m) {
    // Verwijder bestaande popup als die er al is
    const existing = document.getElementById('kw-popup');
    if (existing) existing.remove();
    const pop = document.createElement('div');
    pop.id = 'kw-popup';
    pop.style.cssText = 'position:fixed;bottom:80px;right:24px;background:var(--panel2);border:1.5px solid var(--border3);border-left:4px solid var(--cyan);border-radius:var(--r2);padding:16px 18px;z-index:9995;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.5);animation:slideInRight .3s ease;';
    pop.innerHTML = `
      <div class="kw-popup-header">
        <span class="kw-popup-icon">${m.icon}</span>
        <div class="kw-popup-meta">
          <div class="kw-popup-eyebrow">✨ Nieuw keyword gebruikt!</div>
          <div class="kw-popup-name">${esc(m.name)}</div>
        </div>
        <button onclick="document.getElementById('kw-popup')?.remove()" class="kw-popup-close">×</button>
      </div>
      <div class="kw-popup-desc">${m.desc}</div>`;
    document.body.appendChild(pop);
    setTimeout(() => { const p = document.getElementById('kw-popup'); if (p) { p.style.opacity='0'; p.style.transition='opacity .4s'; setTimeout(() => p?.remove(), 400); } }, 5000);
  },

  runFree() {
    const ta  = document.getElementById('free-sql');
    const fb  = document.getElementById('free-fb');
    const out = document.getElementById('free-out');
    if (!ta || !fb || !out) return;
    const sql = ta.value.trim();
    if (!sql) return;
    // Save to history
    if (!_qHistory.length || _qHistory[0] !== sql) { _qHistory.unshift(sql); if (_qHistory.length > 20) _qHistory.pop(); }
    _qHistIdx = -1;
    const res = runSQL(sql);
    if (!res.ok) {
      fb.className = 'feedback err visible';
      const errMsg = res.msg || 'Query mislukt.';
      // Intelligente hulp bij veelgemaakte fouten
      let helpHint = '';
      const sl = sql.trim().toLowerCase();
      if (!sl.match(/^(select|insert|update|delete|create|alter)/)) {
        helpHint = '<br><small class="u-muted">💡 Begin met SELECT, INSERT, UPDATE, DELETE, CREATE of ALTER.</small>';
      } else if (sl.startsWith('select') && !sl.includes('from')) {
        helpHint = '<br><small class="u-muted">💡 SELECT vereist FROM: <code>SELECT kolommen FROM tabel</code></small>';
      } else if (sl.includes('where') && sl.includes('= null')) {
        helpHint = '<br><small class="u-muted">💡 Gebruik IS NULL in plaats van = NULL: <code>WHERE kolom IS NULL</code></small>';
      } else if (sl.startsWith('update') && !sl.includes('where')) {
        helpHint = '<br><small class="sql-help-warn">⚠️ UPDATE zonder WHERE past ALLE rijen aan. Voeg WHERE toe om specifieke rijen te targeten.</small>';
      } else if (sl.startsWith('delete') && !sl.includes('where')) {
        helpHint = '<br><small class="sql-help-warn">⚠️ DELETE zonder WHERE verwijdert ALLE rijen. Voeg WHERE toe!</small>';
      }
      fb.innerHTML = '❌ ' + esc(errMsg) + helpHint;
      out.innerHTML = '<div class="u-empty-state">Query mislukt.</div>';
      return;
    }
    fb.className = 'feedback ok visible';
    if (res.type==='select') {
      UI.unlockAch('first_select');
      const s = sql.toLowerCase();
      if (s.includes('avg(')||s.includes('sum(')||s.includes('max(')||s.includes('min(')) UI.unlockAch('agg');
      if (s.includes(',')&&s.includes('klant_id')) UI.unlockAch('join');
      const rows = res.rows || [];
      fb.textContent = `✅ ${rows.length} rij(en) gevonden.`;
      // SQL uitleg onder resultaten
      const oldFreeExplain = out.previousElementSibling?.classList.contains('sql-explain') ? out.previousElementSibling : null;
      if (oldFreeExplain) oldFreeExplain.remove();
      const freeExplainEl = document.createElement('div');
      freeExplainEl.className = 'sql-explain';
      freeExplainEl.innerHTML = `<div class="sql-explain-title">🔍 Wat deed jouw SQL?</div>${explainSQL(sql)}`;
      out.before(freeExplainEl);
      if (!rows.length) { out.innerHTML = '<div class="u-empty-state">0 resultaten.</div>'; return; }
      const cols = Object.keys(rows[0]);
      out.innerHTML = `<div class="tv-header"><span class="tv-name">Resultaat</span><span class="tv-badge">${rows.length} rijen</span></div>
        <div class="tv-scroll"><table class="data-table">
          <thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${r[c]==null?'<span class="u-muted">NULL</span>':esc(String(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
      out.classList.remove('free-out-animated');
      void out.offsetWidth; // force reflow
      out.classList.add('free-out-animated');
    } else if (res.type==='ddl') {
      fb.textContent = '✅ ' + (res.msg||'DDL geslaagd.');
      out.innerHTML = '<div class="u-empty-state">DDL geslaagd. Bekijk de Databank-tab.</div>';
      UI.unlockAch('ddl_master');
      UI.renderSchema();
      UI.renderDBTabs();
    } else {
      fb.textContent = `✅ ${res.type.toUpperCase()}: ${res.affectedRows} rij(en).`;
      out.innerHTML = '<div class="u-empty-state">Geslaagd. Bekijk de Databank-tab.</div>';
      UI.refreshUI();
      if (res.type==='insert') UI.unlockAch('first_insert');
      if (res.type==='update') UI.unlockAch('first_update');
      if (res.type==='delete') UI.unlockAch('first_delete');
    }
  },

  openKeyHelp() {
    const el = document.getElementById('key-help');
    const bd = document.getElementById('key-help-backdrop');
    if (!el || !bd) return;
    el.style.display = bd.style.display = '';
    setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translate(-50%,-50%) scale(1)'; }, 20);
  },
  closeKeyHelp() {
    const el = document.getElementById('key-help');
    const bd = document.getElementById('key-help-backdrop');
    if (!el || !bd) return;
    el.style.opacity = '0'; el.style.transform = 'translate(-50%,-50%) scale(.9)';
    setTimeout(() => { el.style.display = bd.style.display = 'none'; }, 200);
  },

  loadExampleIdx(i) {
    const TERM_EXAMPLES = [
      "SELECT *\nFROM klant\nLIMIT 5",
      "SELECT naam, prijs\nFROM product\nORDER BY prijs DESC\nLIMIT 3",
      "SELECT stad, COUNT(*) AS aantal\nFROM klant\nGROUP BY stad\nORDER BY aantal DESC",
      "SELECT k.naam, b.datum, b.status\nFROM klant k\nINNER JOIN bestelling b ON k.klant_id = b.klant_id\nORDER BY b.datum DESC",
      "SELECT naam, prijs,\n  CASE\n    WHEN prijs < 20 THEN 'Goedkoop'\n    WHEN prijs < 100 THEN 'Gemiddeld'\n    ELSE 'Duur'\n  END AS prijsklasse\nFROM product",
      "SELECT naam, prijs\nFROM product\nWHERE prijs > (SELECT AVG(prijs) FROM product)\nORDER BY prijs DESC",
      "SELECT k.naam, COUNT(b.bestelling_id) AS bestellingen\nFROM klant k\nLEFT JOIN bestelling b ON k.klant_id = b.klant_id\nGROUP BY k.klant_id, k.naam\nORDER BY bestellingen DESC",
    ];
    if (i >= 0 && i < TERM_EXAMPLES.length) this.loadExample(TERM_EXAMPLES[i]);
  },

  loadExample(sql) {
    const ta = EL['free-sql'];
    if (!ta) return;
    ta.value = sql;
    // Auto-expand to fit content — reset first so shrinkage works too
    ta.style.height = 'auto';
    ta.style.height = Math.max(200, ta.scrollHeight + 4) + 'px';
    // Trigger syntax highlighter update
    const ev = new Event('input');
    ta.dispatchEvent(ev);
    ta.focus();
    // Auto-run
    this.runFree();
  },

  clearFree() {
    const ta  = document.getElementById('free-sql');
    const fb  = document.getElementById('free-fb');
    const out = document.getElementById('free-out');
    if (ta)  ta.value  = '';
    if (fb)  fb.className = 'feedback';
    if (out) out.innerHTML = '<div class="free-out-empty">// Voer een query uit om resultaten te zien...</div>';
  },
};

// ── SQL EXPLAINER ─────────────────────────────────────────────────
// ── BUILD WHY ERROR ────────────────────────────────────────────────
// Toont een "waarom werkt dit niet?" box bij foute antwoorden
function buildWhyError(sql, sc) {
  if (!sql || !sc) return '';
  const s  = sql.trim();
  const sl = s.toLowerCase();
  const type = sc.sqlType || 'select';
  const rows = [];

  // ── Patroonherkenning op veelgemaakte fouten per type ──

  // WHERE met = NULL i.p.v. IS NULL
  if (/=\s*null/i.test(s)) {
    rows.push({
      bad:  s.match(/\w+\s*=\s*null/i)?.[0] || '... = NULL',
      good: s.match(/(\w+)\s*=\s*null/i)?.[1] ? `${s.match(/(\w+)\s*=\s*null/i)[1]} IS NULL` : '... IS NULL',
      why:  'NULL is de <em>afwezigheid</em> van een waarde — je kan er niet op vergelijken met =. Gebruik altijd <strong>IS NULL</strong> of <strong>IS NOT NULL</strong>.'
    });
  }

  // UPDATE zonder WHERE
  if (type==='update' && !/where/i.test(s)) {
    rows.push({
      bad:  'UPDATE ... SET ... (geen WHERE)',
      good: 'UPDATE ... SET ... WHERE kolom = waarde',
      why:  'Zonder WHERE pas je <strong>alle rijen tegelijk</strong> aan. Dat is zelden de bedoeling — voeg altijd een WHERE-filter toe om de juiste rij te selecteren.'
    });
  }

  // DELETE zonder WHERE
  if (type==='delete' && !/where/i.test(s)) {
    rows.push({
      bad:  'DELETE FROM tabel (geen WHERE)',
      good: 'DELETE FROM tabel WHERE kolom = waarde',
      why:  'Zonder WHERE verwijder je <strong>alle rijen</strong> uit de tabel — onomkeerbaar. Voeg altijd een WHERE-conditie toe.'
    });
  }

  // INSERT zonder kolomnamen
  if (type==='insert' && !/\(\s*\w/.test(s.split(/values/i)[0]||'')) {
    rows.push({
      bad:  'INSERT INTO tabel VALUES (...)',
      good: 'INSERT INTO tabel (kolom1, kolom2) VALUES (...)',
      why:  'Vermeld de kolomnamen expliciet. Zo ben je niet afhankelijk van de volgorde in de tabel en krijg je duidelijkere foutmeldingen.'
    });
  }

  // SELECT zonder FROM
  if (type==='select' && sl.startsWith('select') && !/from/i.test(s)) {
    rows.push({
      bad:  'SELECT kolom (geen FROM)',
      good: 'SELECT kolom FROM tabel',
      why:  'SQL moet altijd weten <strong>uit welke tabel</strong> je gegevens opvraagt. Voeg <code>FROM tabelnaam</code> toe na de kolomnamen.'
    });
  }

  // Tekst zonder aanhalingstekens (bijv. WHERE stad = Gent)
  const bareText = s.match(/where\s+\w+\s*=\s*([A-Za-z][A-Za-z0-9]*)\b/i);
  if (bareText && !['null','true','false','0','1'].includes(bareText[1].toLowerCase())) {
    rows.push({
      bad:  `... = ${bareText[1]}`,
      good: `... = '${bareText[1]}'`,
      why:  `Tekst in SQL staat altijd tussen <strong>enkele aanhalingstekens</strong>: <code>'${bareText[1]}'</code>. Zonder aanhalingstekens denkt SQL dat het een kolomnaam is.`
    });
  }

  // HAVING zonder GROUP BY
  if (/having/i.test(s) && !/group\s+by/i.test(s)) {
    rows.push({
      bad:  '... HAVING COUNT(*) > 1 (geen GROUP BY)',
      good: '... GROUP BY kolom HAVING COUNT(*) > 1',
      why:  '<strong>HAVING</strong> filtert groepen — maar groepen bestaan pas na een GROUP BY. Voeg GROUP BY toe vóór HAVING.'
    });
  }

  // JOIN zonder ON
  if (/(inner|left|right)\s+join/i.test(s) && !/\bon\b/i.test(s)) {
    rows.push({
      bad:  'INNER JOIN tabel (geen ON)',
      good: 'INNER JOIN tabel ON t1.kolom = t2.kolom',
      why:  'Een JOIN heeft een <strong>ON-conditie</strong> nodig die aangeeft hoe de twee tabellen gekoppeld worden (FK = PK). Zonder ON krijg je een cartesisch product van alle rijen.'
    });
  }

  // Verkeerd keyword volgorde (WHERE voor FROM)
  if (/where.*from/i.test(s) && sl.startsWith('select')) {
    rows.push({
      bad:  'SELECT ... WHERE ... FROM ...',
      good: 'SELECT ... FROM ... WHERE ...',
      why:  'De volgorde van clausules in SQL is vast: <strong>SELECT → FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT</strong>.'
    });
  }

  if (!rows.length) {
    // Generieke tip op basis van sqlType
    const generic = {
      select: { bad: 'Onverwacht resultaat', good: 'SELECT kolom FROM tabel WHERE conditie', why: 'Controleer: zijn de juiste kolommen geselecteerd? Klopt de WHERE-conditie? Zijn tabelnamen correct gespeld (kleine letters)?' },
      insert: { bad: 'INSERT mislukt', good: 'INSERT INTO tabel (k1,k2) VALUES (v1,v2)', why: 'Controleer: kloppen de kolomnamen? Staan teksten tussen aanhalingstekens? Komt het aantal kolommen overeen met het aantal waarden?' },
      update: { bad: 'UPDATE mislukt', good: 'UPDATE tabel SET kolom = waarde WHERE conditie', why: 'Controleer: is de tabel- en kolomnaam correct? Is de WHERE-conditie specifiek genoeg?' },
      delete: { bad: 'DELETE mislukt', good: 'DELETE FROM tabel WHERE conditie', why: 'Controleer: staat FROM na DELETE? Is de WHERE-conditie correct?' },
      ddl:    { bad: 'DDL-fout', good: 'CREATE TABLE naam (kolom datatype, ...)', why: 'Controleer: kloppen de datatypes? Is de PRIMARY KEY correct gedefinieerd? Zijn er haakjes rondom alle kolomdefinities?' },
    };
    const g = generic[type] || generic.select;
    rows.push(g);
  }

  return `<div class="why-error-box">
    <div class="why-error-title">💡 Waarom werkt dit niet?</div>
    ${rows.map(r => `
      <div class="why-error-row">
        <span class="why-error-label">Fout:</span>
        <code class="why-error-code bad">${esc(r.bad)}</code>
      </div>
      <div class="why-error-row">
        <span class="why-error-label">Correct:</span>
        <code class="why-error-code">${esc(r.good)}</code>
      </div>
      <div class="why-error-explain">${r.why}</div>
    `).join('<hr class="why-error-hr">')}
  </div>`;
}

// ── EXPLAIN SQL ────────────────────────────────────────────────────
function explainSQL(sql) {
  const s = sql.trim();
  const sl = s.toLowerCase();
  const parts = [];

  const kw = w => `<div class="sql-explain-part"><span class="sql-explain-kw">${w}</span><span class="sql-explain-desc">`;
  const end = `</span></div>`;

  if (sl.startsWith('select')) {
    const selM = s.match(/select\s+(.*?)\s+from/i);
    const cols = selM ? selM[1] : '*';
    parts.push(kw('SELECT') + `Haal kolommen op: <code class="u-mono-cyan">${esc(cols)}</code>` + end);
    const fromM = s.match(/from\s+([\w\s,]+?)(?:\s+where|\s+order|\s+group|\s+limit|$)/i);
    if (fromM) parts.push(kw('FROM') + `Uit tabel(len): <strong>${esc(fromM[1].trim())}</strong>` + end);
    const whereM = s.match(/where\s+(.+?)(?:\s+order|\s+group|\s+limit|$)/i);
    if (whereM) parts.push(kw('WHERE') + `Filter: enkel rijen waarbij <code class="u-mono-cyan">${esc(whereM[1].trim())}</code> klopt` + end);
    const groupM = s.match(/group\s+by\s+(\w+)/i);
    if (groupM) parts.push(kw('GROUP BY') + `Groepeer op <strong>${esc(groupM[1])}</strong> — combineer rijen met dezelfde waarde` + end);
    const havingM = s.match(/having\s+(.+?)(?:\s+order|\s+limit|$)/i);
    if (havingM) parts.push(kw('HAVING') + `Filter op groep: enkel groepen waarbij <code class="u-mono-cyan">${esc(havingM[1].trim())}</code>` + end);
    const orderM = s.match(/order\s+by\s+(\w+)\s*(asc|desc)?/i);
    if (orderM) parts.push(kw('ORDER BY') + `Sorteer op <strong>${esc(orderM[1])}</strong> ${orderM[2]?'('+orderM[2].toUpperCase()+')':'(ASC standaard)'}` + end);
    const limitM = s.match(/limit\s+(\d+)/i);
    if (limitM) parts.push(kw('LIMIT') + `Geef maximaal <strong>${esc(limitM[1])}</strong> rij(en) terug` + end);
    if (/count\s*\(\*\)/i.test(s)) parts.push(kw('COUNT(*)') + `Tel het aantal rijen dat voldoet aan de filter` + end);
    if (/avg\s*\(/i.test(s)) parts.push(kw('AVG()') + `Bereken het gemiddelde van de kolom` + end);
    if (/sum\s*\(/i.test(s)) parts.push(kw('SUM()') + `Tel alle waarden in de kolom op` + end);
    if (/max\s*\(/i.test(s)) parts.push(kw('MAX()') + `Zoek de hoogste waarde in de kolom` + end);
    if (/min\s*\(/i.test(s)) parts.push(kw('MIN()') + `Zoek de laagste waarde in de kolom` + end);
    if ((s.match(/from\s+[\w\s,]+?,/i)||[]).length) parts.push(kw('JOIN') + `Koppel meerdere tabellen via WHERE-conditie (impliciete JOIN)` + end);
    if (/inner\s+join/i.test(s)) parts.push(kw('INNER JOIN') + `Geeft enkel rijen waarvoor een overeenkomst bestaat in beide tabellen` + end);
    if (/left\s+join/i.test(s))  parts.push(kw('LEFT JOIN')  + `Geeft alle rijen van de linker tabel, ook als er geen match is rechts (NULL)` + end);
    if (/right\s+join/i.test(s)) parts.push(kw('RIGHT JOIN') + `Geeft alle rijen van de rechter tabel, ook als er geen match is links (NULL)` + end);
    const onM = s.match(/\bon\s+([\w.]+)\s*=\s*([\w.]+)/i);
    if (onM) parts.push(kw('ON') + `Koppelconditie: <code class="u-mono-cyan">${esc(onM[1])} = ${esc(onM[2])}</code> — rijen worden gekoppeld als deze waarden overeenkomen` + end);
    if (/having/i.test(s)) parts.push(kw('HAVING') + `Filter op gegroepeerde waarden (na GROUP BY) — WHERE filtert vóór groepering, HAVING erna` + end);
  } else if (sl.startsWith('insert')) {
    const tableM = s.match(/into\s+(\w+)/i);
    if (tableM) parts.push(kw('INSERT INTO') + `Voeg een nieuwe rij toe aan tabel <strong>${esc(tableM[1])}</strong>` + end);
    const colsM = s.match(/\(([^)]+)\)\s*values/i);
    if (colsM) parts.push(kw('Kolommen') + `Vul kolommen in: <code class="u-mono-cyan">${esc(colsM[1].trim())}</code>` + end);
    const valsM = s.match(/values\s*\(([^)]+)\)/i);
    if (valsM) parts.push(kw('VALUES') + `Met waarden: <code class="u-mono-cyan">${esc(valsM[1].trim())}</code>` + end);
  } else if (sl.startsWith('update')) {
    const tableM = s.match(/update\s+(\w+)/i);
    if (tableM) parts.push(kw('UPDATE') + `Pas rijen aan in tabel <strong>${esc(tableM[1])}</strong>` + end);
    const setM = s.match(/set\s+(.+?)(?:\s+where|$)/i);
    if (setM) parts.push(kw('SET') + `Nieuwe waarden: <code class="u-mono-cyan">${esc(setM[1].trim())}</code>` + end);
    const whereM = s.match(/where\s+(.+)/i);
    if (whereM) parts.push(kw('WHERE') + `Enkel rijen waarbij: <code class="u-mono-cyan">${esc(whereM[1].trim())}</code>` + end);
    else parts.push(kw('⚠️') + `Geen WHERE → alle rijen zouden aangepast worden (gevaarlijk!)` + end);
  } else if (sl.startsWith('delete')) {
    const tableM = s.match(/from\s+(\w+)/i);
    if (tableM) parts.push(kw('DELETE') + `Verwijder rijen uit tabel <strong>${esc(tableM[1])}</strong>` + end);
    const whereM = s.match(/where\s+(.+)/i);
    if (whereM) parts.push(kw('WHERE') + `Enkel rijen waarbij: <code class="u-mono-cyan">${esc(whereM[1].trim())}</code>` + end);
    else parts.push(kw('⚠️') + `Geen WHERE → alle rijen verwijderd (gevaarlijk!)` + end);
  } else if (sl.startsWith('create table')) {
    const tableM = s.match(/create\s+table\s+(\w+)/i);
    if (tableM) parts.push(kw('CREATE') + `Maak een nieuwe tabel aan: <strong>${esc(tableM[1])}</strong>` + end);
    parts.push(kw('Kolommen') + `Definieer kolomnamen, datatypes en beperkingen (NOT NULL, PRIMARY KEY, AUTO_INCREMENT)` + end);
  } else if (sl.startsWith('alter table')) {
    const tableM = s.match(/alter\s+table\s+(\w+)/i);
    if (tableM) parts.push(kw('ALTER') + `Pas tabel <strong>${esc(tableM[1])}</strong> aan` + end);
    if (sl.includes('add')) parts.push(kw('ADD COLUMN') + `Voeg een nieuwe kolom toe aan een bestaande tabel` + end);
  }

  if (!parts.length) parts.push(kw('SQL') + `Query uitgevoerd.` + end);

  // Voeg een leermoment toe afhankelijk van wat er in de query zit
  let tip = '';
  if (/distinct/i.test(s)) tip = '💡 <strong>DISTINCT</strong> verwijdert dubbele waarden — handig als je wil weten hoeveel unieke waarden er zijn.';
  else if (/left\s+join/i.test(s)) tip = '💡 <strong>LEFT JOIN</strong> retourneert alle rijen van de linker tabel, ook als er geen match is rechts. Kolommen zonder match krijgen de waarde <code>NULL</code>.';
  else if (/inner\s+join/i.test(s)) tip = '💡 <strong>INNER JOIN</strong> geeft enkel rijen terug die in <em>beide</em> tabellen een overeenkomst hebben. Rijen zonder match worden niet getoond.';
  else if (/having/i.test(s) && /group\s+by/i.test(s)) tip = '💡 <strong>WHERE vs HAVING</strong>: WHERE filtert rijen <em>vóór</em> groepering, HAVING filtert groepen <em>na</em> groepering. Beide kunnen samen gebruikt worden.';
  else if (/group\s+by/i.test(s)) tip = '💡 <strong>GROUP BY</strong> combineert rijen met dezelfde waarde in één groep. Gebruik aggregatiefuncties (COUNT, SUM, AVG) om iets over elke groep te berekenen.';
  else if (/where.*null/i.test(s)||/is\s+null/i.test(s)) tip = '💡 <strong>NULL</strong> is geen waarde maar de afwezigheid van een waarde. Je kan niet vergelijken met <code>= NULL</code> — gebruik altijd <code>IS NULL</code> of <code>IS NOT NULL</code>.';
  else if (/like/i.test(s)) tip = '💡 <strong>LIKE</strong> werkt met wildcards: <code>%</code> staat voor nul of meer tekens, <code>_</code> voor precies één teken. Case-insensitief in MySQL.';
  else if (/between/i.test(s)) tip = '💡 <strong>BETWEEN a AND b</strong> is inclusief: het geeft rijen terug waar de waarde gelijk is aan <em>a</em>, gelijk aan <em>b</em>, of ergens tussen beide ligt.';
  else if (/in\s*\(/i.test(s)) tip = '💡 <strong>IN (lijst)</strong> is een compacte manier om meerdere OR-condities te schrijven: <code>WHERE stad IN (\'Gent\',\'Antwerpen\')</code> is hetzelfde als twee WHERE-condities met OR.';
  else if (sl.startsWith('update') && /where/i.test(s)) tip = '💡 Goed! Je gebruikte <strong>WHERE</strong> bij UPDATE. Zonder WHERE zou elke rij in de tabel aangepast worden — een veelgemaakte en gevaarlijke fout.';
  else if (sl.startsWith('delete') && /where/i.test(s)) tip = '💡 Goed! Je gebruikte <strong>WHERE</strong> bij DELETE. Nooit vergeten — DELETE zonder WHERE verwijdert alles in de tabel, en dat is onomkeerbaar.';

  if (tip) {
    parts.push(`<div class="why-error-tip">${tip}</div>`);
  }

  return parts.join('');
}

// ── DAILY CHALLENGE ───────────────────────────────────────────────
const DAILY = {
  _attempts: { easy: 0, medium: 0, hard: 0 },
  _revealed: { easy: false, medium: false, hard: false },

  // Geeft de drie scenario-IDs voor vandaag terug: één easy, medium en hard
  getTodayIds() {
    const d = new Date();
    const seed = d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
    const byDiff = diff => SCENARIOS.filter(s => s.diff === diff && !s.steps);
    const pick = (arr, offset) => {
      // Vermijd integer overflow: gebruik modulaire rekenrekunde stap voor stap
      const MOD = arr.length;
      if (!MOD) return arr[0];
      let h = seed;
      for (let i = 0; i <= offset; i++) h = ((h % MOD) * (2654435761 % MOD) + (i * 7)) % MOD;
      return arr[((h % MOD) + MOD) % MOD];
    };
    return {
      easy:   pick(byDiff('easy'),   0).id,
      medium: pick(byDiff('medium'), 1).id,
      hard:   pick(byDiff('hard'),   2).id,
    };
  },
  // Laad de opgeslagen dagelijkse status (object: {date, done: {easy,medium,hard}})
  _loadState() {
    try {
      const raw = localStorage.getItem('datashop_daily_v2');
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s.date !== new Date().toDateString()) return null;
      return s;
    } catch(e) { return null; }
  },
  _saveState(done) {
    try {
      localStorage.setItem('datashop_daily_v2', JSON.stringify({
        date: new Date().toDateString(),
        done,
        ids: this.getTodayIds(),
      }));
    } catch(e) {}
  },
  isDoneToday(diff) {
    const s = this._loadState();
    if (!s) return false;
    return diff ? !!s.done?.[diff] : ['easy','medium','hard'].every(d => s.done?.[d]);
  },
  markDone(diff) {
    const s = this._loadState() || { date: new Date().toDateString(), done: {}, ids: this.getTodayIds() };
    s.done[diff] = true;
    this._saveState(s.done);
    this.updateBadge();
  },
  updateBadge() {
    const badge = $('daily-badge');
    if (!badge) return;
    const remaining = ['easy','medium','hard'].filter(d => !this.isDoneToday(d)).length;
    badge.textContent = remaining;
    badge.style.display = remaining > 0 ? '' : 'none';
  },
  render() {
    const el = $('daily-content');
    if (!el) return;
    // Reset in-memory attempt/reveal state when re-rendering (new day or full re-render)
    this._attempts = { easy: 0, medium: 0, hard: 0 };
    this._revealed = { easy: false, medium: false, hard: false };
    const ids = this.getTodayIds();
    const today = new Date().toLocaleDateString('nl-BE',{weekday:'long',day:'numeric',month:'long'});
    const todayStr = today.charAt(0).toUpperCase() + today.slice(1);

    const doneCount = ['easy','medium','hard'].filter(d => this.isDoneToday(d)).length;
    $('daily-subtitle').textContent = `${todayStr} · ${doneCount}/3 voltooid`;

    // ── Week streak calendar ─────────────────────────────────────
    const weekDays = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toDateString();
      const saved = (() => {
        try {
          const s = localStorage.getItem('datashop_daily_v2');
          if (!s) return null;
          const p = JSON.parse(s);
          if (p.date !== key) return null;
          return p;
        } catch(e) { return null; }
      })();
      const done3  = saved && ['easy','medium','hard'].every(x => saved.done?.[x]);
      const done1  = saved && ['easy','medium','hard'].some(x => saved.done?.[x]);
      const isToday = i === 0;
      const label   = d.toLocaleDateString('nl-BE',{weekday:'short'}).replace('.','');
      weekDays.push({ label, done3, done1, isToday });
    }

    const streakCount = (() => {
      let n = 0;
      for (let i = weekDays.length - 1; i >= 0; i--) {
        if (weekDays[i].done3 || (weekDays[i].isToday && doneCount > 0)) n++;
        else if (!weekDays[i].isToday) break;
      }
      return n;
    })();

    const calHtml = `
      <div class="daily-cal-wrap">
        <div class="daily-week-cal">
          ${weekDays.map(d => `
            <div class="daily-week-day${d.done3?' done3':d.done1?' done1':''} ${d.isToday?'today':''}">
              <span class="dwd-dot">${d.done3?'✓':d.done1?'·':'○'}</span>
              <span class="dwd-lbl">${d.label}</span>
            </div>`).join('')}
        </div>
        ${streakCount >= 2 ? `<div class="daily-streak-badge">🔥 ${streakCount} dagen op rij!</div>` : ''}
      </div>`;

    const diffLabel = { easy:'Makkelijk', medium:'Gemiddeld', hard:'Moeilijk' };
    const diffEmoji = { easy:'🟢', medium:'🟠', hard:'🔴' };
    const diffXPMult = { easy:1.2, medium:1.5, hard:2.0 };
    const diffAccent = {
      easy:   { bg:'rgba(74,222,128,.07)',  border:'rgba(74,222,128,.25)',  top:'var(--green)',  xpColor:'var(--green)' },
      medium: { bg:'rgba(251,146,60,.07)',  border:'rgba(251,146,60,.25)',  top:'var(--orange)', xpColor:'var(--orange)' },
      hard:   { bg:'rgba(248,113,113,.07)', border:'rgba(248,113,113,.25)', top:'var(--red)',    xpColor:'var(--red)' },
    };

    const allDone = doneCount === 3;

    if (allDone) {
      el.innerHTML = calHtml + `
        <div class="daily-all-done">
          <div class="daily-all-done-icon">🏆</div>
          <div class="daily-all-done-title">Alle uitdagingen voltooid!</div>
          <div class="daily-all-done-sub">Uitstekend werk. Kom morgen terug voor nieuwe missies.</div>
        </div>
        <div class="daily-done-cards">
          ${['easy','medium','hard'].map(diff => {
            const sc  = SCENARIOS.find(s => s.id === ids[diff]);
            const acc = diffAccent[diff];
            const xp  = sc ? Math.round(sc.xp * diffXPMult[diff]) : 0;
            return `
            <div class="daily-done-card daily-done-card--${diff}">
              <span class="daily-done-icon">${sc?.icon||'✅'}</span>
              <div>
                <div class="daily-diff-label-small">${diffEmoji[diff]} ${diffLabel[diff]}</div>
                <div class="daily-done-card-title">${sc ? esc(sc.title) : ''}</div>
              </div>
              <div class="daily-done-card-xp daily-xp-${diff}">+${xp} XP</div>
            </div>`;
          }).join('')}
        </div>`;
      return;
    }

    // ── Render challenge cards ───────────────────────────────────
    const cards = ['easy','medium','hard'].map(diff => {
      const sc  = SCENARIOS.find(s => s.id === ids[diff]);
      if (!sc) return '';
      const done    = this.isDoneToday(diff);
      const bonusXP = Math.round(sc.xp * diffXPMult[diff]);
      const acc     = diffAccent[diff];

      if (done) {
        return `
        <div class="daily-card daily-card-done daily-done-card--${diff}">
          <div class="daily-card-header">
            <div class="daily-diff-badge daily-diff-badge--${diff}">${diffEmoji[diff]} ${diffLabel[diff]}</div>
            <div class="daily-done-check">✅ Voltooid · <span class="daily-xp-${diff}">+${bonusXP} XP</span></div>
          </div>
          <div class="daily-card-body">
            <div class="daily-done-sc-icon">${sc.icon}</div>
            <div class="daily-meta-title daily-done-title">${esc(sc.title)}</div>
          </div>
        </div>`;
      }

      return `
      <div class="daily-card daily-card--${diff}">
        <div class="daily-card-header">
          <div class="daily-diff-badge daily-diff-badge--${diff}">${diffEmoji[diff]} ${diffLabel[diff]}</div>
          <div class="daily-xp-badge daily-xp-badge--${diff}">+${bonusXP} XP</div>
        </div>
        <div class="daily-card-body">
          <div class="daily-icon-wrap daily-icon-wrap--${diff}">${sc.icon}</div>
          <div class="daily-card-info">
            <div class="daily-meta-title">${esc(sc.title)}</div>
            <div class="daily-card-story">${sc.story}</div>
          </div>
        </div>
        <div class="daily-card-footer">
          <div class="daily-footer-tags">
            <span class="tag tag-${diff === 'easy' ? 'easy' : diff === 'medium' ? 'medium' : 'hard'}">${diffLabel[diff]}</span>
            <span class="tag tag-xp">+${sc.xp} basis XP</span>
            <span class="tag tag-sql-type">${sc.sqlType?.toUpperCase()||'SQL'}</span>
            ${sc.time ? `<span class="tag tag-time">⏱ ${sc.time}s</span>` : ''}
          </div>
        </div>
        <div class="daily-sql-wrap">
          <div class="hl-wrap">
            <div class="hl-backdrop" id="hl-daily-${diff}" aria-hidden="true"></div>
            <textarea id="daily-sql-${diff}" class="sql-editor daily-sql-ta" rows="4"
              placeholder="-- Schrijf je SQL hier...&#10;-- Ctrl+Enter om uit te voeren" spellcheck="false"></textarea>
          </div>
          <div id="daily-fb-${diff}" class="feedback"></div>
          <button class="btn btn-primary btn-sm daily-run-btn" id="daily-run-${diff}" onclick="DAILY.run('${diff}')">▶ Uitvoeren</button>
        </div>
      </div>`;
    }).join('');

    el.innerHTML = calHtml + `<div class="daily-cards-grid">${cards}</div>`
  },

  run(diff) {
    const ids = this.getTodayIds();
    const sc = SCENARIOS.find(s => s.id === ids[diff]);
    const sql = ($('daily-sql-'+diff)||{}).value?.trim();
    const fb = $('daily-fb-'+diff);
    if (!fb) return;
    if (!sql) { fb.className='feedback err visible'; fb.textContent='Schrijf eerst een SQL-statement.'; return; }
    if (this.isDoneToday(diff)) {
      fb.className='feedback hint visible';
      fb.textContent='✅ Deze uitdaging heb je vandaag al voltooid!';
      return;
    }
    if (this._revealed[diff]) {
      fb.className='feedback err visible';
      fb.textContent='💡 Oplossing al getoond — je kan geen XP meer verdienen voor deze uitdaging vandaag.';
      return;
    }
    if (!sc) { fb.className='feedback err visible'; fb.textContent='Scenario niet gevonden. Herlaad de pagina.'; return; }
    if (sc.steps) { fb.className='feedback err visible'; fb.textContent='Dit scenario heeft meerdere stappen — gebruik het in de missies-sectie.'; return; }
    const res = sc.check(sql);
    if (res.ok) {
      const multiplier = {easy:1.2, medium:1.5, hard:2.0};
      const alreadyDoneInMain = G.done.has(sc.id);
      const bonusXP = alreadyDoneInMain
        ? Math.round(sc.xp * 0.5)
        : Math.round(sc.xp * multiplier[diff]);
      const bonusLabel = alreadyDoneInMain
        ? `+${bonusXP} extra bonus XP 🌅 (missie al voltooid)`
        : `+${bonusXP} bonus XP 🌅 (×${multiplier[diff]})`;
      fb.className = 'feedback ok visible';
      fb.innerHTML = `✅ <strong>Uitdaging geslaagd!</strong> ${bonusLabel}`;
      G.xp += bonusXP;
      G.streak++;
      UI.xpPop('+'+bonusXP+' XP 🌅');
      UI.updateXP();
      UI.addEvent('ok', `🌅 Dagelijkse uitdaging <strong>${esc(sc.title)}</strong> voltooid! +${bonusXP} XP`);
      this.markDone(diff);
      save();
      APP.checkNewKeyword(sql);
      // Pedagogic reflection
      const dailyReflectEl = document.createElement('div');
      dailyReflectEl.className = 'concept-win-box';
      dailyReflectEl.innerHTML = buildWinReflection(sc, sql);
      fb.after(dailyReflectEl);
      const explainEl = document.createElement('div');
      explainEl.className = 'sql-explain';
      explainEl.innerHTML = `<div class="sql-explain-title">🔍 Wat deed jouw SQL?</div>${explainSQL(sql)}`;
      dailyReflectEl.after(explainEl);
      // Re-render na korte delay om voltooide kaart te tonen
      setTimeout(() => this.render(), 400);
    } else {
      this._attempts[diff] = (this._attempts[diff] || 0) + 1;
      const attempts = this._attempts[diff];
      const remaining = 4 - attempts;
      fb.className = 'feedback err visible';
      // Smart streak: onderscheid syntax van logische fout
      const isSyntaxDailyErr = res.msg && (res.msg.includes('Gebruik') || res.msg.includes('Begin met') || res.msg.includes('ontbreekt') || res.msg.includes('vergeten'));
      const countdownHint = remaining > 0
        ? `<br><small class="u-muted">Nog ${remaining} poging${remaining === 1 ? '' : 'en'} voor de oplossing wordt ontgrendeld.</small>`
        : '';
      if (isSyntaxDailyErr) {
        fb.innerHTML = '⚠️ ' + res.msg + '<br><small class="u-muted">Kleine fout — reeks intact</small>' + countdownHint;
      } else {
        fb.innerHTML = '❌ ' + (res.msg || 'Onjuist. Probeer opnieuw!') + countdownHint;
      }
      // Na 4 pogingen: toon "Toon oplossing" knop
      if (attempts >= 4 && !this._revealed[diff]) {
        const revealBtnId = 'daily-reveal-' + diff;
        if (!document.getElementById(revealBtnId)) {
          const revealBtn = document.createElement('button');
          revealBtn.id = revealBtnId;
          revealBtn.className = 'btn btn-outline btn-sm';
          revealBtn.style.cssText = 'margin-top:8px;border-color:var(--orange);color:var(--orange);width:100%';
          revealBtn.innerHTML = '💡 Toon oplossing (geen XP)';
          revealBtn.onclick = () => DAILY.revealSolution(diff);
          fb.after(revealBtn);
        }
      }
    }
  },

  revealSolution(diff) {
    if (this._revealed[diff]) return;
    this._revealed[diff] = true;
    const ids = this.getTodayIds();
    const sc = SCENARIOS.find(s => s.id === ids[diff]);
    if (!sc) return;
    const solution = sc.hint || sc.solution || sc.answer || '';
    const fb = $('daily-fb-' + diff);
    const revealBtn = document.getElementById('daily-reveal-' + diff);
    if (revealBtn) revealBtn.remove();
    // Toon oplossing in een speciaal blok
    const solutionEl = document.createElement('div');
    solutionEl.style.cssText = 'margin-top:10px;padding:12px 14px;background:rgba(251,146,60,.07);border:1px solid rgba(251,146,60,.3);border-radius:8px';
    solutionEl.innerHTML = `
      <div class="daily-solution-label">💡 Voorbeeldoplossing — geen XP</div>
      <pre class="daily-solution-pre">${esc(solution)}</pre>
      <div class="daily-solution-note">Bestudeer deze oplossing goed. Je kan de uitdaging morgen opnieuw proberen!</div>`;
    if (fb) fb.after(solutionEl);
    // Vergrendel de knop zodat leerling geen XP meer kan verdienen
    const runBtn = document.getElementById('daily-run-' + diff);
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.style.opacity = '0.4';
      runBtn.title = 'Oplossing al getoond — geen XP mogelijk';
    }
  }
};


// ── SCENARIO → TUTORIAL KOPPELING ────────────────────────────────
const SC_TUT_LINK = {
  // SELECT basics
  first_select:      { mod: 'select_basics',      les: 0, label: 'Les: Je eerste SELECT' },
  active_customers:  { mod: 'select_basics',      les: 1, label: 'Les: WHERE — Filteren' },
  low_stock:         { mod: 'select_basics',      les: 2, label: 'Les: ORDER BY & LIMIT' },
  // INSERT / UPDATE / DELETE
  new_customer:      { mod: 'insert_update_delete', les: 0, label: 'Les: INSERT — Nieuwe rij' },
  new_product:       { mod: 'insert_update_delete', les: 0, label: 'Les: INSERT — Nieuwe rij' },
  new_order:         { mod: 'insert_update_delete', les: 0, label: 'Les: INSERT — Nieuwe rij' },
  restock_webcam:    { mod: 'insert_update_delete', les: 1, label: 'Les: UPDATE — Gegevens wijzigen' },
  disable_coupon:    { mod: 'insert_update_delete', les: 1, label: 'Les: UPDATE — Gegevens wijzigen' },
  delete_test:       { mod: 'insert_update_delete', les: 2, label: 'Les: DELETE — Rijen verwijderen' },
  // Aggregaten
  count_products:    { mod: 'aggregaten',           les: 0, label: 'Les: COUNT, SUM, AVG' },
  avg_review:        { mod: 'aggregaten',           les: 0, label: 'Les: COUNT, SUM, AVG' },
  count_orders:      { mod: 'aggregaten',           les: 1, label: 'Les: GROUP BY' },
  // JOINs
  join_orders:       { mod: 'joins',                les: 0, label: 'Les: INNER JOIN' },
  inner_join_basic:  { mod: 'joins',                les: 0, label: 'Les: INNER JOIN' },
  // DDL
  add_telefoon:      { mod: 'ddl',                  les: 1, label: 'Les: ALTER TABLE' },
  create_leverancier:{ mod: 'ddl',                  les: 0, label: 'Les: CREATE TABLE' },
  // Subqueries / DISTINCT
};


// ── WIN REFLECTION ────────────────────────────────────────────────
// Toont na een correcte missie een pedagogische reflectie:
// welk concept is gebruikt, waarom het werkt, + link naar tutorialles
const CONCEPT_WIN_TEXTS = {
  select: {
    icon: '🔍',
    title: 'SELECT gemeisterd',
    explain: 'Met SELECT haal je gegevens op uit een tabel. De clausules worden altijd in vaste volgorde uitgevoerd: <strong>FROM → WHERE → SELECT → ORDER BY → LIMIT</strong>.',
    tip: 'Pro-tip: gebruik specifieke kolomnamen i.p.v. SELECT * — dat is sneller en leesbaarder.',
  },
  insert: {
    icon: '➕',
    title: 'INSERT correct uitgevoerd',
    explain: 'INSERT INTO voegt één nieuwe rij toe aan de tabel. Door de kolomnamen expliciet te vermelden ben je onafhankelijk van de volgorde in de tabel.',
    tip: 'Pro-tip: als je AUTO_INCREMENT hebt, mag je het ID-veld weglaten — de database vult het zelf in.',
  },
  update: {
    icon: '✏️',
    title: 'UPDATE veilig uitgevoerd',
    explain: 'UPDATE past bestaande rijen aan. De WHERE-clausule is cruciaal: zonder WHERE zou je <em>alle</em> rijen tegelijk aanpassen.',
    tip: 'Pro-tip: test je WHERE-filter eerst met een SELECT-query voordat je de UPDATE uitvoert.',
  },
  delete: {
    icon: '🗑️',
    title: 'DELETE correct uitgevoerd',
    explain: 'DELETE FROM verwijdert rijen permanent. Zonder WHERE worden ALLE rijen verwijderd. Bij klantgegevens is UPDATE SET actief = 0 vaak een betere keuze (GDPR).',
    tip: 'Pro-tip: gebruik altijd een transactie (BEGIN/ROLLBACK) in productie zodat je een fout nog kan ongedaan maken.',
  },
  ddl: {
    icon: '🏗️',
    title: 'DDL-commando geslaagd',
    explain: 'DDL (Data Definition Language) wijzigt de <em>structuur</em> van de database. CREATE TABLE maakt een nieuwe tabel, ALTER TABLE past een bestaande aan. Dit heeft geen invloed op de bestaande data.',
    tip: 'Pro-tip: bij ALTER TABLE ADD COLUMN krijgen bestaande rijen automatisch NULL als waarde voor de nieuwe kolom.',
  },
};

// Extra concept-specifieke uitleg op basis van wat er in de query staat
function detectAdvancedConcepts(sql) {
  const s = sql.toLowerCase();
  const found = [];
  if (s.includes('group by'))   found.push({ icon:'📊', name:'GROUP BY', desc:'Groepeert rijen zodat je aggregaten (COUNT, SUM, AVG…) per groep kunt berekenen.' });
  if (s.includes('having'))     found.push({ icon:'🎯', name:'HAVING', desc:'Filtert groepen <em>na</em> GROUP BY — WHERE werkt vóór groepering, HAVING erna.' });
  if (s.includes('inner join')) found.push({ icon:'🔗', name:'INNER JOIN', desc:'Geeft alleen rijen terug die in beide tabellen een overeenkomst hebben via de ON-conditie.' });
  if (s.includes('left join'))  found.push({ icon:'⬅️', name:'LEFT JOIN', desc:'Geeft alle rijen uit de linker tabel, ook als er geen overeenkomst is in de rechter tabel (NULL).' });
  if (s.match(/join/) && !s.includes('inner join') && !s.includes('left join')) found.push({ icon:'🔗', name:'JOIN', desc:'Combineert rijen uit twee tabellen via een gedeelde sleutel (FK = PK).' });
  if (s.includes('distinct'))   found.push({ icon:'🔎', name:'DISTINCT', desc:'Verwijdert duplicate rijen uit het resultaat — elke unieke waarde verschijnt maar één keer.' });
  if (s.includes('(select'))    found.push({ icon:'🧩', name:'Subquery', desc:'Een query binnen een andere query. De binnenste wordt eerst uitgevoerd, het resultaat wordt gebruikt in de buitenste.' });
  if (s.includes(' as '))       found.push({ icon:'🏷️', name:'AS (alias)', desc:'Geeft een kolom of tabel een leesbare naam in het resultaat.' });
  if (s.includes('order by'))   found.push({ icon:'↕️', name:'ORDER BY', desc:'Sorteert het resultaat op een of meer kolommen, oplopend (ASC) of aflopend (DESC).' });
  if (s.match(/count\s*\(/))  found.push({ icon:'🔢', name:'COUNT()', desc:'Telt het aantal rijen (of niet-NULL waarden in een kolom).' });
  if (s.match(/(avg|sum|max|min)\s*\(/)) found.push({ icon:'📐', name:'Aggregatiefunctie', desc:'Berekent een waarde over meerdere rijen: AVG (gemiddelde), SUM (som), MAX/MIN (uitersten).' });
  return found;
}

function buildWinReflection(sc, sql) {
  const type = sc.sqlType || 'select';
  const base = CONCEPT_WIN_TEXTS[type] || CONCEPT_WIN_TEXTS.select;
  const advanced = detectAdvancedConcepts(sql);

  // Tutorial link (hergebruik SC_TUT_LINK als beschikbaar)
  const link = SC_TUT_LINK[sc.id];
  const tutHtml = link
    ? `<div class="cwb-tut-link" onclick="APP.showPanel('tut');TUT.openModule('${link.mod}');TUT._activeLes=${link.les};TUT.render();">
        📚 Verdiep je verder: <strong>${esc(link.label)}</strong> →
      </div>`
    : '';

  const advancedHtml = advanced.length
    ? `<div class="cwb-concepts">${advanced.map(c =>
        `<div class="cwb-concept-pill"><span>${c.icon}</span><div><strong>${esc(c.name)}</strong><span>${c.desc}</span></div></div>`
      ).join('')}</div>`
    : '';

  return `<div class="cwb-head">
      <span class="cwb-icon">${base.icon}</span>
      <div>
        <div class="cwb-title">${esc(base.title)}</div>
        <div class="cwb-explain">${base.explain}</div>
      </div>
    </div>
    ${advancedHtml}
    <div class="cwb-tip">💡 ${base.tip}</div>
    ${tutHtml}`;
}


function scTutLink(scId) {
  const link = SC_TUT_LINK[scId];
  if (!link) return '';
  const isDoneTut = TUT.isLessonDone(link.mod, link.les);
  if (isDoneTut) {
    // Les al gedaan: toon groen afvinkje
    return `<a class="sc-tut-link sc-tut-link--green"
      onclick="APP.showPanel('tut');TUT.openModule('${link.mod}');TUT._activeLes=${link.les};TUT.render();"
      title="Open bijhorende tutorial les">✅ ${esc(link.label)} — bekijk nogmaals</a>`;
  } else {
    // Les nog niet gedaan: aanbeveling
    return `<div class="tut-recommended-wrap">
      <div class="tut-recommended-inner">
        <div class="tut-recommended-label">📚 Aanbevolen eerst</div>
        <div class="u-label-sm">De bijhorende tutorialles helpt je deze missie aan te pakken.</div>
      </div>
      <a class="sc-tut-link sc-tut-link--purple"
        onclick="APP.showPanel('tut');TUT.openModule('${link.mod}');TUT._activeLes=${link.les};TUT.render();">
        🎓 ${esc(link.label)}
      </a>
    </div>`;
  }
}

// ── TUTORIAL ──────────────────────────────────────────────────────
const TUT_MODULES = [
  {
    id: 'select_basics', icon: '🔍', title: 'SELECT — Gegevens opvragen', level: 'beginner',
    lessons: [
      {
        title: 'Je eerste SELECT',
        tables: ['klant', 'product'],
        intro: 'SQL staat voor <strong>Structured Query Language</strong>. Met <strong>SELECT</strong> haal je gegevens op uit een tabel — net als een zoekopdracht in de database.<br><br>Elke SQL-query begint met twee verplichte onderdelen: <code>SELECT</code> zegt <em>welke kolommen</em> je wilt zien, en <code>FROM</code> zegt <em>uit welke tabel</em>. De volgorde is altijd: SELECT eerst, dan FROM.<br><br>💡 <strong>Tip:</strong> Met <code>SELECT *</code> haal je alle kolommen op. Wil je alleen specifieke kolommen, dan schrijf je ze op, gescheiden door komma\'s.',
        concept: { title: 'De basisstructuur', text: 'SELECT kolommen FROM tabel;\n\nMet SELECT kies je welke kolommen je wilt zien. Met FROM zeg je uit welke tabel.' },
        examples: [
          { label: 'Alle klanten (alle kolommen)', code: 'SELECT *\nFROM klant', result: 'Geeft alle rijen + kolommen van de klant-tabel' },
          { label: 'Alleen naam en stad', code: 'SELECT naam, stad\nFROM klant', result: 'Enkel de kolommen naam en stad' },
        ],
        exercise: { task: 'Haal de naam en email op van alle klanten.', hint: 'Gebruik: SELECT naam, email FROM klant', check: s => s.includes('naam') && s.includes('email') && s.includes('klant') },
      },
      {
        title: 'WHERE — Filteren',
        tables: ['klant', 'product'],
        intro: 'Met <strong>WHERE</strong> filter je de resultaten. Zo zie je enkel de rijen die aan een bepaalde voorwaarde voldoen.<br><br>Zonder WHERE geeft SQL <em>alle</em> rijen terug. Met WHERE zeg je: "geef me alleen rijen waarbij kolom X gelijk is aan waarde Y". Je kan vergelijken met <code>=</code>, <code>!=</code>, <code>&gt;</code>, <code>&lt;</code>, of tekst zoeken met <code>LIKE</code>.<br><br>💡 <strong>Tip:</strong> Meerdere voorwaarden combineer je met <code>AND</code> (beide moeten kloppen) of <code>OR</code> (één volstaat).',
        concept: { title: 'Filteroperatoren', text: '= (gelijk)   !=  (niet gelijk)\n> (groter)   <   (kleiner)\n>= (groter of gelijk)   <= (kleiner of gelijk)\nLIKE \'%tekst%\'  (bevat tekst)' },
        examples: [
          { label: 'Klanten uit Gent', code: "SELECT naam, stad\nFROM klant\nWHERE stad = 'Gent'", result: 'Alleen klanten met stad = Gent' },
          { label: 'Producten onder €30', code: 'SELECT naam, prijs\nFROM product\nWHERE prijs < 30', result: 'Alle producten goedkoper dan €30' },
        ],
        exercise: { task: 'Zoek alle actieve klanten (actief = 1).', hint: 'WHERE actief = 1', check: s => s.includes('klant') && s.includes('actief') && (s.includes('= 1') || s.includes('=1')) },
      },
      {
        title: 'ORDER BY & LIMIT',
        tables: ['product'],
        intro: 'Met <strong>ORDER BY</strong> sorteer je de resultaten. Met <strong>LIMIT</strong> beperk je het aantal rijen — handig voor toplists.<br><br>Standaard sorteert ORDER BY van laag naar hoog (A→Z, klein→groot). Voeg <code>DESC</code> toe voor omgekeerde volgorde. Je kan ook op meerdere kolommen tegelijk sorteren: <code>ORDER BY stad ASC, naam ASC</code>.<br><br>💡 <strong>Tip:</strong> LIMIT staat altijd <em>helemaal op het einde</em> van de query, na ORDER BY.',
        concept: { title: 'Sorteren en beperken', text: 'ORDER BY kolom ASC   -- laag → hoog (standaard)\nORDER BY kolom DESC  -- hoog → laag\nLIMIT n              -- enkel de eerste n rijen' },
        examples: [
          { label: 'Duurste producten eerst', code: 'SELECT naam, prijs\nFROM product\nORDER BY prijs DESC', result: 'Producten van duur naar goedkoop' },
          { label: 'Top 3 duurste producten', code: 'SELECT naam, prijs\nFROM product\nORDER BY prijs DESC\nLIMIT 3', result: 'Alleen de 3 duurste producten' },
        ],
        exercise: { task: 'Geef de 5 producten met de laagste stock, laagste eerst.', hint: 'ORDER BY stock ASC LIMIT 5', check: s => s.includes('product') && s.includes('order by') && s.includes('stock') && s.includes('limit') },
      },
    ],
  },
  {
    id: 'insert_update_delete', icon: '✏️', title: 'INSERT · UPDATE · DELETE', level: 'beginner',
    lessons: [
      {
        title: 'INSERT — Nieuwe rij toevoegen',
        tables: ['product', 'klant'],
        intro: 'Met <strong>INSERT INTO</strong> voeg je nieuwe gegevens toe aan een tabel. Je specificeert welke kolommen je invult en welke waarden je invoegt.<br><br>De kolomnamen en de waarden moeten in <em>dezelfde volgorde</em> staan. Tekst staat altijd tussen enkele aanhalingstekens <code>\'zo\'</code>. Getallen schrijf je zonder aanhalingstekens.<br><br>💡 <strong>Tip:</strong> Kolommen die je weglaat krijgen hun standaardwaarde (of NULL). Kolommen die verplicht zijn (NOT NULL) moet je altijd invullen.',
        concept: { title: 'INSERT INTO ... VALUES', text: 'INSERT INTO tabel (kolom1, kolom2)\nVALUES (waarde1, waarde2);\n\nLetop: tekst staat tussen enkelvoudige aanhalingstekens.' },
        examples: [
          { label: 'Nieuw product toevoegen', code: "INSERT INTO product (naam, prijs, stock, categorie)\nVALUES ('Laptop Stand', 34.99, 15, 'Accessoires')", result: 'Voegt een nieuw product toe aan de database' },
          { label: 'Nieuwe klant registreren', code: "INSERT INTO klant (naam, email, stad, actief)\nVALUES ('Lien Claes', 'lien@mail.be', 'Gent', 1)", result: 'Lien Claes wordt toegevoegd als actieve klant' },
        ],
        exercise: { task: "Voeg een nieuw product toe: 'USB Hub', prijs 19.99, stock 25, categorie 'Elektronica'.", hint: "INSERT INTO product (naam, prijs, stock, categorie) VALUES ('USB Hub', 19.99, 25, 'Elektronica')", check: s => s.includes('insert') && s.includes('product') && s.includes('usb hub') },
      },
      {
        title: 'UPDATE — Gegevens wijzigen',
        tables: ['product', 'bestelling'],
        intro: '<strong>UPDATE</strong> past bestaande rijen aan. <span class="u-err-text">Gebruik ALTIJD WHERE</span> — anders pas je elke rij in de tabel aan!<br><br>De structuur is: <code>UPDATE tabel SET kolom = nieuwewaarde WHERE voorwaarde</code>. Je kan meerdere kolommen tegelijk aanpassen door ze te scheiden met komma\'s: <code>SET naam = \'Nieuw\', prijs = 9.99</code>.<br><br>⚠️ <strong>Gevaar:</strong> <code>UPDATE product SET prijs = 0</code> zonder WHERE zet alle prijzen naar nul. Test eerst met SELECT + dezelfde WHERE om te controleren welke rijen je aanpast.',
        concept: { title: 'UPDATE ... SET ... WHERE', text: 'UPDATE tabel\nSET kolom = nieuwewaarde\nWHERE voorwaarde;\n\n⚠️ Zonder WHERE: ALLE rijen worden aangepast!' },
        examples: [
          { label: 'Prijs aanpassen', code: 'UPDATE product\nSET prijs = 44.99\nWHERE product_id = 2', result: 'Enkel product 2 krijgt de nieuwe prijs' },
          { label: 'Meerdere kolommen', code: "UPDATE bestelling\nSET status = 'geleverd'\nWHERE bestelling_id = 4", result: 'Status van bestelling 4 wordt geleverd' },
        ],
        exercise: { task: 'Zet de stock van product_id 3 op 50.', hint: 'UPDATE product SET stock = 50 WHERE product_id = 3', check: s => s.includes('update') && s.includes('product') && s.includes('stock') && s.includes('where') },
        warn: '⚠️ Vergeet WHERE nooit bij UPDATE! UPDATE product SET prijs = 0 (zonder WHERE) zet alle prijzen op nul!',
      },
      {
        title: 'DELETE — Rijen verwijderen',
        tables: ['review', 'klant'],
        intro: '<strong>DELETE FROM</strong> verwijdert rijen uit een tabel. Net als UPDATE: <span class="u-err-text">altijd WHERE gebruiken</span>, anders verwijder je alles!<br><br>DELETE is <em>onomkeerbaar</em> — eenmaal uitgevoerd, zijn de gegevens weg. In productiedatabases werk je daarom altijd met een backup of transactie vooraleer je iets verwijdert.<br><br>💡 <strong>GDPR-tip:</strong> Voor klantgegevens is het vaak veiliger om te "deactiveren" (<code>UPDATE SET actief = 0</code>) dan echt te verwijderen. Zo bewaar je historiek en voldoe je toch aan privacywetgeving.',
        concept: { title: 'DELETE FROM ... WHERE', text: 'DELETE FROM tabel\nWHERE voorwaarde;\n\n⚠️ DELETE FROM tabel (zonder WHERE) verwijdert ALLE rijen!' },
        examples: [
          { label: 'Review verwijderen', code: 'DELETE FROM review\nWHERE review_id = 3', result: 'Enkel review 3 wordt verwijderd' },
          { label: 'GDPR-tip: deactiveer i.p.v. deleten', code: 'UPDATE klant\nSET actief = 0\nWHERE klant_id = 4', result: 'Veiliger: klant blijft in systeem maar is inactief' },
        ],
        exercise: { task: 'Verwijder alle reviews met een score lager dan 2.', hint: 'DELETE FROM review WHERE score < 2', check: s => s.includes('delete') && s.includes('review') && s.includes('score') && s.includes('where') },
        warn: '⚠️ DELETE is onomkeerbaar! Overweeg UPDATE SET actief = 0 als alternatief voor klantgegevens (GDPR).',
      },
    ],
  },
  {
    id: 'aggregaten', icon: '📊', title: 'Aggregatiefuncties', level: 'medium',
    lessons: [
      {
        title: 'COUNT, SUM, AVG',
        tables: ['product', 'klant'],
        intro: '<strong>Aggregatiefuncties</strong> berekenen iets over meerdere rijen tegelijk — totalen, gemiddeldes, aantallen. Ze zijn essentieel voor rapporten en analyses.<br><br>In plaats van individuele rijen terug te geven, <em>vat</em> een aggregatiefunctie alle rijen samen tot één waarde. <code>COUNT(*)</code> telt rijen, <code>SUM(kolom)</code> telt op, <code>AVG(kolom)</code> berekent het gemiddelde, <code>MAX</code> en <code>MIN</code> geven de grootste/kleinste waarde.<br><br>💡 <strong>Tip:</strong> Aggregatiefuncties negeren NULL-waarden (behalve COUNT(*)). <code>COUNT(*)</code> telt alle rijen inclusief NULL; <code>COUNT(kolom)</code> telt alleen rijen mét een waarde.',
        concept: { title: 'De vijf aggregatiefuncties', text: 'COUNT(*) — aantal rijen\nSUM(kolom) — optelling\nAVG(kolom) — gemiddelde\nMAX(kolom) — grootste waarde\nMIN(kolom) — kleinste waarde' },
        examples: [
          { label: 'Hoeveel klanten?', code: 'SELECT COUNT(*)\nFROM klant', result: 'Geeft het totale aantal klanten terug' },
          { label: 'Gemiddelde prijs', code: 'SELECT AVG(prijs)\nFROM product', result: 'De gemiddelde verkoopprijs van alle producten' },
        ],
        exercise: { task: 'Bereken de totale stock van alle producten samen (SUM).', hint: 'SELECT SUM(stock) FROM product', check: s => s.includes('sum') && s.includes('stock') && s.includes('product') },
      },
      {
        title: 'GROUP BY',
        tables: ['product', 'bestelling'],
        intro: '<strong>GROUP BY</strong> groepeert rijen op basis van een kolom, zodat je aggregatiefuncties per groep kunt berekenen — bijv. hoeveel bestellingen per status.<br><br>Zonder GROUP BY geeft een aggregatiefunctie één getal over de hele tabel. <em>Met</em> GROUP BY krijg je een getal per unieke waarde in de groepeerkolom. Stel je voor: tabel met 100 bestellingen → <code>GROUP BY status</code> maakt groepjes per status, en COUNT(*) telt per groepje.<br><br>💡 <strong>Regel:</strong> Elke kolom in SELECT die geen aggregatiefunctie is, moet ook in GROUP BY staan.',
        concept: { title: 'GROUP BY — aggregeren per groep', text: 'SELECT kolom, COUNT(*)\nFROM tabel\nGROUP BY kolom;\n\nElke unieke waarde in de GROUP BY-kolom wordt één resultaatrij.' },
        examples: [
          { label: 'Producten per categorie', code: 'SELECT categorie, COUNT(*)\nFROM product\nGROUP BY categorie', result: 'Eén rij per categorie met het aantal producten' },
          { label: 'Totale stock per categorie', code: 'SELECT categorie, SUM(stock)\nFROM product\nGROUP BY categorie', result: 'Totale voorraad per productcategorie' },
        ],
        exercise: { task: 'Toon het aantal bestellingen per status.', hint: 'SELECT status, COUNT(*) FROM bestelling GROUP BY status', check: s => s.includes('bestelling') && s.includes('count') && s.includes('group by') && s.includes('status') },
      },
      {
        title: 'HAVING',
        tables: ['bestelling', 'product'],
        intro: '<strong>HAVING</strong> filtert na GROUP BY — het is de WHERE voor groepen. Gebruik HAVING wanneer je op een aggregaatwaarde wilt filteren.<br><br>Het verschil is het <em>moment</em> van filteren: WHERE filtert individuele rijen vóórdat ze gegroepeerd worden. HAVING filtert de gevormde groepen ná de groepering. Je kan dus niet schrijven <code>WHERE COUNT(*) > 5</code> — dat moet <code>HAVING COUNT(*) > 5</code> zijn.<br><br>💡 <strong>Volgorde:</strong> <code>SELECT → FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT</code>',
        concept: { title: 'WHERE vs HAVING', text: 'WHERE  → filtert individuele rijen VÓÓR groepering\nHAVING → filtert groepen NÁ groepering\n\nHAVING COUNT(*) > 2 : enkel groepen met meer dan 2 rijen' },
        examples: [
          { label: 'Klanten met >1 bestelling', code: 'SELECT klant_id, COUNT(*)\nFROM bestelling\nGROUP BY klant_id\nHAVING COUNT(*) > 1', result: 'Enkel klanten die meer dan één keer bestelden' },
          { label: 'Categorieën met hoge gemiddelde prijs', code: 'SELECT categorie, AVG(prijs)\nFROM product\nGROUP BY categorie\nHAVING AVG(prijs) > 30', result: 'Enkel categorieën waarvan de gemiddelde prijs > €30' },
        ],
        exercise: { task: 'Toon categorieën met meer dan 2 producten.', hint: 'SELECT categorie, COUNT(*) FROM product GROUP BY categorie HAVING COUNT(*) > 2', check: s => s.includes('product') && s.includes('group by') && s.includes('having') && s.includes('count') },
      },
    ],
  },
  {
    id: 'joins', icon: '🔗', title: 'JOINs — Tabellen koppelen', level: 'medium',
    lessons: [
      {
        title: 'Waarom JOINs?',
        tables: ['klant', 'bestelling'],
        intro: 'Een goede database <strong>splitst gegevens over meerdere tabellen</strong> — klanten, producten, bestellingen apart. Met een <strong>JOIN</strong> combineer je die tabellen in één query.<br><br>Stel je voor: een bestellingtabel heeft een klant_id maar niet de naam van de klant. Die naam staat in de klanttabel. Met JOIN combineer je die twee: je zegt aan SQL "haal de rij op in klanttabel waarvan het klant_id overeenkomt met het klant_id in de bestellingtabel".<br><br>💡 <strong>Terminologie:</strong> Primary Key (PK) = het unieke ID van een rij in een tabel. Foreign Key (FK) = een kolom die verwijst naar de PK van een andere tabel.',
        concept: { title: 'Primaire en vreemde sleutels', text: 'PK (Primary Key) = uniek ID per rij (bv. klant_id)\nFK (Foreign Key) = verwijzing naar PK van andere tabel\n\nbestelling.klant_id → klant.klant_id\nbestelling.product_id → product.product_id' },
        examples: [
          { label: 'Impliciete JOIN (oud stijl)', code: 'SELECT k.naam, b.datum\nFROM klant k, bestelling b\nWHERE k.klant_id = b.klant_id', result: 'Klantnamen met hun besteldatum' },
          { label: 'INNER JOIN (ANSI standaard)', code: 'SELECT k.naam, b.datum\nFROM klant k\nINNER JOIN bestelling b\n  ON k.klant_id = b.klant_id', result: 'Hetzelfde resultaat, modernere syntax' },
        ],
        exercise: { task: 'Haal klantnaam en besteldatum op via een INNER JOIN.', hint: 'SELECT klant.naam, bestelling.datum FROM klant INNER JOIN bestelling ON klant.klant_id = bestelling.klant_id', check: s => (s.includes('inner join') || s.includes('join')) && s.includes('klant') && s.includes('bestelling') && s.includes('klant_id') },
      },
      {
        title: 'INNER JOIN vs LEFT JOIN',
        tables: ['klant', 'bestelling'],
        intro: '<strong>INNER JOIN</strong> geeft alleen rijen die in beide tabellen een overeenkomst hebben. <strong>LEFT JOIN</strong> geeft alle rijen uit de linker tabel, ook als er geen overeenkomst is in de rechter tabel.<br><br>Denk aan twee cirkels (Venn-diagram): INNER JOIN geeft het <em>snijpunt</em> — alleen wat in beide tabellen matcht. LEFT JOIN geeft de <em>volledige linker cirkel</em> — alle rijen links, met rechts NULL als er geen match is.<br><br>💡 <strong>Wanneer welke?</strong> INNER JOIN voor verplichte relaties (een bestelling heeft altijd een klant). LEFT JOIN als de relatie optioneel is (een klant heeft misschien geen bestelling).',
        concept: { title: 'JOIN-types vergelijken', text: 'INNER JOIN → snijpunt (alleen matches)\nLEFT JOIN  → alle links, rechts NULL bij geen match\nRIGHT JOIN → alle rechts, links NULL bij geen match' },
        examples: [
          { label: 'INNER JOIN: alleen klanten die besteld hebben', code: 'SELECT k.naam, b.datum\nFROM klant k\nINNER JOIN bestelling b\n  ON k.klant_id = b.klant_id', result: 'Klanten zonder bestelling verschijnen NIET' },
          { label: 'LEFT JOIN: alle klanten, ook zonder bestelling', code: 'SELECT k.naam, b.datum\nFROM klant k\nLEFT JOIN bestelling b\n  ON k.klant_id = b.klant_id', result: 'Klanten zonder bestelling krijgen datum = NULL' },
        ],
        exercise: { task: 'Gebruik LEFT JOIN om alle klanten te zien, ook wie nog nooit bestelde.', hint: 'SELECT klant.naam, bestelling.datum FROM klant LEFT JOIN bestelling ON klant.klant_id = bestelling.klant_id', check: s => s.includes('left join') && s.includes('klant') && s.includes('bestelling') },
      },
      {
        title: 'Drie tabellen joinen',
        tables: ['klant', 'bestelling', 'product'],
        intro: 'Je kunt meerdere JOINs <strong>ketenen</strong> om drie of meer tabellen samen te brengen. Elke JOIN koppelt één extra tabel aan het tussenresultaat.<br><br>Je bouwt stap voor stap: eerst combineer je tabel 1 + tabel 2, dan voeg je tabel 3 toe aan dat tussenresultaat. SQL voert dit intern van links naar rechts uit. Vergeet niet aliassen te gebruiken (<code>k</code>, <code>b</code>, <code>p</code>) — dat maakt lange queries veel leesbaarder.<br><br>💡 <strong>Tip:</strong> Schrijf altijd de ON-conditie direct na elke JOIN. Zo zie je meteen welke kolommen de tabellen koppelen.',
        concept: { title: 'Meerdere JOINs ketenen', text: 'FROM tabel1\nINNER JOIN tabel2 ON tabel1.fk = tabel2.pk\nINNER JOIN tabel3 ON tabel2.fk = tabel3.pk\n\nElke JOIN voegt één tabel toe aan het resultaat.' },
        examples: [
          { label: 'Klant + bestelling + product', code: 'SELECT k.naam, p.naam, b.datum\nFROM klant k\nINNER JOIN bestelling b\n  ON k.klant_id = b.klant_id\nINNER JOIN product p\n  ON b.product_id = p.product_id', result: 'Wie heeft welk product op welke datum besteld' },
        ],
        exercise: { task: 'Combineer klant, bestelling en product: toon klantnaam, productnaam en datum.', hint: 'FROM klant INNER JOIN bestelling ON ... INNER JOIN product ON ...', check: s => (s.match(/join/g)||[]).length >= 2 && s.includes('klant') && s.includes('product') && s.includes('bestelling') },
      },
    ],
  },
  {
    id: 'advanced', icon: '🧬', title: 'Gevorderde technieken', level: 'advanced',
    lessons: [
      {
        title: 'DISTINCT en aliassen (AS)',
        tables: ['klant', 'product'],
        intro: '<strong>DISTINCT</strong> verwijdert duplicaten uit je resultaat. <strong>AS</strong> geeft een kolom of tabel een andere naam — handig voor leesbaarheid.<br><br>Zonder DISTINCT kan een kolom dezelfde waarde meerdere keren tonen (bv. "Gent" voor elke klant uit Gent). Met DISTINCT krijg je elke waarde maar één keer. AS (alias) hernoem je een kolom in het resultaat — ideaal als de echte kolomnaam technisch of onduidelijk is.<br><br>💡 <strong>Tip:</strong> Tabelaliassen (bv. <code>FROM klant AS k</code>) laten je schrijven <code>k.naam</code> i.p.v. <code>klant.naam</code>. Bij JOINs bijna onmisbaar.',
        concept: { title: 'DISTINCT en AS', text: 'SELECT DISTINCT kolom → unieke waarden\nSELECT kolom AS "Nieuwe Naam" → kolomalias\nFROM tabel AS t → tabelindexalias (afkorting)' },
        examples: [
          { label: 'Unieke steden', code: 'SELECT DISTINCT stad\nFROM klant', result: 'Elke stad slechts één keer in de lijst' },
          { label: 'Leesbare kolomnamen', code: 'SELECT naam AS product,\n       prijs AS verkoopprijs\nFROM product\nORDER BY verkoopprijs DESC', result: 'Kolommen heten nu "product" en "verkoopprijs"' },
        ],
        exercise: { task: "Toon unieke categorieën uit de product-tabel.", hint: 'SELECT DISTINCT categorie FROM product', check: s => s.includes('distinct') && s.includes('categorie') && s.includes('product') },
      },
      {
        title: 'Subqueries',
        tables: ['product', 'klant', 'bestelling'],
        intro: 'Een <strong>subquery</strong> is een query binnen een query — tussen haakjes. De binnenste query wordt eerst uitgevoerd, het resultaat wordt gebruikt in de buitenste query.<br><br>Je kan een subquery gebruiken in WHERE (<code>WHERE prijs &gt; (SELECT AVG...)</code>), in FROM als tijdelijke tabel, of in SELECT als berekende waarde. De database voert altijd <em>de binnenste query eerst</em> uit, dan pas de buitenste.<br><br>💡 <strong>Wanneer subquery vs JOIN?</strong> Een subquery is eenvoudiger te lezen bij eenvoudige vergelijkingen. Voor grote datasets zijn JOINs doorgaans sneller. Beide zijn correct.',
        concept: { title: 'Subquery in WHERE', text: 'SELECT naam FROM product\nWHERE prijs > (\n  SELECT AVG(prijs) FROM product\n);\n\nDe subquery berekent eerst het gemiddelde. Daarna filtert de buitenste query.' },
        examples: [
          { label: 'Producten boven gemiddelde prijs', code: 'SELECT naam, prijs\nFROM product\nWHERE prijs > (\n  SELECT AVG(prijs) FROM product\n)', result: 'Enkel producten die duurder zijn dan het gemiddelde' },
          { label: 'Klanten die ooit besteld hebben', code: 'SELECT naam\nFROM klant\nWHERE klant_id IN (\n  SELECT klant_id FROM bestelling\n)', result: 'Klanten die minstens één bestelling hebben' },
        ],
        exercise: { task: 'Geef alle producten waarvan de stock hoger is dan de gemiddelde stock.', hint: 'WHERE stock > (SELECT AVG(stock) FROM product)', check: s => s.includes('(select') && s.includes('avg') && s.includes('stock') },
      },
      {
        title: 'CREATE TABLE & ALTER TABLE',
        tables: ['klant', 'product'],
        intro: '<strong>CREATE TABLE</strong> maakt een nieuwe tabel aan. <strong>ALTER TABLE</strong> voegt een kolom toe aan een bestaande tabel. Dit zijn DDL-commando\'s (Data Definition Language).',
        concept: { title: 'DDL — Database structuur aanpassen', text: 'CREATE TABLE naam (\n  id INT PRIMARY KEY AUTO_INCREMENT,\n  kolom VARCHAR(100) NOT NULL\n);\n\nALTER TABLE naam\nADD COLUMN extra VARCHAR(50);' },
        examples: [
          { label: 'Nieuwe tabel aanmaken', code: 'CREATE TABLE leverancier (\n  leverancier_id INT PRIMARY KEY AUTO_INCREMENT,\n  naam VARCHAR(100) NOT NULL,\n  land VARCHAR(80)\n)', result: 'Een nieuwe tabel "leverancier" wordt aangemaakt' },
          { label: 'Kolom toevoegen', code: 'ALTER TABLE klant\nADD COLUMN telefoon VARCHAR(20)', result: 'Alle klanten krijgen een telefoon-veld (NULL)' },
        ],
        exercise: { task: 'Maak een tabel "categorie" aan met categorie_id (PK, AUTO_INCREMENT) en naam (VARCHAR(80), NOT NULL).', hint: 'CREATE TABLE categorie (categorie_id INT PRIMARY KEY AUTO_INCREMENT, naam VARCHAR(80) NOT NULL)', check: s => s.includes('create table') && s.includes('categorie') && s.includes('primary key') },
      },
    ],
  },
  {
    id: 'null_case', icon: '❓', title: 'NULL-waarden & CASE WHEN', level: 'medium',
    lessons: [
      {
        title: 'NULL — de afwezigheid van data',
        tables: ['klant', 'product'],
        intro: '<strong>NULL</strong> is geen nul, geen lege string — het is de <em>afwezigheid van een waarde</em>. NULL vergelijken met <code>= NULL</code> werkt nooit. Je moet altijd <strong>IS NULL</strong> of <strong>IS NOT NULL</strong> gebruiken.<br><br>Dit is één van de meest verwarrende onderdelen van SQL. De reden: NULL is onbekend, en onbekend = onbekend is... ook onbekend (niet true). Daarom heeft SQL speciale operatoren nodig: <code>IS NULL</code> en <code>IS NOT NULL</code>.<br><br>💡 <strong>Praktisch:</strong> NULL kan in elke kolom voorkomen tenzij de kolom NOT NULL is gedefinieerd. Controleer altijd of je data NULL-waarden kan bevatten voordat je filtert of berekent.',
        concept: { title: 'NULL correct gebruiken', text: 'WHERE kolom IS NULL        -- heeft geen waarde\nWHERE kolom IS NOT NULL   -- heeft wél een waarde\n\nLet op: WHERE kolom = NULL geeft altijd GEEN resultaten!' },
        examples: [
          { label: 'Klanten zonder stad', code: 'SELECT naam\nFROM klant\nWHERE stad IS NULL', result: 'Enkel klanten waarbij stad niet ingevuld is' },
          { label: 'Producten met stock ingevuld', code: 'SELECT naam, stock\nFROM product\nWHERE stock IS NOT NULL', result: 'Alle producten met een ingevuld stockgetal' },
        ],
        exercise: { task: 'Zoek klanten waarbij het emailadres IS NULL.', hint: 'SELECT naam FROM klant WHERE email IS NULL', check: s => s.includes('klant') && s.includes('is null') && s.includes('email') },
      },
      {
        title: 'CASE WHEN — conditionele waarden',
        tables: ['product', 'klant'],
        intro: '<strong>CASE WHEN</strong> werkt als een if/else binnen SQL. Je kan er een nieuwe kolom mee berekenen op basis van een conditie — ideaal voor labels, categorieën of tekstuele weergaven.<br><br>CASE WHEN controleert condities van boven naar beneden en stopt bij de eerste die klopt. Als geen enkele conditie klopt, geeft ELSE de standaardwaarde — zonder ELSE geeft SQL NULL terug. Je kan CASE WHEN gebruiken in SELECT, ORDER BY en zelfs in GROUP BY.<br><br>💡 <strong>Gebruik:</strong> Perfect om cijfers om te zetten naar leesbare tekst (0 → "Inactief"), of om data te categoriseren voor rapporten.',
        concept: { title: 'CASE WHEN structuur', text: "CASE\n  WHEN conditie1 THEN waarde1\n  WHEN conditie2 THEN waarde2\n  ELSE standaardwaarde\nEND AS kolomnaam" },
        examples: [
          { label: 'Stockstatus tonen', code: "SELECT naam,\n  CASE\n    WHEN stock = 0 THEN 'Uitverkocht'\n    WHEN stock < 5 THEN 'Bijna op'\n    ELSE 'Op voorraad'\n  END AS status\nFROM product", result: 'Elke product krijgt een leesbare statuslabel' },
          { label: 'Klant actief/inactief label', code: "SELECT naam,\n  CASE WHEN actief = 1 THEN 'Actief' ELSE 'Inactief' END AS status\nFROM klant", result: 'Toont een leesbaar label i.p.v. 0 of 1' },
        ],
        exercise: { task: "Schrijf een SELECT op product die naast naam en prijs een kolom 'prijsklasse' toont: 'Goedkoop' als prijs < 20, 'Gemiddeld' als prijs < 100, anders 'Duur'.", hint: "SELECT naam, prijs, CASE WHEN prijs < 20 THEN 'Goedkoop' WHEN prijs < 100 THEN 'Gemiddeld' ELSE 'Duur' END AS prijsklasse FROM product", check: s => s.includes('case') && s.includes('when') && s.includes('product') && s.includes('prijs') },
      },
    ],
  },
  {
    id: 'filters_advanced', icon: '🔎', title: 'Geavanceerde filters', level: 'medium',
    lessons: [
      {
        title: 'LIKE — Zoeken op patroon',
        tables: ['klant', 'product'],
        intro: '<strong>LIKE</strong> laat je zoeken op een tekstpatroon. Gebruik <code>%</code> als wildcard voor nul of meer tekens, en <code>_</code> voor precies één teken. Perfect voor zoekvelden en e-mailfilters.<br><br><code>%</code> staat voor nul of meer willekeurige tekens: <code>LIKE \'%Jan%\'</code> vindt "Jan", "Januari", "DeJan", enz. <code>_</code> staat voor precies één teken: <code>LIKE \'_at\'</code> vindt "bat", "cat", "hat" maar niet "brat".<br><br>💡 <strong>Tip:</strong> LIKE is in MySQL niet hoofdlettergevoelig. Wil je exact matchen, gebruik dan <code>= \'waarde\'</code> in plaats van LIKE — dat is ook sneller.',
        concept: { title: 'LIKE wildcards', text: "WHERE naam LIKE '%Jan%'   -- bevat 'Jan'\nWHERE email LIKE '%@gmail%' -- Gmail-adressen\nWHERE naam LIKE 'A%'      -- begint met A\nWHERE naam LIKE '_an%'    -- tweede letter = a, n, ...\n\n💡 LIKE is case-insensitief in MySQL." },
        examples: [
          { label: 'Klanten met naam die begint met J', code: "SELECT naam, email\nFROM klant\nWHERE naam LIKE 'J%'", result: 'Jana Pieters, Jonas De Smedt, ...' },
          { label: 'Gmail-adressen vinden', code: "SELECT naam, email\nFROM klant\nWHERE email LIKE '%@gmail%'", result: 'Alle klanten met een gmail-adres' },
        ],
        exercise: { task: "Zoek alle producten waarvan de naam het woord 'USB' bevat.", hint: "SELECT naam FROM product WHERE naam LIKE '%USB%'", check: s => s.includes('like') && s.includes('usb') && s.includes('product') },
      },
      {
        title: 'BETWEEN — Bereikfilter',
        tables: ['product', 'bestelling'],
        intro: '<strong>BETWEEN a AND b</strong> filtert rijen waarvan een waarde binnen een bereik valt — inclusief de grenzen zelf. Handig voor prijsranges, datums en stockniveaus.<br><br>BETWEEN is een kortere notatie voor <code>WHERE prijs &gt;= 10 AND prijs &lt;= 50</code>. Let op: BETWEEN is <em>inclusief</em> — zowel de onder- als bovengrens worden meegenomen.<br><br>💡 <strong>Tip voor datums:</strong> Gebruik de ISO-notatie <code>\'YYYY-MM-DD\'</code>: <code>WHERE datum BETWEEN \'2024-01-01\' AND \'2024-12-31\'</code>. Gebruik NOT BETWEEN om rijen buiten een bereik te vinden.',
        concept: { title: 'BETWEEN — inclusief bereik', text: 'WHERE prijs BETWEEN 10 AND 50\n-- is gelijk aan: WHERE prijs >= 10 AND prijs <= 50\n\nWerkt ook voor tekst (alfabetisch) en datums:\nWHERE datum BETWEEN \'2024-01-01\' AND \'2024-12-31\'' },
        examples: [
          { label: 'Producten tussen €20 en €80', code: 'SELECT naam, prijs\nFROM product\nWHERE prijs BETWEEN 20 AND 80', result: 'Producten in het middensegment' },
          { label: 'Bestellingen in een periode', code: "SELECT *\nFROM bestelling\nWHERE datum BETWEEN '2024-11-01' AND '2024-12-31'", result: 'Bestellingen in de laatste twee maanden van 2024' },
        ],
        exercise: { task: 'Geef alle producten met een prijs tussen €10 en €50 (inclusief).', hint: 'SELECT naam, prijs FROM product WHERE prijs BETWEEN 10 AND 50', check: s => s.includes('between') && s.includes('product') && s.includes('prijs') },
      },
      {
        title: 'IS NULL — Ontbrekende data vinden',
        tables: ['klant', 'bestelling'],
        intro: 'Wanneer een cel geen waarde heeft, is die <strong>NULL</strong>. Je kan NOOIT vergelijken met <code>= NULL</code> — gebruik altijd <strong>IS NULL</strong> of <strong>IS NOT NULL</strong>. Dit is een van de meest gemaakte fouten in SQL!',
        concept: { title: 'NULL correct gebruiken', text: "WHERE kolom IS NULL        -- ontbreekt\nWHERE kolom IS NOT NULL   -- is ingevuld\n\n❌ WHERE kolom = NULL  -- werkt NOOIT!\n✅ WHERE kolom IS NULL  -- correct\n\nAnti-join patroon: LEFT JOIN + IS NULL\n→ vind records die in de andere tabel NIET voorkomen" },
        examples: [
          { label: 'Klanten zonder stad', code: 'SELECT naam\nFROM klant\nWHERE stad IS NULL', result: 'Klanten waarbij de stad niet ingevuld is' },
          { label: 'Anti-join: klanten die nooit bestelden', code: 'SELECT klant.naam\nFROM klant\nLEFT JOIN bestelling\n  ON klant.klant_id = bestelling.klant_id\nWHERE bestelling.klant_id IS NULL', result: 'Klanten zonder één bestelling — via LEFT JOIN + IS NULL' },
        ],
        exercise: { task: 'Vind alle klanten die nog nooit besteld hebben via LEFT JOIN + IS NULL.', hint: 'SELECT klant.naam FROM klant LEFT JOIN bestelling ON klant.klant_id = bestelling.klant_id WHERE bestelling.klant_id IS NULL', check: s => s.includes('left join') && s.includes('is null') && s.includes('klant') },
      },
      {
        title: 'NOT IN — Uitsluiten via een lijst',
        tables: ['klant', 'product', 'review'],
        intro: '<strong>NOT IN</strong> sluit rijen uit waarvan de waarde in een bepaalde lijst of subquery staat. Het is het omgekeerde van IN — ideaal om "alles behalve X" te selecteren.<br><br>Met <code>IN (\'Gent\', \'Brussel\')</code> filter je op specifieke waarden. <code>NOT IN</code> doet het tegenovergestelde. Je kan ook een subquery gebruiken: <code>NOT IN (SELECT klant_id FROM bestelling)</code> geeft alle klanten die nooit besteld hebben.<br><br>⚠️ <strong>Let op:</strong> Als de lijst of subquery een NULL-waarde bevat, geeft NOT IN nooit resultaten terug! Combineer dan met <code>IS NOT NULL</code> in de subquery.',
        concept: { title: 'IN vs NOT IN', text: "WHERE stad IN ('Gent','Brussel')      -- alleen deze steden\nWHERE stad NOT IN ('Gent','Brussel')  -- alles behalve deze\n\nMet subquery:\nWHERE klant_id NOT IN (SELECT klant_id FROM bestelling)\n→ klanten die nooit besteld hebben" },
        examples: [
          { label: 'Klanten niet uit Gent of Brussel', code: "SELECT naam, stad\nFROM klant\nWHERE stad NOT IN ('Gent', 'Brussel')", result: 'Alle klanten buiten Gent en Brussel' },
          { label: 'Producten zonder review', code: 'SELECT naam\nFROM product\nWHERE product_id NOT IN (\n  SELECT product_id FROM review\n)', result: 'Producten die nog nooit beoordeeld werden' },
        ],
        exercise: { task: "Toon producten die NIET in de categorie 'Elektronica' zitten via NOT IN.", hint: "SELECT naam, categorie FROM product WHERE categorie NOT IN ('Elektronica')", check: s => s.includes('not in') && s.includes('product') && s.includes('elektronica') },
      },
    ],
  },
];

const TUT = {
  _lessonKey(modId, lesIdx) { return `${modId}:${lesIdx}`; },
  isLessonDone(modId, lesIdx) {
    return G.tutDone.has(this._lessonKey(modId, lesIdx));
  },
  markLesson(modId, lesIdx) {
    G.tutDone.add(this._lessonKey(modId, lesIdx));
    save();
    this.updateSidebarBadge();
    if (UI && UI.renderDash) UI.renderDash();
    // Tutorial complete achievement
    if (this.totalDone() === this.totalLessons()) UI.unlockAch('tut_complete');
  },
  totalDone() {
    return TUT_MODULES.reduce((n, m) => n + m.lessons.filter((_, i) => this.isLessonDone(m.id, i)).length, 0);
  },
  totalLessons() {
    return TUT_MODULES.reduce((n, m) => n + m.lessons.length, 0);
  },
  updateSidebarBadge() {
    const done  = this.totalDone();
    const total = this.totalLessons();
    const pct   = total ? Math.round(done / total * 100) : 0;
    const badge = document.getElementById('tut-nav-pct');
    if (badge) {
      badge.textContent = pct + '%';
      badge.style.display = done > 0 ? '' : 'none';
    }
  },

  // State
  _activeMod: null,
  _activeLes: 0,

  render() {
    const el = $('tut-content');
    if (!el) return;
    if (this._activeMod) {
      this._renderLesson(el);
    } else {
      this._renderOverview(el);
    }
  },

  _renderOverview(el) {
    const done = this.totalDone();
    const total = this.totalLessons();
    const pct = total ? Math.round(done / total * 100) : 0;
    const levelLabel = { beginner: 'Beginner', medium: 'Gemiddeld', advanced: 'Gevorderd' };
    const levelClass = { beginner: 'tut-badge-beginner', medium: 'tut-badge-medium', advanced: 'tut-badge-advanced' };

    el.innerHTML = `
      <div class="tut-overview-wrap">
      <div class="tut-progress-bar">
        <div class="tut-progress-label">${done} / ${total} lessen</div>
        <div class="tut-progress-track"><div class="tut-progress-fill" style="width:${pct}%"></div></div>
        <div class="tut-progress-pct">${pct}%</div>
      </div>
      <div class="tut-module-grid">
        ${TUT_MODULES.map(m => {
          const modDone = m.lessons.filter((_, i) => this.isLessonDone(m.id, i)).length;
          const modPct = Math.round(modDone / m.lessons.length * 100);
          const completed = modDone === m.lessons.length;
          return `<div class="tut-module ${completed ? 'completed' : ''}" data-level="${m.level}" onclick="TUT.openModule('${m.id}')">
            <div class="tut-module-head">
              <div class="tut-module-icon">${m.icon}</div>
              <div class="tut-module-meta">
                <div class="tut-module-title">${esc(m.title)}</div>
                <div class="tut-module-sub">${modDone}/${m.lessons.length} lessen voltooid</div>
              </div>
              <span class="tut-module-badge ${levelClass[m.level]}">${levelLabel[m.level]}</span>
            </div>
            <div class="tut-module-progress">
              <div class="tut-module-prog-fill" style="width:${modPct}%"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="tut-nav-empty">
        Klik op een module om de lessen te starten · Voortgang wordt lokaal opgeslagen
      </div>
      </div>`;
  },

  openModule(modId) {
    this._activeMod = modId;
    this._activeLes = 0;
    // Open at first unfinished lesson
    const m = TUT_MODULES.find(x => x.id === modId);
    if (m) {
      const firstUnfinished = m.lessons.findIndex((_, i) => !this.isLessonDone(modId, i));
      if (firstUnfinished >= 0) this._activeLes = firstUnfinished;
    }
    this.render();
  },

  _renderLesson(el) {
    const m = TUT_MODULES.find(x => x.id === this._activeMod);
    if (!m) { this._activeMod = null; this.render(); return; }
    const les = m.lessons[this._activeLes];
    if (!les) return;
    const isDone = this.isLessonDone(m.id, this._activeLes);
    const isLast = this._activeLes === m.lessons.length - 1;

    // Build table viewer HTML
    const tableNames = les.tables || ['klant', 'product'];
    const tableViewerHtml = tableNames.map(tName => {
      const tbl = DB[tName];
      if (!tbl) return '';
      const label = { klant: 'klant', product: 'product', bestelling: 'bestelling', review: 'review', kortingscode: 'kortingscode' }[tName] || tName;
      const colHtml = tbl.cols.map(c => {
        const cls = c.pk ? 'pk-col' : c.fk ? 'fk-col' : '';
        const badge = c.pk ? ' 🔑' : c.fk ? ' 🔗' : '';
        return `<th class="${cls}">${c.n}${badge}</th>`;
      }).join('');
      const rowsHtml = tbl.rows.map(r => {
        const cells = tbl.cols.map(c => {
          const v = r[c.n];
          if (v === null || v === undefined) return `<td class="null-val">NULL</td>`;
          if (c.t === 'BOOLEAN' || (tName === 'klant' && c.n === 'actief') || (tName === 'kortingscode' && c.n === 'actief')) {
            return `<td class="${v ? 'bool-val-1' : 'bool-val-0'}">${v ? '1 ✓' : '0 ✗'}</td>`;
          }
          if (c.pk || c.fk || c.t === 'INT' || c.t.startsWith('DECIMAL')) {
            return `<td class="num-val">${v}</td>`;
          }
          return `<td>${esc(String(v))}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `
        <div class="tut-table-card">
          <div class="tut-table-card-head">📋 ${label} <span>${tbl.rows.length} rijen · ${tbl.cols.length} kolommen</span></div>
          <div class="tut-table-scroll">
            <table class="tut-tbl">
              <thead><tr>${colHtml}</tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          <div class="tut-schema-legend">
            <span class="leg-pk"><b>🔑</b> Primary Key</span>
            <span class="leg-fk"><b>🔗</b> Foreign Key</span>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="tut-layout">
        <div class="tut-lesson-col">
          <div class="tut-lesson-wrap">
            <div class="tut-lesson-header">
              <button class="tut-lesson-back" onclick="TUT._back()">← Overzicht</button>
              <div class="tut-lesson-title">${esc(m.icon)} ${esc(les.title)}</div>
              <div class="tut-lesson-counter">${this._activeLes + 1} / ${m.lessons.length}</div>
            </div>
            <div class="tut-lesson-body">
              <!-- Voortgangsbolletjes -->
              <div class="tut-step-dots">
                ${m.lessons.map((l, i) => {
                  const done = this.isLessonDone(m.id, i);
                  const active = i === this._activeLes;
                  return `<div class="tut-step-dot ${done ? 'done' : ''} ${active ? 'active' : ''}" onclick="TUT._goLesson(${i})" title="${esc(l.title)}"></div>`;
                }).join('')}
              </div>

              <!-- Intro -->
              <div class="tut-lesson-intro">${les.intro}</div>

              <!-- Concept box -->
              ${les.concept ? `
              <div class="tut-concept-box">
                <h4>${esc(les.concept.title)}</h4>
                <p><code class="tut-concept-code">${esc(les.concept.text)}</code></p>
              </div>` : ''}

              <!-- Waarschuwing -->
              ${les.warn ? `<div class="tut-warn-box">${les.warn}</div>` : ''}

              <!-- Voorbeelden -->
              ${les.examples && les.examples.length ? `
              <div class="tut-example-title">📌 Voorbeelden</div>
              <div class="tut-example-grid">
                ${les.examples.map(ex => `
                  <div class="tut-example-card">
                    <div class="tut-example-card-head">${esc(ex.label)}</div>
                    <code>${esc(ex.code)}</code>
                    <div class="tut-ex-result">→ ${esc(ex.result)}</div>
                  </div>`).join('')}
              </div>` : ''}

              <!-- Oefening -->
              ${les.exercise ? `
              <div class="tut-exercise">
                <div class="tut-exercise-label">✏️ Oefening</div>
                <div class="tut-exercise-task">${les.exercise.task}</div>
                <div class="tut-exercise-hint-wrap">
                  <button class="btn btn-outline btn-sm tut-hint-toggle" onclick="var h=this.nextElementSibling;h.classList.toggle('hidden');this.textContent=h.classList.contains('hidden')?'💡 Toon hint':'🙈 Hint verbergen'">💡 Toon hint</button>
                  <div class="tut-exercise-hint hidden">💡 Hint: <code class="tut-exercise-hint-code">${esc(les.exercise.hint)}</code></div>
                </div>
                <div class="hl-wrap">
                  <div class="hl-backdrop" id="hl-tut-ex" aria-hidden="true"></div>
                  <textarea class="sql-editor tut-ex-textarea" id="tut-ex-sql" placeholder="-- Schrijf hier je SQL..."
                    ${isDone ? ' disabled' : ''}></textarea>
                </div>
                <div class="tut-exercise-action-row">
                  ${!isDone ? `<button class="btn btn-primary btn-sm" onclick="TUT._runExercise()">▶ Controleren</button>` : ''}
                  ${isDone ? `<span class="tut-exercise-done-label">✅ Voltooid</span><button class="btn btn-outline btn-sm" onclick="TUT._retryExercise()" title="Oefen opnieuw dezelfde les">🔄 Opnieuw oefenen</button>` : ''}
                  ${this._activeLes > 0 ? `<button class="btn btn-outline btn-sm" onclick="TUT._goLesson(${this._activeLes - 1})">← Vorige les</button>` : ''}
                  <button class="btn btn-outline btn-sm btn-tut-next" data-action="tut-next">
                    ${isLast ? '🏁 Module voltooien' : 'Volgende les →'}
                  </button>
                </div>
                <div class="feedback tut-ex-fb" id="tut-ex-fb"></div>
              </div>` : `
              <div class="tut-nav-row">
                ${this._activeLes > 0 ? `<button class="btn btn-outline btn-sm" onclick="TUT._goLesson(${this._activeLes - 1})">← Vorige les</button>` : '<span></span>'}
                <button class="btn btn-primary btn-sm" data-action="tut-next">
                  ${isLast ? '🏁 Module voltooien' : 'Volgende les →'}
                </button>
              </div>`}
            </div>
          </div>
        </div>
        <div class="tut-table-col">
          <div class="tut-tables-label">🗄️ Tabellen in deze les</div>
          <div class="tut-table-viewer">
            ${tableViewerHtml}
          </div>
        </div>
      </div>`;

    // Syntax highlighter
    setTimeout(() => {
      const ta = EL['tut-ex-sql'];
      if (ta) initHighlighter(ta);
    }, 60);
  },

  _back() {
    this._activeMod = null;
    this.render();
  },

  _retryExercise() {
    // Undo the done-mark for current lesson to allow re-practice
    const m = TUT_MODULES.find(x => x.id === this._activeMod);
    if (!m) return;
    // Re-render to enable the textarea again (don't remove from tutDone to keep progress)
    const ta = EL['tut-ex-sql'];
    if (ta) {
      ta.disabled = false;
      ta.value = '';
      const fb = $('tut-ex-fb');
      if (fb) { fb.className = 'feedback'; fb.textContent = ''; }
      // Re-enable check button by re-rendering, but mark as not done temporarily
      const key = this._lessonKey(m.id, this._activeLes);
      G.tutDone.delete(key);
      this.render();
    }
  },

  _goLesson(i) {
    this._activeLes = i;
    this.render();
  },

  _next() {
    const m = TUT_MODULES.find(x => x.id === this._activeMod);
    if (!m) return;
    const les = m.lessons[this._activeLes];
    // If lesson has an exercise and it's not done, require completion first
    if (les && les.exercise && !this.isLessonDone(m.id, this._activeLes)) {
      const fb = $('tut-ex-fb');
      if (fb) {
        fb.className = 'feedback hint visible';
        fb.textContent = '✏️ Voltooi eerst de oefening voordat je verdergaat!';
        fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }
    if (this._activeLes < m.lessons.length - 1) {
      this._activeLes++;
      this.render();
    } else {
      // Module voltooid
      this._activeMod = null;
      this.render();
      UI.addEvent('ok', `🎓 Tutorial module "<strong>${esc(m.title)}</strong>" voltooid!`);
      // XP bonus
      const bonus = 30;
      G.xp += bonus;
      UI.xpPop('+' + bonus + ' XP 🎓');
      UI.updateXP();
      save();
    }
  },

  _runExercise() {
    const m = TUT_MODULES.find(x => x.id === this._activeMod);
    if (!m) return;
    const les = m.lessons[this._activeLes];
    const sql = (EL['tut-ex-sql'] || {}).value?.trim() || '';
    const fb = $('tut-ex-fb');
    if (!sql) { fb.className = 'feedback err visible'; fb.textContent = 'Schrijf eerst een SQL-statement.'; return; }
    const s = sql.toLowerCase();
    if (les.exercise.check(s)) {
      // Try to actually run the SQL for visual feedback
      let resultHtml = '';
      try {
        const res = runSQL(sql);
        if (res.ok && res.type === 'select' && res.rows && res.rows.length) {
          const cols = Object.keys(res.rows[0]);
          resultHtml = `<div class="tut-result-wrap"><table class="data-table tut-result-table">
            <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${res.rows.slice(0, 5).map(r => `<tr>${cols.map(c => `<td>${r[c] == null ? '<span class="u-muted">NULL</span>' : esc(String(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>${res.rows.length > 5 ? `<div class="tut-result-more">... en ${res.rows.length - 5} rijen meer</div>` : ''}</div>`;
        }
      } catch(e) {}
      fb.className = 'feedback ok visible';
      fb.innerHTML = '✅ <strong>Correct!</strong> Oefening voltooid.' + resultHtml;
      this.markLesson(m.id, this._activeLes);
      // Disable textarea
      const ta = EL['tut-ex-sql'];
      if (ta) ta.disabled = true;
      // Swap button to "Volgende"
      const btn = fb.previousElementSibling?.querySelector('button[onclick*="_runExercise"]');
      if (btn) {
        btn.textContent = '✅ Voltooid';
        btn.disabled = true;
        btn.style.opacity = '0.5';
      }
    } else {
      fb.className = 'feedback err visible';
      // Intelligente foutanalyse
      const errTips = tutErrorAnalysis(sql, les);
      fb.innerHTML = '❌ Niet helemaal juist.' + errTips;
    }
  },
};


// ── TUTORIAL FOUT ANALYSE ─────────────────────────────────────────
function tutErrorAnalysis(sql, les) {
  const s = sql.trim().toLowerCase();
  if (!s) return '';
  const tips = [];

  // Detecteer veelvoorkomende SQL-fouten
  if (!s.startsWith('select') && !s.startsWith('insert') && !s.startsWith('update') && !s.startsWith('delete') && !s.startsWith('create') && !s.startsWith('alter')) {
    tips.push({ kw: 'Structuur', msg: 'Begin je SQL met een commando zoals SELECT, INSERT, UPDATE of DELETE.' });
  }
  if (s.includes('select') && !s.includes('from')) {
    tips.push({ kw: 'FROM', msg: 'Na SELECT mis je FROM. Vergeet niet aan te geven uit welke tabel je haalt.' });
  }
  if ((s.includes('update') || s.includes('delete')) && !s.includes('where')) {
    tips.push({ kw: 'WHERE', msg: 'UPDATE en DELETE zonder WHERE raken ALLE rijen. Voeg een WHERE-conditie toe!' });
  }
  if (s.includes('group by') && !s.includes('count') && !s.includes('sum') && !s.includes('avg') && !s.includes('max') && !s.includes('min')) {
    tips.push({ kw: 'GROUP BY', msg: 'GROUP BY wordt normaal gebruikt samen met een aggregatiefunctie zoals COUNT(*), SUM() of AVG().' });
  }
  if (s.includes('having') && !s.includes('group by')) {
    tips.push({ kw: 'HAVING', msg: 'HAVING werkt alleen samen met GROUP BY. Voeg GROUP BY toe vóór HAVING.' });
  }
  if (s.includes('order') && !s.includes('order by')) {
    tips.push({ kw: 'ORDER BY', msg: 'Bedoel je ORDER BY? Schrijf het als twee woorden: ORDER BY kolom.' });
  }
  // Tabel-tip op basis van exercise
  const taskLower = les.exercise.task.toLowerCase();
  const tables = ['klant','product','bestelling','review','kortingscode','leverancier'];
  const expectedTable = tables.find(t => taskLower.includes(t));
  if (expectedTable && !s.includes(expectedTable)) {
    tips.push({ kw: 'Tabel', msg: `De opdracht verwijst naar de tabel <strong>${expectedTable}</strong>. Staat die in jouw query?` });
  }

  if (!tips.length) {
    return '<br><small class="u-muted">Tip: controleer de hint hierboven voor de juiste structuur.</small>';
  }

  return `<div class="sql-error-explain">
    <div class="sql-error-explain-title">💡 Wat kan beter?</div>
    ${tips.map(t => `<div class="sql-error-explain-part">
      <span class="sql-error-kw">${esc(t.kw)}</span>
      <span>${t.msg}</span>
    </div>`).join('')}
  </div>`;
}

// ── SETTINGS ──────────────────────────────────────────────────────

// ── THEME ─────────────────────────────────────────────────────────
const THEME = {
  init() {
    const saved = (() => { try { return localStorage.getItem('datashop_theme'); } catch(e) { return null; } })();
    this.apply(saved === 'light' ? 'light' : 'dark');
  },
  toggle() {
    this.apply(document.body.classList.contains('light') ? 'dark' : 'light');
  },
  set(mode) {
    this.apply(mode);
  },
  apply(mode) {
    document.body.classList.toggle('light', mode === 'light');
    try { localStorage.setItem('datashop_theme', mode); } catch(e) {}
    // Update sidebar toggle
    const label = $('theme-label');
    const indicator = $('theme-indicator');
    if (label) label.textContent = mode === 'light' ? 'Light mode' : 'Light mode';
    if (indicator) indicator.textContent = mode === 'light' ? 'ON' : 'OFF';
    // Update settings buttons
    const btnDark  = $('theme-btn-dark');
    const btnLight = $('theme-btn-light');
    if (btnDark)  btnDark.style.borderColor  = mode === 'dark'  ? 'var(--cyan)' : 'var(--border2)';
    if (btnLight) btnLight.style.borderColor = mode === 'light' ? 'var(--cyan)' : 'var(--border2)';
    // Update boot screen buttons
    const bootDark  = $('boot-btn-dark');
    const bootLight = $('boot-btn-light');
    if (bootDark)  bootDark.classList.toggle('active',  mode === 'dark');
    if (bootLight) bootLight.classList.toggle('active', mode === 'light');
  }
};

const SET = {
  render() {
    const el = $('set-content');
    if (!el) return;
    const rank = RANKS.slice().reverse().find(r => G.xp >= r.min) || RANKS[0];
    el.innerHTML = `
    <div class="set-section">
      <h3>📊 Voortgang samenvatting</h3>
      <div class="set-progress-grid">
        <div class="comp-stat"><div class="comp-val">${G.xp}</div><div class="comp-label">XP totaal</div></div>
        <div class="comp-stat"><div class="comp-val">${G.done.size}</div><div class="comp-label">Missies voltooid</div></div>
        <div class="comp-stat"><div class="comp-val">${G.ach.size}</div><div class="comp-label">Badges</div></div>
        <div class="comp-stat"><div class="comp-val">${TUT.totalDone()}/${TUT.totalLessons()}</div><div class="comp-label">Tutoriallessen</div></div>
        <div class="comp-stat"><div class="comp-val">${G.streak}</div><div class="comp-label">Huidige reeks</div></div>
        <div class="comp-stat"><div class="comp-val ${G.rep>=80?'comp-val--good':G.rep>=50?'comp-val--warn':'comp-val--bad'}">${G.rep}%</div><div class="comp-label">Reputatie</div></div>
      </div>
      <div class="set-mission-progress">
        <div class="u-mono-sub">Missie-voortgang</div>
        <div class="set-mission-track">
          <div class="set-mission-fill" style="width:${Math.round(G.done.size/SCENARIOS.length*100)}%"></div>
        </div>
        <div class="set-mission-label">${G.done.size}/${SCENARIOS.length} missies · ${Math.round(G.done.size/SCENARIOS.length*100)}% voltooid</div>
      </div>
    </div>

    <div class="set-section">
      <h3>🎨 Weergave</h3>
      <p class="set-theme-intro">Kies een thema dat prettig leest voor jou.</p>
      <div class="set-theme-row">
        <button data-theme="dark"  id="theme-btn-dark"  class="btn btn-sm btn-theme-option">🌙 Dark mode</button>
        <button data-theme="light" id="theme-btn-light" class="btn btn-sm btn-theme-option btn-theme-option--panel">☀️ Light mode</button>
      </div>
    </div>

    <div class="set-section">
      <h3>👔 Jouw profiel</h3>
      <p>Ingelogd als <strong>${esc(G.name)}</strong> · Rang: <strong>${esc(rank.title)}</strong></p>
      <div class="set-profile-grid">
        ${[
          {i:'⭐',v:G.xp+' XP',l:'Totaal XP'},
          {i:'🎯',v:G.done.size+'/'+SCENARIOS.length,l:'Missies'},
          {i:'🏅',v:G.ach.size+'/'+ACHIEVEMENTS.length,l:'Badges'},
          {i:'📈',v:G.rep+'%',l:'Reputatie'},
          {i:'🔥',v:G.streak,l:'Huidige streak'},
        ].map(s=>`<div class="kpi-tile">
          <div class="kpi-tile-icon">${s.i}</div>
          <div class="kpi-val">${esc(String(s.v))}</div>
          <div class="kpi-label">${esc(s.l)}</div>
        </div>`).join('')}
      </div>
    </div>

    <div class="set-danger-zone">
      <h3>⚠️ Gevaarzone</h3>
      <p>Onderstaande acties zijn onomkeerbaar. Alle voortgang gaat verloren.</p>
      <div class="set-danger-row">
        <button class="btn btn-danger btn-sm" onclick="SET.confirmReset()">🗑️ Voortgang Resetten</button>
        <button class="btn btn-outline btn-sm" onclick="SET.exportData()">📤 Data exporteren (JSON)</button>
      </div>
      <div id="set-reset-confirm">
        <p class="set-reset-warning">⚠️ Ben je zeker? Dit verwijdert alle XP, missies, badges, tutorialvoortgang en reputatie!</p>
        <div class="set-reset-btns">
          <button class="btn btn-danger btn-sm" onclick="SET.doReset()">Ja, alles verwijderen</button>
          <button class="btn btn-outline btn-sm" onclick="SET.cancelReset()">Annuleren</button>
        </div>
      </div>
    </div>`;
  },
  afterRender() {
    const mode = document.body.classList.contains('light') ? 'light' : 'dark';
    THEME.apply(mode);
  },
  confirmReset() { const el=EL['set-reset-confirm']; if(el) el.style.display=''; },
  cancelReset()  { const el=EL['set-reset-confirm']; if(el) el.style.display='none'; },
  doReset() {
    try { localStorage.removeItem('datashop_v3'); } catch(e) {}
    location.reload();
  },
  exportData() {
    const data = {name:G.name,xp:G.xp,rep:G.rep,streak:G.streak,done:[...G.done],ach:[...G.ach],exportDate:new Date().toISOString()};
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `datashop-data-${G.name.replace(/\s+/g,'-')}.json`;
    a.click();
  }
};

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Ctrl+Enter: run query in terminal or active scenario
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const active = document.querySelector('.panel.on');
    if (active?.id === 'panel-term') { e.preventDefault(); APP.runFree(); return; }
    if (UI.openSc) { e.preventDefault(); APP.runSc(UI.openSc); return; }
  }
  const active = document.querySelector('.panel.on');
  if (active?.id === 'panel-term') { return; }
  if (!e.ctrlKey && !e.metaKey && e.key === '?' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
    APP.openKeyHelp();
    return;
  }
  if (e.key === 'Escape') { APP.closeKeyHelp(); return; }
  if (UI.openSc && e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const ta = $('sq-'+UI.openSc);
    if (ta && document.activeElement === ta) { e.preventDefault(); APP.runSc(UI.openSc); }
  }
});

// ── PARTICLES ─────────────────────────────────────────────────────
(function initParticles() {
  const container = $('boot-particles');
  if (!container) return;
  const colors = ['rgba(34,211,238,.4)','rgba(167,139,250,.35)','rgba(244,114,182,.3)','rgba(74,222,128,.3)'];
  for (let i = 0; i < 18; i++) {
    const el = document.createElement('div');
    el.className = 'boot-particle';
    const size = Math.random() * 4 + 2;
    el.style.cssText = `
      width:${size}px;height:${size}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      left:${Math.random()*100}%;
      animation-duration:${8+Math.random()*14}s;
      animation-delay:${-Math.random()*15}s;
      filter:blur(${size*.4}px);
    `;
    container.appendChild(el);
  }
})();

// ── SQL SYNTAX HIGHLIGHTER ───────────────────────────────────────
const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|ADD|COLUMN|DROP|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|DISTINCT|AS|AND|OR|NOT|NULL|IS|IN|BETWEEN|LIKE|JOIN|ON|LEFT|RIGHT|INNER|OUTER|PRIMARY\s+KEY|AUTO_INCREMENT|NOT\s+NULL|UNIQUE|FOREIGN\s+KEY|REFERENCES|IF\s+NOT\s+EXISTS|ASC|DESC|COUNT|AVG|SUM|MAX|MIN|INT|VARCHAR|TEXT|DECIMAL|BOOLEAN|DATE|DATETIME)\b/gi;
const SQL_FUNCTIONS = /\b(COUNT|AVG|SUM|MAX|MIN)\s*(?=\()/gi;
const SQL_TABLES = /\b(klant|product|bestelling|review|kortingscode|leverancier)\b/gi;

function sqlHighlight(code) {
  // Escape HTML first
  let h = code
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');

  // Tokeniseer stap voor stap om overlapping te voorkomen
  // 1. strings
  const strings = [];
  h = h.replace(/'(?:[^'\\]|\\.)*'/g, m => {
    strings.push(`<span class="hl-str">${m}</span>`);
    return `\x00S${strings.length-1}\x00`;
  });
  // 2. comments
  const comments = [];
  h = h.replace(/--[^\n]*/g, m => {
    comments.push(`<span class="hl-cmt">${m}</span>`);
    return `\x00C${comments.length-1}\x00`;
  });
  // 3. functions (before keywords to catch COUNT/AVG/etc)
  h = h.replace(/\b(COUNT|AVG|SUM|MAX|MIN)(?=\s*\()/gi, '<span class="hl-fn">$1</span>');
  // 4. keywords
  h = h.replace(/\b(SELECT|FROM|WHERE|INSERT\s+INTO|INSERT|INTO|VALUES|UPDATE|SET|DELETE\s+FROM|DELETE|CREATE\s+TABLE|CREATE|TABLE|ALTER\s+TABLE|ALTER|ADD\s+COLUMN|ADD|COLUMN|DROP|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|DISTINCT|AS|AND|OR|NOT\s+NULL|NOT|NULL|IS\s+NULL|IS\s+NOT\s+NULL|IS|IN|BETWEEN|LIKE|PRIMARY\s+KEY|AUTO_INCREMENT|UNIQUE|FOREIGN\s+KEY|REFERENCES|IF\s+NOT\s+EXISTS|ASC|DESC|INT|VARCHAR|TEXT|DECIMAL|BOOLEAN|DATE|DATETIME)\b/gi,
    '<span class="hl-kw">$1</span>');
  // 5. table names
  h = h.replace(/\b(klant|product|bestelling|review|kortingscode|leverancier)\b/gi,
    '<span class="hl-tbl">$1</span>');
  // 6. numbers
  h = h.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="hl-num">$1</span>');
  // 7. restore strings and comments
  h = h.replace(/\x00S(\d+)\x00/g, (_,i) => strings[i]);
  h = h.replace(/\x00C(\d+)\x00/g, (_,i) => comments[i]);
  return h;
}

function initHighlighter(ta) {
  if (!ta || ta._hlInit) return;
  ta._hlInit = true;

  // Gebruik de bestaande hl-backdrop div als highlight-laag (al aanwezig in HTML)
  // De textarea zit al in een hl-wrap; maak geen extra sq-wrap aan.
  const wrap = ta.closest('.hl-wrap');
  let hlLayer = wrap ? wrap.querySelector('.hl-backdrop') : null;

  if (!hlLayer) {
    // Fallback: geen hl-wrap gevonden, maak wrapper zelf aan (vrije terminal / edge case)
    const parent = ta.parentNode;
    const newWrap = document.createElement('div');
    newWrap.className = 'sq-wrap';
    hlLayer = document.createElement('div');
    hlLayer.className = 'sql-highlight-layer';
    hlLayer.setAttribute('aria-hidden','true');
    parent.insertBefore(newWrap, ta);
    newWrap.appendChild(hlLayer);
    newWrap.appendChild(ta);
  }

  // Zorg dat de highlight-laag de juiste CSS-klasse heeft
  if (!hlLayer.classList.contains('sql-highlight-layer')) {
    hlLayer.classList.add('sql-highlight-layer');
  }

  // Copy relevant styles from textarea to layer
  const taStyle = getComputedStyle(ta);
  hlLayer.style.padding = taStyle.padding;
  hlLayer.style.fontSize = taStyle.fontSize;
  hlLayer.style.lineHeight = taStyle.lineHeight;
  hlLayer.style.fontFamily = taStyle.fontFamily;
  hlLayer.style.minHeight = taStyle.minHeight || '130px';
  hlLayer.style.height = taStyle.height;

  function sync() {
    const val = ta.value;
    hlLayer.innerHTML = sqlHighlight(val) + '\n'; // trailing newline prevents scroll drift
    // Sync scroll
    hlLayer.scrollTop = ta.scrollTop;
    hlLayer.scrollLeft = ta.scrollLeft;
    // Sync height if auto-expanding
    hlLayer.style.height = ta.offsetHeight + 'px';
  }

  ta.addEventListener('input', sync);
  ta.addEventListener('scroll', () => {
    hlLayer.scrollTop = ta.scrollTop;
  });
  ta.addEventListener('keydown', e => {
    // Tab → 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, v = ta.value;
      ta.value = v.slice(0,s) + '  ' + v.slice(s);
      ta.selectionStart = ta.selectionEnd = s + 2;
    }
    setTimeout(sync, 0);
  });
  // Initial render
  sync();
  // Re-sync when value set externally (e.g. hint fill)
  // Safe per-instance setter using defineProperty on the instance only
  const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (nativeDescriptor && nativeDescriptor.set) {
    Object.defineProperty(ta, 'value', {
      get() { return nativeDescriptor.get.call(this); },
      set(v) { nativeDescriptor.set.call(this, v); sync(); },
      configurable: true,
    });
  }
}

// Initialiseer de highlighter op alle SQL-tekstvakken wanneer ze zichtbaar worden
function initAllHighlighters() {
  // Free terminal
  const freeTa = EL['free-sql'];
  if (freeTa) initHighlighter(freeTa);
  // Mission textareas — both sql-editor and sq-input classes
  document.querySelectorAll('textarea.sql-editor, textarea.sq-input').forEach(ta => initHighlighter(ta));
}

// ── SQL SYNTAX FILTER ────────────────────────────────────────────
(function initSynFilter() {
  function setup() {
    const bar = document.querySelector('.syn-filter-bar');
    if (!bar) return;
    bar.addEventListener('click', e => {
      const btn = e.target.closest('.syn-filter-btn');
      if (!btn) return;
      const filter = btn.dataset.filter;
      // Update active button
      bar.querySelectorAll('.syn-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show/hide cards
      document.querySelectorAll('.syn-card').forEach(card => {
        const cat = card.dataset.cat || '';
        if (filter === 'all' || cat === filter) {
          card.classList.remove('syn-hidden');
        } else {
          card.classList.add('syn-hidden');
        }
      });
    });
  }
  // Run after DOM is ready; also hook into panel open
  document.addEventListener('DOMContentLoaded', setup);
  setTimeout(setup, 500);
})();

// ── INIT ──────────────────────────────────────────────────────────
// Script loads with defer: DOM is guaranteed ready when this runs.
(function init() {
  try {
    const hasSave = load();
    if (hasSave) {
      const bootNameEl = document.getElementById('boot-name');
      if (bootNameEl) bootNameEl.value = G.name;
      const info = document.getElementById('boot-saved');
      if (info) {
        info.style.display = '';
        info.textContent = `✓ Voortgang gevonden: ${G.name}`;
      }
      const skipBtn = document.getElementById('boot-skip-cin');
      if (skipBtn) skipBtn.style.display = '';
    }

    // Boot name input: Enter key starts game
    const bootInput = document.getElementById('boot-name');
    if (bootInput) {
      bootInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') APP.startGame();
      });
    }

    THEME.init();
    const sBoot = document.getElementById('s-boot');
    if (sBoot) sBoot.classList.add('active');

    try { DAILY.updateBadge(); } catch(e) { /* badge update can wait until game is loaded */ }
  } catch(e) {
    console.error('[DataShop] Init error:', e);
  }
})();

// ── EVENT DELEGATION ─────────────────────────────────────────────
// Single listener — all data-* driven interactions go through here.
// Wrapped in try/catch: a handler error must never silently break other clicks.
document.addEventListener('click', function(e) {
  try {
    const dbEl = e.target.closest('[data-dbtab]');
    if (dbEl) {
      APP.showDbTab(dbEl.dataset.dbtab);
      // data-dbtable on shortcut buttons navigates directly to a table
      if (dbEl.dataset.dbtable) APP.renderDBTable(dbEl.dataset.dbtable);
      return;
    }
    const exEl = e.target.closest('[data-example]');
    if (exEl) { APP.loadExampleIdx(parseInt(exEl.dataset.example)); return; }

    const el = e.target.closest('[data-panel],[data-filter],[data-theme],[data-action]');
    if (!el) return;

    if (el.dataset.panel)  { APP.showPanel(el.dataset.panel); return; }
    if (el.dataset.filter) { APP.setFilter(el.dataset.filter); return; }
    if (el.dataset.theme)  { THEME.set(el.dataset.theme); return; }

    switch (el.dataset.action) {
      case 'theme-toggle':     THEME.toggle(); break;
      case 'clear-search':     APP.clearSearch(); break;
      case 'open-key-help':    APP.openKeyHelp(); break;
      case 'close-key-help':   APP.closeKeyHelp(); break;
      case 'close-recap':      APP.closeRecap(); break;
      case 'close-completion': APP.closeCompletion(); break;
      case 'download-cert':    APP.downloadCertificate(); break;
      case 'start-game':       APP.startGame(); break;
      case 'clear-free':       APP.clearFree(); break;
      case 'tut-next':         TUT._next(); break;
    }
  } catch(err) {
    console.error('[DataShop] Click handler error:', err);
  }
});

