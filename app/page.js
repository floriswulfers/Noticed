"use client";
import React, { useState, useEffect, useRef } from "react";
import { loadState, saveState, getSession, onAuthChange, signIn, signUp, signOut } from "../lib/supabase";

/* ─────────────────────────────────────────────
   NOTICED — v1.0 (real, database-backed)
   Hospitality, translated into a digital product.
   ───────────────────────────────────────────── */

const PAPER = "#F4F0E6";
const PAPER_2 = "#FBF8F1";
const LINE = "#E2DBCB";
const INK = "#1C1815";
const INK_SOFT = "#5C544A";
const FAINT = "#948979";
const EMBER = "#B4603A";
const DEEP = "#7A5C6E";

const DAYS = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 999);
const TODAY = () => new Date().toISOString().slice(0, 10);
const BLANK_DB = { people: [], weeks: [], gesture: null, restedOn: null, user: null, onboarded: false };

/* ── name matching ──────────────────────────────────
   Identity resolution lives here, in inspectable code, not
   in the LLM's own judgment — the model just extracts names;
   deciding whether two names are the same person is deterministic
   and, past an exact match, always requires human confirmation.
   ─────────────────────────────────────────────────── */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[n];
}

function nameSimilarity(a, b) {
  const an = (a || "").trim().toLowerCase();
  const bn = (b || "").trim().toLowerCase();
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  const maxLen = Math.max(an.length, bn.length);
  return 1 - levenshtein(an, bn) / maxLen;
}

function namesOf(p) {
  return [p.name, p.label, ...(p.aliases || [])].filter(Boolean);
}

