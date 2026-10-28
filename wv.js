/* wv.js  |  Build v2  |  updated 2026-10-28  |  v2: the /admin block lists who has signed, with Clear per person and Clear all, so someone who messed up can start over with the same code; clearing deletes those signatures and flips every tracker cell that had been auto-marked Received from them back to Missing (a cell already Filed is left alone and named in the toast). Build v1 notes: Online waiver signing (e-sign), shared by /waivers (public, no roster.js),
   /sgt, and /admin. Holds everything the three pages must agree on: the code recipe, the three online forms (wording,
   who signs, PDF field maps), the signature status rules, the envelope format, the PDF filling, and the panel block that
   /sgt and /admin show on each tracker row (code, status, Copy link, Share, QR, admin PDFs and contact merge).
   COUPLING: WV_SALT, WV_ITER, and derive() here are the only copy; /waivers, /sgt, and /admin all load this file, and
   roster.js holds none of it (roster.js only moves the sealed nodes). The code is the key: 8 characters from the same
   alphabet as the reference codes, PBKDF2 to a node id plus an AES key; nothing about a cadet is readable without it,
   and the signed records themselves are sealed to the reference RSA key, so only the full advisor passcode opens them.
   Firebase layout (all under roster/, written by the public page without any passcode):
     wvInvites/<id>  { blob:AES(code){ v, cadet, adult, forms, paper, parent:{name,phone,email}, cadetPhone, at, exp }, at, exp }
                     forms = the online forms still missing when the code was made; paper = the paper forms still missing
                     (PTC Release, Release of Liability, Medical), listed on the finish screen with downloads.
     wvSigs/<id>/<token>  one subtree per signer device:
        reg   { s:AES(code){ role:'cadet'|'parent', name, at, ua }, t }
        meta  { s:AES(code){ second:true|false, at }, t }            (parents only: does a second parent also sign)
        forms/<formKey>  { s:AES(code){ at, name, role }, e:RSA envelope to refPub { the full signed record }, t }
     wvCodes  records key, kept by roster.js (RPDRoster.esign): which code belongs to which cadet, plus contact merges.
   The signed record (inside e): { v, form, formVersion, id, token, role, cadet, name, phone, email, address, at,
     consent, consentAt, ua, sig:'data:image/png;base64,...', sigMode:'drawn'|'typed', second } */
