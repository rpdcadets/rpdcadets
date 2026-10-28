/* awards.js  |  Build v1  |  updated 2026-10-28  |  Cadet awards, shared by /admin (Awards tool) and the Trackers cadet PDF.
   The 21-award list (PSC proficiency awards as the unit applies them, the Congressional Award, and the four RPD unit
   awards), the event buckets that feed the counted awards, and one compute() that turns a cadet's attendance,
   logged events, roster join date, and the advisor's award ledger into a status per award. Rules (Tony, 10/28/26):
   Law Enforcement Training 60 hrs, Community Service 100 hrs, and Law Enforcement Service 100 hrs accumulate from
   the day the cadet joined and are earned once; weekly meetings marked Present count 3 hrs toward Training.
   Crime Prevention is 4 crime prevention events per calendar year. Physical Fitness is a better rowing percentage
   at the end of the calendar year than at the start. Perfect Attendance is a full membership year (join date to
   anniversary) with no unexcused absence; excused absences are fine. Tenure is one year, a silver star for each
   added year, gold at five. Drug Abuse Prevention is 6 hrs of training plus 50 service hrs in two different
   projects. Everything else is recorded by the advisor with the date presented. Data: roster/awards, see roster.js
   VERSION 37. Nothing here touches Firebase; the pages pass the data in. */
