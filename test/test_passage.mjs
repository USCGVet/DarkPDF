/* End-to-end data tests for kjv.js — run with:  node test/test_passage.mjs

   Exercises the same path the standalone build uses: base64 -> gunzip ->
   parse -> passage(). Passing here means libs/kjv.txt.gz is intact and the
   inlined dist path works, not just the regexes. */

import fs from "node:fs";

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/* Run the real data file the way a browser would: it assigns the global that
   kjv.js reads. Evaluating it here also checks the generator's output is
   valid JS, not just valid base64. */
global.window = {};
new Function(fs.readFileSync(here + "../libs/kjv.b64.js", "utf8"))();
if (!global.window.__KJV_B64__) {
  console.log("FAIL  libs/kjv.b64.js did not set window.__KJV_B64__");
  process.exit(1);
}
new Function(fs.readFileSync(here + "../kjv.js", "utf8"))();
const KJV = global.window.KJV;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${extra ? "\n        " + extra : ""}`); }
}

/* Look up a reference the way the app does: parse text, then resolve. */
function look(text) {
  const { refs } = KJV.findRefs(text, null, 1);
  if (!refs.length) return null;
  return KJV.passage(refs[0].ref);
}

await KJV.load();
ok(KJV.isLoaded(), "gzipped store loads and parses");

console.log("\n--- exact verse text ---");
const j316 = look("John 3:16");
ok(j316.verses.length === 1 && j316.verses[0].text ===
   "For God so loved the world, that he gave his only begotten Son, that "
   + "whosoever believeth in him should not perish, but have everlasting life.",
   "John 3:16 verbatim", j316 && j316.verses[0] && j316.verses[0].text);

const isa910 = look("Isaiah 9:10");
ok(/^The bricks are fallen down/.test(isa910.verses[0].text),
   "Isaiah 9:10 (Cahn's Harbinger verse)");

console.log("\n--- verses the carry fixes had to get right ---");
ok(/Behold, the man is become as one of us/.test(look("Genesis 3:22").verses[0].text),
   "Genesis 3:22 is the 'one of us' verse");
ok(/so much better than the angels/.test(look("Hebrews 1:4").verses[0].text),
   "Hebrews 1:4 is 'so much better than the angels'");
ok(/holy mountain of God/.test(look("Ezekiel 28:14").verses[0].text),
   "Ezekiel 28:14 is 'the holy mountain of God'");

console.log("\n--- shapes ---");
const range = look("Isa 14:12–15");
ok(range.verses.length === 4 && range.verses[0].v === 12 && range.verses[3].v === 15,
   "range Isa 14:12–15 yields 4 verses", range && String(range.verses.length));

const list = look("John 3:16, 17");
ok(list.verses.length === 2 && list.verses.map(v => v.v).join(",") === "16,17",
   "comma list John 3:16, 17 yields verses 16 and 17");

const cross = look("Gen 1:1–2:3");
ok(cross.verses.length === 34 && cross.verses[0].c === 1 &&
   cross.verses[33].c === 2 && cross.verses[33].v === 3,
   "cross-chapter Gen 1:1–2:3 spans 31 + 3 verses", cross && String(cross.verses.length));

const psalm = look("Psalm 89:6–8");
ok(psalm.verses.length === 3 && psalm.label === "Psalm 89:6–8",
   "Psalms displays as singular 'Psalm' for one psalm");

console.log("\n--- limits ---");
const big = look("Psalm 119:1–176");
ok(big.truncated && big.verses.length === KJV.MAX_VERSES,
   `Psalm 119:1–176 truncates at ${KJV.MAX_VERSES} verses`,
   big && `truncated=${big.truncated} n=${big.verses.length}`);

const last = look("Revelation 22:21");
ok(last.verses[0].text === "The grace of our Lord Jesus Christ be with you all. Amen.",
   "last verse of the Bible resolves");

console.log("\n--- whole-store integrity ---");
let verseTotal = 0, bookCount = 0;
for (const name of ["Genesis", "Psalms", "Isaiah", "Malachi", "Matthew", "Revelation"]) {
  const p = look(`${name === "Psalms" ? "Psalm" : name} 1:1`);
  if (p && p.verses.length) bookCount++;
}
ok(bookCount === 6, "spot books across OT and NT all resolve");

/* Every verse the parser can name in chapter 1 verse 1 of every book. */
let missing = [];
for (const [book] of [["Genesis"], ["Obadiah"], ["Jude"], ["3 John"], ["Philemon"]]) {
  const p = KJV.passage({ book, chapter: 1, segs: [{ c1: 1, v1: 1, c2: 1, v2: 1 }], label: "" });
  if (!p || !p.verses.length) missing.push(book);
}
ok(missing.length === 0, "single-chapter books resolve", missing.join(", "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
