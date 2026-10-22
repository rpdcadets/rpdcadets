/* opr.js  |  Build v2  |  updated 2026-10-21  |  v2: Reviewer recommendation block (Proceed / Proceed with notes / Do not proceed, plus a reason) that whoever runs the review sets, shared with both panels and printed beside the advisor result. Build v1: Online Presence Review: the standardized social media and online presence check run on cadet applicants (the public-information part of the background check). One shared form and guide rendered on both /sgt (the one sergeant cleared for background checks, after the hidden unlock) and /admin (advisors). Holds the step list, the one-tap link builder (every search link is built from the name, handles, email, phone, and parent names typed in), the username variant generator, the twelve review categories, the household and public-records section, the activity trail, the How to run this check guide, and the letterhead PDF builder used by /admin. Data access is RPDRoster.vet (roster.js VERSION 33). Loaded only by sgt.html and admin.html with a ?v= cache-buster; bump it with every change. */
(function (global) {
  'use strict';

  const BUILD = 2;
  const PDF_LABEL = 'CADET/ONLINE V1';
  const CITY = 'Richardson';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const rand = p => p + '_' + Math.random().toString(36).slice(2, 9);
  const now = () => Date.now();
  function fmtWhen(ms) { if (!ms) return ''; const d = new Date(ms); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function fmtDate(ms) { if (!ms) return ''; const d = new Date(ms); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function cleanHandle(h) { return String(h || '').trim().replace(/^[@$]+/, '').replace(/\s+/g, ''); }
  function ageFrom(dob) {
    if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
    const p = dob.split('-').map(Number), t = new Date();
    let a = t.getFullYear() - p[0];
    if (t.getMonth() + 1 < p[1] || (t.getMonth() + 1 === p[1] && t.getDate() < p[2])) a--;
    return (a >= 0 && a < 120) ? a : null;
  }
  function nameParts(name) {
    const parts = String(name || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '', full: parts.join(' ') };
  }
  function gq(query, tbm) { return 'https://www.google.com/search?q=' + enc(query) + (tbm ? '&tbm=' + tbm : ''); }
  function bq(query) { return 'https://www.bing.com/search?q=' + enc(query); }
  const Q = s => '"' + String(s).replace(/"/g, '') + '"';

  /* ══════════ definitions ══════════ */
  // Every platform the form can hold. core: shown as a row from the start.
  // url(h) builds the profile link from the cleaned handle; extra() builds the
  // deeper links; how: the one-line instruction under the row.
  const PLATFORMS = [
    { k: 'instagram', label: 'Instagram', core: true, ph: 'username',
      url: h => 'https://www.instagram.com/' + enc(h) + '/',
      extra: h => [['Tagged', 'https://www.instagram.com/' + enc(h) + '/tagged/'], ['Reels', 'https://www.instagram.com/' + enc(h) + '/reels/'], ['Imginn (logged-out followers and tagged)', 'https://imginn.com/' + enc(h) + '/'], ['Wayback copies', 'https://web.archive.org/web/*/https://www.instagram.com/' + enc(h) + '*']],
      how: 'Bio and links, posts, Reels, highlights, tagged photos, comments they left, who they follow, who follows them, and the Suggested row. Scroll back two years or to the start.' },
    { k: 'tiktok', label: 'TikTok', core: true, ph: 'username',
      url: h => 'https://www.tiktok.com/@' + enc(h),
      extra: h => [['Wayback copies', 'https://web.archive.org/web/*/https://www.tiktok.com/@' + enc(h) + '*']],
      how: 'Videos, bio and link, the Liked, Following, and Reposts tabs when public, comments. View logged out or from the program account: profile view history can show who looked.' },
    { k: 'snapchat', label: 'Snapchat', core: true, ph: 'username',
      url: h => 'https://www.snapchat.com/add/' + enc(h),
      extra: h => [['Snap Map', 'https://map.snapchat.com/']],
      how: 'Confirms the handle exists and shows any public stories or Spotlight posts. Check Snap Map around the school.' },
    { k: 'x', label: 'X (Twitter)', core: true, ph: 'username',
      url: h => 'https://x.com/' + enc(h),
      extra: h => [['Wayback copies', 'https://web.archive.org/web/*/https://x.com/' + enc(h) + '*']],
      how: 'Posts, replies, likes if public, bio and link. Search on X needs a login, so mentions come from the Searches step.' },
    { k: 'facebook', label: 'Facebook', core: true, ph: 'username or profile link', name: true,
      url: h => 'https://www.facebook.com/' + enc(h),
      extra: h => [['Who Posted What', 'https://whopostedwhat.com/']],
      how: 'Profile pictures album, Photos of (tagged), check-ins, About. Facebook shows little without a login.' },
    { k: 'youtube', label: 'YouTube', core: true, ph: 'handle',
      url: h => 'https://www.youtube.com/@' + enc(h),
      extra: h => [['Wayback copies', 'https://web.archive.org/web/*/https://www.youtube.com/@' + enc(h) + '*']],
      how: 'Videos, Shorts, playlists, channel description, comments on other channels when shown.' },
    { k: 'discord', label: 'Discord', core: true, ph: 'username', nolink: true,
      url: null, extra: null,
      how: 'Discord has no public profile page. The handle matters when it shows up in a bio or a server listing; the quoted search below is the only lookup.' },
    { k: 'threads', label: 'Threads', ph: 'username', url: h => 'https://www.threads.net/@' + enc(h), how: 'Posts and replies; usually mirrors the Instagram handle.' },
    { k: 'bluesky', label: 'Bluesky', ph: 'handle', url: h => 'https://bsky.app/profile/' + enc(h.indexOf('.') >= 0 ? h : h + '.bsky.social'), how: 'Posts, replies, likes are public by default.' },
    { k: 'reddit', label: 'Reddit', ph: 'username', url: h => 'https://www.reddit.com/user/' + enc(h) + '/', extra: h => [['Reveddit (removed comments)', 'https://www.reveddit.com/y/' + enc(h) + '/']], how: 'Posts and comments, which subreddits. Reveddit shows comments moderators removed.' },
    { k: 'pinterest', label: 'Pinterest', ph: 'username', url: h => 'https://www.pinterest.com/' + enc(h) + '/', how: 'Boards and pins.' },
    { k: 'tumblr', label: 'Tumblr', ph: 'blog name', url: h => 'https://www.tumblr.com/' + enc(h), how: 'Posts and reblogs.' },
    { k: 'twitch', label: 'Twitch', ph: 'username', url: h => 'https://www.twitch.tv/' + enc(h), how: 'Channel, past broadcasts, chat conduct in clips.' },
    { k: 'steam', label: 'Steam', ph: 'custom URL name', url: h => 'https://steamcommunity.com/id/' + enc(h), extra: h => [['Search Steam users', 'https://steamcommunity.com/search/users/#text=' + enc(h)]], how: 'Profile comments, group names, and friends can be telling.' },
    { k: 'roblox', label: 'Roblox', ph: 'username', url: h => 'https://www.roblox.com/search/users?keyword=' + enc(h), how: 'Profile, groups, and friends list when public.' },
    { k: 'spotify', label: 'Spotify', ph: 'username', url: h => 'https://open.spotify.com/search/' + enc(h) + '/users', how: 'Public playlist names and bios.' },
    { k: 'soundcloud', label: 'SoundCloud', ph: 'username', url: h => 'https://soundcloud.com/' + enc(h), how: 'Tracks, comments, likes.' },
    { k: 'linktree', label: 'Linktree', ph: 'username', url: h => 'https://linktr.ee/' + enc(h), how: 'A bio link page lists every account they want found. Check Beacons and similar pages the same way.' },
    { k: 'telegram', label: 'Telegram', ph: 'username', url: h => 'https://t.me/' + enc(h), how: 'Confirms the handle exists; public channels show posts.' },
    { k: 'venmo', label: 'Venmo', ph: 'username', url: h => 'https://account.venmo.com/u/' + enc(h), how: 'Public payment notes, when the account is not set to private, say what the money was for.' },
    { k: 'cashapp', label: 'Cash App', ph: '$cashtag', url: h => 'https://cash.app/$' + enc(h), how: 'Confirms the cashtag exists.' },
    { k: 'other', label: 'Other site', ph: 'site and username', nolink: true, how: 'Anything not listed. Put the site name with the username.' }
  ];
  const PLAT = {}; PLATFORMS.forEach(p => PLAT[p.k] = p);

  const CATEGORIES = [
    ['c1', 'Drugs, vaping, underage drinking'],
    ['c2', 'Weapons handled unsafely or as threats'],
    ['c3', 'Fighting, violence, threats'],
    ['c4', 'Slurs, hate, extremist or gang content'],
    ['c5', 'Crimes shown or bragged about (theft, vandalism, street racing)'],
    ['c6', 'Bullying or harassment'],
    ['c7', 'Sexual or age-inappropriate content'],
    ['c8', 'Threats or hostility toward police (opinions about policing alone are not a concern)'],
    ['c9', 'Impersonating police, fake badges or uniforms, claiming authority'],
    ['c10', 'Posting program or police information that should not be public'],
    ['c11', 'Reckless judgment (dangerous stunts, doxxing, public feuds)'],
    ['c12', 'Positives worth noting (volunteering, sports, JROTC, school activities)']
  ];
  const CAT_CHIPS = [['clear', 'Clear'], ['note', 'Note'], ['concern', 'Concern'], ['na', 'N/A']];
  const POS_CHIPS = [['none', 'None seen'], ['noted', 'Noted']];
  const ACCT_ST = [['found', 'Found'], ['private', 'Private'], ['notfound', 'Not found']];
  const RP = [['yes', 'Right person'], ['no', 'Not sure']];
  const SRC = [['app', 'On the application'], ['found', 'Found in discovery']];
  const RESULTS = [['clear', 'Clear'], ['notes', 'Clear with notes'], ['concerns', 'Concerns found'], ['decline', 'Recommend decline']];
  const RECS = [['proceed', 'Proceed'], ['notes', 'Proceed with notes'], ['no', 'Do not proceed']];
  const REC_WHO = ['Applicant', 'Parent or guardian', 'Sibling', 'Other household member'];
  const REC_SRC = ['Dallas County courts', 'Collin County courts', 'Other county (re:SearchTX)', 'Sex offender registry', 'Protective Order Registry', 'TDCJ or jail lookup', 'VINELink', 'Federal (BOP)', 'News or web search', 'Other'];
  const REC_DISP = ['Convicted', 'Deferred adjudication', 'Dismissed', 'Pending', 'Arrest only, no charge', 'Registered', 'Unknown'];
  const STEPS = [
    ['details', 'Applicant details'],
    ['discovery', 'Discovery'],
    ['identity', 'Confirm it is them'],
    ['platforms', 'Accounts and platforms'],
    ['searches', 'Searches, hashtags, mentions'],
    ['image', 'Reverse image'],
    ['public', 'Public records, applicant'],
    ['household', 'Household and family'],
    ['categories', 'What was found']
  ];
  // Public records sites. copy: what to paste into the site's own search box.
  const PUBLIC_SITES = [
    ['osint', 'OSINT Industries', 'https://app.osint.industries/', 'Searches an email, phone, or username across hundreds of services. Paste one at a time. Both of you have a login.'],
    ['dallas', 'Dallas County courts portal', 'https://courtsportal.dallascounty.org/DALLASPROD', 'Criminal, civil, and county cases. Use the Criminal Background Search on the portal.'],
    ['collin', 'Collin County judicial search', 'https://apps2.collincountytx.gov/JudicialRecords', 'Court cases, active warrants, and the county jail in one search.'],
    ['retx', 're:SearchTX (other Texas counties)', 'https://research.txcourts.gov/CourtRecordsSearch/', 'Statewide case index for counties outside Dallas and Collin.'],
    ['por', 'Texas Protective Order Registry', 'https://protectiveorderregistry.txcourts.gov/', 'Public portal is limited, but worth the tap.'],
    ['dps', 'Texas DPS sex offender registry', 'https://publicsite.dps.texas.gov/SexOffenderRegistry', 'Search by name, and by the home address for who is registered nearby.'],
    ['nsopw', 'NSOPW (every state)', 'https://www.nsopw.gov/search-public-sex-offender-registries', 'All state registries at once, by name and by address radius.'],
    ['tdcj', 'TDCJ inmate search', 'https://inmate.tdcj.texas.gov/InmateSearch/start.action', 'Texas prison system, current and recent.'],
    ['djail', 'Dallas County jail lookup', 'https://www.dallascounty.org/jaillookup/', 'Who is in the Dallas County jail now.'],
    ['vine', 'VINELink (custody status)', 'https://vinelink.vineapps.com/search/TX/Person', 'Custody status across states.'],
    ['bop', 'Federal inmate locator (BOP)', 'https://www.bop.gov/inmateloc/', 'Federal prison system.']
  ];
  const SITE = {}; PUBLIC_SITES.forEach(s => SITE[s[0]] = s);

  /* ══════════ guide ══════════ */
  const STOP_RULES = [
    'Public view only. Never log in as the applicant, send a follow or friend request, DM them, or use a fake account.',
    'Do not screenshot, download, or save anything. Describe what you saw in the note. An advisor decides what goes in the folder.',
    'Anything serious (threats, weapons, drugs, sexual content): mark Concern, write one line, stop looking, and tell an advisor.',
    'Sexual content involving a minor is never saved by anyone. Note that it exists and stop.',
    'What you find stays in this panel. Do not discuss it with cadets or anyone outside the advisors.',
    'No people-search sites (Spokeo, BeenVerified, TruthFinder) and no paid lookups. Everything in the link rows is free.',
    'Reverse image search only photos found online in public view, never the photo from the application file.'
  ];
  const GUIDE = [
    ['Applicant details', 'Type what the application gives: nickname or other names, email, phone, home address, parent or guardian names, and every handle listed. The links below build from these as you type.'],
    ['Discovery', 'Run the email, phone, and each handle through OSINT Industries, then each handle and its variants through WhatsMyName and the quoted Google search. Add any account you find with + Add account found so the rest of the review covers it.'],
    ['Confirm it is them', 'Profile photo against the application photo, school or city in the bio, mutual follows with current cadets. Mark Right person on each account. A handle or email match can belong to someone else.'],
    ['Accounts and platforms', 'For each account: bio and links, posts, videos or Reels, highlights, tagged photos, comments they left, who they follow and who follows them (gang, drug, weapon, or hate accounts), pinned posts. Scroll back two years or to the start. Private accounts are marked Private and left alone.'],
    ['Searches, hashtags, mentions', 'The Google and Bing name searches, Images and News, the site-limited searches, school and class hashtags, Social Searcher for mentions, Snap Map and Instagram locations around the school, Wayback for old copies.'],
    ['Reverse image', 'In Chrome, long-press any photo and choose Search image with Google Lens. Or paste an image address in the box for Google, Yandex, and Bing. Yandex is the one most likely to find the same face on another account. FaceCheck.ID is the free face search.'],
    ['Public records, applicant', 'Only for applicants 17 and older. Juvenile records are not public in Texas, so the court portals show nothing for younger applicants. This row is for anything public that needs explaining; the official criminal history still runs through the advisor channel.'],
    ['Household and family', 'Run the parent or guardian names and the home address through the sex offender registries, the court portals, the jail and prison lookups, and the name and news searches. Household findings inform; the applicant\'s own conduct decides. Record what you find in the records list with the disposition: a dismissed case is not a conviction.'],
    ['What was found', 'Mark each of the twelve categories Clear, Note, or Concern with a short line that says where and when. Positives count too.']
  ];
  const SGT_NOTE = 'This review is confidential and yours alone to run. Public view only: no follows, friend requests, DMs, logins, fake accounts, screenshots, or saved copies. Anything serious gets a Concern, one line, and you stop and tell an advisor. Nothing you find here is discussed with cadets or anyone outside the advisors.';

  /* ══════════ data ══════════ */
  function blankApp(name, obsId, prefill) {
    const p = prefill || {};
    const accounts = PLATFORMS.filter(x => x.core).map(x => ({ aid: rand('ac'), plat: x.k, handle: '', src: 'app', st: '', rp: '', note: '' }));
    return {
      v: 1, name: name || '', obsId: obsId || '', createdAt: now(), updatedAt: now(),
      in: { email: p.email || '', phone: p.phone || '', school: p.school || '', nick: '', addr: '', tags: suggestTags(p.school), parents: [p.parentName || '', ''], img: '' },
      accounts, know: '', idc: '', steps: {}, cats: {}, pub: { run: '', res: '', n: '' }, hh: { rms: '', recs: [] },
      rec: { v: '', n: '' }, opened: {}, trail: [], status: 'open'
    };
  }
  function fix(app) {   // tolerate older or partial objects
    app.in = app.in || {}; if (!Array.isArray(app.in.parents)) app.in.parents = ['', ''];
    app.accounts = Array.isArray(app.accounts) ? app.accounts : [];
    app.steps = app.steps || {}; app.cats = app.cats || {}; app.pub = app.pub || { run: '', res: '', n: '' };
    app.hh = app.hh || { rms: '', recs: [] }; if (!Array.isArray(app.hh.recs)) app.hh.recs = [];
    app.opened = app.opened || {}; app.trail = Array.isArray(app.trail) ? app.trail : [];
    app.rec = app.rec || { v: '', n: '' };
    if (!app.status) app.status = 'open';
    return app;
  }
  function suggestTags(school) {
    const s = String(school || '').toLowerCase().replace(/high school/g, 'hs').replace(/[^a-z0-9 ]/g, '').trim();
    if (!s) return '';
    const t = s.replace(/\s+/g, '');
    return t ? '#' + t : '';
  }
  function log(app, by, what) {
    app.trail.push({ at: now(), by: by || '', what: String(what || '').slice(0, 160) });
    if (app.trail.length > 150) app.trail = app.trail.slice(app.trail.length - 150);
    app.updatedAt = now();
  }
  function variants(handle, first, last) {
    const set = new Set();
    const add = v => { v = cleanHandle(v).toLowerCase(); if (v && v.length >= 3) set.add(v); };
    const h = cleanHandle(handle).toLowerCase();
    if (h) { const nd = h.replace(/\d+$/, '').replace(/[._]+$/, ''); add(nd); add(nd.replace(/[._]/g, '')); add(h.replace(/[._]/g, '')); add(h.replace(/\./g, '_')); add(h.replace(/_/g, '.')); add(h.replace(/^_+|_+$/g, '')); }
    const f = String(first || '').toLowerCase().replace(/[^a-z0-9]/g, ''), l = String(last || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (f && l) { add(f + l); add(f + '.' + l); add(f + '_' + l); add(l + f); }
    set.delete(h);
    return Array.from(set).slice(0, 8);
  }
  function tagsOf(app) {
    return String(app.in.tags || '').split(/[\s,]+/).map(t => t.replace(/^#/, '').replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean).slice(0, 8);
  }
  function catStatus(app, k) { const c = app.cats[k] || {}; return c.st || ''; }
  function flagCounts(app) {
    let concern = 0, note = 0;
    CATEGORIES.forEach(([k]) => { if (k === 'c12') return; const st = catStatus(app, k); if (st === 'concern') concern++; else if (st === 'note') note++; });
    return { concern, note };
  }
  function summary(app) {   // short status for pills
    if (!app) return { k: 'none', label: 'Not started' };
    if (app.status === 'reviewed') return { k: 'done', label: 'Advisor reviewed' };
    const touched = (app.trail || []).length;
    return touched ? { k: 'prog', label: 'In progress' } : { k: 'none', label: 'Not started' };
  }

  /* ══════════ links ══════════ */
  // Every link has a stable key so the tap log survives re-renders. Returns
  // [{ k, label, url, hint?, copy? }].
  function accountLinks(app, a) {
    const p = PLAT[a.plat] || PLAT.other, h = cleanHandle(a.handle), out = [];
    if (p.nolink) {
      if (h) out.push({ k: 'pl:' + a.aid + ':gq', label: 'Google ' + Q(h), url: gq(Q(h)) });
      return out;
    }
    if (h) {
      out.push({ k: 'pl:' + a.aid + ':profile', label: p.label + ' profile', url: p.url(h) });
      (p.extra ? p.extra(h) : []).forEach((x, i) => out.push({ k: 'pl:' + a.aid + ':x' + i, label: x[0], url: x[1] }));
    } else if (p.name) {
      const n = nameParts(app.name).full;
      if (n) out.push({ k: 'pl:' + a.aid + ':name', label: 'Search people on Facebook', url: 'https://www.facebook.com/search/people/?q=' + enc(n) });
      (p.extra ? p.extra('') : []).forEach((x, i) => out.push({ k: 'pl:' + a.aid + ':x' + i, label: x[0], url: x[1] }));
    }
    return out;
  }
  function discoveryLinks(app) {
    const np = nameParts(app.name), out = [];
    const copies = [];
    if (app.in.email) copies.push({ label: 'Copy email', text: app.in.email });
    if (app.in.phone) copies.push({ label: 'Copy phone', text: app.in.phone });
    app.accounts.forEach(a => { const h = cleanHandle(a.handle); if (h) copies.push({ label: 'Copy ' + (PLAT[a.plat] || PLAT.other).label + ' handle', text: h }); });
    out.push({ k: 'disc:osint', label: 'Open OSINT Industries', url: SITE.osint[2], hint: SITE.osint[3], copies });
    const seen = new Set();
    app.accounts.forEach(a => {
      const h = cleanHandle(a.handle); if (!h || seen.has(h.toLowerCase())) return; seen.add(h.toLowerCase());
      out.push({ k: 'disc:wmn:' + h.toLowerCase(), label: 'WhatsMyName: ' + h, url: 'https://whatsmyname.app/?q=' + enc(h), hint: 'If the box comes up empty, paste the handle.', copies: [{ label: 'Copy', text: h }] });
      out.push({ k: 'disc:gq:' + h.toLowerCase(), label: 'Google ' + Q(h), url: gq(Q(h)) });
    });
    const vars = new Set();
    app.accounts.forEach(a => variants(a.handle, np.first, np.last).forEach(v => { if (!seen.has(v)) vars.add(v); }));
    if (!app.accounts.some(a => cleanHandle(a.handle))) variants('', np.first, np.last).forEach(v => vars.add(v));
    Array.from(vars).slice(0, 10).forEach(v => out.push({ k: 'disc:var:' + v, label: 'Variant: ' + v, url: 'https://whatsmyname.app/?q=' + enc(v), variant: true, copies: [{ label: 'Copy', text: v }] }));
    return out;
  }
  function searchLinks(app) {
    const np = nameParts(app.name), full = np.full, out = [];
    if (!full) return out;
    const nick = String(app.in.nick || '').trim(), school = String(app.in.school || '').trim();
    out.push({ k: 's:g-city', label: 'Google: ' + Q(full) + ' ' + CITY, url: gq(Q(full) + ' ' + CITY) });
    if (school) out.push({ k: 's:g-school', label: 'Google: ' + Q(full) + ' ' + Q(school), url: gq(Q(full) + ' ' + Q(school)) });
    if (nick) { out.push({ k: 's:g-nick', label: 'Google: ' + Q(nick) + ' ' + CITY, url: gq(Q(nick) + ' ' + CITY) }); if (np.last) out.push({ k: 's:g-nicklast', label: 'Google: ' + Q(nick.split(' ')[0] + ' ' + np.last), url: gq(Q(nick.split(' ')[0] + ' ' + np.last)) }); }
    out.push({ k: 's:g-img', label: 'Google Images: ' + Q(full), url: gq(Q(full) + ' ' + CITY, 'isch') });
    out.push({ k: 's:g-news', label: 'Google News: ' + Q(full), url: gq(Q(full), 'nws') });
    out.push({ k: 's:g-ig', label: 'site:instagram.com ' + Q(full), url: gq('site:instagram.com ' + Q(full)) });
    out.push({ k: 's:g-tt', label: 'site:tiktok.com ' + Q(full), url: gq('site:tiktok.com ' + Q(full)) });
    out.push({ k: 's:g-yt', label: 'site:youtube.com ' + Q(full), url: gq('site:youtube.com ' + Q(full)) });
    out.push({ k: 's:g-mp', label: 'MaxPreps and Hudl: ' + Q(full), url: gq(Q(full) + ' (site:maxpreps.com OR site:hudl.com)') });
    out.push({ k: 's:bing', label: 'Bing: ' + Q(full) + ' ' + CITY, url: bq(Q(full) + ' ' + CITY) });
    out.push({ k: 's:ss', label: 'Social Searcher mentions: ' + Q(full), url: 'https://www.social-searcher.com/social-buzz/?q=' + enc(Q(full)) });
    tagsOf(app).forEach(t => {
      out.push({ k: 's:ig-tag:' + t.toLowerCase(), label: 'Instagram #' + t, url: 'https://www.instagram.com/explore/tags/' + enc(t.toLowerCase()) + '/' });
      out.push({ k: 's:tt-tag:' + t.toLowerCase(), label: 'TikTok #' + t, url: 'https://www.tiktok.com/tag/' + enc(t.toLowerCase()) });
    });
    if (school) out.push({ k: 's:ig-loc', label: 'Instagram locations: ' + school, url: gq('site:instagram.com/explore/locations ' + Q(school)) });
    out.push({ k: 's:snapmap', label: 'Snap Map', url: 'https://map.snapchat.com/', hint: 'Look around the school and the usual hangouts.' });
    out.push({ k: 's:instahunt', label: 'InstaHunt (Instagram posts by location)', url: 'https://instahunt.co/' });
    return out;
  }
  function imageLinks(app) {
    const u = String(app.in.img || '').trim(), out = [];
    if (/^https?:\/\//i.test(u)) {
      out.push({ k: 'img:lens', label: 'Google Lens', url: 'https://lens.google.com/uploadbyurl?url=' + enc(u) });
      out.push({ k: 'img:yandex', label: 'Yandex', url: 'https://yandex.com/images/search?rpt=imageview&url=' + enc(u) });
      out.push({ k: 'img:bing', label: 'Bing Visual Search', url: 'https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:' + enc(u) });
    } else {
      out.push({ k: 'img:yandex0', label: 'Yandex Images', url: 'https://yandex.com/images/', hint: 'Tap the camera icon and paste or upload the photo.' });
      out.push({ k: 'img:bing0', label: 'Bing Visual Search', url: 'https://www.bing.com/visualsearch' });
    }
    out.push({ k: 'img:facecheck', label: 'FaceCheck.ID (face search)', url: 'https://facecheck.id/', hint: 'Upload a public photo of the face. Free results are limited.' });
    return out;
  }
  function publicLinks(app) {
    const n = nameParts(app.name).full, copies = n ? [{ label: 'Copy name', text: n }] : [];
    return ['dallas', 'collin', 'retx', 'por', 'dps', 'nsopw'].map(k => ({ k: 'pub:' + k, label: SITE[k][1], url: SITE[k][2], hint: SITE[k][3], copies }));
  }
  function householdLinks(app) {
    const names = (app.in.parents || []).map(x => String(x || '').trim()).filter(Boolean);
    const addr = String(app.in.addr || '').trim(), out = [];
    names.forEach((nm, i) => {
      out.push({ k: 'hh:g:' + i, label: 'Google: ' + Q(nm) + ' ' + CITY, url: gq(Q(nm) + ' ' + CITY) });
      out.push({ k: 'hh:gn:' + i, label: 'Google News: ' + Q(nm), url: gq(Q(nm), 'nws') });
      out.push({ k: 'hh:b:' + i, label: 'Bing: ' + Q(nm) + ' ' + CITY, url: bq(Q(nm) + ' ' + CITY) });
    });
    const copies = names.map(nm => ({ label: 'Copy ' + nm.split(' ')[0], text: nm }));
    const withAddr = addr ? copies.concat([{ label: 'Copy address', text: addr }]) : copies;
    ['nsopw', 'dps', 'dallas', 'collin', 'retx', 'por', 'tdcj', 'djail', 'vine', 'bop'].forEach(k => out.push({ k: 'hh:' + k, label: SITE[k][1], url: SITE[k][2], hint: SITE[k][3], copies: (k === 'nsopw' || k === 'dps') ? withAddr : copies }));
    return out;
  }

  /* ══════════ styles ══════════ */
  const CSS = `
.opr{margin-top:14px;border:1px solid rgba(212,169,82,0.35);border-radius:14px;background:rgba(212,169,82,0.03);padding:14px 14px 10px}
.opr *{box-sizing:border-box}
.opr-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px}
.opr-title{font-family:'Bebas Neue',sans-serif;font-size:21px;letter-spacing:1.5px;color:var(--white);margin-right:auto}
.opr-pill{display:inline-block;font-family:'Barlow Condensed',sans-serif;font-size:10.5px;font-weight:600;letter-spacing:1px;text-transform:uppercase;border-radius:4px;padding:2px 8px;border:1px solid var(--card-border);color:var(--text-muted);white-space:nowrap}
.opr-pill.prog{border-color:rgba(212,169,82,0.55);color:var(--gold-light)}
.opr-pill.done{border-color:rgba(39,174,96,0.6);color:#8ee7b1}
.opr-pill.src-found{border-color:rgba(220,38,38,0.5);color:#f8a3a3}
.opr-btn{background:rgba(255,255,255,0.03);border:1px solid var(--card-border);color:#c6d0de;border-radius:8px;padding:9px 13px;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;cursor:pointer;min-height:38px}
.opr-btn:hover{color:#fff;border-color:rgba(255,255,255,0.22)}
.opr-btn:disabled{opacity:.5;cursor:default}
.opr-btn.gold{border-color:rgba(212,169,82,0.55);color:var(--gold-light)}
.opr-btn.main{background:var(--red);border-color:var(--red);color:#fff}
.opr-btn.danger{color:#f8a3a3}
.opr-btn.green{border-color:rgba(39,174,96,0.6);color:#8ee7b1}
.opr-who{font-size:12.5px;color:var(--text-muted);margin:4px 0 10px;line-height:1.5}
.opr-who b{color:var(--gold-light);font-weight:600}
.opr-lock{font-size:13px;color:#8ee7b1;background:rgba(39,174,96,0.08);border:1px solid rgba(39,174,96,0.35);border-radius:9px;padding:9px 12px;margin:6px 0 10px;line-height:1.5}
.opr-step{border-top:1px solid var(--card-border);padding:12px 0 8px}
.opr-step-h{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:10px;cursor:pointer;user-select:none}
.opr-step-n{width:24px;height:24px;border-radius:50%;background:rgba(212,169,82,0.14);border:1px solid rgba(212,169,82,0.5);color:var(--gold-light);font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.opr-step-t{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--white);min-width:0}
.opr-step-d{font-size:11.5px;color:var(--text-muted);font-family:'Barlow Condensed',sans-serif;letter-spacing:1px;text-transform:uppercase}
.opr-step-d.on{color:#8ee7b1}
.opr-step-body{display:none;padding-top:8px}
.opr-step.open .opr-step-body{display:block}
.opr-step-h svg{transition:transform .2s;color:var(--text-muted)}
.opr-step.open .opr-step-h svg{transform:rotate(180deg)}
.opr-how{font-size:12.5px;color:var(--text-muted);line-height:1.55;margin:2px 0 10px}
.opr-how b{color:#dbe3ee;font-weight:600}
.opr-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;margin-bottom:8px}
.opr-grid.three{grid-template-columns:1fr 1fr 1fr}
.opr-f{display:flex;flex-direction:column;gap:3px;min-width:0}
.opr-f span{font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted)}
.opr-f input,.opr-f select,.opr-f textarea,.opr input.opr-in,.opr select.opr-in{width:100%;background:var(--input-bg);border:1px solid var(--input-border);border-radius:8px;padding:10px 11px;color:var(--white);font-family:'Barlow',sans-serif;font-size:14px;outline:none;min-width:0}
.opr-f input:focus,.opr input.opr-in:focus,.opr-f textarea:focus{border-color:var(--input-focus)}
.opr-f input:disabled,.opr input.opr-in:disabled,.opr-f select:disabled,.opr-f textarea:disabled{opacity:.6}
.opr select option{background:var(--navy)}
.opr-ro{font-size:14px;padding:10px 0 2px;color:var(--white);font-weight:500}
.opr-chips{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.opr-chip{background:rgba(255,255,255,0.03);border:1px solid var(--card-border);color:var(--text-muted);border-radius:20px;padding:7px 11px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;cursor:pointer;min-height:34px}
.opr-chip:hover{color:var(--white)}
.opr-chip:disabled{cursor:default}
.opr-chip.on{background:rgba(212,169,82,0.14);border-color:var(--gold);color:var(--gold-light)}
.opr-chip.on.good{background:rgba(39,174,96,0.14);border-color:var(--green);color:#8ee7b1}
.opr-chip.on.warn{background:rgba(217,119,6,0.14);border-color:var(--amber);color:#f6c47a}
.opr-chip.on.bad{background:rgba(220,38,38,0.14);border-color:var(--red-abs);color:#f8a3a3}
.opr-chip.on.muted{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.25);color:#dbe3ee}
.opr-chip-l{font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-right:2px}
.opr-links{display:flex;flex-direction:column;gap:5px;margin:6px 0 10px}
.opr-link{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;background:rgba(255,255,255,0.025);border:1px solid var(--card-border);border-radius:9px;padding:7px 10px}
.opr-link.var{background:none;border-style:dashed;opacity:.85}
.opr-link a{color:var(--gold-light);font-family:'Barlow',sans-serif;font-size:13.5px;font-weight:600;text-decoration:none;border-bottom:1px dashed rgba(240,214,138,0.45);overflow-wrap:anywhere;min-height:24px;display:inline-flex;align-items:center}
.opr-link a:hover{color:#fff}
.opr-link .opr-hint{flex-basis:100%;font-size:12px;color:var(--text-muted);line-height:1.45}
.opr-open{font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-left:auto;white-space:nowrap}
.opr-open.on{color:#8ee7b1}
.opr-copy{background:none;border:1px solid var(--card-border);color:#c6d0de;border-radius:6px;padding:4px 9px;font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;min-height:28px}
.opr-copy:hover{color:#fff;border-color:rgba(255,255,255,0.25)}
.opr-acct{background:rgba(255,255,255,0.02);border:1px solid var(--card-border);border-radius:10px;padding:11px 12px;margin-bottom:8px}
.opr-acct-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.opr-acct-name{font-size:14.5px;font-weight:600;color:var(--white);min-width:96px}
.opr-acct-top input{flex:1;min-width:150px}
.opr-acct-row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:8px}
.opr-note{width:100%;margin-top:8px}
.opr-sub{font-family:'Barlow Condensed',sans-serif;font-size:11.5px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin:12px 0 6px}
.opr-more{margin-top:6px}
.opr-cat{display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center;padding:9px 10px;border-radius:9px;border-left:3px solid transparent;margin-bottom:4px}
.opr-cat:nth-child(odd){background:rgba(255,255,255,0.02)}
.opr-cat.note{border-left-color:var(--amber);background:rgba(217,119,6,0.08)}
.opr-cat.concern{border-left-color:var(--red-abs);background:rgba(220,38,38,0.1)}
.opr-cat.noted{border-left-color:var(--green);background:rgba(39,174,96,0.08)}
.opr-cat-q{font-size:13.5px;line-height:1.4}
.opr-cat-q small{display:block;color:var(--text-muted);font-size:12px}
.opr-cat .opr-note{grid-column:1/-1;margin-top:2px}
.opr-rec{display:grid;grid-template-columns:1.1fr 1.3fr 1.3fr 1.1fr .8fr auto;gap:6px;align-items:center;margin-bottom:6px}
.opr-rec input,.opr-rec select{width:100%;background:var(--input-bg);border:1px solid var(--input-border);border-radius:8px;padding:9px 10px;color:var(--white);font-family:'Barlow',sans-serif;font-size:13.5px;outline:none;min-width:0}
.opr-rec .opr-note{grid-column:1/-1;margin-top:0}
.opr-rec-h{display:grid;grid-template-columns:1.1fr 1.3fr 1.3fr 1.1fr .8fr auto;gap:6px;font-family:'Barlow Condensed',sans-serif;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px}
.opr-rec-h span:last-child{width:36px}
.opr-x{background:none;border:1px solid rgba(220,38,38,0.35);color:#f87171;border-radius:8px;width:36px;height:36px;font-size:18px;cursor:pointer}
.opr-trail{margin-top:8px}
.opr-trail-list{display:none;margin-top:6px;max-height:220px;overflow:auto;font-size:12.5px;color:var(--text-muted);line-height:1.6}
.opr-trail.open .opr-trail-list{display:block}
.opr-trail-list b{color:#dbe3ee;font-weight:600}
.opr-result{margin-top:12px;border:1px solid rgba(212,169,82,0.35);border-radius:12px;padding:12px 14px;background:rgba(212,169,82,0.05)}
.opr-result-h{font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:8px}
.opr-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--card-border)}
.opr-modal{display:none;position:fixed;inset:0;background:rgba(6,11,22,0.88);z-index:1600;align-items:center;justify-content:center;padding:16px}
.opr-modal.show{display:flex}
.opr-modal-card{background:var(--navy);border:1px solid rgba(212,169,82,0.3);border-radius:16px;padding:22px 20px 18px;max-width:640px;width:100%;max-height:92vh;overflow:auto}
.opr-modal-card h3{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:1.5px;margin:0 0 8px;color:var(--white)}
.opr-modal-card p,.opr-modal-card li{font-size:13.5px;color:#c6d0de;line-height:1.6}
.opr-modal-card ol,.opr-modal-card ul{padding-left:20px;margin:6px 0 12px}
.opr-modal-card li b{color:var(--white)}
.opr-rules{background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.35);border-radius:10px;padding:10px 14px 4px;margin-bottom:12px}
.opr-rules .opr-sub{color:#f8a3a3;margin-top:0}
.opr-modal-acts{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}
.opr-small{font-size:12px;color:var(--text-muted);line-height:1.5}
.opr-flag{display:inline-block;margin-left:6px;font-family:'Barlow Condensed',sans-serif;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:#f8a3a3}
@media(max-width:640px){.opr-grid,.opr-grid.three{grid-template-columns:1fr}.opr-rec{grid-template-columns:1fr 1fr}.opr-rec-h{display:none}.opr-cat{grid-template-columns:1fr}}
`;
  function ensureStyle() {
    if (document.getElementById('opr-style')) return;
    const st = document.createElement('style'); st.id = 'opr-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  /* ══════════ render ══════════ */
  function chipRow(list, cur, attrs, cls, disabled) {
    return list.map(([k, l]) => `<button type="button" class="opr-chip${cur === k ? ' on ' + (cls ? cls(k) : '') : ''}" ${attrs} data-v="${esc(k)}"${disabled ? ' disabled' : ''}>${esc(l)}</button>`).join('');
  }
  const catCls = k => ({ clear: 'good', note: 'warn', concern: 'bad', na: 'muted', none: 'muted', noted: 'good' }[k] || '');
  const acctCls = k => ({ found: 'good', private: 'muted', notfound: 'muted' }[k] || '');
  const rpCls = k => ({ yes: 'good', no: 'warn' }[k] || '');
  function linkRowHtml(L, app, ro) {
    const at = app.opened[L.k];
    const copies = (L.copies || []).map(c => `<button type="button" class="opr-copy" data-copy="${esc(c.text)}">${esc(c.label)}</button>`).join('');
    return `<div class="opr-link${L.variant ? ' var' : ''}"><a href="${esc(L.url)}" target="_blank" rel="noopener noreferrer" data-lk="${esc(L.k)}">${esc(L.label)}</a>${copies}<span class="opr-open${at ? ' on' : ''}" data-lko="${esc(L.k)}">${at ? 'Opened ' + esc(fmtWhen(at)) : (ro ? 'Not opened' : '')}</span>${L.hint ? `<span class="opr-hint">${esc(L.hint)}</span>` : ''}</div>`;
  }
  function linksHtml(key, list, app, ro, empty) {
    const none = empty === '' ? '' : `<div class="opr-small">${esc(empty || 'Nothing to link yet.')}</div>`;
    return `<div class="opr-links" data-links="${key}"${list.length || none ? '' : ' style="margin:0"'}>${list.length ? list.map(L => linkRowHtml(L, app, ro)).join('') : none}</div>`;
  }
  function stepHtml(k, idx, title, app, inner, open, ro) {
    const d = (app.steps || {})[k];
    return `<div class="opr-step${open ? ' open' : ''}" data-step="${k}">
      <div class="opr-step-h" data-act="togglestep"><span class="opr-step-n">${idx}</span><span class="opr-step-t">${esc(title)}</span>
        <span class="opr-step-d${d && d.at ? ' on' : ''}">${d && d.at ? 'Done ' + esc(fmtDate(d.at)) + (d.by ? ' by ' + esc(d.by) : '') : 'Not done'}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></div>
      <div class="opr-step-body">${inner}
        <div class="opr-chips" style="margin-top:8px"><span class="opr-chip-l">Step</span>${chipRow([['done', 'Done'], ['open', 'Not done']], d && d.at ? 'done' : 'open', `data-act="stepdone" data-k="${k}"`, k2 => k2 === 'done' ? 'good' : 'muted', ro)}</div>
      </div></div>`;
  }
  function inputHtml(label, field, val, ro, ph, type) {
    return `<label class="opr-f"><span>${esc(label)}</span><input type="${type || 'text'}" data-f="${field}" value="${esc(val)}" placeholder="${esc(ph || '')}" maxlength="200"${ro ? ' disabled' : ''}></label>`;
  }
  function acctHtml(app, a, ro) {
    const p = PLAT[a.plat] || PLAT.other, links = accountLinks(app, a), h = cleanHandle(a.handle);
    return `<div class="opr-acct" data-aid="${esc(a.aid)}">
      <div class="opr-acct-top"><span class="opr-acct-name">${esc(p.label)}</span>
        <input type="text" class="opr-in" data-af="handle" value="${esc(a.handle || '')}" placeholder="${esc(p.ph)}" maxlength="120"${ro ? ' disabled' : ''} autocapitalize="none" autocomplete="off">
        ${a.src === 'found' ? '<span class="opr-pill src-found">Not on application</span>' : ''}
        ${(!p.core || a.src === 'found') && !ro ? '<button type="button" class="opr-x" data-act="delacct" title="Remove">&times;</button>' : ''}</div>
      <div class="opr-how">${esc(p.how)}</div>
      ${linksHtml('acct:' + a.aid, links, app, ro, '')}
      <div data-acctrows="${esc(a.aid)}">${acctRowsHtml(a, ro, !!(h || p.name || a.st || a.rp || a.note))}</div>
    </div>`;
  }
  // The chips and note appear once there is a handle (or a name search), so
  // untouched platforms stay one line tall.
  function acctRowsHtml(a, ro, show) {
    if (!show) return '';
    return `<div class="opr-acct-row"><div class="opr-chips"><span class="opr-chip-l">Source</span>${chipRow(SRC, a.src || 'app', 'data-act="asrc"', k => k === 'found' ? 'bad' : 'muted', ro)}</div></div>
      <div class="opr-acct-row"><div class="opr-chips"><span class="opr-chip-l">Account</span>${chipRow(ACCT_ST, a.st || '', 'data-act="ast"', acctCls, ro)}</div>
        <div class="opr-chips"><span class="opr-chip-l">Identity</span>${chipRow(RP, a.rp || '', 'data-act="arp"', rpCls, ro)}</div></div>
      <input type="text" class="opr-in opr-note" data-af="note" value="${esc(a.note || '')}" placeholder="Note: what you saw, where, when" maxlength="500"${ro ? ' disabled' : ''}>`;
  }
  function recHtml(r, ro) {
    const opt = (list, cur) => list.map(x => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
    return `<div class="opr-rec" data-rid="${esc(r.rid)}">
      <select data-rf="who"${ro ? ' disabled' : ''}>${opt(REC_WHO, r.who || 'Applicant')}</select>
      <select data-rf="src"${ro ? ' disabled' : ''}>${opt(REC_SRC, r.src || REC_SRC[0])}</select>
      <input type="text" data-rf="what" value="${esc(r.what || '')}" placeholder="Offense or finding" maxlength="160"${ro ? ' disabled' : ''}>
      <select data-rf="disp"${ro ? ' disabled' : ''}>${opt(REC_DISP, r.disp || 'Unknown')}</select>
      <input type="text" data-rf="date" value="${esc(r.date || '')}" placeholder="Year" maxlength="20"${ro ? ' disabled' : ''}>
      ${ro ? '<span></span>' : '<button type="button" class="opr-x" data-act="delrec" title="Remove">&times;</button>'}
      <input type="text" class="opr-note" data-rf="n" value="${esc(r.n || '')}" placeholder="Note (case number, county, what it means)" maxlength="300"${ro ? ' disabled' : ''}>
    </div>`;
  }

  function render(S) {
    const app = S.app, ro = S.locked, pre = S.prefill || {}, np = nameParts(app.name);
    const age = ageFrom(pre.dob);
    const sum = summary(app);
    const openSet = S.open;
    let html = '';
    // header
    html += `<div class="opr-top"><span class="opr-title">Online Presence Review</span><span class="opr-pill ${sum.k}">${esc(sum.label)}</span>
      <button type="button" class="opr-btn gold" data-act="guide">How to run this check</button>${S.mode === 'admin' && S.onPdf ? '<button type="button" class="opr-btn gold" data-act="pdf">Download PDF</button>' : ''}</div>`;
    if (S.mode === 'sgt') html += `<div class="opr-who">Edits save as <b>${esc(S.by || 'the cleared sergeant')}</b> with the time. Public view only; the rules are under How to run this check.</div>`;
    else html += `<div class="opr-who">Edits save as <b>${esc(S.by || 'Advisor')}</b>. The cleared sergeant can fill this in from /sgt until it is marked Advisor reviewed.</div>`;
    if (app.status === 'reviewed') html += `<div class="opr-lock">Advisor reviewed ${esc(fmtDate(app.reviewedAt))}${app.reviewedBy ? ' by ' + esc(app.reviewedBy) : ''}. ${S.mode === 'sgt' ? 'Locked on this page; an advisor can reopen it.' : 'Locked on /sgt. Reopen below if the sergeant needs to add anything.'}</div>`;

    // 1 details
    let d = `<div class="opr-how">Type what the application gives. Every link in the steps below builds from these as you type.</div>
      <div class="opr-grid three">
        <div class="opr-f"><span>Applicant</span><div class="opr-ro">${esc(app.name)}</div></div>
        <div class="opr-f"><span>Date of birth</span><div class="opr-ro">${esc(pre.dob || 'Not given')}${age !== null ? ' (' + age + ' yrs)' : ''}</div></div>
        ${inputHtml('School', 'school', app.in.school, ro, 'e.g. Berkner HS')}
        ${inputHtml('Nickname or other names', 'nick', app.in.nick, ro, 'Goes by, maiden or former name')}
        ${inputHtml('Email', 'email', app.in.email, ro, 'From the application', 'email')}
        ${inputHtml('Phone', 'phone', app.in.phone, ro, 'From the application', 'tel')}
        ${inputHtml('Home address', 'addr', app.in.addr, ro, 'Street, city, zip')}
        ${inputHtml('Parent or guardian 1', 'parent0', app.in.parents[0] || '', ro, 'Full name')}
        ${inputHtml('Parent or guardian 2', 'parent1', app.in.parents[1] || '', ro, 'Full name')}
        ${inputHtml('Hashtags to check', 'tags', app.in.tags, ro, '#berknerhs #classof2028')}
      </div>`;
    if (S.mode === 'sgt' || app.know) d += `<div class="opr-chips" style="margin:4px 0 6px"><span class="opr-chip-l">Do you know this applicant outside the program?</span>${chipRow([['no', 'No'], ['yes', 'Yes']], app.know || '', 'data-act="know"', k => k === 'yes' ? 'warn' : 'good', ro)}</div>`;
    if (app.know === 'yes') d += `<div class="opr-small" style="color:#f6c47a;margin-bottom:6px">Recorded. Let an advisor know; they may run this one themselves.</div>`;
    html += stepHtml('details', 1, 'Applicant details', app, d, openSet.has('details'), ro);

    // 2 discovery
    let dc = `<div class="opr-how">${esc(GUIDE[1][1])}</div>` + linksHtml('discovery', discoveryLinks(app), app, ro) +
      (ro ? '' : `<div class="opr-chips"><button type="button" class="opr-btn gold" data-act="addfound">+ Add account found</button><select class="opr-in" data-sel="addplat" style="width:auto;min-width:150px;padding:8px 10px">${PLATFORMS.map(p => `<option value="${p.k}">${esc(p.label)}</option>`).join('')}</select></div>`);
    html += stepHtml('discovery', 2, 'Discovery', app, dc, openSet.has('discovery'), ro);

    // 3 identity
    let id = `<div class="opr-how">${esc(GUIDE[2][1])}</div>`;
    const withH = app.accounts.filter(a => cleanHandle(a.handle));
    id += withH.length ? withH.map(a => `<div class="opr-acct-row" data-aid="${esc(a.aid)}" style="margin-top:4px"><span class="opr-acct-name">${esc((PLAT[a.plat] || PLAT.other).label)} <span class="opr-small">${esc(cleanHandle(a.handle))}</span></span><div class="opr-chips">${chipRow(RP, a.rp || '', 'data-act="arp"', rpCls, ro)}</div></div>`).join('') : '<div class="opr-small">Type the handles in Applicant details first.</div>';
    id += `<div class="opr-chips" style="margin-top:10px"><span class="opr-chip-l">Overall</span>${chipRow([['yes', 'Identity confirmed'], ['no', 'Not sure yet']], app.idc || '', 'data-act="idc"', rpCls, ro)}</div>`;
    html += stepHtml('identity', 3, 'Confirm it is them', app, id, openSet.has('identity'), ro);

    // 4 platforms
    const core = app.accounts.filter(a => (PLAT[a.plat] || {}).core && a.src !== 'found');
    const more = app.accounts.filter(a => !core.includes(a));
    let pl = `<div class="opr-how">${esc(GUIDE[3][1])}</div>` + core.map(a => acctHtml(app, a, ro)).join('');
    pl += `<div class="opr-sub">More platforms and accounts found</div>` + (more.length ? more.map(a => acctHtml(app, a, ro)).join('') : '<div class="opr-small" style="margin-bottom:6px">None added yet.</div>');
    if (!ro) pl += `<div class="opr-chips opr-more"><button type="button" class="opr-btn" data-act="addplat">+ Add platform</button><select class="opr-in" data-sel="addplat2" style="width:auto;min-width:150px;padding:8px 10px">${PLATFORMS.filter(p => !p.core).map(p => `<option value="${p.k}">${esc(p.label)}</option>`).join('')}</select></div>`;
    html += stepHtml('platforms', 4, 'Accounts and platforms', app, pl, openSet.has('platforms'), ro);

    // 5 searches
    html += stepHtml('searches', 5, 'Searches, hashtags, mentions', app, `<div class="opr-how">${esc(GUIDE[4][1])}</div>` + linksHtml('searches', searchLinks(app), app, ro, 'Nothing to search yet.'), openSet.has('searches'), ro);

    // 6 reverse image
    let im = `<div class="opr-how">${esc(GUIDE[5][1])} Only photos found online in public view, never the application photo.</div>
      <div class="opr-grid"><label class="opr-f" style="grid-column:1/-1"><span>Image address (optional)</span><input type="url" data-f="img" value="${esc(app.in.img)}" placeholder="Paste a photo link to build the three searches"${ro ? ' disabled' : ''}></label></div>` + linksHtml('image', imageLinks(app), app, ro);
    html += stepHtml('image', 6, 'Reverse image', app, im, openSet.has('image'), ro);

    // 7 public records (applicant)
    let pb = `<div class="opr-how">${esc(GUIDE[6][1])}</div>`;
    if (age !== null && age < 17) pb += `<div class="opr-small" style="color:#f6c47a;margin-bottom:8px">This applicant is ${age}. Court records will not show anything; mark Not run unless an advisor says otherwise.</div>`;
    pb += `<div class="opr-chips" style="margin-bottom:8px"><span class="opr-chip-l">Run</span>${chipRow([['yes', 'Run'], ['no', 'Not run (under 17)']], app.pub.run || '', 'data-act="pubrun"', k => k === 'yes' ? 'good' : 'muted', ro)}</div>`;
    if (app.pub.run !== 'no') pb += linksHtml('public', publicLinks(app), app, ro);
    pb += `<div class="opr-chips" style="margin-top:4px"><span class="opr-chip-l">Result</span>${chipRow([['none', 'Nothing found'], ['found', 'Record found (list it below)']], app.pub.res || '', 'data-act="pubres"', k => k === 'found' ? 'bad' : 'good', ro)}</div>`;
    html += stepHtml('public', 7, 'Public records, applicant', app, pb, openSet.has('public'), ro);

    // 8 household
    let hh = `<div class="opr-how">${esc(GUIDE[7][1])}</div>` + linksHtml('household', householdLinks(app), app, ro, 'Type the parent or guardian names and the home address in Applicant details first.');
    hh += `<div class="opr-chips" style="margin:4px 0 10px"><span class="opr-chip-l">RMS name and address history</span>${chipRow([['done', 'Done, results in folder'], ['no', 'Not done']], app.hh.rms || '', 'data-act="rms"', k => k === 'done' ? 'good' : 'muted', ro || S.mode !== 'admin')}${S.mode !== 'admin' ? '<span class="opr-small">An advisor runs this one.</span>' : ''}</div>`;
    hh += `<div class="opr-sub">Records found (anyone)</div>` + ((app.hh.recs || []).length ? '<div class="opr-rec-h"><span>Who</span><span>Source</span><span>Offense or finding</span><span>Disposition</span><span>Year</span><span></span></div>' + app.hh.recs.map(r => recHtml(r, ro)).join('') : '<div class="opr-small" style="margin-bottom:6px">None recorded. Nothing found is a result too; mark the step done.</div>');
    if (!ro) hh += `<div class="opr-chips"><button type="button" class="opr-btn" data-act="addrec">+ Add record</button></div>`;
    html += stepHtml('household', 8, 'Household and family', app, hh, openSet.has('household'), ro);

    // 9 categories
    let ct = `<div class="opr-how">${esc(GUIDE[8][1])}</div>`;
    CATEGORIES.forEach(([k, label]) => {
      const c = app.cats[k] || {}, st = c.st || '', pos = k === 'c12';
      const shot = S.mode === 'admin' && S.adv && S.adv.shots && S.adv.shots[k];
      ct += `<div class="opr-cat ${esc(st)}" data-cat="${k}"><div class="opr-cat-q">${esc(label)}${st === 'concern' && shot ? '<span class="opr-flag">Screenshot in folder</span>' : ''}</div>
        <div class="opr-chips">${chipRow(pos ? POS_CHIPS : CAT_CHIPS, st, 'data-act="cat"', catCls, ro)}${S.mode === 'admin' && st === 'concern' && !ro ? `<button type="button" class="opr-chip${shot ? ' on muted' : ''}" data-act="shot" data-k="${k}">Screenshot in folder</button>` : ''}</div>
        ${(st && st !== 'clear' && st !== 'na' && st !== 'none') || c.n ? `<input type="text" class="opr-in opr-note" data-cf="${k}" value="${esc(c.n || '')}" placeholder="Where, when, what" maxlength="500"${ro ? ' disabled' : ''}>` : ''}</div>`;
    });
    html += stepHtml('categories', 9, 'What was found', app, ct, openSet.has('categories'), ro);

    // reviewer recommendation (whoever runs the review; shared with both panels)
    const rec = app.rec || {};
    html += `<div class="opr-result"><div class="opr-result-h">Reviewer recommendation</div>
      <div class="opr-chips">${chipRow(RECS, rec.v || '', 'data-act="rec"', k => ({ proceed: 'good', notes: 'warn', no: 'bad' }[k]), ro)}</div>
      ${rec.at ? `<div class="opr-small" style="margin-top:6px">Set ${esc(fmtWhen(rec.at))}${rec.by ? ' by ' + esc(rec.by) : ''}</div>` : ''}
      <input type="text" class="opr-in opr-note" data-f="recnote" value="${esc(rec.n || '')}" placeholder="Why, in a line (prints on the PDF)" maxlength="500"${ro ? ' disabled' : ''}></div>`;
    // result (admin) / status (sgt)
    if (S.mode === 'admin') {
      const adv = S.adv || {};
      html += `<div class="opr-result" style="border-color:rgba(39,174,96,0.4)"><div class="opr-result-h">Advisor result (not shown on /sgt)</div>
        <div class="opr-chips">${chipRow(RESULTS, adv.result || '', 'data-act="result"', k => ({ clear: 'good', notes: 'good', concerns: 'warn', decline: 'bad' }[k]))}</div>
        ${adv.resultAt ? `<div class="opr-small" style="margin-top:6px">Set ${esc(fmtWhen(adv.resultAt))}${adv.resultBy ? ' by ' + esc(adv.resultBy) : ''}</div>` : ''}
        <input type="text" class="opr-in opr-note" data-f="advnote" value="${esc(adv.note || '')}" placeholder="Advisor note (optional, prints on the PDF)" maxlength="800">
        <div class="opr-acts">
          ${app.status === 'reviewed' ? '<button type="button" class="opr-btn" data-act="reopen">Reopen for the sergeant</button>' : '<button type="button" class="opr-btn green" data-act="reviewed">Mark Advisor reviewed</button>'}
          <button type="button" class="opr-btn gold" data-act="pdf">Download PDF</button>
          <button type="button" class="opr-btn danger" data-act="delete" style="margin-left:auto">Delete review</button>
        </div></div>`;
    }
    // trail
    const tr = (app.trail || []).slice().reverse().slice(0, 60);
    html += `<div class="opr-trail${S.trailOpen ? ' open' : ''}"><button type="button" class="opr-btn" data-act="trail" style="padding:6px 10px;min-height:30px">Activity (${(app.trail || []).length})</button>
      <div class="opr-trail-list">${tr.map(t => `<div><b>${esc(fmtWhen(t.at))}</b> ${esc(t.by)}: ${esc(t.what)}</div>`).join('') || '<div>Nothing yet.</div>'}</div></div>`;
    return html;
  }

  /* ══════════ guide modal ══════════ */
  function guideModal() {
    let m = document.getElementById('oprGuide');
    if (m) return m;
    m = document.createElement('div'); m.className = 'opr-modal'; m.id = 'oprGuide';
    m.innerHTML = `<div class="opr-modal-card"><h3>How to run this check</h3>
      <div class="opr-rules"><div class="opr-sub">Rules</div><ul>${STOP_RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
      <ol>${GUIDE.map(g => `<li><b>${esc(g[0])}.</b> ${esc(g[1])}</li>`).join('')}</ol>
      <p class="opr-small">Anything else: osintframework.com lists more free tools by type. Mark each step Done as you finish it so the file shows what was actually run.</p>
      <div class="opr-modal-acts"><button type="button" class="opr-btn main" data-act="close">Close</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-act="close"]')) m.classList.remove('show'); });
    return m;
  }
  function noteModal(onOk) {
    let m = document.getElementById('oprNote');
    if (!m) {
      m = document.createElement('div'); m.className = 'opr-modal'; m.id = 'oprNote';
      m.innerHTML = `<div class="opr-modal-card"><h3>Before you start</h3><p>${esc(SGT_NOTE)}</p>
        <div class="opr-modal-acts"><button type="button" class="opr-btn main" data-act="ok">I understand</button></div></div>`;
      document.body.appendChild(m);
    }
    m.querySelector('[data-act="ok"]').onclick = () => { m.classList.remove('show'); if (onOk) onOk(); };
    m.classList.add('show');
  }

  /* ══════════ mount ══════════ */
  // opts: { mode:'sgt'|'admin', app, adv, locked, by, prefill, save(fn), saveAdv(fn),
  //         onPdf(), onReviewed(), onReopen(), onDelete(), toast(msg) }
  // save(fn) must re-read the node, run fn(freshApp), write, and resolve with the fresh app.
  function mount(host, opts) {
    ensureStyle();
    const S = { mode: opts.mode, app: fix(opts.app), adv: opts.adv || null, locked: !!opts.locked, by: opts.by || '', prefill: opts.prefill || {},
      open: new Set(opts.openSteps || ['details']), trailOpen: false, opts, host, timers: {} };
    host.innerHTML = '<div class="opr"></div>';
    const root = host.firstElementChild;
    const toast = m => { if (opts.toast) opts.toast(m); };
    function draw() {
      const act = document.activeElement, keep = act && root.contains(act) ? { sel: selectorFor(act), s: act.selectionStart, e: act.selectionEnd } : null;
      root.innerHTML = render(S);
      if (keep && keep.sel) { const el = root.querySelector(keep.sel); if (el) { el.focus(); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) {} } }
    }
    function selectorFor(el) {
      const acct = el.closest('[data-aid]'), rec = el.closest('[data-rid]');
      if (el.dataset.f) return `[data-f="${el.dataset.f}"]`;
      if (el.dataset.cf) return `[data-cf="${el.dataset.cf}"]`;
      if (acct && el.dataset.af) return `[data-aid="${acct.dataset.aid}"] [data-af="${el.dataset.af}"]`;
      if (rec && el.dataset.rf) return `[data-rid="${rec.dataset.rid}"] [data-rf="${el.dataset.rf}"]`;
      return '';
    }
    function redrawLinks() {   // only the link lists, so typing never loses focus
      root.querySelectorAll('[data-links]').forEach(box => {
        const key = box.dataset.links; let list = null;
        if (key === 'discovery') list = discoveryLinks(S.app);
        else if (key === 'searches') list = searchLinks(S.app);
        else if (key === 'image') list = imageLinks(S.app);
        else if (key === 'public') list = publicLinks(S.app);
        else if (key === 'household') list = householdLinks(S.app);
        else if (key.indexOf('acct:') === 0) { const a = S.app.accounts.find(x => x.aid === key.slice(5)); if (a) list = accountLinks(S.app, a); }
        if (list) box.outerHTML = linksHtml(key, list, S.app, S.locked, key.indexOf('acct:') === 0 ? '' : undefined);
      });
      root.querySelectorAll('[data-acctrows]').forEach(box => {
        if (box.children.length) return;
        const a = S.app.accounts.find(x => x.aid === box.dataset.acctrows); if (!a) return;
        const p = PLAT[a.plat] || PLAT.other;
        if (cleanHandle(a.handle) || p.name || a.st || a.rp || a.note) box.innerHTML = acctRowsHtml(a, S.locked, true);
      });
    }
    // Saves from this form run one at a time (each re-reads, applies, writes),
    // so two quick edits can never clobber each other.
    S.q = Promise.resolve();
    const enqueue = fn => { const run = () => opts.save(fn); const p = S.q.then(run, run); S.q = p.catch(() => {}); return p; };
    // Apply a change locally, then persist through opts.save (re-read + write).
    async function change(fn, what, opts2) {
      if (!(opts2 && opts2.noDraw)) flush();
      fn(S.app); if (what) log(S.app, S.by, what);
      if (!(opts2 && opts2.noDraw)) draw(); else redrawLinks();
      try {
        const fresh = await enqueue(a => { fn(a); if (what) log(a, S.by, what); });
        if (fresh) { S.app = fix(fresh); if (!(opts2 && opts2.noDraw)) draw(); else { syncInputs(); redrawLinks(); } }
      } catch (e) { console.error(e); toast('That did not save. Check your connection and try again.'); }
    }
    function syncInputs() {   // after a fresh read, refresh any text input the user is NOT typing in
      const act = document.activeElement;
      root.querySelectorAll('input[data-f],input[data-cf],[data-aid] input[data-af],[data-rid] input[data-rf],[data-rid] select[data-rf]').forEach(el => {
        if (el === act) return;
        let v;
        if (el.dataset.f) v = fieldGet(S.app, el.dataset.f);
        else if (el.dataset.cf) v = (S.app.cats[el.dataset.cf] || {}).n || '';
        else if (el.dataset.af) { const a = S.app.accounts.find(x => x.aid === el.closest('[data-aid]').dataset.aid); v = a ? (a[el.dataset.af] || '') : el.value; }
        else if (el.dataset.rf) { const r = S.app.hh.recs.find(x => x.rid === el.closest('[data-rid]').dataset.rid); v = r ? (r[el.dataset.rf] || '') : el.value; }
        if (v !== undefined && el.value !== v) el.value = v;
      });
    }
    function fieldGet(app, f) {
      if (f === 'parent0') return app.in.parents[0] || '';
      if (f === 'parent1') return app.in.parents[1] || '';
      if (f === 'advnote') return (S.adv && S.adv.note) || '';
      if (f === 'recnote') return (app.rec && app.rec.n) || '';
      return app.in[f] || '';
    }
    function fieldSet(app, f, v) {
      if (f === 'parent0') app.in.parents[0] = v;
      else if (f === 'parent1') app.in.parents[1] = v;
      else if (f === 'recnote') { app.rec = app.rec || {}; app.rec.n = v; }
      else app.in[f] = v;
    }
    // Text edits save after a short pause; a chip tap or structural change
    // flushes anything still waiting so a full re-render never shows stale text.
    S.pending = {};
    const debounce = (key, fn, ms) => { clearTimeout(S.timers[key]); S.pending[key] = fn; S.timers[key] = setTimeout(() => { delete S.pending[key]; fn(); }, ms || 700); };
    const flush = () => { Object.keys(S.pending).forEach(k => { const fn = S.pending[k]; clearTimeout(S.timers[k]); delete S.pending[k]; fn(); }); };
    const FIELD_LABEL = { school: 'school', nick: 'nickname', email: 'email', phone: 'phone', addr: 'home address', parent0: 'parent or guardian 1', parent1: 'parent or guardian 2', tags: 'hashtags', img: 'image address', recnote: 'recommendation note' };

    root.addEventListener('input', e => {
      if (S.locked && e.target.disabled) return;
      const el = e.target;
      if (el.dataset.f) {
        const f = el.dataset.f, v = el.value;
        if (f === 'advnote') { if (!opts.saveAdv) return; debounce('adv', () => opts.saveAdv(a => { a.note = v.trim(); }).then(fresh => { if (fresh) S.adv = fresh; }).catch(() => toast('That did not save.')), 800); return; }
        fieldSet(S.app, f, v); redrawLinks();
        debounce('f:' + f, () => change(a => fieldSet(a, f, v.trim()), 'Updated ' + (FIELD_LABEL[f] || f), { noDraw: true }), 800);
      } else if (el.dataset.cf) {
        const k = el.dataset.cf, v = el.value;
        (S.app.cats[k] = S.app.cats[k] || {}).n = v;
        debounce('c:' + k, () => change(a => { (a.cats[k] = a.cats[k] || {}).n = v.trim(); }, 'Note on ' + catLabel(k), { noDraw: true }), 800);
      } else if (el.dataset.af) {
        const aid = el.closest('[data-aid]').dataset.aid, f = el.dataset.af, v = el.value;
        const a = S.app.accounts.find(x => x.aid === aid); if (!a) return;
        a[f] = v; if (f === 'handle') redrawLinks();
        debounce('a:' + aid + f, () => change(x => { const y = x.accounts.find(z => z.aid === aid); if (y) y[f] = v.trim(); }, (f === 'handle' ? 'Handle: ' : 'Note: ') + (PLAT[a.plat] || PLAT.other).label + ' ' + v.trim(), { noDraw: true }), 800);
      } else if (el.dataset.rf) {
        const rid = el.closest('[data-rid]').dataset.rid, f = el.dataset.rf, v = el.value;
        const r = S.app.hh.recs.find(x => x.rid === rid); if (!r) return;
        r[f] = v;
        debounce('r:' + rid + f, () => change(x => { const y = x.hh.recs.find(z => z.rid === rid); if (y) y[f] = v.trim(); }, 'Record updated', { noDraw: true }), 800);
      }
    });
    root.addEventListener('change', e => {   // selects in record rows fire change, not input
      const el = e.target; if (el.tagName !== 'SELECT' || !el.dataset.rf) return;
      const rid = el.closest('[data-rid]').dataset.rid, f = el.dataset.rf, v = el.value;
      const r = S.app.hh.recs.find(x => x.rid === rid); if (!r) return; r[f] = v;
      change(x => { const y = x.hh.recs.find(z => z.rid === rid); if (y) y[f] = v; }, 'Record updated', { noDraw: true });
    });
    root.addEventListener('click', async e => {
      const a = e.target.closest('a[data-lk]');
      if (a) {   // let the tab open; record the tap
        const k = a.dataset.lk, t = now();
        S.app.opened[k] = t;
        const tag = a.parentElement.querySelector('[data-lko]'); if (tag) { tag.textContent = 'Opened ' + fmtWhen(t); tag.classList.add('on'); }
        if (!S.locked) { try { await enqueue(x => { x.opened = x.opened || {}; x.opened[k] = t; x.updatedAt = t; }); } catch (err) {} }
        return;
      }
      const cp = e.target.closest('[data-copy]');
      if (cp) { const ok = await copyText(cp.dataset.copy); toast(ok ? 'Copied' : 'Could not copy; select it by hand'); return; }
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'togglestep') { const st = btn.closest('[data-step]').dataset.step; if (S.open.has(st)) S.open.delete(st); else S.open.add(st); btn.closest('[data-step]').classList.toggle('open'); if (opts.onOpenChange) opts.onOpenChange(Array.from(S.open)); return; }
      if (act === 'guide') { guideModal().classList.add('show'); return; }
      if (act === 'trail') { S.trailOpen = !S.trailOpen; btn.closest('.opr-trail').classList.toggle('open', S.trailOpen); return; }
      if (act === 'pdf') { if (opts.onPdf) opts.onPdf(); return; }
      if (act === 'reviewed') { if (opts.onReviewed) opts.onReviewed(); return; }
      if (act === 'reopen') { if (opts.onReopen) opts.onReopen(); return; }
      if (act === 'delete') { if (opts.onDelete) opts.onDelete(); return; }
      if (act === 'result') {
        if (!opts.saveAdv) return; const v = btn.dataset.v;
        try { const fresh = await opts.saveAdv(x => { x.result = (x.result === v ? '' : v); x.resultAt = now(); x.resultBy = S.by; }); if (fresh) S.adv = fresh; draw(); }
        catch (err) { toast('That did not save.'); }
        return;
      }
      if (act === 'shot') {
        if (!opts.saveAdv) return; const k = btn.dataset.k;
        try { const fresh = await opts.saveAdv(x => { x.shots = x.shots || {}; if (x.shots[k]) delete x.shots[k]; else x.shots[k] = now(); }); if (fresh) S.adv = fresh; draw(); }
        catch (err) { toast('That did not save.'); }
        return;
      }
      if (S.locked) return;
      if (act === 'stepdone') {
        const k = btn.dataset.k, v = btn.dataset.v, title = (STEPS.find(s => s[0] === k) || [k, k])[1];
        change(x => { x.steps = x.steps || {}; if (v === 'done') x.steps[k] = { at: now(), by: S.by }; else delete x.steps[k]; }, (v === 'done' ? 'Done: ' : 'Reopened: ') + title);
      } else if (act === 'rec') { const v = btn.dataset.v, lab = (RECS.find(r => r[0] === v) || [v, v])[1]; change(x => { x.rec = x.rec || {}; x.rec.v = (x.rec.v === v ? '' : v); x.rec.at = now(); x.rec.by = S.by; }, 'Recommendation: ' + lab); }
      else if (act === 'know') { const v = btn.dataset.v; change(x => { x.know = (x.know === v ? '' : v); }, 'Knows applicant outside the program: ' + v); }
      else if (act === 'idc') { const v = btn.dataset.v; change(x => { x.idc = (x.idc === v ? '' : v); }, 'Identity ' + (v === 'yes' ? 'confirmed' : 'not sure')); }
      else if (act === 'pubrun') { const v = btn.dataset.v; change(x => { x.pub.run = (x.pub.run === v ? '' : v); }, 'Public records: ' + (v === 'yes' ? 'run' : 'not run')); }
      else if (act === 'pubres') { const v = btn.dataset.v; change(x => { x.pub.res = (x.pub.res === v ? '' : v); }, 'Public records result: ' + (v === 'found' ? 'record found' : 'nothing found')); }
      else if (act === 'rms') { if (S.mode !== 'admin') return; const v = btn.dataset.v; change(x => { x.hh.rms = (x.hh.rms === v ? '' : v); }, 'RMS check: ' + (v === 'done' ? 'done' : 'not done')); }
      else if (act === 'cat') {
        const k = btn.closest('[data-cat]').dataset.cat, v = btn.dataset.v;
        change(x => { const c = x.cats[k] = x.cats[k] || {}; c.st = (c.st === v ? '' : v); c.at = now(); c.by = S.by; }, catLabel(k) + ': ' + v);
      }
      else if (act === 'asrc' || act === 'ast' || act === 'arp') {
        const aid = btn.closest('[data-aid]').dataset.aid, v = btn.dataset.v, f = { asrc: 'src', ast: 'st', arp: 'rp' }[act];
        const lab = { asrc: 'Source', ast: 'Account', arp: 'Identity' }[act];
        change(x => { const y = x.accounts.find(z => z.aid === aid); if (y) y[f] = (f !== 'src' && y[f] === v) ? '' : v; }, lab + ' on ' + acctLabel(S.app, aid) + ': ' + v);
      }
      else if (act === 'addfound' || act === 'addplat') {
        const sel = root.querySelector(act === 'addfound' ? '[data-sel="addplat"]' : '[data-sel="addplat2"]'); const plat = sel ? sel.value : 'other';
        const na = { aid: rand('ac'), plat, handle: '', src: act === 'addfound' ? 'found' : 'app', st: '', rp: '', note: '' };
        S.open.add('platforms'); if (opts.onOpenChange) opts.onOpenChange(Array.from(S.open));
        change(x => { x.accounts.push(na); }, 'Added ' + (PLAT[plat] || PLAT.other).label + (act === 'addfound' ? ' (found in discovery)' : ''));
        setTimeout(() => { const el = root.querySelector(`[data-aid="${na.aid}"] [data-af="handle"]`); if (el) el.focus(); }, 50);
      }
      else if (act === 'delacct') {
        const aid = btn.closest('[data-aid]').dataset.aid; const lab = acctLabel(S.app, aid);
        if (!confirm('Remove ' + lab + ' from this review?')) return;
        change(x => { x.accounts = x.accounts.filter(z => z.aid !== aid); }, 'Removed ' + lab);
      }
      else if (act === 'addrec') { const nr = { rid: rand('rc'), who: 'Applicant', src: REC_SRC[0], what: '', disp: 'Unknown', date: '', n: '' }; change(x => { x.hh.recs.push(nr); }, 'Added a record row'); }
      else if (act === 'delrec') { const rid = btn.closest('[data-rid]').dataset.rid; if (!confirm('Remove this record row?')) return; change(x => { x.hh.recs = x.hh.recs.filter(z => z.rid !== rid); }, 'Removed a record row'); }
    });
    draw();
    return {
      refresh(next) { if (next.app) S.app = fix(next.app); if ('adv' in next) S.adv = next.adv; if ('locked' in next) S.locked = !!next.locked; if (next.by) S.by = next.by; draw(); },
      get app() { return S.app; }
    };
  }
  function catLabel(k) { const c = CATEGORIES.find(x => x[0] === k); return c ? c[1].split(' (')[0] : k; }
  function acctLabel(app, aid) { const a = app.accounts.find(x => x.aid === aid); if (!a) return 'account'; const h = cleanHandle(a.handle); return (PLAT[a.plat] || PLAT.other).label + (h ? ' ' + h : ''); }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} ta.remove(); return ok;
    }
  }

  /* ══════════ PDF (pdf-lib; same locked GENERAL letterhead as the reference PDF) ══════════ */
  function pdfSafe(s) {
    return String(s == null ? '' : s)
      .replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-').replace(/\u2026/g, '...').replace(/[\u00A0\u2000-\u200B\u202F]/g, ' ')
      .replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
      .replace(/[^\n\x20-\x7E\u00A1-\u00FF]/g, '?');
  }
  function wrap(font, size, text, maxW) {
    const out = [];
    pdfSafe(text).split('\n').forEach(par => {
      let line = '';
      par.split(' ').forEach(word => {
        while (font.widthOfTextAtSize(word, size) > maxW) {
          let cut = word.length;
          while (cut > 1 && font.widthOfTextAtSize((line ? line + ' ' : '') + word.slice(0, cut), size) > maxW) cut--;
          if (line && cut <= 1) { out.push(line); line = ''; continue; }
          out.push((line ? line + ' ' : '') + word.slice(0, cut)); line = ''; word = word.slice(cut);
        }
        const test = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(test, size) > maxW && line) { out.push(line); line = word; } else line = test;
      });
      out.push(line);
    });
    return out;
  }
  // ctx = { app, adv, prefill, cfg }
  async function buildPdf(PDFLib, logoBytes, ctx) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const app = fix(ctx.app), adv = ctx.adv || {}, pre = ctx.prefill || {};
    const doc = await PDFDocument.create();
    doc.setTitle('Online Presence Review: ' + pdfSafe(app.name));
    doc.setAuthor('Richardson Police Department Public Safety Cadets');
    const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold), FI = await doc.embedFont(StandardFonts.HelveticaOblique);
    let logo = null; if (logoBytes) { try { logo = await doc.embedPng(logoBytes); } catch (e) {} }
    const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    const NAVY = hex('#1B2A4A'), RED = hex('#C41E3A'), GOLD = hex('#C5A55A'), BG = hex('#7A8BA0'), INK = rgb(0.1, 0.1, 0.1), TINT = hex('#F4F6F9'), FLAG = hex('#FBEDEF'), LOOK = hex('#FBF4E4'), GOOD = hex('#EEF7F0'), AMBER = hex('#B7791F'), GREEN = hex('#2F7D4A');
    const W = 612, H = 792, L = 55, R = W - 55, CW = R - L, BOTTOM = 64, LEAD = 11.5;
    const pages = []; let page = null, y = 0;
    const rtext = (t, xr, yy, size, font, color) => page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
    function header() {
      const top = H - 42, tx = L + 96 + 14;
      if (logo) page.drawImage(logo, { x: L, y: (top - 36) - 48, width: 96, height: 96 });
      page.pushOperators(PDFLib.setCharacterSpacing(2.2));
      page.drawText('RICHARDSON POLICE DEPARTMENT', { x: tx, y: top - 14, size: 8.5, font: FB, color: BG });
      page.pushOperators(PDFLib.setCharacterSpacing(0));
      page.drawText('PUBLIC SAFETY CADETS', { x: tx, y: top - 40, size: 25, font: FB, color: NAVY });
      const mid = tx + (R - tx) / 2;
      page.drawLine({ start: { x: tx, y: top - 50 }, end: { x: mid, y: top - 50 }, thickness: 1.5, color: RED });
      page.drawLine({ start: { x: mid, y: top - 50 }, end: { x: R, y: top - 50 }, thickness: 1.5, color: NAVY });
      page.drawText('Applicant Online Presence Review', { x: tx, y: top - 64, size: 9, font: F, color: BG });
      rtext('CONFIDENTIAL', R, top - 64, 8, FB, BG);
      rtext('Printed ' + pdfSafe(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })), R, top - 76, 8, F, BG);
      y = H - 134 - 6;
    }
    function newPage() { page = doc.addPage(); page.setSize(W, H); pages.push(page); header(); }
    function need(h) { if (y - h < BOTTOM) { newPage(); page.drawText(pdfSafe(app.name) + ' / online presence review (continued)', { x: L, y, size: 8, font: FI, color: BG }); y -= 16; } }
    function section(title) {
      need(36); y -= 6;
      page.drawText(pdfSafe(title).toUpperCase(), { x: L, y, size: 9.5, font: FB, color: NAVY });
      page.drawLine({ start: { x: L, y: y - 4 }, end: { x: R, y: y - 4 }, thickness: 0.5, color: GOLD });
      y -= 15;
    }
    function para(text, font, size, color, indent) {
      const lines = wrap(font || F, size || 9, text, CW - (indent || 0));
      lines.forEach(t => { need(LEAD); page.drawText(t, { x: L + (indent || 0), y, size: size || 9, font: font || F, color: color || INK }); y -= LEAD; });
    }
    function kvRow(label, value, fill, bar) {
      const ll = wrap(F, 9, label || '', 200), vl = wrap(FB, 9, value || '', CW - 230);
      const h = Math.max(1, ll.length, vl.length) * LEAD + 4;
      need(h);
      const rb = y - h + 9 + 2;
      if (fill) page.drawRectangle({ x: L, y: rb, width: CW, height: h, color: fill });
      if (bar) page.drawRectangle({ x: L, y: rb, width: 3, height: h, color: bar });
      ll.forEach((t, i) => page.drawText(t, { x: L + 8, y: y - i * LEAD, size: 9, font: F, color: INK }));
      vl.forEach((t, i) => page.drawText(t, { x: L + 218, y: y - i * LEAD, size: 9, font: FB, color: bar === RED ? RED : INK }));
      y -= h;
    }
    function noteLine(text) { if (!text) return; wrap(FI, 9, text, CW - 30).forEach(t => { need(LEAD); page.drawText(t, { x: L + 22, y, size: 9, font: FI, color: INK }); y -= LEAD; }); }
    newPage();
    // applicant block
    const age = ageFrom(pre.dob);
    page.drawText('APPLICANT', { x: L, y, size: 7, font: FB, color: BG }); page.drawText('REVIEW', { x: L + CW / 2, y, size: 7, font: FB, color: BG }); y -= 15;
    page.drawText(wrap(FB, 13, app.name, CW / 2 - 12)[0] || '', { x: L, y, size: 13, font: FB, color: NAVY });
    const sum = summary(app);
    page.drawText(pdfSafe(sum.label) + (app.status === 'reviewed' && app.reviewedAt ? ' ' + pdfSafe(fmtDate(app.reviewedAt)) : ''), { x: L + CW / 2, y, size: 13, font: FB, color: NAVY }); y -= 14;
    const line1 = [pre.dob ? 'DOB ' + pre.dob + (age !== null ? ' (' + age + ' yrs)' : '') : '', app.in.school ? 'School: ' + app.in.school : ''].filter(Boolean).join('   ');
    const line2 = [app.in.email, app.in.phone].filter(Boolean).join('   ');
    const who = (() => { const set = []; (app.trail || []).forEach(t => { if (t.by && !set.includes(t.by)) set.push(t.by); }); return set.join(', '); })();
    page.drawText(wrap(F, 9, line1, CW / 2 - 6)[0] || '', { x: L, y, size: 9, font: F, color: INK });
    page.drawText(wrap(F, 9, who ? 'Reviewed by ' + who : '', CW / 2 - 6)[0] || '', { x: L + CW / 2, y, size: 9, font: F, color: INK }); y -= 12;
    if (line2 || app.in.addr) { page.drawText(wrap(F, 9, line2, CW / 2 - 6)[0] || '', { x: L, y, size: 9, font: F, color: INK }); page.drawText(wrap(F, 9, app.in.addr ? 'Home: ' + app.in.addr : '', CW / 2 - 6)[0] || '', { x: L + CW / 2, y, size: 9, font: F, color: INK }); y -= 12; }
    // recommendation and result box
    y -= 8;
    const fc = flagCounts(app), rec = app.rec || {};
    const resLabel = (RESULTS.find(r => r[0] === adv.result) || [null, 'Not set'])[1];
    const recLabel = (RECS.find(r => r[0] === rec.v) || [null, 'Not set'])[1];
    page.drawRectangle({ x: L, y: y - 24, width: CW, height: 34, color: TINT, borderColor: NAVY, borderWidth: 0.75 });
    page.drawText('REVIEWER RECOMMENDATION', { x: L + 10, y: y - 2, size: 7, font: FB, color: BG });
    page.drawText(pdfSafe(recLabel), { x: L + 10, y: y - 16, size: 12, font: FB, color: rec.v === 'no' ? RED : NAVY });
    if (rec.by) page.drawText(pdfSafe('by ' + rec.by), { x: L + 10 + FB.widthOfTextAtSize(pdfSafe(recLabel), 12) + 8, y: y - 16, size: 8, font: F, color: BG });
    page.drawLine({ start: { x: L + CW / 2, y: y - 22 }, end: { x: L + CW / 2, y: y + 8 }, thickness: 0.5, color: BG });
    page.drawText('ADVISOR RESULT', { x: L + CW / 2 + 10, y: y - 2, size: 7, font: FB, color: BG });
    page.drawText(pdfSafe(resLabel), { x: L + CW / 2 + 10, y: y - 16, size: 12, font: FB, color: (adv.result === 'decline' || adv.result === 'concerns') ? RED : NAVY });
    rtext('CONCERNS', R - 60, y - 2, 7, FB, BG); rtext(String(fc.concern), R - 60, y - 16, 12, FB, fc.concern ? RED : NAVY);
    rtext('NOTES', R - 10, y - 2, 7, FB, BG); rtext(String(fc.note), R - 10, y - 16, 12, FB, fc.note ? AMBER : NAVY);
    y -= 46;
    if (rec.n) { para('Reviewer note: ' + rec.n, FI, 9); y -= 4; }
    if (adv.note) { para('Advisor note: ' + adv.note, FI, 9); y -= 4; }
    para('Scope: public content only. No passwords or logins were requested, no accounts were followed or contacted, no fake accounts were used, and nothing was saved from the applicant\'s accounts by the reviewer. Household findings are information for the advisor; the applicant\'s own conduct decides.', F, 8, BG);
    y -= 4;
    // accounts
    section('Accounts');
    const accts = app.accounts.filter(a => cleanHandle(a.handle) || a.st || a.note);
    if (!accts.length) para('No accounts recorded.', FI, 9);
    accts.forEach((a, i) => {
      const p = PLAT[a.plat] || PLAT.other, h = cleanHandle(a.handle);
      const st = (ACCT_ST.find(x => x[0] === a.st) || [null, 'Not checked'])[1];
      const val = [h || '(no handle)', st, a.rp === 'yes' ? 'right person' : (a.rp === 'no' ? 'identity not sure' : ''), a.src === 'found' ? 'NOT ON APPLICATION' : ''].filter(Boolean).join(' / ');
      kvRow(p.label, val, i % 2 ? TINT : null, a.src === 'found' ? AMBER : null);
      noteLine(a.note);
    });
    const know = app.know === 'yes' ? 'Reviewer knows the applicant outside the program: yes' : (app.know === 'no' ? 'Reviewer knows the applicant outside the program: no' : '');
    const idc = app.idc === 'yes' ? 'Identity confirmed' : (app.idc === 'no' ? 'Identity not confirmed' : 'Identity not marked');
    y -= 4; para([idc, know].filter(Boolean).join('.  '), FB, 9);
    // steps with opened links
    const stepLinks = { discovery: discoveryLinks(app), searches: searchLinks(app), image: imageLinks(app), public: app.pub.run === 'no' ? [] : publicLinks(app), household: householdLinks(app) };
    const plLinks = []; app.accounts.forEach(a => accountLinks(app, a).forEach(L => plLinks.push(L)));
    stepLinks.platforms = plLinks;
    section('Steps run');
    STEPS.filter(s => s[0] !== 'details' && s[0] !== 'categories' && s[0] !== 'identity').forEach(([k, title], i) => {
      const d = app.steps[k], list = stepLinks[k] || [];
      const opened = list.filter(L => app.opened[L.k]);
      let val = d && d.at ? 'Done ' + fmtDate(d.at) + (d.by ? ' by ' + d.by : '') : 'Not marked done';
      if (k === 'public') val += app.pub.run === 'no' ? ' / not run (under 17)' : (app.pub.res === 'found' ? ' / RECORD FOUND' : (app.pub.res === 'none' ? ' / nothing found' : ''));
      if (k === 'household') val += app.hh.rms === 'done' ? ' / RMS check done, results in folder' : ' / RMS check not marked';
      kvRow(title, val, i % 2 ? TINT : null, (k === 'public' && app.pub.res === 'found') ? RED : null);
      if (list.length) noteLine('Opened ' + opened.length + ' of ' + list.length + ' links' + (opened.length ? ': ' + opened.map(L => L.label.replace(/^(Google|Bing|WhatsMyName|Variant): /, '')).join('; ') : ''));
    });
    // records
    if ((app.hh.recs || []).length) {
      section('Records found');
      app.hh.recs.forEach((r, i) => {
        kvRow((r.who || 'Applicant') + ' / ' + (r.src || ''), [r.what, r.disp, r.date].filter(Boolean).join(' / '), i % 2 ? TINT : null, (r.disp === 'Convicted' || r.disp === 'Registered' || r.disp === 'Pending') ? RED : AMBER);
        noteLine(r.n);
      });
    }
    // categories
    section('What was found');
    CATEGORIES.forEach(([k, label], i) => {
      const c = app.cats[k] || {}, st = c.st || '';
      const lab = (k === 'c12' ? POS_CHIPS : CAT_CHIPS).find(x => x[0] === st);
      const fill = st === 'concern' ? FLAG : (st === 'note' ? LOOK : (st === 'noted' ? GOOD : (i % 2 ? TINT : null)));
      const bar = st === 'concern' ? RED : (st === 'note' ? AMBER : (st === 'noted' ? GREEN : null));
      kvRow(label, lab ? lab[1] : 'Not marked', fill, bar);
      noteLine(c.n);
    });
    // trail
    section('Activity');
    const tr = (app.trail || []).slice(-40);
    if (!tr.length) para('No activity recorded.', FI, 9);
    tr.forEach(t => para(fmtWhen(t.at) + '  ' + (t.by ? t.by + ': ' : '') + t.what, F, 8, BG));
    // sign-off
    need(34); y -= 20;
    page.drawText('Advisor:', { x: L, y, size: 9, font: F, color: INK });
    page.drawLine({ start: { x: L + 48, y: y - 2 }, end: { x: L + 290, y: y - 2 }, thickness: 0.5, color: BG });
    page.drawText('Date:', { x: L + 310, y, size: 9, font: F, color: INK });
    page.drawLine({ start: { x: L + 336, y: y - 2 }, end: { x: R, y: y - 2 }, thickness: 0.5, color: BG });
    pages.forEach((p, i) => {
      page = p;
      p.drawLine({ start: { x: L, y: 45 }, end: { x: R, y: 45 }, thickness: 0.5, color: GOLD });
      const addr = '200 N. Greenville Ave, Richardson, TX 75081  |  (972) 744-4801';
      p.drawText(addr, { x: (W - F.widthOfTextAtSize(addr, 7)) / 2, y: 34, size: 7, font: F, color: BG });
      p.drawText(PDF_LABEL, { x: L, y: 22, size: 7, font: F, color: BG });
      rtext('Page ' + (i + 1) + ' of ' + pages.length, R, 22, 7, F, BG);
    });
    return await doc.save();
  }

  global.RPDOpr = {
    BUILD, PLATFORMS, CATEGORIES, STEPS, RESULTS, RECS, GUIDE, STOP_RULES, SGT_NOTE,
    blankApp, fix, summary, flagCounts, log, variants, mount, buildPdf, noteModal, guideModal, cleanHandle,
    links: { account: accountLinks, discovery: discoveryLinks, searches: searchLinks, image: imageLinks, public: publicLinks, household: householdLinks }
  };
})(window);