// Forgiving parser for the free-typed/spoken "nicknames" field: accepts commas,
// periods, or plain whitespace (spaces/new lines) as separators, since voice
// dictation often drops punctuation. Never throws — always returns an array,
// even given a non-string input.
function parseAliases(raw) {
  return String(raw || "")
    .split(/[,.]+|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findExactPersonIndex(people, name) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return -1;
  return people.findIndex((p) => namesOf(p).some((x) => x.toLowerCase() === n));
}

// A candidate is a close but not exact spelling (typos, transcription variants
// like "Stacy"/"Stacey"). It is never auto applied — only ever offered for the
// user to confirm. Short names are excluded; a one letter edit on a very short
// name isn't a meaningful enough signal to interrupt the user over.
function findBestCandidate(people, name) {
  const target = (name || "").trim();
  if (target.length < 3) return null;
  let best = null;
  people.forEach((p) => {
    namesOf(p).forEach((known) => {
      if (known.length < 3) return;
      const sim = nameSimilarity(target, known);
      if (sim >= 0.6 && sim < 1 && (!best || sim > best.sim)) best = { person: p, sim };
    });
  });
  return best;
}

function newPerson(f) {
  return {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: f.name, who: f.who || "", label: "", carries: f.carries || "", loves: f.loves || "",
    threads: f.threads || [], birthday: "", aliases: [],
    last: f.sawThem ? new Date().toISOString() : new Date(Date.now() - 14 * 864e5).toISOString(),
    upcoming: f.upcoming || [], hardDates: f.hardDates || [],
  };
}

// Merges a fresh mention `f` (from the engine's extraction) into an existing
// person `p`. `learnAlias`, when given, is the exact spelling that was just
// confirmed to refer to `p` — it's remembered so the same spelling auto
// matches next time without asking again.
function mergeIntoPerson(p, f, learnAlias) {
  const aliases = [...(p.aliases || [])];
  if (learnAlias) {
    const t = learnAlias.trim();
    if (t && !namesOf(p).some((x) => x.toLowerCase() === t.toLowerCase())) aliases.push(t);
  }
  return {
    ...p,
    who: p.who || f.who,
    carries: f.carries || p.carries,
    loves: [p.loves, f.loves].filter(Boolean).join(", "),
    threads: [...(p.threads || []), ...(f.threads || [])].slice(-30),
    last: f.sawThem ? new Date().toISOString() : p.last,
    upcoming: [...(p.upcoming || []), ...(f.upcoming || [])],
    hardDates: [...(p.hardDates || []), ...(f.hardDates || [])],
    aliases,
  };
}

/* ── merging two people ─────────────────────────────
   Combines everything into `primary`; nothing from `other` is
   dropped — text fields are combined rather than picked between,
   and lists are concatenated and deduplicated, never truncated.
   ─────────────────────────────────────────────────── */
function combineText(a, b) {
  const at = (a || "").trim();
  const bt = (b || "").trim();
  if (!at) return bt;
  if (!bt || at.toLowerCase() === bt.toLowerCase()) return at;
  return `${at} ${bt}`;
}

function laterOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function dedupeStrings(arr) {
  const seen = new Set();
  const out = [];
  (arr || []).forEach((s) => {
    const t = (s || "").trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  });
  return out;
}

function dedupeEvents(arr, dateKey) {
  const seen = new Set();
  const out = [];
  (arr || []).forEach((ev) => {
    if (!ev) return;
    const key = `${(ev.what || "").trim().toLowerCase()}|${ev[dateKey] || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ev);
  });
  return out;
}

function mergePeople(primary, other) {
  const aliasSeen = new Set();
  const aliases = [];
  const addAlias = (a) => {
    const t = (a || "").trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (key === primary.name.trim().toLowerCase() || aliasSeen.has(key)) return;
    aliasSeen.add(key);
    aliases.push(t);
  };
  (primary.aliases || []).forEach(addAlias);
  addAlias(primary.label);
  addAlias(other.name);
  addAlias(other.label);
  (other.aliases || []).forEach(addAlias);

  return {
    ...primary,
    label: primary.label || other.label || "",
    who: combineText(primary.who, other.who),
    carries: combineText(primary.carries, other.carries),
    loves: [primary.loves, other.loves].filter(Boolean).join(", "),
    threads: dedupeStrings([...(primary.threads || []), ...(other.threads || [])]),
    birthday: primary.birthday || other.birthday || "",
    last: laterOf(primary.last, other.last),
    upcoming: dedupeEvents([...(primary.upcoming || []), ...(other.upcoming || [])], "when"),
    hardDates: dedupeEvents([...(primary.hardDates || []), ...(other.hardDates || [])], "date"),
    aliases,
  };
}

// Raw fetch failures ("TypeError: Load failed" on Safari, "Failed to fetch"
// on Chrome) mean the request never reached the server at all — a
// connection problem, not something the app did wrong. Surface that plainly
// instead of the cryptic raw error text.
function friendlyError(e) {
  const msg = e?.message || "";
  if (!msg || /load failed|failed to fetch|network/i.test(msg)) {
    return "A network problem — check your connection and try again.";
  }
  return msg;
}

const THRESHOLD = [
  { big: "Noticed", small: "A quieter way to love the people who matter." },
  { big: "We think of them often.", small: "We just forget to let them know. Life gets loud." },
  { big: "Not a reminder app.", small: "No nagging, no lists. A place that helps you notice, then steps back." },
  { big: "Tell it about the people rooted in your heart.", small: "Whenever it suits you. The small, true things you'd otherwise lose are kept safe here." },
  { big: "And now and then,", small: "a reason to reach for someone finds its way to you. The words are always yours." },
  { big: "Slowly, you'll find your way back to them.", small: "A better friend. A better son, daughter, sister, brother." },
];

export default function Noticed() {
  const [db, setDb] = useState(BLANK_DB);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [retryTick, setRetryTick] = useState(0);
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [slide, setSlide] = useState(0);
  const [nameInput, setNameInput] = useState("");
  const [firstPerson, setFirstPerson] = useState("");
  const [view, setView] = useState("keep");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [kept, setKept] = useState(null);
  const [working, setWorking] = useState("");
  const [note, setNote] = useState("");
  const [supported, setSupported] = useState(true);
  const [editing, setEditing] = useState(null);
  const [aliasInput, setAliasInput] = useState(""); // raw text of the nicknames field, parsed only on save
  const [pendingKeep, setPendingKeep] = useState(null);
  const [mergePicker, setMergePicker] = useState(false);
  const [mergePreview, setMergePreview] = useState(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [undo, setUndo] = useState(null);
  const rec = useRef(null);
  const asked = useRef(false);
  const wantListening = useRef(false);
  const listenBase = useRef(""); // committed text: manual typing + everything finalized across restarts
  const undoTimer = useRef(null);

  // Keep the nicknames field's raw text in sync with whichever person is
  // being edited, without ever reformatting it while the user is typing —
  // that reformatting (splitting/rejoining on every keystroke) was what
  // made commas hard to type in the first place.
  useEffect(() => {
    setAliasInput(editing ? (editing.aliases || []).join(", ") : "");
  }, [editing?.id]);

  /* ── who's signed in ────────────────────────── */
  useEffect(() => {
    let subscription;
    (async () => {
      const s = await getSession();
      setSession(s);
      setAuthChecked(true);
      subscription = onAuthChange((s2) => setSession(s2));
    })();
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) setSupported(false);
    return () => subscription?.unsubscribe();
  }, []);

  /* ── load that person's data from the real database ── */
  useEffect(() => {
    let current = true;
    asked.current = false;
    // These hold in-progress decisions (an open edit sheet, a pending name
    // confirmation, a merge in preview, an undo snapshot) — none of them
    // should ever survive a switch to a different account.
    setEditing(null);
    setAliasInput("");
    setPendingKeep(null);
    setMergePicker(false);
    setMergePreview(null);
    setConfirmRelease(false);
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (!session) {
      setDb(BLANK_DB);
      setLoaded(false);
      setLoadError("");
      return () => { current = false; };
    }
    (async () => {
      setLoaded(false);
      setLoadError("");
      try {
        const saved = await loadState(session.user.id);
        if (!current) return; // a newer sign in has since superseded this fetch
        setDb(saved || BLANK_DB);
        setLoaded(true);
      } catch (e) {
        if (!current) return;
        // Don't fall back to a blank db here — that would look identical to
        // "brand new user" and silently walk an existing user back through
        // onboarding, which then overwrites their real saved data.
        setLoadError(friendlyError(e));
      }
    })();
    return () => { current = false; };
  }, [session?.user?.id, retryTick]);

  const persist = async (next) => {
    setDb(next);
    if (!session?.user?.id) return;
    try {
      await saveState(session.user.id, next);
      setSaveError("");
    } catch (e) {
      setSaveError(friendlyError(e));
    }
  };

  /* ── sign in, sign up, sign out ─────────────── */
  const handleAuth = async () => {
    setAuthBusy(true);
    setAuthMessage("");
    try {
      if (authMode === "signin") {
        await signIn(email.trim(), password);
      } else {
        const { session: newSession } = await signUp(email.trim(), password);
        if (!newSession) {
          setAuthMessage("Check your email to confirm your account, then sign in.");
          setAuthMode("signin");
        }
      }
      setPassword("");
    } catch (e) {
      setAuthMessage(e?.message || "Something went wrong");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  /* ── the engine, via secret server route ──── */
  const ask = async (prompt) => {
    const res = await fetch("/api/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const { raw, error } = await res.json();
    if (error) throw new Error(error);
    try {
      return JSON.parse(raw);
    } catch (e) {
      // engine replied but not clean JSON — pull the object out if wrapped in text
      const m = raw && raw.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("Could not read engine reply");
    }
  };

  /* ── voice ──────────────────────────────── */
  // Continuous mode is unreliable on mobile (Android Chrome especially): a
  // single long-lived session restarts and redelivers results on its own in
  // ways that duplicate text no matter how the results are reassembled. So
  // each recognition instance here captures exactly one utterance (continuous
  // = false): it listens until a pause, returns one final result, and ends.
  // That single utterance is committed to `listenBase` exactly once in onend,
  // then — if the user hasn't pressed stop — a fresh instance starts for the
  // next utterance with an empty result list, so nothing already committed
  // can be re-added.
  const startRecognitionInstance = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";

    let utteranceFinal = "";

    r.onresult = (e) => {
      let interim = "";
      let finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      utteranceFinal = finalText.trim();
      const combined = [listenBase.current, utteranceFinal].filter(Boolean).join(" ");
      setTranscript(interim ? `${combined} ${interim}` : combined);
    };

    r.onerror = (e) => {
      if (["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(e.error)) {
        wantListening.current = false;
      }
    };

    r.onend = () => {
      listenBase.current = [listenBase.current, utteranceFinal].filter(Boolean).join(" ");
      if (wantListening.current) {
        startRecognitionInstance(); // pick up the next utterance
      } else {
        setListening(false);
      }
    };

    r.start();
    rec.current = r;
  };

  const listen = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    listenBase.current = transcript.trim(); // keep anything typed before pressing Speak
    wantListening.current = true;
    startRecognitionInstance();
    setListening(true);
  };
  const stop = () => {
    wantListening.current = false;
    rec.current?.stop();
    setListening(false);
  };

  /* ── capture ────────────────────────────── */
  const keep = async () => {
    const text = transcript.trim();
    if (!text) return;
    setWorking("Keeping it…");
    const known = db.people
      .map((p) => `${p.name}${p.label ? ` [${p.label}]` : ""}${p.aliases?.length ? ` (also called ${p.aliases.join(", ")})` : ""} (${p.who})`)
      .join("; ") || "none yet";
    try {
      const out = await ask(`I'm telling you about my week. Pull out the people I mentioned.

Already known: ${known}
Today: ${TODAY()}
What I said:
"""${text}"""

Keep every field short, written in my own plain words, first person (I, me, my). Never refer to me as "the speaker" or by name. Never invent detail.
"threads" = specific true things worth remembering, human and verbatim ish, not blandly summarised.
"hardDates" = anniversaries of painful things others forget. YYYY-MM-DD, only if implied.
"upcoming" = a specific thing about to happen to them, with rough date.
Never use hyphens or dashes anywhere. Use commas or separate sentences.

ONLY JSON:
{"people":[{"name":"","who":"","carries":"","loves":"","threads":[""],"sawThem":true,"upcoming":[{"what":"","when":"YYYY-MM-DD"}],"hardDates":[{"what":"","date":"YYYY-MM-DD"}]}]}`);

      // Identity resolution happens here, not in the prompt: exact matches
      // (name, label, or a saved alias) merge immediately; a close-but-not-exact
      // spelling is only ever offered for confirmation, never merged on its own.
      let people = [...db.people];
      const names = [];
      const queue = [];
      (out.people || []).forEach((f) => {
        if (!f.name) return;
        const exactIdx = findExactPersonIndex(people, f.name);
        if (exactIdx >= 0) {
          people[exactIdx] = mergeIntoPerson(people[exactIdx], f);
          names.push(people[exactIdx].label || people[exactIdx].name);
          return;
        }
        const candidate = findBestCandidate(people, f.name);
        if (candidate) {
          queue.push({ extracted: f, candidateId: candidate.person.id, candidateName: candidate.person.label || candidate.person.name });
        } else {
          const np = newPerson(f);
          people.push(np);
          names.push(np.name);
        }
      });

      if (queue.length) {
        setWorking("");
        setPendingKeep({ text, people, queue, idx: 0, names });
        return;
      }

      await persist({ ...db, people, weeks: [...db.weeks, { at: TODAY(), text }] });
      setTranscript(""); setWorking(""); setKept(names);
    } catch (e) {
      console.error(e); setWorking("Hm, that didn't land: " + (e?.message || "unknown") + ". Try again.");
    }
  };

  const resolvePending = async (isMatch) => {
    const { text, people, queue, idx, names } = pendingKeep;
    const item = queue[idx];
    let nextPeople = people;
    let nextNames = names;
    if (isMatch) {
      const i = nextPeople.findIndex((p) => p.id === item.candidateId);
      nextPeople = [...nextPeople];
      nextPeople[i] = mergeIntoPerson(nextPeople[i], item.extracted, item.extracted.name);
      nextNames = [...nextNames, nextPeople[i].label || nextPeople[i].name];
    } else {
      const np = newPerson(item.extracted);
      nextPeople = [...nextPeople, np];
      nextNames = [...nextNames, np.name];
    }
    const nextIdx = idx + 1;
    if (nextIdx < queue.length) {
      setPendingKeep({ text, people: nextPeople, queue, idx: nextIdx, names: nextNames });
      return;
    }
    setPendingKeep(null);
    setWorking("Keeping it…");
    await persist({ ...db, people: nextPeople, weeks: [...db.weeks, { at: TODAY(), text }] });
    setWorking(""); setKept(nextNames); setTranscript("");
  };

  /* ── triggers ───────────────────────────── */
  const pick = () => {
    if (!db.people.length) return null;
    const now = Date.now();
    let best = null;
    db.people.forEach((p) => {
      let score = Math.random() * 8, reason = "no reason at all", kind = "open";
      const drift = DAYS(p.last);
      if (drift > 10) { score = Math.min(drift, 60); reason = `${drift} days of quiet`; kind = "drift"; }
      if (p.birthday) {
        const b = new Date(p.birthday); b.setFullYear(new Date().getFullYear());
        const d = (b.getTime() - now) / 864e5;
        if (d > -1 && d < 8) { score = 250 - Math.abs(d); reason = d < 1 ? "their birthday is today" : `their birthday, in ${Math.round(d)} days`; kind = "birthday"; }
      }
      (p.upcoming || []).forEach((u) => {
        if (!u.when) return;
        const d = (new Date(u.when).getTime() - now) / 864e5;
        if (d > -2 && d < 6) { score = 200 - Math.abs(d); reason = u.what; kind = "event"; }
      });
      (p.hardDates || []).forEach((h) => {
        if (!h.date) return;
        const a = new Date(h.date); a.setFullYear(new Date().getFullYear());
        const d = Math.abs((a.getTime() - now) / 864e5);
        if (d < 4) { score = 300; reason = h.what; kind = "anniversary"; }
      });
      if (!best || score > best.score) best = { p, score, reason, kind };
    });
    return best;
  };

  const summon = async () => {
    const t = pick();
    if (!t) return;
    const p = t.p;
    const callname = p.label || p.name;
    try {
      const g = await ask(`You are the quiet engine inside Noticed, hospitality translated into software. Once in a while it hands someone a reason to reach for a person they love, then gets out of the way.

Person: ${p.name}${p.label ? ` (the user calls them "${p.label}")` : ""}
Who they are: ${p.who}
Carrying: ${p.carries}
Loves: ${p.loves}
Recent true things they've said or done: ${(p.threads || []).slice(-6).join(" / ") || "nothing yet"}
Days since contact: ${DAYS(p.last)}
Why now: ${t.reason} (trigger: ${t.kind})

CRITICAL: you never write the message for them. Hand them the noticing; the words stay theirs. Do not produce a sendable text.

Rules:
 SPECIFIC. Never "reach out" or "check in".
 The act must cost NOTHING. Words, presence, a memory named aloud.
 Emotional context over reminder. Not "it has been a while", the actual human thing.
 Never sentimental, greeting card, or therapy speak.
 "worthNaming" = 2 or 3 short fragments: the detail to mention, the memory to bring up, the thing not to say.
 Anniversary of something painful: do not perform sadness. Remembering is the gift.
 "why" is one quiet observational sentence, a small truth, not a notification.
 Refer to the person as "${callname}".
 Never use hyphens or dashes anywhere in your writing. Use commas, or separate sentences.

ONLY JSON:
{"why":"","act":"","worthNaming":["",""],"deeper":"","object":null}`);
      await persist({ ...db, gesture: { date: TODAY(), personId: p.id, name: callname, reason: t.reason, kind: t.kind, ...g } });
    } catch (e) { setWorking("The engine stumbled."); }
  };

  useEffect(() => {
    if (!loaded || asked.current) return;
    if (view !== "today" || !db.onboarded) return;
    if (db.gesture?.date === TODAY() || db.restedOn === TODAY() || !db.people.length) return;
    asked.current = true;
    setWorking("…");
    summon();
  }, [view, loaded, db.people.length, db.onboarded]);

  const done = async () => {
    const people = db.people.map((p) =>
      p.id === db.gesture.personId
        ? { ...p, last: new Date().toISOString(), threads: note ? [...(p.threads || []), note] : p.threads }
        : p
    );
    await persist({ ...db, people, gesture: null, restedOn: TODAY() });
    setNote("");
  };

  // Opening/closing the edit sheet always resets any in-progress merge or
  // release attempt — otherwise a choice made for one person could linger
  // and get shown against a different one later.
  const openEditing = (p) => {
    setEditing(p);
    setMergePicker(false);
    setMergePreview(null);
    setConfirmRelease(false);
  };
  const closeEditing = () => {
    setEditing(null);
    setMergePicker(false);
    setMergePreview(null);
    setConfirmRelease(false);
  };

  const saveEdit = async () => {
    const people = db.people.map((p) => (p.id === editing.id ? { ...editing, aliases: parseAliases(aliasInput) } : p));
    await persist({ ...db, people });
    closeEditing();
  };

  /* ── merge two people ──────────────────────── */
  const confirmMerge = async () => {
    const primary = editing;
    const other = mergePreview;
    const merged = mergePeople(primary, other);
    const snapshot = { people: db.people, gesture: db.gesture, message: "Merged." };
    const nextPeople = db.people.filter((p) => p.id !== other.id).map((p) => (p.id === primary.id ? merged : p));
    const nextGesture = db.gesture?.personId === other.id ? { ...db.gesture, personId: primary.id } : db.gesture;
    await persist({ ...db, people: nextPeople, gesture: nextGesture });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(snapshot);
    undoTimer.current = setTimeout(() => setUndo(null), 10000);
    closeEditing();
  };

  const handleUndo = async () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const restored = undo;
    setUndo(null);
    await persist({ ...db, people: restored.people, gesture: restored.gesture });
  };

  /* ── release a person ──────────────────────── */
  const releasePerson = async () => {
    const person = editing;
    const name = person.label || person.name;
    const snapshot = { people: db.people, gesture: db.gesture, message: `${name} has been released. Space for other memories now.` };
    const nextPeople = db.people.filter((p) => p.id !== person.id);
    const nextGesture = db.gesture?.personId === person.id ? null : db.gesture;
    await persist({ ...db, people: nextPeople, gesture: nextGesture });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(snapshot);
    undoTimer.current = setTimeout(() => setUndo(null), 10000);
    closeEditing();
  };

  /* ── styles ─────────────────────────────── */
  const S = {
    shell: { minHeight: "100vh", background: PAPER, color: INK, fontFamily: "'Inter',system-ui,sans-serif", maxWidth: 460, margin: "0 auto", paddingBottom: 44 },
    head: { padding: "30px 26px 20px", display: "flex", justifyContent: "space-between", alignItems: "baseline" },
    mark: { fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 27 },
    nav: { display: "flex", gap: 16 },
    nb: (on) => ({ background: "none", border: "none", padding: 0, cursor: "pointer", color: on ? EMBER : FAINT, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "inherit" }),
    card: { margin: "0 20px 16px", background: PAPER_2, borderRadius: 4, padding: "28px 26px", border: `1px solid ${LINE}` },
    eyebrow: { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: FAINT, marginBottom: 16 },
    greet: { fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 26, lineHeight: 1.2, marginBottom: 4 },
    name: { fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 42, lineHeight: 1.02, marginBottom: 12 },
    serif: { fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 21, lineHeight: 1.45, fontStyle: "italic" },
    body: { fontSize: 14.5, lineHeight: 1.65, color: INK_SOFT },
    label: { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: EMBER, marginTop: 26, marginBottom: 9 },
    frag: { fontSize: 14.5, lineHeight: 1.6, color: INK, paddingLeft: 14, borderLeft: `1px solid ${LINE}`, marginBottom: 9 },
    primary: { width: "100%", background: INK, color: PAPER, border: "none", borderRadius: 999, padding: "15px 0", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", marginTop: 20 },
    ghost: { width: "100%", background: "transparent", color: FAINT, border: `1px solid ${LINE}`, borderRadius: 999, padding: "13px 0", fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginTop: 10 },
    mic: (on) => ({ width: 118, height: 118, borderRadius: "50%", border: `1px solid ${on ? EMBER : LINE}`, background: on ? "#B4603A0F" : "transparent", color: on ? EMBER : INK_SOFT, cursor: "pointer", fontFamily: "inherit", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", margin: "8px auto 0", display: "block", animation: on ? "breathe 2.4s ease-in-out infinite" : "none" }),
    ta: { width: "100%", minHeight: 108, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 3, padding: 14, color: INK, fontSize: 15, lineHeight: 1.6, fontFamily: "inherit", resize: "none", outline: "none", boxSizing: "border-box", marginTop: 20 },
    inp: { width: "100%", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 3, padding: "11px 13px", color: INK, fontSize: 14.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 12 },
    row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer" },
    dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block", margin: "0 5px" },
  };

  if (!authChecked)
    return <div style={{ ...S.shell, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color: FAINT, fontSize: 13 }}>Opening…</span></div>;

  /* ── SIGN IN / SIGN UP ──────────────────── */
  if (!session) {
    return (
      <div style={{ ...S.shell, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 34px" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500&display=swap');input::placeholder{color:#B0A692}`}</style>
        <div style={S.mark}>Noticed</div>
        <div style={{ ...S.serif, margin: "18px 0 24px", color: INK_SOFT }}>
          {authMode === "signin" ? "Welcome back." : "Let's begin."}
        </div>
        <input style={S.inp} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          style={S.inp}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAuth()}
        />
        {authMessage && <div style={{ ...S.body, color: EMBER, marginBottom: 8 }}>{authMessage}</div>}
        <button style={S.primary} disabled={authBusy || !email.trim() || !password.trim()} onClick={handleAuth}>
          {authBusy ? "…" : authMode === "signin" ? "Sign in" : "Create account"}
        </button>
        <button
          style={S.ghost}
          onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthMessage(""); }}
        >
          {authMode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ ...S.shell, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 34px", textAlign: "center" }}>
        <div style={S.mark}>Noticed</div>
        <div style={{ ...S.body, margin: "18px 0 4px" }}>Couldn't load your data.</div>
        <div style={{ ...S.body, fontSize: 12.5, color: FAINT, marginBottom: 8 }}>{loadError}</div>
        <button style={S.primary} onClick={() => setRetryTick((t) => t + 1)}>Try again</button>
      </div>
    );
  }

  if (!loaded)
    return <div style={{ ...S.shell, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color: FAINT, fontSize: 13 }}>Opening…</span></div>;

  /* ── THRESHOLD ──────────────────────────── */
  if (!db.onboarded) {
    const last = slide === THRESHOLD.length - 1;
    const s = THRESHOLD[slide];
    return (
      <div style={{ ...S.shell, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 34px" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500&display=swap');
          input::placeholder{color:#B0A692}
          @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}`}</style>
        <div key={slide} style={{ animation: "rise .6s ease" }}>
          <div style={{ ...S.dot, background: EMBER }} />
          <div style={{ fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 34, lineHeight: 1.12, margin: "18px 0 14px" }}>{s.big}</div>
          <div style={{ ...S.body, fontSize: 16 }}>{s.small}</div>
          {last && (
            <div style={{ marginTop: 30 }}>
              <div style={{ ...S.eyebrow, marginBottom: 10 }}>What should we call you?</div>
              <input style={S.inp} placeholder="Your first name" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
              <div style={{ ...S.eyebrow, marginBottom: 10, marginTop: 18 }}>And who's the first person on your heart right now?</div>
              <input style={S.inp} placeholder="Just their name" value={firstPerson} onChange={(e) => setFirstPerson(e.target.value)} />
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 32 }}>
          {THRESHOLD.map((_, i) => (
            <div key={i} style={{ height: 2, flex: 1, background: i <= slide ? EMBER : LINE, borderRadius: 2, transition: "background .4s" }} />
          ))}
        </div>
        {!last ? (
          <button style={{ ...S.primary, marginTop: 22 }} onClick={() => setSlide(slide + 1)}>Continue</button>
        ) : (
          <button
            style={{ ...S.primary, marginTop: 22 }}
            disabled={!nameInput.trim() || !firstPerson.trim()}
            onClick={async () => {
              const seed = firstPerson.trim()
                ? [{ id: `p-${Date.now()}`, name: firstPerson.trim(), who: "", label: "", carries: "", loves: "", threads: [], birthday: "", aliases: [], last: new Date().toISOString(), upcoming: [], hardDates: [] }]
                : [];
              await persist({ ...db, user: nameInput.trim(), onboarded: true, people: seed });
              setView("keep");
            }}
          >
            Begin
          </button>
        )}
        {saveError && <div style={{ ...S.body, color: EMBER, fontSize: 12.5, marginTop: 14 }}>{saveError}</div>}
      </div>
    );
  }

  const g = db.gesture?.date === TODAY() ? db.gesture : null;
  const hour = new Date().getHours();
  const timeword = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";

  /* ── NAME CONFIRMATION ─────────────────────
     A close but not exact name match — never merged without this. ── */
  if (pendingKeep) {
    const item = pendingKeep.queue[pendingKeep.idx];
    return (
      <div style={S.shell}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500&display=swap');input::placeholder{color:#B0A692}`}</style>
        <header style={S.head}><div style={S.mark}>Noticed</div></header>
        <div style={S.card}>
          <div style={S.eyebrow}>
            {pendingKeep.queue.length > 1 ? `One thing — ${pendingKeep.idx + 1} of ${pendingKeep.queue.length}` : "One thing"}
          </div>
          <div style={{ ...S.serif, marginBottom: 14 }}>Did you mean {item.candidateName}?</div>
          <div style={S.body}>You mentioned "{item.extracted.name}" — is that the same person as {item.candidateName}, just spelled or said differently?</div>
          <button style={S.primary} onClick={() => resolvePending(true)}>Yes, same person</button>
          <button style={S.ghost} onClick={() => resolvePending(false)}>No, someone new</button>
        </div>
      </div>
    );
  }

  /* ── EDIT SHEET ─────────────────────────── */
  if (editing) {
    const displayName = editing.label || editing.name; // the one name shown everywhere
    const otherDisplayName = mergePreview ? (mergePreview.label || mergePreview.name) : "";
    return (
      <div style={S.shell}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500&display=swap');input::placeholder{color:#B0A692}`}</style>
        <header style={S.head}><div style={S.mark}>Noticed</div></header>
        <div style={S.card}>
          <div style={S.eyebrow}>Their details</div>
          <div style={{ ...S.body, marginBottom: 4, color: FAINT, fontSize: 12 }}>Name</div>
          <input style={S.inp} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <div style={{ ...S.body, marginBottom: 4, color: FAINT, fontSize: 12 }}>What you call them — if set, this is shown everywhere instead of their name</div>
          <input style={S.inp} placeholder="optional, a personal name" value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
          <div style={{ ...S.body, marginBottom: 4, color: FAINT, fontSize: 12 }}>Other names or nicknames (separate with commas, periods, or spaces)</div>
          <input
            style={S.inp}
            placeholder="other names you call them"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
          />
          <div style={{ ...S.body, marginBottom: 4, color: FAINT, fontSize: 12 }}>Who they are to you</div>
          <input style={S.inp} value={editing.who} onChange={(e) => setEditing({ ...editing, who: e.target.value })} />
          <div style={{ ...S.body, marginBottom: 4, color: FAINT, fontSize: 12 }}>Birthday</div>
          <input style={S.inp} type="date" value={editing.birthday || ""} onChange={(e) => setEditing({ ...editing, birthday: e.target.value })} />
          <button style={S.primary} onClick={saveEdit}>Save</button>
          <button style={S.ghost} onClick={closeEditing}>Cancel</button>
          {saveError && <div style={{ ...S.body, color: EMBER, fontSize: 12.5, marginTop: 14 }}>{saveError}</div>}

          {db.people.length > 1 && !mergePicker && !mergePreview && (
            <button style={{ ...S.ghost, marginTop: 22, borderTop: `1px solid ${LINE}`, paddingTop: 20 }} onClick={() => setMergePicker(true)}>
              Merge with someone else…
            </button>
          )}

          {mergePicker && (
            <div style={{ marginTop: 22, borderTop: `1px solid ${LINE}`, paddingTop: 20 }}>
              <div style={S.eyebrow}>Merge {displayName} with</div>
              {db.people.filter((p) => p.id !== editing.id).map((p) => (
                <div key={p.id} style={S.row} onClick={() => { setMergePreview(p); setMergePicker(false); }}>
                  <div>{p.label || p.name}</div>
                </div>
              ))}
              <button style={S.ghost} onClick={() => setMergePicker(false)}>Cancel</button>
            </div>
          )}

          {mergePreview && (
            <div style={{ marginTop: 22, borderTop: `1px solid ${LINE}`, paddingTop: 20 }}>
              <div style={S.eyebrow}>Merging {otherDisplayName} into {displayName}</div>
              <div style={S.body}>
                Combines {mergePreview.threads?.length || 0} thing{(mergePreview.threads?.length || 0) === 1 ? "" : "s"} remembered,{" "}
                {mergePreview.upcoming?.length || 0} upcoming, {mergePreview.hardDates?.length || 0} hard date{(mergePreview.hardDates?.length || 0) === 1 ? "" : "s"}.
                Nothing is deleted, everything combines into one person, and {otherDisplayName} still matches next time, remembered invisibly.
              </div>
              {mergePreview.birthday && editing.birthday && mergePreview.birthday !== editing.birthday && (
                <div style={{ ...S.body, color: EMBER, marginTop: 10, fontSize: 12.5 }}>
                  They have different birthdays saved — make sure these are really the same person before merging.
                </div>
              )}
              <button style={S.primary} onClick={confirmMerge}>Merge {otherDisplayName} into {displayName}</button>
              <button style={S.ghost} onClick={() => setMergePreview(null)}>Cancel</button>
            </div>
          )}

          {!mergePicker && !mergePreview && !confirmRelease && (
            <button style={{ ...S.ghost, marginTop: 22, borderTop: `1px solid ${LINE}`, paddingTop: 20, color: EMBER }} onClick={() => setConfirmRelease(true)}>
              Release {displayName}
            </button>
          )}

          {confirmRelease && (
            <div style={{ marginTop: 22, borderTop: `1px solid ${LINE}`, paddingTop: 20 }}>
              <div style={{ ...S.body, color: EMBER, fontSize: 12.5, marginBottom: 12 }}>
                Let {displayName} go? Everything kept for them will be removed from your account. This can't be undone after a little while.
              </div>
              <button style={{ ...S.primary, background: EMBER }} onClick={releasePerson}>Yes, release them</button>
              <button style={S.ghost} onClick={() => setConfirmRelease(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={S.shell}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500&display=swap');
        textarea::placeholder,input::placeholder{color:#B0A692}
        @keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
        @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>

      <header style={S.head}>
        <div style={S.mark}>Noticed</div>
        <nav style={S.nav}>
          <button style={S.nb(view === "keep")} onClick={() => setView("keep")}>Keep</button>
          <button style={S.nb(view === "today")} onClick={() => setView("today")}>Today</button>
          <button style={S.nb(view === "people")} onClick={() => setView("people")}>People</button>
          <button style={S.nb(false)} onClick={handleSignOut}>Sign out</button>
        </nav>
      </header>

      {saveError && (
        <div style={{ margin: "0 20px 16px", padding: "10px 14px", background: "#B4603A14", border: `1px solid ${EMBER}`, borderRadius: 4, color: EMBER, fontSize: 12.5 }}>
          {saveError}
        </div>
      )}

      {undo && (
        <div style={{ margin: "0 20px 16px", padding: "10px 14px", background: "#7A5C6E14", border: `1px solid ${DEEP}`, borderRadius: 4, color: DEEP, fontSize: 12.5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{undo.message}</span>
          <button style={{ background: "none", border: "none", color: DEEP, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }} onClick={handleUndo}>Undo</button>
        </div>
      )}

      {view === "keep" && !kept && (
        <div style={S.card}>
          <div style={S.greet}>{timeword}, {db.user}.</div>
          {db.people.length === 1 && !(db.people[0].threads || []).length ? (
            <div style={{ ...S.serif, margin: "10px 0 24px", color: INK_SOFT }}>
              Tell me about {db.people[0].label || db.people[0].name}. What's happening with them lately?
            </div>
          ) : (
            <div style={{ ...S.serif, margin: "10px 0 24px", color: INK_SOFT }}>Who was on your heart?</div>
          )}
          {supported && (
            <button style={S.mic(listening)} onClick={listening ? stop : listen}>{listening ? "Listening" : "Speak"}</button>
          )}
          <textarea style={S.ta} placeholder={supported ? "…or type it, if you'd rather" : "Type what happened"} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
          <div style={{ ...S.body, fontSize: 12.5, color: FAINT, marginTop: 12 }}>Nothing is asked of you here. People appear by being mentioned.</div>
          {working && <div style={{ ...S.body, color: EMBER, marginTop: 14 }}>{working}</div>}
          <button style={S.primary} onClick={keep} disabled={!transcript.trim()}>Keep this</button>
        </div>
      )}

      {view === "keep" && kept && (
        <div style={{ ...S.card, animation: "fade .5s ease" }}>
          <div style={S.eyebrow}>Kept</div>
          <div style={{ ...S.serif, marginBottom: 18 }}>{kept.length ? `${kept.join(", ")}, remembered.` : "Remembered."}</div>
          <div style={S.body}>Nothing to do now. Something will come to you when it's the right moment.</div>
          <button style={S.ghost} onClick={() => setKept(null)}>Tell it something else</button>
        </div>
      )}

      {view === "today" && !db.people.length && (
        <div style={S.card}>
          <div style={S.name}>Nobody yet</div>
          <div style={S.body}>Tell it about your week and the people will appear on their own.</div>
          <button style={S.primary} onClick={() => setView("keep")}>Talk about your week</button>
        </div>
      )}

      {view === "today" && db.people.length > 0 && !g && (
        <div style={S.card}>
          <div style={S.eyebrow}>{working ? "…" : "Today"}</div>
          <div style={{ ...S.serif, marginBottom: 16 }}>{working ? "Thinking about someone…" : "Nothing today."}</div>
          {!working && <div style={S.body}>That's allowed. It'll come when there's a reason.</div>}
        </div>
      )}

      {view === "today" && g && (
        <>
          <div style={{ ...S.card, animation: "fade .6s ease" }}>
            <div style={{ ...S.eyebrow, color: g.kind === "anniversary" || g.kind === "birthday" ? DEEP : FAINT }}>
              {g.kind === "anniversary" ? "Nobody else will remember today" : g.kind === "birthday" ? g.reason : g.kind === "event" ? "This is happening to them now" : g.kind === "drift" ? g.reason : "No reason at all"}
            </div>
            <div style={S.name}>{g.name}</div>
            <div style={{ ...S.serif, marginTop: 8 }}>“{g.why}”</div>
            <div style={S.label}>What to do</div>
            <div style={S.body}>{g.act}</div>
            <div style={S.label}>Worth naming</div>
            {(g.worthNaming || []).map((w, i) => <div key={i} style={S.frag}>{w}</div>)}
            <div style={{ ...S.body, fontSize: 12.5, color: FAINT, marginTop: 10, fontStyle: "italic" }}>The words are yours. This is only what's worth remembering.</div>
            <div style={S.label}>If you're braver today</div>
            <div style={S.body}>{g.deeper}</div>
            {g.object && (<><div style={{ ...S.label, color: FAINT }}>Or send something</div><div style={{ ...S.body, color: FAINT }}>{g.object}</div></>)}
            <div style={S.label}>How did it land?</div>
            <input style={{ ...S.ta, minHeight: 0, marginTop: 0, padding: "12px 14px" }} placeholder="However it went, if you'd like to remember it" value={note} onChange={(e) => setNote(e.target.value)} />
            <button style={S.primary} onClick={done}>I did it</button>
            <button style={S.ghost} onClick={async () => await persist({ ...db, gesture: null, restedOn: TODAY() })}>Not today</button>
          </div>
          <p style={{ ...S.body, padding: "4px 26px", fontSize: 12.5, color: FAINT }}>One person. Never a list. Never a guilt trip.</p>
        </>
      )}

      {view === "people" && (
        <div style={S.card}>
          <div style={S.eyebrow}>{db.people.length ? "Your people" : "Nobody yet"}</div>
          {db.people.map((p) => (
            <div key={p.id} style={S.row} onClick={() => openEditing(p)}>
              <div style={{ paddingRight: 14 }}>
                <div style={{ fontSize: 17, marginBottom: 3, fontFamily: "'Instrument Serif',Georgia,serif" }}>
                  {p.label || p.name}
                </div>
                <div style={{ fontSize: 12.5, color: FAINT, lineHeight: 1.45 }}>{p.who}</div>
                {p.birthday && <div style={{ fontSize: 12, color: DEEP, marginTop: 4 }}>🎂 {new Date(p.birthday).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</div>}
                {p.hardDates?.length > 0 && <div style={{ fontSize: 12, color: DEEP, marginTop: 4 }}>{p.hardDates[0].what}</div>}
                {p.threads?.length > 0 && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 6, fontStyle: "italic" }}>"{p.threads[p.threads.length - 1]}"</div>}
              </div>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", color: DAYS(p.last) > 21 ? DEEP : FAINT, whiteSpace: "nowrap" }}>{DAYS(p.last)}d</div>
            </div>
          ))}
          {db.people.length > 0 && <div style={{ ...S.body, fontSize: 12, color: FAINT, marginTop: 14 }}>Tap anyone to add a nickname or their birthday.</div>}
        </div>
      )}
    </div>
  );
}