(function (global) {
  'use strict';
  const WV_SALT = 'rpdcadets-waivers-v1';
  const WV_ITER = 100000;
  const WV_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I, L, O, 0, 1 (same as the reference codes)
  const WV_CODE_LEN = 8;
  const LINK_BASE = 'https://rpdcadets.com/waivers#';
  const ROOT = 'roster';
  const ONLINE_KEYS = ['psc', 'photo', 'sim'];
  const DAYS = 30;
  const CONSENT = 'I agree to sign these forms electronically. My electronic signature has the same force and effect as my handwritten signature, and I can download a copy of what I sign.';
  const enc = new TextEncoder(), dec = new TextDecoder();

  /* ── forms ─────────────────────────────────────────────────────────────── */
  const FORMS = {
    psc: {
      key: 'psc', title: 'Public Safety Cadets Agreement and Legal Waiver', short: 'PSC Agreement',
      file: 'Public_Safety_Cadets_Agreement_and_Legal_Waiver.pdf', version: '2026-10-28',
      roles: (adult, second) => adult ? ['cadet'] : ['cadet', 'parent1'],
      fields: { cadet: ['name'], parent: ['name', 'phone', 'email'] },
      html: `
<h4>Agreement and Legal Waiver</h4>
<p>I declare that all statements on this enrollment form and attachments are true and complete to the best of my knowledge. I understand that false, misleading, or incomplete information shall be cause for disqualification or termination from the Public Safety Cadets program (hereinafter "Cadets Program"). I understand that my participation in the Cadets Program is voluntary and at an "at will" status; and that the sponsoring agency/organization, acting through its Cadets Program Unit, is free to discharge me without cause and I am free to discontinue participation in the program at any time. I understand the importance of providing accurate medical information, I certify that all information provided is accurate, and I acknowledge that there are no undisclosed physical limitations that would prevent me from participating in all aspects of the Cadets Program. I understand that participation in the Cadets Program involves the risk of personal injury, including death, due to the physical, mental, and emotional challenges of the Cadet Program activities. I agree that approved Mentors and program volunteers may provide transport during Cadets Program activities. I also understand that in the event of serious illness or injury, reasonable efforts will be made to contact the parent or guardian, if listed below.</p>
<h4>Agreement Assuming Risk of Injury or Damage, Waiver and Release of Claims</h4>
<p>With appreciation of the dangers and risks associated with the Cadets Program, I hereby release, acquit and forever discharge the Public Safety Cadets, the partnering agency/organization and its officers, agencies, and employees of and from any and all rights, claims, demands, actions, causes of action, damages, costs, losses of services, compensation, and debts, including attorney's fees (collectively "claims") which I may have against the Cadets Program, whether known or unknown, which result from, arise from, or are related in any way to my participation in the Cadets Program or any activities or events related thereto. I hereby agree to hold harmless Public Safety Cadets and the partnering agency/organization from and against any and all claims which result from, arise from, or are related in any way to my participation in the Cadets Program excluding only claims that are attributable to the gross negligence or willful misconduct of Public Safety Cadets and/or the partnering agency/organization.</p>
<p>Should I require emergency medical care while participating in the Cadet Program, I hereby give sponsoring agency/organization personnel my permission to use their judgment in obtaining care for me and I give permission to the medical care provider selected by the Cadet Program personnel to render medical care deemed necessary and appropriate. Such consent includes any x-ray examination, anesthetic, medical or surgical diagnostic or treatment and/or hospital service that may be rendered. I understand that Public Safety Cadets or the sponsoring agency/organization is not obligated to provide medical treatment and that any cost incurred for treatment provided which is not covered by insurance shall be my sole responsibility. I warrant that I understand the content of the foregoing authorization and release. My signature, hereon, is my own free act and it is my intention to be legally bound hereby.</p>
<h4>Waiver for Consent for Photographs</h4>
<p>I do hereby consent to being photographed, by professional and/or amateur photographers, while participating in any detail, event, function, or activity related to the Cadets Program. I also give my consent for the Public Safety Cadets and/or the partnering agency/organization, including any Division or unit therein to use my name, likeness, image, appearance, and biographical information ("Image"), in, on or in connection with any photographs, pictures, digital images, websites programs, printed materials and any and all media, whether now known or hereafter developed, throughout the world at any time, for the legitimate purposes of Public Safety Cadets. I hereby expressly waive all claims for royalties or other compensation related to any such use of my Image or related information and release Public Safety Cadets and the partnering agency/organization from any and all liability which may arise as a result of being photographed while participating in the Cadets Program, and for the subsequent use and display of the Image. I understand that this consent/waiver and release will remain in effect until such time that it is revoked, in writing, by me. Public Safety Cadets and the sponsoring agency/organization retains the right to use the aforementioned Image for the purposes stated herein, whether or not I continue to be involved in the Cadets Program, absent my written revocation of consent.</p>
<p>I understand that Public Safety Cadets shall have no obligation to use the Image, and that all creative decisions regarding the use of the Image shall be at the sole discretion of Public Safety Cadet's or the sponsoring agency/organization.</p>
<p>By signing below, all Cadet Applicants, Parents, Guardians, Partnering Agency/Organization Unit Mentors have read, understand, and agree to all conditions listed herein.</p>
<p>I acknowledge and agree that this Release &amp; Waiver is binding upon me, my heirs, assigns and legal representatives:</p>
<p class="wv-minor">If participant is a minor child, I, as his/her parent/legal guardian, agree on his/her behalf.</p>`
    },
    photo: {
      key: 'photo', title: 'Photo and Video Release', short: 'Photo Release',
      file: 'Photo_Video_Release.pdf', version: '2026-10-28',
      roles: (adult, second) => adult ? ['cadet'] : (second ? ['cadet', 'parent1', 'parent2'] : ['cadet', 'parent1']),
      fields: { cadet: ['name', 'phone', 'address'], parent: ['name', 'phone', 'email', 'address'] },
      html: `
<p>The Richardson Police Department may take photographs and videos of Cadets and those participating in our Richardson Police Department Public Safety Cadets program. These photos and videos are used for promotion of the program to the public. The Photo Release below is used to give permission for us to do this.</p>
<h4>Cadet</h4>
<p>I, <span class="wv-blank" data-blank="cadet">the cadet named above</span>, hereby authorize and consent to the use of my visual image by the City of Richardson and the Richardson Police Department Public Safety Cadets for appropriate purposes, including but not limited to: still photography, videotape, electronic and print publications, websites, and artificial intelligence (AI)-generated or AI-edited content, including the use of my likeness in AI-generated images, videos, or other media. I give this consent, irrevocably, with no claim for payment.</p>
<h4>Parent or legal guardian</h4>
<p class="wv-minor">If the person named above is under 18 years old, his or her parent or legal guardian must sign below.</p>
<p>I, <span class="wv-blank" data-blank="parent">the parent or guardian signing</span>, Parent/Guardian of <span class="wv-blank" data-blank="cadet">the cadet named above</span>, hereby authorize and consent to the use of his/her visual image by the City of Richardson and the Richardson Police Department Public Safety Cadets for appropriate purposes, including but not limited to: still photography, videotape, electronic and print publications, websites, and artificial intelligence (AI)-generated or AI-edited content, including the use of his/her likeness in AI-generated images, videos, or other media. I give this consent, irrevocably, with no claim for payment.</p>
<p class="wv-minor">If the parents are divorced, the signature of the other parent is also required unless sole legal custody has been granted to one parent.</p>`
    },
    sim: {
      key: 'sim', title: 'Non-Lethal Training Firearm (Simunitions) Release of Liability', short: 'Simunitions',
      file: 'Simunitions_NLTF_Waiver.pdf', version: '2026-10-28',
      roles: (adult, second) => adult ? ['cadet'] : (second ? ['parent1', 'parent2'] : ['parent1']),
      fields: { cadet: ['name'], parent: ['name', 'phone', 'email'] },
      html: `
<p>This Release applies to all of the Cadet's participation in Non-Lethal Training Firearm (NLTF) / Simunitions force-on-force scenario training, wherever and whenever it is conducted and regardless of location or facility, supervised by qualified instructors and range safety officers. I understand this training involves the discharge of non-lethal marking cartridges and carries inherent risks, including personal injury, welts, bruising, eye or skin injury, and in rare cases serious injury or death. I agree to use all required protective equipment, including approved eye and full-face protection, to follow instructor and range safety officer direction, and I understand no live firearms or ammunition are permitted in the training area.</p>
<p>With appreciation of these risks, and in consideration of the privilege of participation, I release, acquit, forever discharge, and covenant not to sue Public Safety Cadets, the Richardson Police Department, the City of Richardson, the partnering agency/organization, and the owner or operator of any facility or property where the training is conducted, and their officials, officers, agents, and employees, in both their public and private capacities (the "Released Parties"), from any and all claims, demands, causes of action, damages, costs, losses, and expenses, including attorney's fees, for personal injury, property damage, or death, whether known or unknown, arising in any way from this training, including any wrongful death claim pursuant to TEX. CIV. PRAC. &amp; REM. CODE ANN. ch. 71, et. seq. (Vernon 1986) and any survival action pursuant to TEX. CIV. PRAC. &amp; REM. CODE ANN. sec. 71.021 (Vernon 1986), excepting only claims attributable to the gross negligence or willful misconduct of the Released Parties.</p>
<p>I assume all risk of participation and agree to hold harmless, defend, and indemnify the Released Parties from all such claims. This Release does not waive the City of Richardson's governmental immunity or any other defense available under law. I represent that I am of sound mind, have read and understand this Release, and agree to its terms, which bind me, my heirs, assigns, and legal representatives.</p>
<h4>Section A: adult cadet (18 years and older)</h4>
<p class="wv-minor">Complete if the Cadet is 18 or older and signs for themselves.</p>
<h4>Section B: minor cadet (under 18), parent or legal guardian</h4>
<p class="wv-minor">One parent/guardian signs; a second signs only if parents are unmarried or divorced with shared rights.</p>`
    }
  };
  const ROLE_LABEL = { cadet: 'the cadet', parent1: 'a parent or guardian', parent2: 'the second parent or guardian' };
  // Forms that stay on paper. The finish screen on /waivers lists the ones the tracker shows missing, with a download
  // for each, so a family that never got the paper copy can print it, have it notarized where needed, and hand it in.
  const PAPER = {
    ptc: { key: 'ptc', title: 'Police Training Center Waiver', file: 'PTC_Release_of_Liability.pdf', notary: true, who: 'The cadet and a parent or guardian sign in front of a notary.' },
    liability: { key: 'liability', title: 'Release of Liability', notary: true, who: 'Signed in front of a notary.',
      versions: [
        { id: 'adult', label: 'Adult cadet (18 or older)', file: 'Release_of_Liability_Adult.pdf' },
        { id: 'married', label: 'Minor cadet: married parents or a single guardian', file: 'Release_of_Liability_Minor_MarriedParents.pdf' },
        { id: 'divorced', label: 'Minor cadet: divorced parents', file: 'Release_of_Liability_Minor_DivorcedParents.pdf' }
      ] },
    med: { key: 'med', title: 'Permission for Medical Treatment', file: 'Parent_Permission_Medical_Consent.pdf', notary: false, who: 'A parent or guardian signs; no notary.' }
  };
  const PAPER_KEYS = ['ptc', 'liability', 'med'];

  /* ── codes and keys ────────────────────────────────────────────────────── */
  function normalizeCode(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function formatCode(code) { const n = normalizeCode(code); return n.length === 8 ? n.slice(0, 4) + '-' + n.slice(4) : n; }
  function newCode() {
    let out = '';
    while (out.length < WV_CODE_LEN) {
      const buf = crypto.getRandomValues(new Uint8Array(32));
      for (let i = 0; i < buf.length && out.length < WV_CODE_LEN; i++) if (buf[i] < 248) out += WV_ALPHA[buf[i] % 31];
    }
    return out;
  }
  // code -> { id (32 hex chars), key (32 bytes) }
  async function derive(code) {
    const km = await crypto.subtle.importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(WV_SALT), iterations: WV_ITER, hash: 'SHA-256' }, km, 384));
    return { id: Array.from(bits.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(''), key: bits.slice(16, 48) };
  }
  function link(code) { return LINK_BASE + formatCode(code); }
  function b64ToArr(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function arrToB64(arr) { let s = ''; const a = new Uint8Array(arr); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  // 'ivB64.ctB64', AES-GCM, raw 32-byte key: the same blob format roster.js uses everywhere
  async function keyEncrypt(plaintext, rawKeyBytes) {
    const key = await crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
    return arrToB64(iv) + '.' + arrToB64(ct);
  }
  async function keyDecrypt(blob, rawKeyBytes) {
    const [ivB64, dataB64] = String(blob).split('.');
    const key = await crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToArr(ivB64) }, key, b64ToArr(dataB64)));
  }
  // RSA-OAEP envelope to the reference public key: a fresh AES key per record, sealed so only the full advisor passcode opens it
  async function envelope(plainJson, pubJwkTxt) {
    const pubKey = await crypto.subtle.importKey('jwk', JSON.parse(pubJwkTxt), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const aes = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', aes, { name: 'AES-GCM' }, false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plainJson)));
    const ek = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, aes));
    return arrToB64(ek) + '.' + arrToB64(iv) + '.' + arrToB64(ct);
  }
  function newToken() { const b = crypto.getRandomValues(new Uint8Array(12)); return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); }

  /* ── signer status ─────────────────────────────────────────────────────── */
  function normName(n) { return String(n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  // raw = the wvSigs/<id> node; returns one entry per signer device with the code-key stubs decoded
  async function decodeSigs(raw, key) {
    const out = [];
    for (const token of Object.keys(raw || {})) {
      const node = raw[token] || {}; let reg = null, meta = null; const forms = {};
      try { if (node.reg && node.reg.s) reg = JSON.parse(await keyDecrypt(node.reg.s, key)); } catch (e) { }
      try { if (node.meta && node.meta.s) meta = JSON.parse(await keyDecrypt(node.meta.s, key)); } catch (e) { }
      for (const k of Object.keys(node.forms || {})) {
        try { const st = JSON.parse(await keyDecrypt(node.forms[k].s, key)); st.t = node.forms[k].t || 0; st.hasEnv = !!node.forms[k].e; forms[k] = st; } catch (e) { }
      }
      if (!reg) continue;
      out.push({ token, role: reg.role, name: reg.name || '', at: reg.at || 0, t: (node.reg && node.reg.t) || 0, meta, forms });
    }
    return out.sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  // Roles: the first cadet signer is the cadet; parent signers are grouped by name so a parent who continues on another
  // phone stays one person; the first parent name is parent1, the next is parent2. Same-role devices pool their forms.
  function assignRoles(signers) {
    const slots = { cadet: null, parent1: null, parent2: null };
    const merge = (slot, s) => {
      if (!slots[slot]) { slots[slot] = { name: s.name, tokens: [s.token], forms: {}, meta: s.meta || null, at: s.at }; }
      else { slots[slot].tokens.push(s.token); if (!slots[slot].meta && s.meta) slots[slot].meta = s.meta; if (s.meta && s.meta.second === true) slots[slot].meta = s.meta; }
      Object.keys(s.forms || {}).forEach(k => { const f = s.forms[k]; if (!slots[slot].forms[k] || (f.at || 0) < (slots[slot].forms[k].at || 0)) slots[slot].forms[k] = Object.assign({ token: s.token }, f); });
    };
    const parentsByName = [];
    (signers || []).forEach(s => {
      if (s.role === 'cadet') { merge('cadet', s); return; }
      if (s.role !== 'parent') return;
      const key = normName(s.name);
      let g = parentsByName.find(x => x.key === key);
      if (!g) { g = { key, list: [] }; parentsByName.push(g); }
      g.list.push(s);
    });
    parentsByName.slice(0, 2).forEach((g, i) => g.list.forEach(s => merge(i === 0 ? 'parent1' : 'parent2', s)));
    return { slots, extraParents: parentsByName.slice(2).map(g => g.list[0].name) };
  }
  function status(invite, signers) {
    const { slots, extraParents } = assignRoles(signers);
    const adult = !!(invite && invite.adult);
    const second = !adult && (!!slots.parent2 || (signers || []).some(s => s.meta && s.meta.second === true));
    const answered = (signers || []).some(s => s.meta && typeof s.meta.second === 'boolean');
    const forms = {}; let allComplete = true;
    ((invite && invite.forms) || []).forEach(k => {
      const F = FORMS[k]; if (!F) return;
      const needed = F.roles(adult, second);
      const signed = {}; let at = 0, by = [];
      needed.forEach(r => { const sl = slots[r]; if (sl && sl.forms[k]) { signed[r] = { at: sl.forms[k].at || 0, t: sl.forms[k].t || 0, name: sl.name, token: sl.forms[k].token }; at = Math.max(at, sl.forms[k].at || 0); by.push(sl.name); } });
      const waiting = needed.filter(r => !signed[r]);
      const complete = waiting.length === 0;
      if (!complete) allComplete = false;
      forms[k] = { needed, signed, waiting, complete, at, by, title: F.title, short: F.short };
    });
    return { adult, second, answered, slots, extraParents, forms, allComplete };
  }
  function roleLabel(r) { return ROLE_LABEL[r] || r; }
  function dateIso(ms) { const d = new Date(ms || Date.now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtDate(ms) { if (!ms) return ''; return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fmtDateTime(ms) { if (!ms) return ''; return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ── PDF filling (pdf-lib) ─────────────────────────────────────────────── */
  // data = { cadet, sections:{ cadet:{name,phone,address,email,date,sig}, parent1:{...}, parent2:{...} } }
  // sig is a PNG data URL. Fields the signer never filled stay blank. The form is flattened on the way out.
  async function fillPdf(PDFLib, formKey, blankBytes, data) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.load(blankBytes);
    const page = doc.getPages()[0];
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sec = data.sections || {};
    const S = r => sec[r] || null;
    const txt = (page, s, x, y, size) => { if (s) page.drawText(String(s), { x, y, size: size || 9, font, color: rgb(0.1, 0.1, 0.1) }); };
    async function sigAt(page, s, x, y, w, h) {
      if (!s || !s.sig) return;
      try {
        const b64 = String(s.sig).split(',')[1]; const png = await doc.embedPng(b64ToArr(b64));
        const sc = Math.min(w / png.width, h / png.height); const dw = png.width * sc, dh = png.height * sc;
        page.drawImage(png, { x, y: y + (h - dh) / 2, width: dw, height: dh });
      } catch (e) { }
    }
    const form = doc.getForm();
    const setField = (name, v) => { try { const f = form.getTextField(name); f.setText(v == null ? '' : String(v)); } catch (e) { } };
    const rectOf = name => { try { const f = form.getTextField(name); const w = f.acroField.getWidgets()[0]; const r = w.getRectangle(); return { x: r.x, y: r.y, w: r.width, h: r.height }; } catch (e) { return null; } };
    const sigField = async (name, s) => { const r = rectOf(name); if (!r) return; setField(name, ''); await sigAt(page, s, r.x + 2, r.y - 3, r.w - 4, r.h + 8); };
    if (formKey === 'photo') {
      const c = S('cadet'), p1 = S('parent1'), p2 = S('parent2');
      setField('f_1', data.cadet); setField('f_8', data.cadet);
      if (c) { setField('f_2', c.name); setField('f_4', c.address); setField('f_5', c.date); setField('f_6', c.phone); }
      if (p1) { setField('f_7', p1.name); setField('f_9', p1.name); setField('f_11', p1.address); setField('f_12', p1.date); setField('f_13', p1.phone); }
      if (p2) { setField('f_14', p2.name); setField('f_16', p2.address); setField('f_17', p2.date); setField('f_18', p2.phone); }
      form.updateFieldAppearances(font);
      await sigField('f_3', c); await sigField('f_10', p1); await sigField('f_15', p2);
      form.flatten();
    } else if (formKey === 'sim') {
      const c = S('cadet'), p1 = S('parent1'), p2 = S('parent2');
      const first = [c, p1, p2].filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0))[0];
      setField('f_1', data.cadet); setField('f_2', first ? first.date : '');
      if (c) { setField('f_4', c.date); setField('f_5', c.name); }
      if (p1) { setField('f_7', p1.date); setField('f_8', p1.name); }
      if (p2) { setField('f_10', p2.date); setField('f_11', p2.name); }
      form.updateFieldAppearances(font);
      await sigField('f_3', c); await sigField('f_6', p1); await sigField('f_9', p2);
      form.flatten();
    } else if (formKey === 'psc') {
      // no fillable fields on the PSC form: text and signatures go on the blank lines (page is 612 x 792, origin bottom-left)
      const c = S('cadet'), p1 = S('parent1');
      if (c) { await sigAt(page, c, 132, 206, 190, 24); txt(page, c.date, 418, 207, 9.5); txt(page, c.name, 145, 179, 9.5); }
      if (p1) { await sigAt(page, p1, 166, 122, 158, 24); txt(page, p1.date, 418, 123, 9.5); txt(page, p1.name, 116, 86, 9.5); }
    }
    return await doc.save();
  }

  /* ── QR (qrcode-generator must be loaded on the page that asks for one) ── */
  function qrSvg(text) {
    if (typeof global.qrcode !== 'function') return '';
    const q = global.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  }

  /* ── panel block for /sgt and /admin ──────────────────────────────────────
     host = { admin:bool, rec(name)->Cadet Records entry or {}, sum(name)->waiver summary, toast(msg), rerender(),
              who()->string (name stamped on tracker marks), recSave(name, patch)->Promise (admin only) }
     Lifecycle: init(host) once; refresh() after every tracker render: fills every [data-wvo] placeholder. */
  const P = { host: null, codes: null, loading: false, sigs: {}, inv: {}, st: {}, envs: {}, ready: false, err: '', memo: {} };
  // PBKDF2 is deliberately slow; remember each code's id and key for the session so Refresh does not re-derive every code
  async function pDerive(code) { if (!P.memo[code]) P.memo[code] = await derive(code); return P.memo[code]; }
  function pInit(host) { P.host = host; injectCss(); }
  async function pLoad() {
    if (!global.RPDRoster || !RPDRoster.esign) { P.err = 'esign module missing'; return; }
    try { P.codes = (await RPDRoster.esign.codesGet()) || { v: 1, cadets: {} }; P.err = ''; }
    catch (e) { P.codes = P.codes || { v: 1, cadets: {} }; P.err = 'codes'; }
    P.ready = true;
    const names = Object.keys(P.codes.cadets || {});
    for (const name of names) {
      const c = P.codes.cadets[name]; if (!c || !c.code || c.closed) continue;
      try {
        const d = await pDerive(c.code);
        const rawInv = await RPDRoster.esign.inviteGet(d.id);
        let inv = null;
        if (rawInv && rawInv.blob) { try { inv = JSON.parse(await keyDecrypt(rawInv.blob, d.key)); } catch (e) { inv = null; } }
        if (!inv) inv = { v: 1, cadet: name, adult: !!c.adult, forms: c.forms || [], parent: {}, at: c.at, exp: c.exp, missing: true };
        const raw = await RPDRoster.esign.sigsGet(d.id);
        const signers = await decodeSigs(raw, d.key);
        P.inv[name] = inv; P.sigs[name] = signers; P.st[name] = status(inv, signers);
        P.st[name]._id = d.id; P.st[name]._key = d.key; P.st[name]._raw = raw;
      } catch (e) { P.st[name] = null; }
    }
    await pMerge();
  }
  // Mark Received in the tracker for every online form that now has all its signatures. The decision is made
  // inside the mutate, against the freshly read tracker, so a mark made from the other panel (or a paper mark)
  // is never overwritten and nothing is marked twice.
  async function pMerge() {
    const cand = [];
    Object.keys(P.st).forEach(name => {
      const st = P.st[name]; if (!st) return;
      Object.keys(st.forms).forEach(k => { const f = st.forms[k]; if (f.complete) cand.push({ name, k, f, id: st._id }); });
    });
    if (!cand.length) return;
    const done = [];
    try {
      await RPDRoster.waivers.mutate(obj => {
        cand.forEach(x => {
          const rec = P.host.rec(x.name) || {};
          const c = obj.cadets[x.name] || {};
          const stt = RPDRoster.waivers.status(x.k, c[x.k], rec.waiverSet, rec.dob);
          if (stt.state !== 'missing' && stt.state !== 'resign') return;   // paper, or already marked (from either panel)
          const prev = c[x.k];
          c[x.k] = { s: 'received', rAt: dateIso(x.f.at), rBy: 'Online: ' + x.f.by.join(', '), at: Date.now(), via: 'online', wvId: x.id, prev: (prev && prev.s) ? prev : undefined };
          obj.cadets[x.name] = c; done.push(x);
        });
        return done.length ? undefined : false;   // nothing to write: skip the save
      });
    } catch (e) { return; }
    if (!done.length) return;
    if (P.host.rerender) await P.host.rerender();
    if (P.host.toast) P.host.toast(done.length === 1 ? 'Online signature received: ' + FORMS[done[0].k].short + ' for ' + done[0].name : done.length + ' online signatures received');
  }
  function pForms(name) {   // which online forms this cadet still needs, from the tracker
    const sum = P.host.sum(name); if (!sum) return [];
    return ONLINE_KEYS.filter(k => { const c = sum.cells[k]; return c && (c.state === 'missing' || c.state === 'resign'); });
  }
  function pPaper(name) {   // paper forms still missing, carried in the code so the finish screen can list them
    const sum = P.host.sum(name); if (!sum) return [];
    return PAPER_KEYS.filter(k => { const c = sum.cells[k]; return c && (c.state === 'missing' || c.state === 'resign'); });
  }
  async function pGenerate(name) {
    const rec = P.host.rec(name) || {}; const sum = P.host.sum(name);
    const forms = pForms(name); if (!forms.length) { P.host.toast('Nothing to sign online for ' + name); return; }
    const adult = !!(sum && sum.age && sum.age.adult);
    const code = newCode(); const d = await derive(code);
    const at = Date.now(), exp = at + DAYS * 86400000;
    const inv = { v: 1, cadet: name, adult, forms, paper: pPaper(name), parent: { name: rec.parentName || '', phone: rec.parentPhone || '', email: rec.parentEmail || '' }, parent2: { name: rec.parent2Name || '', phone: rec.parent2Phone || '', email: rec.parent2Email || '' }, cadetPhone: rec.phone || '', cadetEmail: rec.email || '', at, exp };
    const blob = await keyEncrypt(JSON.stringify(inv), d.key);
    await RPDRoster.esign.inviteSet(d.id, { blob, at, exp });
    P.codes = await RPDRoster.esign.codesMutate(obj => {
      const old = obj.cadets[name];
      if (old && old.code) { obj.history = obj.history || []; obj.history.push(Object.assign({ cadet: name, closedAt: at }, old)); }
      obj.cadets[name] = { code, id: d.id, at, exp, forms, adult, by: P.host.who ? P.host.who() : '' };
    });
    P.inv[name] = inv; P.sigs[name] = []; P.st[name] = status(inv, []); P.st[name]._id = d.id; P.st[name]._key = d.key; P.st[name]._raw = null;
    pFill(name);
  }
  async function pCancel(name) {
    const c = (P.codes.cadets || {})[name]; if (!c) return;
    if (!confirm('Cancel the online code for ' + name + '? Signatures already made stay on file; the link stops working.')) return;
    try { await RPDRoster.esign.inviteRemove(c.id); } catch (e) { }
    P.codes = await RPDRoster.esign.codesMutate(obj => { const old = obj.cadets[name]; if (old) { obj.history = obj.history || []; obj.history.push(Object.assign({ cadet: name, closedAt: Date.now() }, old)); } delete obj.cadets[name]; });
    delete P.st[name]; delete P.inv[name]; pFill(name);
  }
  function pFill(name) {
    document.querySelectorAll('[data-wvo]').forEach(el => { if (!name || el.dataset.wvo === name) el.innerHTML = pBlockHtml(el.dataset.wvo); });
  }
  function pBlockHtml(name) {
    if (!P.ready) return '<div class="wvo"><span class="wvo-muted">Online signing: loading…</span></div>';
    const c = (P.codes && P.codes.cadets || {})[name]; const st = P.st[name];
    const need = pForms(name);
    if (!c || !c.code) {
      if (!need.length) return '';
      return `<div class="wvo"><button type="button" class="wvo-btn gen" data-wvoact="gen" data-wvoname="${esc(name)}">Online code</button><span class="wvo-muted">${need.map(k => FORMS[k].short).join(', ')} can be signed online</span></div>`;
    }
    const expired = c.exp && Date.now() > c.exp;
    let rows = '';
    if (st) {
      rows = Object.keys(st.forms).map(k => {
        const f = st.forms[k];
        if (f.complete) return `<span class="wvo-f ok">${esc(FORMS[k].short)}: signed ${esc(fmtDate(f.at))}${f.by.length ? ' by ' + esc(f.by.join(', ')) : ''}</span>`;
        const have = Object.keys(f.signed).map(r => f.signed[r].name);
        return `<span class="wvo-f wait">${esc(FORMS[k].short)}: waiting on ${esc(f.waiting.map(roleLabel).join(' and '))}${have.length ? ' (signed by ' + esc(have.join(', ')) + ')' : ''}</span>`;
      }).join('');
      if (st.extraParents.length) rows += `<span class="wvo-f wait">Extra parent signatures not counted: ${esc(st.extraParents.join(', '))}</span>`;
    } else rows = '<span class="wvo-f wait">Could not read the signing status right now.</span>';
    const pdfs = (P.host.admin && st) ? Object.keys(st.forms).filter(k => Object.keys(st.forms[k].signed).length).map(k => `<button type="button" class="wvo-btn" data-wvoact="pdf" data-wvoname="${esc(name)}" data-wvoform="${k}">${esc(FORMS[k].short)} PDF${st.forms[k].complete ? '' : ' (partial)'}</button>`).join('') : '';
    // admin: who has signed, each with a Clear so that person can start over
    let people = '';
    if (P.host.admin && st) {
      const who = ['cadet', 'parent1', 'parent2'].filter(r => st.slots[r] && Object.keys(st.slots[r].forms).length);
      if (who.length) people = `<div class="wvo-people"><span class="wvo-muted">Signed so far:</span>${who.map(r => `<span class="wvo-person">${esc(st.slots[r].name)} (${r === 'cadet' ? 'cadet' : (r === 'parent1' ? 'parent or guardian' : 'other parent')})<button type="button" class="wvo-btn danger" data-wvoact="clear" data-wvoname="${esc(name)}" data-wvoslot="${r}">Clear</button></span>`).join('')}<button type="button" class="wvo-btn danger" data-wvoact="clearall" data-wvoname="${esc(name)}">Clear all</button></div>`;
    }
    return `<div class="wvo${st && st.allComplete ? ' done' : ''}">
      <div class="wvo-head"><span class="wvo-l">Online signing</span><span class="wvo-code">${esc(formatCode(c.code))}</span><span class="wvo-muted">${expired ? 'expired ' : 'expires '}${esc(fmtDate(c.exp))}${st && st.allComplete ? ' · all signed' : ''}</span></div>
      <div class="wvo-forms">${rows}</div>${people}
      <div class="wvo-acts">
        <button type="button" class="wvo-btn" data-wvoact="copy" data-wvoname="${esc(name)}">Copy link</button>
        <button type="button" class="wvo-btn" data-wvoact="share" data-wvoname="${esc(name)}">Share</button>
        <button type="button" class="wvo-btn" data-wvoact="qr" data-wvoname="${esc(name)}">QR</button>
        ${pdfs}
        <button type="button" class="wvo-btn" data-wvoact="refresh" data-wvoname="${esc(name)}">Refresh</button>
        <button type="button" class="wvo-btn" data-wvoact="new" data-wvoname="${esc(name)}">New code</button>
        <button type="button" class="wvo-btn danger" data-wvoact="cancel" data-wvoname="${esc(name)}">Cancel</button>
      </div></div>`;
  }
  async function pRefresh() {
    if (!P.host) return;
    if (!P.loading) { P.loading = true; pFill(); try { await pLoad(); } finally { P.loading = false; } }
    pFill();
  }
  async function pAct(act, name, formKey, btn) {
    const c = (P.codes.cadets || {})[name];
    const url = c ? link(c.code) : '';
    try {
      if (act === 'gen' || act === 'new') { if (act === 'new' && !confirm('Issue a new code for ' + name + '? The old code stops working; signatures already made stay on file.')) return; btn.disabled = true; await pGenerate(name); return; }
      if (act === 'cancel') { await pCancel(name); return; }
      if (act === 'refresh') { btn.disabled = true; await pRefresh(); return; }
      if (act === 'copy') { await navigator.clipboard.writeText(url); P.host.toast('Link copied'); return; }
      if (act === 'share') { if (navigator.share) { await navigator.share({ title: 'Cadet waivers to sign', text: 'Richardson PD Public Safety Cadets: waivers for ' + name + ' to sign online. Code ' + formatCode(c.code), url }); } else { await navigator.clipboard.writeText(url); P.host.toast('Sharing is not available here; link copied instead'); } return; }
      if (act === 'qr') { qrPopup(url, formatCode(c.code), name); return; }
      if (act === 'pdf') { btn.disabled = true; try { await pPdf(name, formKey); } finally { btn.disabled = false; } return; }
      if (act === 'clear' || act === 'clearall') { btn.disabled = true; await pClear(name, act === 'clearall' ? 'all' : btn.dataset.wvoslot); return; }
    } catch (e) { if (P.host.toast) P.host.toast('That did not work: ' + (e && e.message ? e.message : e)); }
  }
  // Admin: delete one person's signatures (or all of them) so they can start over with the same code, then put the
  // tracker back for any cell that had been auto-marked from this code and is no longer complete.
  async function pClear(name, slot) {
    const st = P.st[name]; if (!st) return;
    const who = slot === 'all' ? 'everyone' : ((st.slots[slot] || {}).name || slot);
    if (!confirm('Delete the online signatures for ' + who + ' on ' + name + '? They can sign again with the same code. Tracker cells marked from those signatures go back to Missing.')) { pFill(name); return; }
    if (slot === 'all') await RPDRoster.esign.sigsClear(st._id);
    else for (const tok of ((st.slots[slot] || {}).tokens || [])) await RPDRoster.esign.sigsRemove(st._id, tok);
    const raw = await RPDRoster.esign.sigsGet(st._id);
    const signers = await decodeSigs(raw, st._key);
    const next = status(P.inv[name], signers); next._id = st._id; next._key = st._key; next._raw = raw;
    P.sigs[name] = signers; P.st[name] = next;
    // revert tracker marks that came from this code and are no longer earned (decided against the fresh tracker)
    const revert = [], filed = [];
    try {
      await RPDRoster.waivers.mutate(obj => {
        const c = obj.cadets[name] || {};
        ONLINE_KEYS.forEach(k => {
          const e = c[k]; if (!e || e.via !== 'online' || e.wvId !== st._id) return;
          if (next.forms[k] && next.forms[k].complete) return;
          if (e.s === 'filed') { filed.push(FORMS[k].short); return; }
          let prev = e.prev; while (prev && prev.via === 'online' && prev.wvId === st._id) prev = prev.prev;   // never fall back onto a mark from this same code
          if (prev && prev.s) c[k] = prev; else delete c[k];
          revert.push(k);
        });
        if (!revert.length) return false;
        obj.cadets[name] = c;
      });
    } catch (e) { }
    if (P.host.rerender) await P.host.rerender(); else pFill(name);
    if (P.host.toast) P.host.toast('Signatures cleared for ' + who + (revert.length ? '; ' + revert.map(k => FORMS[k].short).join(', ') + ' back to Missing' : '') + (filed.length ? '. Already filed, left as is: ' + filed.join(', ') : ''));
  }
  function qrPopup(url, code, name) {
    let m = document.getElementById('wvoQr');
    if (!m) {
      m = document.createElement('div'); m.id = 'wvoQr'; m.className = 'wvo-qr';
      m.innerHTML = '<div class="wvo-qr-card"><button type="button" class="wvo-qr-x" aria-label="Close">&times;</button><div class="wvo-qr-svg"></div><div class="wvo-qr-code"></div><div class="wvo-qr-hint"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('wvo-qr-x')) m.classList.remove('show'); });
    }
    const svg = qrSvg(url);
    m.querySelector('.wvo-qr-svg').innerHTML = svg || '<div style="padding:30px;color:#5b6b82">QR library not loaded</div>';
    m.querySelector('.wvo-qr-code').textContent = code;
    m.querySelector('.wvo-qr-hint').textContent = 'rpdcadets.com/waivers · ' + name;
    m.classList.add('show');
  }
  // Admin: open the envelopes for one form and build the signed PDF
  async function pPdf(name, formKey) {
    const st = P.st[name]; if (!st || !st.forms[formKey]) return;
    if (!RPDRoster.references.isUnlocked()) throw new Error('needs the full advisor passcode');
    if (P.host.loadPdfLib) await P.host.loadPdfLib();
    const data = { cadet: name, sections: {} };
    const f = st.forms[formKey];
    for (const role of Object.keys(f.signed)) {
      const sig = f.signed[role]; const node = ((st._raw || {})[sig.token] || {}).forms || {};
      const env = node[formKey] && node[formKey].e; if (!env) continue;
      const rec = await RPDRoster.esign.open(env);
      data.sections[role] = { name: rec.name || sig.name, phone: rec.phone || '', email: rec.email || '', address: rec.address || '', date: fmtDateUS(rec.at || sig.at), at: rec.at || sig.at, sig: rec.sig || '' };
    }
    const blank = await (await fetch('/' + FORMS[formKey].file + '?v=' + encodeURIComponent(FORMS[formKey].version), { cache: 'force-cache' })).arrayBuffer();
    const bytes = await fillPdf(global.PDFLib, formKey, blank, data);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = (name.replace(/[^A-Za-z0-9]+/g, '_') + '_' + FORMS[formKey].short.replace(/[^A-Za-z0-9]+/g, '_') + '_signed.pdf');
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function fmtDateUS(ms) { const d = new Date(ms || Date.now()); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(); }
  // Admin: parent contacts from the sealed records that are not yet in Cadet Records -> [{name, cadet, role, phone, email, token, form}]
  async function pContacts() {
    const out = [];
    if (!P.host.admin || !RPDRoster.references.isUnlocked()) return out;
    const done = (P.codes && P.codes.contacts) || {};
    for (const name of Object.keys(P.st)) {
      const st = P.st[name]; if (!st) continue; const rec = P.host.rec(name) || {};
      for (const role of ['parent1', 'parent2']) {
        const sl = st.slots[role]; if (!sl) continue;
        const k = Object.keys(sl.forms)[0]; if (!k) continue;
        const sig = sl.forms[k]; const node = ((st._raw || {})[sig.token] || {}).forms || {}; const env = node[k] && node[k].e; if (!env) continue;
        const key = st._id + ':' + sl.tokens[0]; if (done[key]) continue;
        let r; try { r = await RPDRoster.esign.open(env); } catch (e) { continue; }
        const same = (a, b) => normName(a) === normName(b);
        const onFile1 = same(rec.parentName, r.name) && (!r.phone || !rec.parentPhone || rec.parentPhone === r.phone) && (!r.email || !rec.parentEmail || normName(rec.parentEmail) === normName(r.email));
        const onFile2 = same(rec.parent2Name, r.name) && (!r.phone || !rec.parent2Phone || rec.parent2Phone === r.phone) && (!r.email || !rec.parent2Email || normName(rec.parent2Email) === normName(r.email));
        if (onFile1 || onFile2) continue;
        out.push({ key, cadet: name, role, name: r.name || sl.name, phone: r.phone || '', email: r.email || '', slot1Free: !rec.parentName, slot2Free: !rec.parent2Name, match1: same(rec.parentName, r.name), match2: same(rec.parent2Name, r.name) });
      }
    }
    return out;
  }
  async function pContactsHtml() {
    const list = await pContacts(); if (!list.length) return '';
    return `<div class="wvo-contacts"><div class="wvo-l">New parent contacts from online signing</div>${list.map(c => `
      <div class="wvo-contact" data-wvokey="${esc(c.key)}"><div><b>${esc(c.name)}</b> for ${esc(c.cadet)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.email ? ' · ' + esc(c.email) : ''}</div>
      <div class="wvo-acts">
        <button type="button" class="wvo-btn go" data-wvoc="1" data-wvokey="${esc(c.key)}">${c.match1 ? 'Update parent / guardian' : (c.slot1Free ? 'Add as parent / guardian' : 'Replace parent / guardian')}</button>
        <button type="button" class="wvo-btn go" data-wvoc="2" data-wvokey="${esc(c.key)}">${c.match2 ? 'Update second parent' : (c.slot2Free ? 'Add as second parent' : 'Replace second parent')}</button>
        <button type="button" class="wvo-btn" data-wvoc="skip" data-wvokey="${esc(c.key)}">Skip</button>
      </div></div>`).join('')}</div>`;
  }
  async function pContactAct(key, which) {
    const list = await pContacts(); const c = list.find(x => x.key === key); if (!c) return;
    if (which !== 'skip') {
      const rec = P.host.rec(c.cadet) || {}; const pre = which === '1' ? 'parent' : 'parent2';
      const cur = { name: rec[pre + 'Name'] || '', phone: rec[pre + 'Phone'] || '', email: rec[pre + 'Email'] || '' };
      const patch = {};
      [['Name', c.name, cur.name], ['Phone', c.phone, cur.phone], ['Email', c.email, cur.email]].forEach(([f, nv, ov]) => {
        if (!nv) return;
        if (!ov) patch[pre + f] = nv;
        else if (normName(ov) !== normName(nv) && confirm('Cadet Records has ' + f.toLowerCase() + ' "' + ov + '" for ' + c.cadet + '. Replace it with "' + nv + '"?')) patch[pre + f] = nv;
      });
      if (Object.keys(patch).length) await P.host.recSave(c.cadet, patch);
    }
    P.codes = await RPDRoster.esign.codesMutate(obj => { obj.contacts = obj.contacts || {}; obj.contacts[key] = which === 'skip' ? 'skipped' : 'added'; });
    if (P.host.rerender) P.host.rerender();
  }
  function pBind(container) {
    (container || document).addEventListener('click', e => {
      const b = e.target.closest('[data-wvoact]');
      if (b) { pAct(b.dataset.wvoact, b.dataset.wvoname, b.dataset.wvoform, b); return; }
      const cb = e.target.closest('[data-wvoc]');
      if (cb) { cb.disabled = true; pContactAct(cb.dataset.wvokey, cb.dataset.wvoc); }
    });
  }
  function injectCss() {
    if (document.getElementById('wvoCss')) return;
    const s = document.createElement('style'); s.id = 'wvoCss';
    s.textContent = `
.wvo{margin-top:8px;padding:9px 10px;border:1px dashed rgba(212,169,82,0.35);border-radius:9px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12.5px;color:#c6d0de}
.wvo.done{border-style:solid;border-color:rgba(39,174,96,0.45)}
.wvo-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;width:100%}
.wvo-l{font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--gold)}
.wvo-code{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:17px;letter-spacing:2px;color:#fff}
.wvo-muted{color:var(--text-muted);font-size:12px}
.wvo-forms{display:flex;flex-direction:column;gap:3px;width:100%}
.wvo-f{font-size:12.5px;line-height:1.35}
.wvo-f.ok{color:#8fe3b3}
.wvo-f.wait{color:var(--gold-light)}
.wvo-acts{display:flex;flex-wrap:wrap;gap:6px;width:100%}
.wvo-btn{background:rgba(255,255,255,0.03);border:1px solid var(--card-border);color:#c6d0de;border-radius:8px;padding:8px 11px;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;cursor:pointer}
.wvo-btn:hover{color:#fff;border-color:rgba(255,255,255,0.25)}
.wvo-btn:disabled{opacity:.5;cursor:wait}
.wvo-btn.gen{border-color:var(--gold);color:var(--gold-light);background:rgba(212,169,82,0.1)}
.wvo-btn.go{border-color:var(--green,#27ae60);color:#b8f1cf;background:rgba(39,174,96,0.14)}
.wvo-btn.danger{color:#f8a3a3}
.wvo-people{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;width:100%;font-size:12.5px;color:#c6d0de}
.wvo-person{display:inline-flex;align-items:center;gap:6px}
.wvo-people .wvo-btn{padding:5px 9px;font-size:11px}
.wvo-contacts{background:var(--card-bg);border:1px solid rgba(212,169,82,0.35);border-radius:12px;padding:12px;margin-bottom:12px;display:flex;flex-direction:column;gap:8px}
.wvo-contact{display:flex;flex-direction:column;gap:6px;font-size:13.5px;padding:8px 0;border-top:1px solid var(--card-border)}
.wvo-contact:first-of-type{border-top:none}
.wvo-qr{display:none;position:fixed;inset:0;background:rgba(6,11,22,0.86);z-index:1700;align-items:center;justify-content:center;padding:24px}
.wvo-qr.show{display:flex}
.wvo-qr-card{background:#fff;border-radius:18px;padding:26px 26px 20px;max-width:340px;width:100%;text-align:center;position:relative;box-shadow:0 30px 80px rgba(0,0,0,0.5)}
.wvo-qr-card svg{display:block;width:100%;height:auto;border-radius:6px}
.wvo-qr-code{margin-top:12px;font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:700;letter-spacing:3px;color:#1a2744}
.wvo-qr-hint{margin-top:2px;font-size:12px;color:#5b6b82}
.wvo-qr-x{position:absolute;top:10px;right:12px;background:none;border:none;font-size:26px;line-height:1;color:#5b6b82;cursor:pointer;padding:4px}`;
    document.head.appendChild(s);
  }

  global.RPDWv = {
    SALT: WV_SALT, FORMS, PAPER, PAPER_KEYS, ONLINE_KEYS, CONSENT, DAYS, LINK_BASE, ROOT,
    normalizeCode, formatCode, newCode, derive, link, newToken,
    keyEncrypt, keyDecrypt, envelope, b64ToArr, arrToB64,
    decodeSigs, assignRoles, status, roleLabel, dateIso, fmtDate, fmtDateTime, fmtDateUS, esc, normName,
    fillPdf, qrSvg,
    panel: { init: pInit, bind: pBind, refresh: pRefresh, fill: pFill, contactsHtml: pContactsHtml, state: P, blockHtml: pBlockHtml, pdf: pPdf }
  };
})(window);
