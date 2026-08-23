/* Reference-parser tests for kjv.js — run with:  node test/test_refs.mjs

   Strings in the first and third blocks are verbatim (or lightly trimmed)
   from the PDFs this was built against — Heiser's Supernatural and The
   Unseen Realm, Cahn's The Harbinger — so a regression there is a real
   regression against real books. */

import fs from "node:fs";

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
global.window = {};
new Function(fs.readFileSync(here + "../kjv.js", "utf8"))();
const KJV = global.window.KJV;

let pass = 0, fail = 0;

/* A trailing "*" on an expected label means "resolved via carry". */
function chk(text, expect, { carry = null, page = 10 } = {}) {
  const { refs } = KJV.findRefs(text, carry, page);
  const got = refs.map(r => r.ref.label + (r.carried ? "*" : ""));
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${JSON.stringify(text.slice(0, 66))}`);
  if (!ok) console.log(`        want ${JSON.stringify(expect)}\n        got  ${JSON.stringify(got)}`);
}

console.log("--- verbatim strings from the PDFs ---");
chk("1 Sam 23:1–14", ["1 Samuel 23:1–14"]);
chk("1 Kgs 22:1–23", ["1 Kings 22:1–23"]);
chk("2 Kgs 5:17–19", ["2 Kings 5:17–19"]);
chk("Isa 14:12–15", ["Isaiah 14:12–15"]);
chk("Ezek 28:11–19", ["Ezekiel 28:11–19"]);
chk("Matt 16:13–23", ["Matthew 16:13–23"]);
chk("John 1:1–14", ["John 1:1–14"]);
chk("Isaiah 9:10. So it's known.", ["Isaiah 9:10"]);
chk("One commentary on Isaiah 9:10 describes how the", ["Isaiah 9:10"]);
chk("argument in 1 Cor[inthians] 11:2–16 require", ["1 Corinthians 11:2–16"]);
chk("Psalm 89:5–7 (Hebrew: vv. 6–8) explicitly", ["Psalm 89:5–7", "Psalm 89:6–8*"]);
chk("council, or court (Ps. 89:5–7; Dan. 7:10).", ["Psalm 89:5–7", "Daniel 7:10"]);
chk("(Judg 6:11–24). This is fascinating. In verse 11 the angel",
    ["Judges 6:11–24", "Judges 6:11*"]);
chk("(Rom 10:9–13). the quotation of verse 13 comes from Joel 2:32.",
    ["Romans 10:9–13", "Romans 10:13*", "Joel 2:32"]);
chk("this argument in 1 Cor[inthians] 11:2–16 require explanation, the argument "
  + "from nature in vv. 13–15 is particularly problematic",
    ["1 Corinthians 11:2–16", "1 Corinthians 11:13–15*"]);
chk("Hirah (v. 12), but of course", []);          // no antecedent at all
chk("2 Pet 3:1 then vv. 13–15", ["2 Peter 3:1", "2 Peter 3:13–15*"]);

console.log("\n--- book-less continuations after ; or , ---");
chk("(Ezek. 28:13; 31:8–9)", ["Ezekiel 28:13", "Ezekiel 31:8–9"]);
chk("Ezek. 28:13; 31:8–9; 32:1", ["Ezekiel 28:13", "Ezekiel 31:8–9", "Ezekiel 32:1"]);
chk("(Rom. 8:15, 23; Eph. 1:5; Gal. 4:4)",
    ["Romans 8:15, 23", "Ephesians 1:5", "Galatians 4:4"]);
/* Not a continuation — prose intervenes, so the bare number is ignored. */
chk("Genesis 1:1 and then later on page 31:8 of the book", ["Genesis 1:1"]);

console.log("\n--- numbered books, roman numerals, tight spacing ---");
chk("I Sam 3:1", ["1 Samuel 3:1"]);
chk("II Cor 5:17", ["2 Corinthians 5:17"]);
chk("III John 1:4", ["3 John 1:4"]);
chk("1Cor 13:4", ["1 Corinthians 13:4"]);
chk("1 Thess 4:16", ["1 Thessalonians 4:16"]);
chk("2 Tim 3:16", ["2 Timothy 3:16"]);
chk("Titus 2:11", ["Titus 2:11"]);
chk("1 Ti 2:5", ["1 Timothy 2:5"]);
chk("Song of Solomon 2:1", ["Song of Solomon 2:1"]);
chk("Song 2:1", ["Song of Solomon 2:1"]);
chk("Rev 22:21", ["Revelation 22:21"]);
chk("Jude 1:6", ["Jude 1:6"]);

console.log("\n--- ranges, lists, cross-chapter, dot separator ---");
chk("John 3:16, 17", ["John 3:16, 17"]);
chk("Gen 1:1–2:3", ["Genesis 1:1–2:3"]);
chk("Isa 7.14", ["Isaiah 7:14"]);
chk("Gen 1:1ff", ["Genesis 1:1"]);
chk("John 3:16a", ["John 3:16"]);
chk("Deut. 6:4", ["Deuteronomy 6:4"]);

console.log("\n--- must NOT match (precision) ---");
chk("And Isaiah spoke", []);
chk("Matthew 5. 3 reasons follow", []);
chk("the meeting is at 3:16 pm", []);
chk("Journal of Theology 5:12", []);
chk("see Table 2:1 below", []);
chk("Is 3:4 the right ratio?", []);
chk("I am 3:4 done", []);
chk("inGenesis 1:1", []);
chk("Roe v. Wade", []);
chk("in these verses we see", []);
chk("1 Enoch 6:1 is not canonical", []);   // Heiser cites this constantly

console.log("\n--- bare chapter anchors the carry (regressions from Supernatural) ---");
/* p27: the antecedent is the bare chapter "Genesis 3", not the earlier
   full citation. Before this was handled, "verse 22" resolved to Gen 1:22. */
chk("headquarters (Gen. 1:26–28). Just as we saw in Genesis 1, there are hints "
  + "in Genesis 3 that Eden is home to other divine beings. In verse 22, after "
  + "Adam and Eve have sinned",
    ["Genesis 1:26–28", "Genesis 3:22*"]);
/* p98: "Hebrews 1 makes the point ... (v. 4)" must not borrow Gal. 4:4. */
chk("the language of being adopted by God (Gal. 4:4). Hebrews 1 makes the point "
  + "that Jesus is better than the angels (v. 4 LEB). angels need to worship "
  + "Jesus (vv. 5–6 LEB)",
    ["Galatians 4:4", "Hebrews 1:4*", "Hebrews 1:5–6*"]);
/* p20: Heiser puts a chapter inside the v. marker. */
chk("Ezekiel refers to Eden as the garden of God (Ezek. 28:13; 31:8–9). "
  + "Ezekiel calls it the holy mountain of God (v. 28:14).",
    ["Ezekiel 28:13", "Ezekiel 31:8–9", "Ezekiel 28:14*"]);

console.log("\n--- single-chapter books cited by verse alone ---");
/* Supernatural p29 writes "see also Jude 5–6". Jude has one chapter, so the
   bare number is a verse — none of these matched at all before. */
chk("(2 Pet. 2:4–6 GNT; see also Jude 5–6)", ["2 Peter 2:4–6", "Jude 5–6"]);
chk("Jude 6", ["Jude 6"]);
chk("Jude 6–7", ["Jude 6–7"]);
chk("Jude 8, 10", ["Jude 8, 10"]);
chk("Philemon 10", ["Philemon 10"]);
chk("Phlm. 10", ["Philemon 10"]);
chk("Obadiah 15", ["Obadiah 15"]);
chk("2 John 5", ["2 John 5"]);
chk("3 John 4", ["3 John 4"]);
/* A colon after a complete range is punctuation introducing a quotation
   (Reversing Hermon p16), not a chapter — the range must survive. */
chk("Jude 5–7:", ["Jude 5–7"]);
/* The chapter stays in the label when the source spelled it out. */
chk("Jude 1:6", ["Jude 1:6"]);
/* 1 John has five chapters, so this stays a bare chapter — anchor only. */
chk("1 John 5", []);
/* A footnote marker fused to the book name is not a verse. */
chk("discussed in Jude.13", []);

/* "Jude" is never abbreviated, so that period ends a sentence and the number
   after it is a footnote marker (Unseen Realm p316). An abbreviation keeps its
   period legitimately, so "Phlm. 10" above must still resolve. */
chk("the epistles of 2 Peter and Jude. 1 We discovered that", []);
chk("Obad. 15", ["Obadiah 15"]);
/* A colon introducing a quotation must still leave a usable chapter anchor —
   without this, "v. 15" borrowed a stale Jude citation (Unseen Realm p349). */
chk("Revelation 19: “He will shepherd them with an iron rod” (v. 15)",
    ["Revelation 19:15*"]);

console.log("\n--- dash variants ---");
chk("Numbers 13:32−33", ["Numbers 13:32–33"]);   // U+2212 minus sign
chk("Numbers 13:32－33", ["Numbers 13:32–33"]);   // U+FF0D fullwidth
/* Whitespace inside a range is collapsed in the label rather than carried
   into it — this caught DASH_RUN being built from a template literal, where
   \s degrades to a literal "s". */
chk("Isa. 14:9– 11", ["Isaiah 14:9–11"]);
chk("Genesis 6:1–\n4", ["Genesis 6:1–4"]);

console.log("\n--- references beginning a line ---");
/* PDF.js emits one item per line with no separator, so app.js inserts a
   newline wherever an item carries hasEOL. Without it these two fuse to
   "InNumbers" and "like1 Samuel", and the word-boundary guard correctly
   refuses them — which is exactly why Supernatural p30/p31 showed nothing. */
chk("giants went by various names. In\nNumbers 13:32–33 they are called",
    ["Numbers 13:32–33"]);
chk("for certain from passages like\n1 Samuel 23:1–14, which tells us",
    ["1 Samuel 23:1–14"]);
chk("various names. InNumbers 13:32–33 they are called", []);   // the old, fused form
chk("from passages like1 Samuel 23:1–14, which", []);

console.log("\n--- carry across pages ---");
const c = { book: "Judges", chapter: 6, page: 40, label: "Judges 6" };
chk("Then in verse 14 the angel", ["Judges 6:14*"], { carry: c, page: 41 });
chk("Then in verse 14 the angel", ["Judges 6:14*"], { carry: c, page: 42 });
chk("Then in verse 14 the angel", [], { carry: c, page: 44 });  // too stale

console.log("\n--- impossible references rejected by chapter count ---");
chk("Genesis 51:1", []);        // Genesis has 50
chk("Revelation 23:1", []);     // Revelation has 22
chk("Jude 2:1", []);            // Jude has 1
chk("Obadiah 1:3", ["Obadiah 1:3"]);
chk("Psalm 150:6", ["Psalm 150:6"]);
chk("Psalm 151:1", []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