(function (global) {
  'use strict';

  const BUILD = 1;
  const MEETING_HOURS = 3;

  /* ── Event buckets. One bucket per event name; 'crime+drug' counts for both. ── */
  const BUCKETS = [
    ['train', 'Law Enforcement Training hours'],
    ['comm', 'Community Service hours'],
    ['serv', 'Law Enforcement Service hours'],
    ['crime', 'Crime Prevention event'],
    ['crime+drug', 'Crime Prevention event, hours also count for Drug Abuse Prevention'],
    ['drug', 'Drug Abuse Prevention hours'],
    ['cgPD', 'Congressional Award: Personal Development'],
    ['cgPF', 'Congressional Award: Physical Fitness'],
    ['cgEX', 'Congressional Award: Expedition/Exploration'],
    ['none', 'Not counted toward an award']
  ];
  const BUCKET_LABEL = {}; BUCKETS.forEach(b => { BUCKET_LABEL[b[0]] = b[1]; });

  // Starting map for the unit's event names (Tony, 10/28/26). The advisor can change any of these in /admin.
  const DEFAULT_BUCKETS = {
    'bi-weekly': 'train', 'competition related': 'train', 'ride along academy': 'train', 'swat camp': 'train',
    'christmas parade': 'comm', 'cottonwood arts festival': 'comm', 'gobble hobble': 'comm', 'july 4th': 'comm',
    'risd football': 'comm', "santa's village": 'comm', 'summer safety camp': 'comm', 'wildflower festival': 'comm',
    'criminal investigations division | service hours': 'serv', 'ride along | service hours': 'serv', 'uas drone unit': 'serv',
    'service hours | communications division': 'serv', 'service hours | crime scene unit': 'serv', 'service hours | desk officer': 'serv',
    'service hours | detention': 'serv', 'service hours | drone as first responder (dfr)': 'serv',
    'service hours | property & evidence': 'serv', 'service hours | records unit': 'serv',
    'national night out (nno)': 'crime', 'drug take back': 'crime+drug', 'cpaaa support': 'crime', 'youth citizen police academy': 'crime',
    'public safety expo': 'crime', 'recycle event': 'crime', 'unidos': 'crime',
    'congressional award | expedition/exploration': 'cgEX', 'congressional award | personal development': 'cgPD',
    'congressional award | physical fitness': 'cgPF',
    'banquet': 'none',
    'red cross - emergency first responder award - aed': 'none', 'red cross - emergency first responder award - cpr': 'none',
    'red cross - emergency first responder award - first aid': 'none'
  };

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  }
  // bucket for an event name: the advisor's map first, then the starting map, else none
  function bucketOf(name, buckets) {
    const n = norm(name); if (!n) return 'none';
    if (buckets && Object.prototype.hasOwnProperty.call(buckets, n)) return buckets[n] || 'none';
    return DEFAULT_BUCKETS[n] || 'none';
  }
  function bucketHas(b, key) { return String(b || 'none').split('+').indexOf(key) >= 0; }
  function isRedCross(name, part) { const n = norm(name); return n.indexOf('red cross') >= 0 && n.indexOf(part) >= 0; }

  /* ── The awards, in the order they print. how: hours | drug | congress | year | fitness | anniv | tenure | manual ── */
  const AWARDS = [
    { key: 'train', name: 'Law Enforcement Training', group: 'psc', how: 'hours', target: 60, ribbon: ['#c0392b', '#1f4e9c'],
      req: '60 hours of training, accumulated from the day the cadet joined.',
      fill: 'Weekly meetings marked Present (3 hrs each), Bi-Weekly, Competition Related, Ride Along Academy, SWAT Camp.' },
    { key: 'comm', name: 'Community Service', group: 'psc', how: 'hours', target: 100, ribbon: ['#1f4e9c', '#f1c40f'],
      req: '100 hours of community service, accumulated. Crime prevention events and department service hours do not count here.',
      fill: 'Christmas Parade, Cottonwood Arts Festival, Gobble Hobble, July 4th, RISD Football, Santa\'s Village, Summer Safety Camp, Wildflower Festival.' },
    { key: 'serv', name: 'Law Enforcement Service', group: 'psc', how: 'hours', target: 100, ribbon: ['#c0392b', '#d4a952'],
      req: '100 hours of service to the department, accumulated: records, communications, property and evidence, detention, ride-alongs, and similar.',
      fill: 'Criminal Investigations Division | Service Hours, Ride Along | Service Hours, UAS Drone Unit, and every Service Hours | entry (Communications Division, Crime Scene Unit, Desk Officer, Detention, Drone as First Responder, Property & Evidence, Records Unit).' },
    { key: 'drug', name: 'Drug Abuse Prevention', group: 'psc', how: 'drug', target: 50, projects: 2, ribbon: ['#1f4e9c', '#bdc3c7'],
      req: '6 hours of drug abuse prevention training plus 50 hours of service in at least two different drug abuse prevention projects.',
      fill: 'Drug Take Back (hours also count here). The training hours are recorded by the advisor.' },
    { key: 'congress', name: 'Congressional Award', group: 'psc', how: 'congress', ribbon: ['#cd7f32', '#bdc3c7', '#d4a952'],
      req: 'Certified by the Congressional Award program, cumulative from the cadet\'s registration. Hours in Voluntary Public Service, Personal Development, and Physical Fitness plus an Expedition/Exploration: Bronze certificate 30/15/15 hrs and 1 day; Silver 60/30/30 and 2 days; Gold 90/45/45, 3 days, 6 months; Bronze medal 100/50/50, 2 days 1 night, 7 months; Silver medal 200/100/100, 3 days 2 nights, 12 months; Gold medal 400/200/200, 5 days 4 nights, 24 months.',
      fill: 'Congressional Award | Personal Development, | Physical Fitness, | Expedition/Exploration. Public Service is the Community Service and Law Enforcement Service hours.' },
    { key: 'crime', name: 'Crime Prevention', group: 'psc', how: 'year', target: 4, ribbon: ['#1e8449', '#d4a952'],
      req: 'Four crime prevention events in the calendar year.',
      fill: 'National Night Out, Drug Take Back, CPAAA Support, Youth Citizen Police Academy, Public Safety Expo, Recycle Event, UNIDOS.' },
    { key: 'fitness', name: 'Physical Fitness', group: 'psc', how: 'fitness', ribbon: ['#c0392b', '#f1c40f', '#1f4e9c', '#1e8449'],
      req: 'A rowing percentage recorded at the start of the calendar year and again at the end; a higher percentage at the end earns it.',
      fill: 'Rowing log kept by the advisor on the cadet\'s awards card.' },
    { key: 'attendance', name: 'Perfect Attendance', group: 'psc', how: 'anniv', ribbon: ['#f1c40f', '#ffffff'],
      req: 'A full year of membership, from the join date to the anniversary, with no unexcused absence at a weekly meeting. Excused absences are fine. Checked again every anniversary year.',
      fill: 'Weekly attendance tracker.' },
    { key: 'tenure', name: 'Tenure', group: 'psc', how: 'tenure', ribbon: ['#c0392b'],
      req: 'One year of satisfactory service from the join date. A silver star for each additional year; a gold star at five years.',
      fill: 'Roster join date.' },
    { key: 'outstanding', name: 'Outstanding Cadet/Cadet of The Year', group: 'psc', how: 'manual', ribbon: ['#1f4e9c'],
      req: 'One cadet each year, selected on dependability, attitude, attendance, and contributions to the unit, department, and community.', fill: 'Selected by the advisors.' },
    { key: 'chief', name: 'Chief\'s Award', group: 'psc', how: 'manual', ribbon: ['#d4a952'],
      req: 'An outstanding contribution to the Public Safety Cadets program or the community, on the recommendation of the Chief of Police.', fill: 'Recorded by the advisor.' },
    { key: 'conference', name: 'National Conference', group: 'psc', how: 'manual', ribbon: ['#145a32'],
      req: 'Attended a National Public Safety Cadets Conference.', fill: 'Recorded by the advisor.' },
    { key: 'nla', name: 'National Leadership Academy', group: 'psc', how: 'manual', ribbon: ['#111111'],
      req: 'Competitively selected for and completed a National Leadership Academy certified by the PSC National Committee, Law Enforcement Sector. Black bar with a torch attachment.', fill: 'Recorded by the advisor.' },
    { key: 'academy', name: 'Training Academy', group: 'psc', how: 'manual', ribbon: ['#1f4e9c', '#f1c40f', '#95a5a6', '#c0392b'],
      req: 'Attended a Unit, State, or Regional Training Academy of at least forty consecutive hours of training sanctioned by Public Safety Cadets.', fill: 'Recorded by the advisor.' },
    { key: 'emergency', name: 'Emergency Preparedness', group: 'psc', how: 'manual', ribbon: ['#c0392b', '#ffffff'],
      req: 'Training in advanced first aid and CPR, training in how the unit would assist in a disaster (flood, tornado, hurricane), and at least one civil defense or community-wide disaster training exercise.',
      fill: 'Recorded by the advisor; the card shows whether the Red Cross AED, CPR, and First Aid events are logged.' },
    { key: 'firearms', name: 'Firearms Safety Training', group: 'psc', how: 'manual', levels: ['Marksman', 'Sharpshooter', 'Expert', 'Distinguished'], ribbon: ['#cd7f32', '#bdc3c7', '#d4a952'],
      req: 'Eight hours of firearms safety training and a demonstration of safe and proper handling under the PSC Law Enforcement Sector firearms certification program. PSC Marksmanship bar: Marksman (bronze), Sharpshooter (silver), Expert (gold), or Distinguished.', fill: 'Recorded by the advisor with the level reached.' },
    { key: 'marksman', name: 'Competitive Marksmanship Distinction', group: 'psc', how: 'manual', levels: ['1st place (gold)', '2nd place (silver)', '3rd place (bronze)'], ribbon: ['#d4a952', '#bdc3c7', '#cd7f32'],
      req: 'Safe and proper handling of firearms while placing first, second, or third in a competitive marksmanship event, individual or team. Gold, silver, or bronze; a silver star for each repeat, gold at five.', fill: 'Recorded by the advisor with the place.' },
    { key: 'leadership', name: 'Cadet Leadership Excellence Award', group: 'rpd', how: 'manual', ribbon: ['#c0392b', '#ffffff', '#1f4e9c'],
      req: 'A specific contribution to improving and growing the unit through leadership: policies and procedures, training programs, recruiting, fundraisers, and other lasting work. Selected by the advisors and the advisory committee. Red, white, and blue bar with a gold border.', fill: 'Recorded by the advisor.' },
    { key: 'academic', name: 'Academic Achievement Award', group: 'rpd', how: 'manual', ribbon: ['#f1c40f', '#1f4e9c', '#c0392b'],
      req: 'A 4.0 grade point average for an entire academic year or two full semesters while in good standing and active with the unit.', fill: 'Recorded by the advisor.' },
    { key: 'ridealong', name: 'Ride-Along Certification Award', group: 'rpd', how: 'manual', ribbon: ['#d2b48c'],
      req: 'Completion of the Richardson Police Department Ride-Along Certification Course. Tan bar with a gold star.', fill: 'Recorded by the advisor; Ride Along Academy hours show as a hint.' },
    { key: 'efr', name: 'Emergency First Responder Award', group: 'rpd', how: 'manual', ribbon: ['#c0392b', '#ffffff', '#1f4e9c'],
      req: 'American Red Cross Professional Rescuer First Aid, CPR, and AED certification. Red, white, and blue bar with a red cross.',
      fill: 'Shows ready once the Red Cross AED, CPR, and First Aid events are all logged; the advisor records the date presented.' }
  ];
  const BY_KEY = {}; AWARDS.forEach(a => { BY_KEY[a.key] = a; });

  const CONGRESS = [
    ['Bronze Certificate', 30, 15, 15], ['Silver Certificate', 60, 30, 30], ['Gold Certificate', 90, 45, 45],
    ['Bronze Medal', 100, 50, 50], ['Silver Medal', 200, 100, 100], ['Gold Medal', 400, 200, 200]
  ];

  /* ── date helpers (ISO strings, local calendar) ── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayIso() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isIso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function addYears(iso, n) {
    if (!isIso(iso)) return '';
    const y = +iso.slice(0, 4) + n, m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    const last = new Date(y, m, 0).getDate();            // clamp Feb 29 to Feb 28
    return y + '-' + pad(m) + '-' + pad(Math.min(d, last));
  }
  function dayBefore(iso) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmt(iso) { if (!isIso(iso)) return iso || ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fmtH(n) { n = Math.round((Number(n) || 0) * 10) / 10; return (n % 1 === 0) ? String(n) : n.toFixed(1); }
  function yearOf(iso) { return isIso(iso) ? +iso.slice(0, 4) : null; }

  /* ── ledger helpers: entry = { earned:[{key,on,year,lvl,note,by,at}], flags:{}, rows:[{on,pct}] } ── */
  function blankEntry() { return { earned: [], flags: {}, rows: [] }; }
  function entryOf(ledger, name) {
    const e = (ledger && ledger.people && ledger.people[name]) || null;
    const out = blankEntry();
    if (e) { if (Array.isArray(e.earned)) out.earned = e.earned.slice(); if (e.flags && typeof e.flags === 'object') out.flags = Object.assign({}, e.flags); if (Array.isArray(e.rows)) out.rows = e.rows.slice(); }
    return out;
  }
  function presentedFor(entry, key, year) {
    return (entry.earned || []).filter(x => x && x.key === key && (year == null || String(x.year || '') === String(year)))
      .slice().sort((a, b) => String(a.on || '').localeCompare(String(b.on || '')));
  }

  /* ── compute: one cadet, every award ──
       opts: { p (roster entry), roll (attendance rollup entry, all time), buckets, ledger, year, today, sessionsFrom }
       roll.meetings: [{date,status}] marked meetings; roll.events: this cadet's logged events; roll.present: count */
  function compute(opts) {
    const p = opts.p || {}, roll = opts.roll || { meetings: [], events: [], present: 0 };
    const buckets = opts.buckets || {}, today = isIso(opts.today) ? opts.today : todayIso();
    const year = opts.year || +today.slice(0, 4);
    const entry = opts.entry || entryOf(opts.ledger, p.name);
    const events = (roll.events || []).filter(e => e && isIso(e.date));
    const evBucket = e => bucketOf(e.event, buckets);
    const hoursIn = key => Math.round(events.filter(e => bucketHas(evBucket(e), key)).reduce((a, e) => a + (Number(e.hours) || 0), 0) * 100) / 100;
    const join = isIso(p.joinDate) ? p.joinDate : '';
    const out = [];

    AWARDS.forEach(a => {
      const r = { key: a.key, name: a.name, group: a.group, how: a.how, levels: a.levels || null, ribbon: a.ribbon, state: 'none', pct: null, line: '', detail: '', presented: [], ready: false, year: null, progress: null };
      if (a.how === 'hours') {
        const extra = hoursIn(a.key);
        const meet = a.key === 'train' ? (Number(roll.present) || 0) * MEETING_HOURS : 0;
        const hrs = Math.round((extra + meet) * 100) / 100;
        r.progress = { hours: hrs, meetingHours: meet, eventHours: extra, target: a.target };
        r.pct = Math.min(100, Math.round(hrs / a.target * 100));
        r.presented = presentedFor(entry, a.key);
        if (r.presented.length) { r.state = 'presented'; r.line = 'Presented ' + fmt(r.presented[0].on); r.detail = fmtH(hrs) + ' hrs on record'; }
        else if (hrs >= a.target) { r.state = 'earned'; r.ready = true; r.line = fmtH(hrs) + ' of ' + a.target + ' hrs, earned'; r.detail = 'Not yet presented'; }
        else { r.state = r.pct >= 75 ? 'close' : (hrs > 0 ? 'progress' : 'none'); r.line = fmtH(hrs) + ' of ' + a.target + ' hrs'; r.detail = fmtH(a.target - hrs) + ' to go'; }
        if (a.key === 'train' && hrs > 0) r.detail += (r.detail ? ' (' : '(') + (roll.present || 0) + ' meetings = ' + fmtH(meet) + ' hrs, events ' + fmtH(extra) + ' hrs)';
      }
      else if (a.how === 'drug') {
        const list = events.filter(e => bucketHas(evBucket(e), 'drug'));
        const hrs = Math.round(list.reduce((s, e) => s + (Number(e.hours) || 0), 0) * 100) / 100;
        const projects = Array.from(new Set(list.map(e => norm(e.event)))).length;
        const trained = !!(entry.flags && entry.flags.drugTraining);
        r.progress = { hours: hrs, target: a.target, projects, projectsTarget: a.projects, trained, trainedOn: trained ? entry.flags.drugTraining : '' };
        r.pct = Math.min(100, Math.round(hrs / a.target * 100));
        r.presented = presentedFor(entry, a.key);
        const parts = [fmtH(hrs) + ' of ' + a.target + ' hrs', projects + ' of ' + a.projects + ' projects', trained ? 'training done' : 'training not recorded'];
        if (r.presented.length) { r.state = 'presented'; r.line = 'Presented ' + fmt(r.presented[0].on); r.detail = parts.join(', '); }
        else if (hrs >= a.target && projects >= a.projects && trained) { r.state = 'earned'; r.ready = true; r.line = 'Earned'; r.detail = parts.join(', '); }
        else { r.state = (hrs > 0 || trained) ? (r.pct >= 75 && projects >= a.projects ? 'close' : 'progress') : 'none'; r.line = parts.join(', '); r.detail = ''; }
      }
      else if (a.how === 'congress') {
        const ps = Math.round((hoursIn('comm') + hoursIn('serv')) * 100) / 100, pd = hoursIn('cgPD'), pf = hoursIn('cgPF'), ex = hoursIn('cgEX');
        let level = null; CONGRESS.forEach(L => { if (ps >= L[1] && pd >= L[2] && pf >= L[3]) level = L[0]; });
        r.progress = { ps, pd, pf, ex, level };
        r.presented = presentedFor(entry, a.key);
        r.state = r.presented.length ? 'presented' : 'info';
        const hrs = 'Public Service ' + fmtH(ps) + ', Personal Development ' + fmtH(pd) + ', Physical Fitness ' + fmtH(pf) + ' hrs';
        r.line = r.presented.length ? r.presented.map(x => (x.lvl || 'Award') + ' ' + fmt(x.on)).join('; ') : ((level ? level + ' hours met: ' : 'Below Bronze certificate hours: ') + hrs);
        r.detail = (r.presented.length ? hrs + '. ' : '') + 'Expedition ' + fmtH(ex) + ' hrs logged; expedition days and the minimum months are not tracked here.';
      }
      else if (a.how === 'year') {
        const list = events.filter(e => yearOf(e.date) === year && bucketHas(evBucket(e), 'crime'));
        const dates = Array.from(new Set(list.map(e => e.date))).sort();
        r.year = year;
        r.progress = { count: dates.length, target: a.target, dates, names: list.map(e => e.event) };
        r.pct = Math.min(100, Math.round(dates.length / a.target * 100));
        r.presented = presentedFor(entry, a.key, year);
        const all = presentedFor(entry, a.key);
        if (r.presented.length) { r.state = 'presented'; r.line = 'Presented ' + fmt(r.presented[0].on) + ' for ' + year; r.detail = dates.length + ' events in ' + year; }
        else if (dates.length >= a.target) { r.state = 'earned'; r.ready = true; r.line = dates.length + ' of ' + a.target + ' events in ' + year + ', earned'; r.detail = 'Not yet presented'; }
        else { r.state = dates.length >= a.target - 1 ? 'close' : (dates.length ? 'progress' : 'none'); r.line = dates.length + ' of ' + a.target + ' events in ' + year; r.detail = (a.target - dates.length) + ' to go'; }
        if (all.length) r.history = all.map(x => x.year).filter(Boolean);
      }
      else if (a.how === 'fitness') {
        const rows = (entry.rows || []).filter(x => x && isIso(x.on) && yearOf(x.on) === year && x.pct !== '' && x.pct != null && !isNaN(Number(x.pct)))
          .slice().sort((x, y) => x.on.localeCompare(y.on));
        r.year = year;
        const first = rows[0] || null, last = rows.length > 1 ? rows[rows.length - 1] : null;
        r.progress = { rows, first, last };
        r.presented = presentedFor(entry, a.key, year);
        if (r.presented.length) { r.state = 'presented'; r.line = 'Presented ' + fmt(r.presented[0].on) + ' for ' + year; r.detail = first && last ? fmtH(first.pct) + '% to ' + fmtH(last.pct) + '%' : ''; }
        else if (!first) { r.state = 'none'; r.line = 'No rowing percentage recorded for ' + year; r.detail = 'Record the first row of the year, then the retest.'; }
        else if (!last) { r.state = 'progress'; r.pct = 50; r.line = 'Baseline ' + fmtH(first.pct) + '% on ' + fmt(first.on); r.detail = 'Retest due by Dec 31, ' + year; }
        else if (Number(last.pct) > Number(first.pct)) { r.state = 'earned'; r.ready = true; r.pct = 100; r.line = 'Improved ' + fmtH(first.pct) + '% to ' + fmtH(last.pct) + '%, earned'; r.detail = fmt(first.on) + ' to ' + fmt(last.on) + ', not yet presented'; }
        else { r.state = 'progress'; r.pct = 50; r.line = fmtH(first.pct) + '% to ' + fmtH(last.pct) + '%, no improvement yet'; r.detail = 'Latest row ' + fmt(last.on) + '; another row before Dec 31 can still earn it.'; }
      }
      else if (a.how === 'anniv') {
        r.presented = presentedFor(entry, a.key);
        const meetings = (roll.meetings || []).filter(m => m && isIso(m.date));
        const from = isIso(opts.sessionsFrom) ? opts.sessionsFrom : '';
        if (!join) { r.state = 'none'; r.line = 'No join date on the roster'; r.detail = 'Add the join date in the Roster Editor.'; }
        else {
          const years = [];
          for (let i = 0; ; i++) {
            const start = addYears(join, i), end = addYears(join, i + 1);
            if (start > today) break;
            const inYear = meetings.filter(m => m.date >= start && m.date < end);
            const unex = inYear.filter(m => m.status === 'unexcused'), rec = inYear.filter(m => m.status !== 'none');
            const done = end <= today;
            const covered = !!from && from <= start;
            let st, note;
            if (!done) { st = unex.length ? 'broken' : 'ontrack'; note = unex.length ? 'Unexcused ' + fmt(unex[0].date) : (rec.length + ' meetings marked, none unexcused'); }
            else if (unex.length) { st = 'missed'; note = 'Unexcused ' + unex.map(m => fmt(m.date)).join(', '); }
            else if (!covered || !rec.length) { st = 'check'; note = rec.length ? 'Records begin ' + fmt(from) + ', after this year started; no unexcused in the ' + rec.length + ' meetings on file' : 'No attendance on file for this year'; }
            else { st = 'earned'; note = rec.length + ' meetings on file, none unexcused'; }
            const pres = presentedFor(entry, a.key, +end.slice(0, 4)).concat(presentedFor(entry, a.key, 'Y' + (i + 1)));
            years.push({ n: i + 1, start, end, last: dayBefore(end), done, st, note, unexcused: unex.length, recorded: rec.length, presented: pres, label: +end.slice(0, 4) });
            if (years.length > 25) break;
          }
          r.progress = { years, join };
          const cur = years[years.length - 1];
          const readyYears = years.filter(y => y.done && y.st === 'earned' && !y.presented.length);
          const presentedYears = years.filter(y => y.presented.length);
          r.year = cur ? cur.label : null;
          if (readyYears.length) { r.state = 'earned'; r.ready = true; r.line = 'Year ' + readyYears.map(y => y.n).join(', ') + ' earned, not yet presented'; r.detail = readyYears.map(y => fmt(y.start) + ' to ' + fmt(y.last)).join('; '); }
          else if (cur && !cur.done) {
            r.state = cur.st === 'ontrack' ? (presentedYears.length ? 'presented' : 'progress') : 'none';
            const elapsed = Math.max(0, Math.min(1, (new Date(today + 'T12:00:00') - new Date(cur.start + 'T12:00:00')) / (new Date(cur.end + 'T12:00:00') - new Date(cur.start + 'T12:00:00'))));
            r.pct = cur.st === 'ontrack' ? Math.round(elapsed * 100) : 0;
            r.line = (cur.st === 'ontrack' ? 'On track, year ' + cur.n + ' ends ' + fmt(cur.last) : 'Not this year: ' + cur.note);
            r.detail = cur.st === 'ontrack' ? cur.note : ('Year ' + cur.n + ' runs ' + fmt(cur.start) + ' to ' + fmt(cur.last));
            if (presentedYears.length) r.line = 'Presented for ' + presentedYears.map(y => y.label).join(', ') + '; ' + r.line.charAt(0).toLowerCase() + r.line.slice(1);
          }
          else if (presentedYears.length) { r.state = 'presented'; r.line = 'Presented for ' + presentedYears.map(y => y.label).join(', '); r.detail = ''; }
          else { r.state = 'none'; r.line = cur ? ('Year ' + cur.n + ': ' + cur.note) : 'Nothing on file'; r.detail = ''; }
          const checks = years.filter(y => y.done && y.st === 'check' && !y.presented.length);
          if (checks.length && r.state !== 'earned') r.detail = (r.detail ? r.detail + '. ' : '') + 'Year ' + checks.map(y => y.n).join(', ') + ' needs a manual check: ' + checks[0].note;
        }
      }
      else if (a.how === 'tenure') {
        r.presented = presentedFor(entry, a.key);
        if (!join) { r.state = 'none'; r.line = 'No join date on the roster'; r.detail = 'Add the join date in the Roster Editor.'; }
        else {
          let yrs = 0; while (addYears(join, yrs + 1) <= today && yrs < 60) yrs++;
          const next = addYears(join, yrs + 1);
          const stars = yrs >= 5 ? 'gold star' : (yrs > 1 ? (yrs - 1) + ' silver star' + (yrs > 2 ? 's' : '') : '');
          const device = yrs < 1 ? '' : (stars ? 'bar with ' + stars : 'bar');
          r.progress = { years: yrs, next, join, device };
          const have = r.presented.map(x => Number(x.year) || 0);
          const maxPres = have.length ? Math.max.apply(null, have) : 0;
          const elapsed = Math.max(0, Math.min(1, (new Date(today + 'T12:00:00') - new Date(addYears(join, yrs) + 'T12:00:00')) / (new Date(next + 'T12:00:00') - new Date(addYears(join, yrs) + 'T12:00:00'))));
          if (yrs < 1) { r.state = 'progress'; r.pct = Math.round(elapsed * 100); r.line = 'First anniversary ' + fmt(next); r.detail = 'Joined ' + fmt(join); }
          else if (maxPres >= yrs) { r.state = 'presented'; r.line = 'Presented for year ' + maxPres + ' (' + device + ')'; r.detail = 'Next anniversary ' + fmt(next); }
          else { r.state = 'earned'; r.ready = true; r.line = yrs + ' year' + (yrs > 1 ? 's' : '') + ' completed, ' + device; r.detail = (maxPres ? 'Presented through year ' + maxPres + '; year ' : 'Year ') + yrs + ' not yet presented. Next anniversary ' + fmt(next); }
          r.year = yrs;
        }
      }
      else {   // manual
        r.presented = presentedFor(entry, a.key);
        if (a.key === 'efr' || a.key === 'emergency') {
          const has = part => events.some(e => isRedCross(e.event, part));
          const parts = [['aed', 'AED'], ['cpr', 'CPR'], ['first aid', 'First Aid']];
          const got = parts.filter(x => has(x[0])).map(x => x[1]);
          r.progress = { redCross: got };
          const rc = got.length ? 'Red Cross logged: ' + got.join(', ') : 'No Red Cross events logged';
          if (r.presented.length) { r.state = 'presented'; r.line = 'Presented ' + r.presented.map(x => fmt(x.on)).join(', '); r.detail = rc; }
          else if (a.key === 'efr' && got.length === 3) { r.state = 'earned'; r.ready = true; r.line = 'Ready: AED, CPR, and First Aid all logged'; r.detail = 'Not yet presented'; }
          else { r.state = 'manual'; r.line = 'Not yet awarded'; r.detail = rc + (a.key === 'emergency' ? '. Disaster training and the exercise are recorded by the advisor.' : ''); }
        } else if (a.key === 'ridealong') {
          const hrs = Math.round(events.filter(e => norm(e.event) === 'ride along academy').reduce((s, e) => s + (Number(e.hours) || 0), 0) * 100) / 100;
          r.progress = { academyHours: hrs };
          if (r.presented.length) { r.state = 'presented'; r.line = 'Presented ' + r.presented.map(x => fmt(x.on)).join(', '); r.detail = ''; }
          else { r.state = 'manual'; r.line = 'Not yet awarded'; r.detail = hrs ? 'Ride Along Academy: ' + fmtH(hrs) + ' hrs logged' : 'No Ride Along Academy hours logged'; }
        } else {
          if (r.presented.length) { r.state = 'presented'; r.line = 'Presented ' + r.presented.map(x => (x.lvl ? x.lvl + ', ' : '') + fmt(x.on)).join('; '); r.detail = ''; }
          else { r.state = 'manual'; r.line = 'Not yet awarded'; r.detail = ''; }
        }
      }
      out.push(r);
    });
    return out;
  }

  function summary(list) {
    const s = { presented: 0, ready: 0, close: 0 };
    (list || []).forEach(r => { if (r.state === 'presented') s.presented++; if (r.ready) s.ready++; if (r.state === 'close') s.close++; });
    return s;
  }
  const STATE_LABEL = { presented: 'Presented', earned: 'Earned', close: 'Close', progress: 'In progress', none: 'Not started', manual: 'Not yet awarded', info: 'By hours' };
  function stateLabel(st) { return STATE_LABEL[st] || st; }

  // earliest recorded session date in an attendance map ({date: session})
  function sessionsFrom(attData) {
    let first = '';
    Object.values(attData || {}).forEach(s => { if (s && isIso(s.date) && !s.noMeeting && (!first || s.date < first)) first = s.date; });
    return first;
  }
  // the years worth offering in a year picker: from the earliest event, session, or join date to this year
  function yearsAvailable(opts) {
    const now = +todayIso().slice(0, 4);
    let lo = now;
    (opts.events || []).forEach(e => { const y = yearOf(e && e.date); if (y && y < lo) lo = y; });
    Object.values(opts.attData || {}).forEach(s => { const y = yearOf(s && s.date); if (y && y < lo) lo = y; });
    (opts.rosterJoins || []).forEach(j => { const y = yearOf(j); if (y && y < lo) lo = y; });
    const out = []; for (let y = now; y >= Math.max(lo, now - 12); y--) out.push(y);
    return out;
  }
  // ribbon swatch as inline SVG-free HTML (stripes side by side)
  function ribbonHtml(colors, w, h) {
    w = w || 40; h = h || 12;
    const cs = (colors && colors.length) ? colors : ['#888'];
    const seg = w / cs.length;
    return '<span class="aw-rib" style="display:inline-flex;width:' + w + 'px;height:' + h + 'px;border:1px solid rgba(255,255,255,0.35);border-radius:2px;overflow:hidden;vertical-align:middle">' +
      cs.map(c => '<i style="display:block;width:' + seg + 'px;height:' + h + 'px;background:' + c + '"></i>').join('') + '</span>';
  }

  global.RPDAwards = {
    BUILD, MEETING_HOURS, BUCKETS, BUCKET_LABEL, DEFAULT_BUCKETS, AWARDS, BY_KEY, CONGRESS,
    norm, bucketOf, bucketHas, compute, summary, stateLabel, entryOf, blankEntry, presentedFor,
    sessionsFrom, yearsAvailable, ribbonHtml, fmt, fmtH, todayIso, addYears, isIso
  };
})(typeof window !== 'undefined' ? window : globalThis);
