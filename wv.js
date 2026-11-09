/* wv.js  |  Build v4  |  updated 2026-11-09  |  v4: event packets. One shared code per special event (first use: Active Shooter Simunitions Training at Garland ISD, 12/17/2026): /admin creates the event (title, date, location, forms, cadets from the active roster, closing day), every family enters the same code on /waivers, picks the cadet, and signs. Two new forms: gisd (the Garland ISD Training Center waiver, a flat PDF: the cadet signs its own lines and for a minor a parent or guardian signs an added line beneath; agency prefilled) and medtrip (Parent Permission / Consent to Medical Treatment, per trip: activity and date from the event, allergies / medical / medications box, address, two phone numbers; a parent signs for every cadet under 21). The Simunitions release (sim) can ride in the packet too: every cadet signs it again except those whose tracker entry already came from online signing, and the new online signature marks the tracker Received "Online: name" over any paper copy (the old entry kept under prev). A cadet who signs sim through their own code meanwhile is dropped from the packet (evSync). Event section (panel.events) on the Waiver Tracker (/admin) and the Waivers tab (/sgt): code, Copy link, Share, QR, per-cadet grid with Signed / Waiting / Paper / Not needed cells, paper marks by tap (both panels), Still missing filter; admin only: New event, Cadets (edit the list), PDF per cadet, All PDFs merged per form, Print still missing (letterhead PDF, CADET/EVENTWV V1), Clear signatures per cadet, Close / Reopen / Delete. decodeSigs now carries reg.cadet; eventStatus() groups signers by cadet and reuses status(). Needs roster.js VERSION 38 (esign.eventsGet/eventsMutate, node roster/wvEvents). The onboarding block names a Simunitions release signed through an event packet instead of showing it as waiting. Build v3 notes: v3: which paper Release of Liability version the family needs now comes from the online signing. waivers.html v3 asks every parent or guardian of a minor cadet which version applies (required, on the name screen) and stores the answer on their signing record (meta.liab); a tap on the finish screen updates it. status() returns liab: the latest parent answer (how: chosen), else, for families who signed before the question existed, the version the second-parent answer suggests (how: inferred), else adult for an adult cadet. panel.liabFor(name) hands it to the tracker dialogs on /admin and /sgt, which preselect a chosen version and say who chose it (an inferred one is only suggested, never preselected); the tracker row block names it while the paper release is still missing. Build v2 notes: v2: the /admin block lists who has signed, with Clear per person and Clear all, so someone who messed up can start over with the same code; clearing deletes those signatures and flips every tracker cell that had been auto-marked Received from them back to Missing (a cell already Filed is left alone and named in the toast). Build v1 notes: Online waiver signing (e-sign), shared by /waivers (public, no roster.js),
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
        meta  { s:AES(code){ second:true|false, at, liab:'married'|'divorced', liabAt, liabHow:'asked'|'tapped' }, t }
              (parents only; second: does a second parent also sign; liab: which Release of Liability version applies, v3)
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
  // Build v4: event packets. gisd and medtrip exist only inside an event code; sim is shared with the onboarding set.
  const EVENT_KEYS = ['gisd', 'medtrip', 'sim'];
  const EVENT_TRACKER = { sim: 'sim' };   // event forms that are also tracker waivers: the event signature overrides paper
  const DEFAULT_AGENCY = 'Richardson Police Department Public Safety Cadets';
  const GISD_LOCATION = 'Garland ISD Training Center, 1821 Old Gate Lane, Garland, TX 75042';
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
    },
    /* Build v4: event packet forms. gisd and medtrip are only ever carried by an event code (see EVENT_KEYS); sim above is
       reused by events too, so a Simunitions release signed through an event is the same form as the onboarding one. */
    gisd: {
      key: 'gisd', title: 'Garland ISD Training Center Waiver', short: 'Garland ISD waiver',
      file: 'Garland_ISD_Training_Center_Waiver.pdf', version: '2026-11-09', event: true,
      roles: (adult, second) => adult ? ['cadet'] : ['cadet', 'parent1'],
      fields: { cadet: ['name'], parent: ['name'] },
      html: `
<h4>Acknowledgment, Release and Hold Harmless Agreement for Use of Garland ISD Training Center Facilities</h4>
<p>In order to participate in training utilizing the Garland ISD Training Center located at 1821 Old Gate Lane, City of Garland, Dallas County, Texas 75042, I, <span class="wv-blank" data-blank="cadet">the cadet named above</span>, agree and understand that I VOLUNTARILY AND WILLINGLY ASSUME THE RISK OF PERSONAL INJURY AND LOSS OF PROPERTY THAT MAY OCCUR AS A RESULT OF PARTICIPATING IN SUCH TRAINING.</p>
<p>I further agree to indemnify, defend, and hold harmless the Garland Independent School District, their officers, agents, employees, affiliates, successors and assigns from and against any and all losses, liabilities, damages, claims, fines, causes of action deficiencies, costs and expenses (including reasonable attorneys' fees and other litigation expenses) based upon, arising out of, or otherwise related to such training.</p>
<p>I further agree to release the Garland Independent School District from any and all liabilities, damages, claims, fines, causes of action, including but not limited to negligence, gross negligence, deficiencies, costs and expenses based upon, arising out of or otherwise related to my participation in such training, including but not limited to personal injury or the loss of any property I may use or bring to the training.</p>
<p>Agency name: <span class="wv-blank" data-blank="agency">Richardson Police Department Public Safety Cadets</span></p>
<p class="wv-minor">If the participant is under 18, a parent or legal guardian also signs this agreement on the participant's behalf.</p>`
    },
    medtrip: {
      key: 'medtrip', title: 'Parent Permission / Consent to Medical Treatment', short: 'Medical consent',
      file: 'Parent_Permission_Medical_Consent.pdf', version: '2026-11-09', event: true,
      roles: (adult, second) => ['parent1'],
      fields: { cadet: ['name'], parent: ['name', 'phone', 'phone2', 'address', 'meds'] },
      html: `
<p class="wv-minor">For Cadets and guests under 21 years of age participating in a Public Safety Cadets trip or activity. A parent or legal guardian signs.</p>
<p><span class="wv-blank" data-blank="cadet">the cadet named above</span> has my permission to participate in <span class="wv-blank" data-blank="activity">the activity</span> on <span class="wv-blank" data-blank="date">the date</span>.</p>
<p>I know of no health or fitness restriction(s) that preclude his or her participation. In the event of illness or injury occurring to my son or daughter while involved in this activity, I consent to x-ray examination, anesthesia, medical, or surgical diagnostic procedures or treatment that is considered necessary in the best judgment of the attending physician and performed by or under the supervision of a member of the medical staff of the hospital furnishing medical services. It is understood that in the event of a serious illness or injury, reasonable efforts to reach me will be attempted.</p>
<p>In the event that I (we) cannot be contacted and the said participant shall, by reason of accident, illness or injury, require any character of medical treatment or surgery, including any and all diagnostic procedures or drugs related thereto, this instrument will authorize the Public Safety Cadets Executive Advisor, any Public Safety Cadets Associate Advisor or any sworn police officer of the Richardson Police Department, Richardson, Texas to consent to the medical treatment of said participant and to do each and every act necessary to provide for said medical treatment.</p>
<p class="wv-minor">Below this form you will list any and all allergies, medical problems, and medications used by the participant, your address, and the phone numbers where you can be reached during the time of this activity.</p>`
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
      out.push({ token, role: reg.role, name: reg.name || '', cadet: reg.cadet || '', at: reg.at || 0, t: (node.reg && node.reg.t) || 0, meta, forms });   // v4: cadet names the cadet on an event code
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
    // Build v3: the paper Release of Liability version this family needs, and where that came from
    let liab = null;
    const picks = (signers || []).filter(s => s.role === 'parent' && s.meta && (s.meta.liab === 'married' || s.meta.liab === 'divorced'))
      .sort((a, b) => (b.meta.liabAt || 0) - (a.meta.liabAt || 0));
    if (adult) liab = { type: 'adult', how: 'adult', by: '', second: false };
    else if (picks.length) liab = { type: picks[0].meta.liab, how: 'chosen', by: picks[0].name || '', at: picks[0].meta.liabAt || 0, second };
    else if (answered || slots.parent2) liab = { type: second ? 'divorced' : 'married', how: 'inferred', by: '', second };
    return { adult, second, answered, slots, extraParents, forms, allComplete, liab };
  }
  function roleLabel(r) { return ROLE_LABEL[r] || r; }
  /* Build v4: event packets. The invite of an event code is { kind:'event', title, date, location, agency, forms, cadets:[{ name, adult,
     forms, skip }] }; eventCadetInvite() turns one cadet of it into the per-cadet shape status() and /waivers already understand, and
     eventStatus() runs status() per cadet over the signers that belong to that cadet (reg.cadet). */
  function isoAddYears(iso, n) { const p = String(iso || '').split('-').map(Number); if (p.length !== 3 || p.some(isNaN)) return null; return dateIso(new Date(p[0] + n, p[1] - 1, p[2], 12).getTime()); }
  function isAtLeast(dob, years) { const b = isoAddYears(dob, years); return !!b && dateIso() >= b; }
  function fmtIsoUS(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? (Number(m[2]) + '/' + Number(m[3]) + '/' + m[1]) : String(iso || ''); }
  function fmtIsoLong(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); if (!m) return String(iso || ''); return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  function eventCadetInvite(ev, c) {
    return { v: 2, kind: 'event', cadet: c.name, adult: !!c.adult, forms: (c.forms || []).filter(k => FORMS[k]), paper: [],
      event: { key: ev.key || '', title: ev.title || '', date: ev.date || '', dateUS: fmtIsoUS(ev.date || ''), location: ev.location || '', agency: ev.agency || DEFAULT_AGENCY },
      parent: {}, parent2: {}, cadetPhone: '', cadetEmail: '' };
  }
  function eventStatus(inv, signers) {
    const byCadet = {};
    (signers || []).forEach(s => { const k = normName(s.cadet); (byCadet[k] = byCadet[k] || []).push(s); });
    const out = { cadets: {}, order: [] };
    ((inv && inv.cadets) || []).forEach(c => { if (!c || !c.name) return; const st = status(eventCadetInvite(inv, c), byCadet[normName(c.name)] || []); st.cadet = c; out.cadets[c.name] = st; out.order.push(c.name); });
    return out;
  }
  // Build v3: short name of a Release of Liability version, without the Minor: prefix (the tracker's LIAB list when roster.js is loaded)
  function liabShort(t) { let s = ''; try { const f = (global.RPDRoster && RPDRoster.waivers && RPDRoster.waivers.LIAB || []).find(x => x[0] === t); if (f) s = f[2]; } catch (e) { s = ''; }
    if (!s) s = { married: 'married parents or single guardian', divorced: 'divorced parents', adult: 'adult' }[t] || t; return s.replace(/^Minor:\s*/, ''); }
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
    // v4: shrink to fit a blank line (flat forms)
    const fitTxt = (page, s, x, y, size, maxW) => { if (!s) return; let sz = size; while (sz > 6 && font.widthOfTextAtSize(String(s), sz) > maxW) sz -= 0.5; page.drawText(String(s), { x, y, size: sz, font, color: rgb(0.1, 0.1, 0.1) }); };
    async function sigAt(page, s, x, y, w, h) {
      if (!s || !s.sig) return;
      try {
        const b64 = String(s.sig).split(',')[1]; const png = await doc.embedPng(b64ToArr(b64));
        const sc = Math.min(w / png.width, h / png.height); const dw = png.width * sc, dh = png.height * sc;
        page.drawImage(png, { x, y: y + (h - dh) / 2, width: dw, height: dh });
      } catch (e) { }
    }
    const form = doc.getForm();
    // v4: a value longer than the field's MaxLen lifts the limit instead of failing (the medical form caps every field at 100)
    const setField = (name, v) => { try { const f = form.getTextField(name); const str = v == null ? '' : String(v); try { f.setText(str); } catch (e) { try { f.setMaxLength(undefined); f.setText(str); } catch (e2) { try { f.setText(str.slice(0, 100)); } catch (e3) { } } } } catch (e) { } };
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
    } else if (formKey === 'gisd') {
      // Build v4. Flat PDF (no fields): the participant's name goes on the form's own lines, the cadet's signature on its
      // signature line, and for a minor a parent or guardian block is drawn beneath it (page 612 x 792, origin bottom-left).
      const c = S('cadet'), p1 = S('parent1');
      const agency = (data.event && data.event.agency) || DEFAULT_AGENCY;
      fitTxt(page, data.cadet, 86, 503, 10, 226);
      fitTxt(page, agency, 158, 225.5, 10, 286);
      fitTxt(page, data.cadet, 160, 130.5, 10, 286);
      if (c) { txt(page, c.date, 109, 178, 10); await sigAt(page, c, 140, 81, 300, 27); }
      if (p1) {
        const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
        const ink = rgb(0.1, 0.1, 0.1), rule = rgb(0.25, 0.25, 0.25);
        page.drawText('PARENT OR GUARDIAN OF A PARTICIPANT UNDER 18, SIGNING ON THE PARTICIPANT\'S BEHALF', { x: 72, y: 60, size: 7, font: fontB, color: ink });
        page.drawText('DATE:', { x: 448, y: 60, size: 7.5, font: fontB, color: ink });
        txt(page, p1.date, 474, 60, 8);
        page.drawText('SIGNATURE:', { x: 72, y: 31, size: 9, font: fontB, color: ink });
        page.drawLine({ start: { x: 130, y: 29 }, end: { x: 318, y: 29 }, thickness: 0.6, color: rule });
        await sigAt(page, p1, 134, 31, 180, 24);
        page.drawText('PRINTED NAME:', { x: 328, y: 31, size: 9, font: fontB, color: ink });
        page.drawLine({ start: { x: 400, y: 29 }, end: { x: 540, y: 29 }, thickness: 0.6, color: rule });
        fitTxt(page, p1.name, 403, 31.5, 9, 135);
      }
    } else if (formKey === 'medtrip') {
      // Build v4. Fillable fields: f_1 participant, f_2 activity, f_3 activity date, f_4 allergies / medical problems /
      // medications (multiline), f_5 signature, f_6 date signed, f_7 address, f_8 and f_9 phone numbers for the activity.
      const p1 = S('parent1'); const ev = data.event || {};
      setField('f_1', data.cadet); setField('f_2', ev.title || ''); setField('f_3', ev.dateUS || '');
      if (p1) { setField('f_4', p1.meds || ''); setField('f_6', p1.date); setField('f_7', p1.address || ''); setField('f_8', p1.phone || ''); setField('f_9', p1.phone2 || ''); }
      // the allergies box is set to auto size on the form, which blows short text up to fill it; pick the largest size from 9 down that fits
      try {
        const f4 = form.getTextField('f_4'); const r4 = f4.acroField.getWidgets()[0].getRectangle(); const txt4 = (p1 && p1.meds) || '';
        const lines = (sz) => txt4.split(/\r?\n/).reduce((n, par) => { let line = '', c = 1; par.split(/\s+/).forEach(w => { const t = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(t, sz) <= r4.width - 8) line = t; else { c++; line = w; } }); return n + c; }, 0);
        let sz = 9; while (sz > 6 && lines(sz) * sz * 1.18 > r4.height - 4) sz -= 0.5;
        // the form's DA strings are stored escaped, which pdf-lib cannot parse (it then auto-sizes the text), so the DA is written fresh
        try { f4.acroField.dict.set(PDFLib.PDFName.of('DA'), PDFLib.PDFString.of('/Helv ' + sz + ' Tf 0.1 0.1 0.1 rg')); } catch (e2) { f4.setFontSize(sz); }
      } catch (e) { }
      form.updateFieldAppearances(font);
      if (p1) { await sigField('f_5', p1); txt(page, 'Parent or guardian: ' + (p1.name || ''), 127, 296.5, 7.5); }
      form.flatten();
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
  function pInit(host) { P.host = host; injectCss(); evBind(); }   // v4: the event section binds to its own host element
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
    await evLoad();   // v4: event packets (codes, statuses, packet sync, tracker override)
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
    if (!name) evFill();   // v4
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
        // v4: the same form may have been signed through an event packet (the tracker entry names that code)
        try { const te = P.host.entry ? P.host.entry(name, k) : null; const cell = ((P.host.sum(name) || {}).cells || {})[k]; if (te && te.via === 'online' && te.wvId && te.wvId !== st._id && cell && (cell.state === 'received' || cell.state === 'filed')) return `<span class="wvo-f ok">${esc(FORMS[k].short)}: signed online through an event packet${te.rAt ? ' ' + esc(fmtIsoUS(te.rAt)) : ''}</span>`; } catch (e) { }
        const have = Object.keys(f.signed).map(r => f.signed[r].name);
        return `<span class="wvo-f wait">${esc(FORMS[k].short)}: waiting on ${esc(f.waiting.map(roleLabel).join(' and '))}${have.length ? ' (signed by ' + esc(have.join(', ')) + ')' : ''}</span>`;
      }).join('');
      if (st.extraParents.length) rows += `<span class="wvo-f wait">Extra parent signatures not counted: ${esc(st.extraParents.join(', '))}</span>`;
      // Build v3: which paper Release of Liability version the family needs, while that waiver is still missing on the tracker
      if (st.liab && st.liab.how !== 'adult') { let cell = null; try { cell = ((P.host.sum(name) || {}).cells || {}).liability || null; } catch (e) { cell = null; }
        if (!cell || cell.state === 'missing' || cell.state === 'resign') rows += st.liab.how === 'chosen'
          ? `<span class="wvo-f">Paper Release of Liability needed: ${esc(liabShort(st.liab.type))} version (${esc(st.liab.by || 'the parent')} chose it online)</span>`
          : `<span class="wvo-f">Paper Release of Liability: not asked online; the second-parent answer suggests the ${esc(liabShort(st.liab.type))} version</span>`; }
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
  /* ── Event packets (Build v4) ─────────────────────────────────────────────
     One shared code per special event. The public invite (wvInvites/<id>, blob under the code key) carries the event and
     the cadets on it, each with the forms that cadet still needs; every family enters the same code on /waivers, picks
     the cadet, and signs. Signatures sit under wvSigs/<event id>/<token> exactly like a cadet code, with reg.cadet
     naming the cadet each signer belongs to. roster/wvEvents (records key, roster.js esign.eventsGet/eventsMutate):
       { v:1, events:{ <key>: { key, code, id, title, date:'YYYY-MM-DD', location, agency, forms:[...], at, exp, by,
                                 closed, closedAt, cadets:{ <name>: { adult, forms:[...], skip:{ sim:'online', medtrip:'age' } } },
                                 paper:{ <name>: { <formKey>: { at, by } } } } } }
     Tracker: a Simunitions release signed through an event is the same form as the onboarding one, so it marks the
     cadet's tracker cell Received "Online: name" even over a paper copy (Tony, 11/09/26: the new online signature
     overrides paper), keeping the old entry underneath as history. A cadet who signs it through their own code in the
     meantime drops it from the packet. */
  const E = { data: null, st: {}, inv: {}, raw: {}, id: {}, key: {}, filter: {}, open: {}, form: false, err: '', bound: false };
  function evHostEl() { return document.getElementById((P.host && P.host.eventsHost) || 'wveHost'); }
  function evActive() { try { return RPDRoster.activeSorted().map(p => ({ name: p.name, rank: p.rank || '' })); } catch (e) { return []; } }
  function evRank(name) { const p = evActive().find(x => x.name === name); return p ? p.rank : ''; }
  function evToast(m) { if (P.host && P.host.toast) P.host.toast(m); }
  function fileSafe(s) { return String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function dlBytes(bytes, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  // A fresh read of the tracker (another device may have marked something since this page loaded); null when unreadable.
  async function evTracker() { try { return await RPDRoster.waivers.get(); } catch (e) { return null; } }
  function evTrackerEntry(name, k, tr) { if (tr && tr.cadets) return (tr.cadets[name] || {})[k]; return P.host.entry ? P.host.entry(name, k) : null; }
  // The tracker's Simunitions entry came from online signing (received or filed): that cadet does not sign it again.
  function evSimOnline(name, tr) {
    try {
      const e = evTrackerEntry(name, 'sim', tr); if (!e || e.via !== 'online') return false;
      const rec = P.host.rec(name) || {}; const stt = RPDRoster.waivers.status('sim', e, rec.waiverSet, rec.dob);
      return stt.state === 'received' || stt.state === 'filed';
    } catch (e) { return false; }
  }
  // Which of the event's forms a cadet needs, and why any are skipped (sim: signed online already; medtrip: 21 or older).
  function evCadetForms(ev, name, tr) {
    const rec = P.host.rec(name) || {}; const sum = P.host.sum(name) || {};
    const forms = [], skip = {};
    (ev.forms || []).forEach(k => {
      if (!FORMS[k]) return;
      if (k === 'sim' && evSimOnline(name, tr)) { skip[k] = 'online'; return; }
      if (k === 'medtrip' && rec.dob && isAtLeast(rec.dob, 21)) { skip[k] = 'age'; return; }
      forms.push(k);
    });
    return { adult: !!(sum.age && sum.age.adult), forms, skip };
  }
  function evInviteFrom(ev) {
    const cadets = Object.keys(ev.cadets || {}).map(n => Object.assign({ name: n }, ev.cadets[n]));
    return { v: 2, kind: 'event', key: ev.key, title: ev.title, date: ev.date, location: ev.location || '', agency: ev.agency || DEFAULT_AGENCY, forms: ev.forms || [], cadets, at: ev.at, exp: ev.exp };
  }
  // (Re)writes the public invite from the stored entry, under the event's own code. A closed event keeps its blob but
  // the node's expiry is set to the close time, so the page says the code has expired instead of "opened nothing".
  async function evWriteInvite(ev) {
    const d = await pDerive(ev.code);
    const inv = evInviteFrom(ev);
    const blob = await keyEncrypt(JSON.stringify(inv), d.key);
    await RPDRoster.esign.inviteSet(d.id, { blob, at: ev.at, exp: ev.closed ? Math.min(ev.exp || Date.now(), ev.closedAt || Date.now()) : ev.exp });
    return inv;
  }
  function evSetStatus(key, signers) { const st = eventStatus(E.inv[key], signers); st._signers = signers; E.st[key] = st; return st; }
  async function evLoad() {
    E.err = '';
    if (!global.RPDRoster || !RPDRoster.esign || !RPDRoster.esign.eventsGet) { E.data = null; return; }
    try { E.data = (await RPDRoster.esign.eventsGet()) || { v: 1, events: {} }; }
    catch (e) { E.data = E.data || { v: 1, events: {} }; E.err = 'events'; return; }
    for (const ev of Object.values(E.data.events || {})) {
      if (!ev || !ev.code || !ev.key) continue;
      try {
        const d = await pDerive(ev.code);
        E.id[ev.key] = d.id; E.key[ev.key] = d.key;
        let inv = null;
        const rawInv = await RPDRoster.esign.inviteGet(d.id);
        if (rawInv && rawInv.blob) { try { inv = JSON.parse(await keyDecrypt(rawInv.blob, d.key)); } catch (e) { inv = null; } }
        if (!inv || inv.kind !== 'event') inv = evInviteFrom(ev);   // a closed event, or an invite that went missing: the stored entry is the picture
        const raw = await RPDRoster.esign.sigsGet(d.id);
        E.inv[ev.key] = inv; E.raw[ev.key] = raw;
        evSetStatus(ev.key, await decodeSigs(raw, d.key));
      } catch (e) { E.st[ev.key] = null; }
    }
    await evSync(); await evMerge();
  }
  // A cadet who signed the Simunitions release through their own code since the packet was made drops it from the packet.
  async function evSync() {
    if (!E.data) return;
    const drops = []; const tr = await evTracker();
    Object.values(E.data.events || {}).forEach(ev => {
      if (!ev || ev.closed) return; const st = E.st[ev.key]; if (!st) return;
      Object.keys(ev.cadets || {}).forEach(name => {
        const c = ev.cadets[name]; if (!c || !(c.forms || []).includes('sim')) return;
        const f = st.cadets[name] && st.cadets[name].forms.sim; if (f && Object.keys(f.signed).length) return;   // already signing it here
        const e = evTrackerEntry(name, 'sim', tr);
        if (e && e.via === 'online' && e.wvId !== E.id[ev.key] && evSimOnline(name, tr)) drops.push({ key: ev.key, name });
      });
    });
    if (!drops.length) return;
    try {
      E.data = await RPDRoster.esign.eventsMutate(obj => {
        drops.forEach(x => { const c = obj.events[x.key] && obj.events[x.key].cadets && obj.events[x.key].cadets[x.name]; if (!c) return; c.forms = (c.forms || []).filter(k => k !== 'sim'); c.skip = Object.assign({}, c.skip, { sim: 'online' }); });
      });
      for (const key of Array.from(new Set(drops.map(x => x.key)))) { const ev = E.data.events[key]; if (!ev) continue; E.inv[key] = await evWriteInvite(ev); evSetStatus(key, (E.st[key] && E.st[key]._signers) || []); }
    } catch (e) { }
  }
  // Every tracker waiver that an event packet carries (the Simunitions release) and now has all its signatures is marked
  // Received on the tracker as "Online: name", over whatever was there (paper included); the old entry stays under prev.
  async function evMerge() {
    if (!E.data) return;
    const cand = [];
    Object.values(E.data.events || {}).forEach(ev => {
      const st = ev && E.st[ev.key]; if (!st) return;
      Object.keys(st.cadets).forEach(name => { Object.keys(EVENT_TRACKER).forEach(k => { const f = st.cadets[name].forms[k]; if (f && f.complete) cand.push({ ev, name, k, f, id: E.id[ev.key] }); }); });
    });
    if (!cand.length) return;
    const done = [];
    try {
      await RPDRoster.waivers.mutate(obj => {
        cand.forEach(x => {
          const tk = EVENT_TRACKER[x.k]; const c = obj.cadets[x.name] || {}; const cur = c[tk];
          if (cur && cur.via === 'online' && cur.wvId === x.id) return;   // already recorded from this event
          c[tk] = { s: 'received', rAt: dateIso(x.f.at), rBy: 'Online: ' + x.f.by.join(', '), at: Date.now(), via: 'online', wvId: x.id, ev: x.ev.key, prev: (cur && cur.s) ? cur : undefined };
          obj.cadets[x.name] = c; done.push(x);
        });
        return done.length ? undefined : false;
      });
    } catch (e) { return; }
    if (!done.length) return;
    if (P.host.rerender) await P.host.rerender();
    evToast(done.length === 1 ? 'Online signature received: ' + FORMS[done[0].k].short + ' for ' + done[0].name + ' (' + done[0].ev.title + ')' : done.length + ' online signatures received from event packets');
  }
  async function evCreate(vals) {
    const code = newCode(); const d = await derive(code); P.memo[code] = d;
    const key = newToken().slice(0, 10); const at = Date.now();
    const ev = { key, code, id: d.id, title: vals.title, date: vals.date, location: vals.location || '', agency: DEFAULT_AGENCY, forms: vals.forms, cadets: {}, at, exp: vals.exp, by: P.host.who ? P.host.who() : '', closed: false, paper: {} };
    const tr = await evTracker();
    vals.cadets.forEach(name => { ev.cadets[name] = evCadetForms(ev, name, tr); });
    E.data = await RPDRoster.esign.eventsMutate(obj => { obj.events = obj.events || {}; obj.events[key] = ev; });
    E.id[key] = d.id; E.key[key] = d.key;
    E.inv[key] = await evWriteInvite(ev); E.raw[key] = {}; evSetStatus(key, []);
    E.form = false; E.open[key] = true;
    evFill();
    evToast('Event created. Code ' + formatCode(code));
  }
  async function evSaveCadets(key, names) {
    const ev = E.data.events[key]; if (!ev) return;
    const next = {}; const tr = await evTracker();
    names.forEach(n => { next[n] = ev.cadets[n] || evCadetForms(ev, n, tr); });
    E.data = await RPDRoster.esign.eventsMutate(obj => { const e = obj.events[key]; if (!e) return false; e.cadets = next; });
    const ev2 = E.data.events[key]; if (!ev2) return;
    E.inv[key] = await evWriteInvite(ev2); evSetStatus(key, (E.st[key] && E.st[key]._signers) || []);
    evFill(); evToast('Cadet list saved: ' + names.length + (names.length === 1 ? ' cadet' : ' cadets'));
  }
  // Paper mark: the form was signed on paper for this cadet (sergeants and advisors). A paper Simunitions release also goes
  // on the tracker as Received when nothing is there yet; it never replaces a Received or Filed entry.
  async function evPaper(key, name, k) {
    const ev = E.data.events[key]; if (!ev || !FORMS[k]) return;
    const cur = ((ev.paper || {})[name] || {})[k];
    if (!confirm(cur ? 'Remove the paper mark on the ' + FORMS[k].short + ' for ' + name + '?' : 'Mark the ' + FORMS[k].short + ' for ' + name + ' as signed on paper?')) return;
    let by = (P.host.who ? P.host.who() : '') || '';
    if (!cur && !by) { by = String(prompt('Your name, for the record of who took the paper copy:') || '').trim(); if (!by) { evFill(); return; } }
    E.data = await RPDRoster.esign.eventsMutate(obj => { const e = obj.events[key]; if (!e) return false; e.paper = e.paper || {}; e.paper[name] = e.paper[name] || {}; if (cur) delete e.paper[name][k]; else e.paper[name][k] = { at: Date.now(), by }; });
    if (!cur && EVENT_TRACKER[k]) {
      try {
        const tk = EVENT_TRACKER[k]; let marked = false;
        await RPDRoster.waivers.mutate(obj => {
          const c = obj.cadets[name] || {}; const rec = P.host.rec(name) || {};
          const stt = RPDRoster.waivers.status(tk, c[tk], rec.waiverSet, rec.dob);
          if (stt.state !== 'missing' && stt.state !== 'resign') return false;
          c[tk] = { s: 'received', rAt: dateIso(), rBy: by || 'Event paper', at: Date.now(), via: 'paper', ev: key, prev: (c[tk] && c[tk].s) ? c[tk] : undefined };
          obj.cadets[name] = c; marked = true;
        });
        if (marked && P.host.rerender) await P.host.rerender();
      } catch (e) { }
    }
    evFill();
  }
  // Admin: delete one cadet's online signatures on an event so the family can start over with the same code, then put the
  // tracker back for anything that had been marked from this event and is no longer complete.
  async function evClear(key, name) {
    const ev = E.data.events[key]; const st = E.st[key]; if (!ev || !st) return;
    if (!confirm('Delete the online signatures for ' + name + ' on "' + ev.title + '"? They can sign again with the same code. Tracker cells marked from this event go back to what they were.')) return;
    const toks = (st._signers || []).filter(s => normName(s.cadet) === normName(name)).map(s => s.token);
    for (const t of toks) await RPDRoster.esign.sigsRemove(E.id[key], t);
    const raw = await RPDRoster.esign.sigsGet(E.id[key]); E.raw[key] = raw;
    const next = evSetStatus(key, await decodeSigs(raw, E.key[key])).cadets[name];
    const id = E.id[key], revert = [], filed = [];
    try {
      await RPDRoster.waivers.mutate(obj => {
        const c = obj.cadets[name] || {};
        Object.keys(EVENT_TRACKER).forEach(k => {
          const tk = EVENT_TRACKER[k]; const e = c[tk]; if (!e || e.via !== 'online' || e.wvId !== id) return;
          if (next && next.forms[k] && next.forms[k].complete) return;
          if (e.s === 'filed') { filed.push(FORMS[k].short); return; }
          let prev = e.prev; while (prev && prev.via === 'online' && prev.wvId === id) prev = prev.prev;
          if (prev && prev.s) c[tk] = prev; else delete c[tk];
          revert.push(k);
        });
        if (!revert.length) return false;
        obj.cadets[name] = c;
      });
    } catch (e) { }
    if (P.host.rerender) await P.host.rerender(); else evFill();
    evToast('Signatures cleared for ' + name + (revert.length ? '; ' + revert.map(k => FORMS[k].short).join(', ') + ' back to what it was on the tracker' : '') + (filed.length ? '. Already filed, left as is: ' + filed.join(', ') : ''));
  }
  async function evClose(key) {
    const ev = E.data.events[key]; if (!ev) return;
    if (!confirm('Close "' + ev.title + '"? The code stops working; every signature stays on file and the PDFs still open here.')) return;
    const now = Date.now();
    E.data = await RPDRoster.esign.eventsMutate(obj => { const e = obj.events[key]; if (!e) return false; e.closed = true; e.closedAt = now; });
    if (E.data.events[key]) E.inv[key] = await evWriteInvite(E.data.events[key]);   // keeps the blob, sets the node's expiry to now: the page says the code expired
    E.open[key] = false; evFill(); evToast('Event closed; the code no longer opens anything new');
  }
  async function evReopen(key) {
    const ev = E.data.events[key]; if (!ev) return;
    const exp = Math.max(ev.exp || 0, Date.now() + 7 * 86400000);
    E.data = await RPDRoster.esign.eventsMutate(obj => { const e = obj.events[key]; if (!e) return false; e.closed = false; delete e.closedAt; e.exp = exp; });
    E.inv[key] = await evWriteInvite(E.data.events[key]); evSetStatus(key, (E.st[key] && E.st[key]._signers) || []);
    E.open[key] = true; evFill(); evToast('Reopened; the same code works again until ' + fmtDate(exp));
  }
  async function evDelete(key) {
    const ev = E.data.events[key]; if (!ev) return;
    if (!confirm('Delete "' + ev.title + '" for good? Every online signature made for it is deleted too. Download any PDFs you need first.')) return;
    if (!confirm('Last check: delete the event and its signatures?')) return;
    try { await RPDRoster.esign.sigsClear(E.id[key]); } catch (e) { }
    try { await RPDRoster.esign.inviteRemove(E.id[key]); } catch (e) { }
    E.data = await RPDRoster.esign.eventsMutate(obj => { if (!obj.events[key]) return false; delete obj.events[key]; });
    delete E.st[key]; delete E.inv[key]; delete E.raw[key]; evFill(); evToast('Event deleted');
  }
  // Admin: unseal one cadet's signed sections for one form (the reference key: full advisor passcode only).
  async function evPdfData(key, name, k) {
    const st = E.st[key]; const cs = st && st.cadets[name]; if (!cs || !cs.forms[k]) return null;
    if (!RPDRoster.references.isUnlocked()) throw new Error('needs the full advisor passcode');
    const ev = E.data.events[key];
    const data = { cadet: name, sections: {}, event: { title: ev.title, dateUS: fmtIsoUS(ev.date), agency: ev.agency || DEFAULT_AGENCY } };
    const f = cs.forms[k];
    for (const role of Object.keys(f.signed)) {
      const sig = f.signed[role]; const node = ((E.raw[key] || {})[sig.token] || {}).forms || {}; const env = node[k] && node[k].e; if (!env) continue;
      const rec = await RPDRoster.esign.open(env);
      data.sections[role] = { name: rec.name || sig.name, phone: rec.phone || '', phone2: rec.phone2 || '', email: rec.email || '', address: rec.address || '', meds: rec.meds || '', date: fmtDateUS(rec.at || sig.at), at: rec.at || sig.at, sig: rec.sig || '' };
    }
    return data;
  }
  async function evBlank(k) { return await (await fetch('/' + FORMS[k].file + '?v=' + encodeURIComponent(FORMS[k].version), { cache: 'force-cache' })).arrayBuffer(); }
  async function evPdf(key, name, k) {
    if (P.host.loadPdfLib) await P.host.loadPdfLib();
    const data = await evPdfData(key, name, k); if (!data) return;
    const bytes = await fillPdf(global.PDFLib, k, await evBlank(k), data);
    dlBytes(bytes, fileSafe(name) + '_' + fileSafe(FORMS[k].short) + '_' + fileSafe(E.data.events[key].title) + '.pdf');
  }
  // Admin: one PDF with every cadet's signed copy of a form, for the host's folder or the trip binder.
  async function evPdfAll(key, k) {
    if (P.host.loadPdfLib) await P.host.loadPdfLib();
    const { PDFDocument } = global.PDFLib; const st = E.st[key]; const ev = E.data.events[key]; if (!st || !ev) return;
    const out = await PDFDocument.create(); const blank = await evBlank(k); let n = 0;
    for (const name of st.order.slice().sort((a, b) => a.localeCompare(b))) {
      const f = st.cadets[name].forms[k]; if (!f || !Object.keys(f.signed).length) continue;
      const data = await evPdfData(key, name, k); if (!data) continue;
      const src = await PDFDocument.load(await fillPdf(global.PDFLib, k, blank.slice(0), data));
      (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p)); n++;
    }
    if (!n) { evToast('No one has signed the ' + FORMS[k].short + ' yet'); return; }
    out.setTitle(ev.title + ': ' + FORMS[k].title); out.setAuthor('Richardson Police Department Public Safety Cadets');
    dlBytes(await out.save(), fileSafe(ev.title) + '_' + fileSafe(FORMS[k].short) + '_all_' + n + '.pdf');
    evToast(n + (n === 1 ? ' signed copy' : ' signed copies') + ' in one PDF');
  }
  // Who is done on an event: every form in the cadet's packet signed online or marked paper.
  function evTally(ev, st) {
    const doneSet = new Set(); let missing = 0;
    Object.keys(ev.cadets || {}).forEach(name => {
      const c = ev.cadets[name] || {}; const cs = st && st.cadets[name];
      const ok = (c.forms || []).every(k => (((ev.paper || {})[name] || {})[k]) || (cs && cs.forms[k] && cs.forms[k].complete));
      if (ok) doneSet.add(name); else missing++;
    });
    return { doneSet, done: doneSet.size, missing };
  }
  // Admin: letterhead PDF of who still owes what on an event (same locked header and footer as the Missing Waivers list).
  async function evMissingPdf(key) {
    if (P.host.loadPdfLib) await P.host.loadPdfLib();
    const ev = E.data.events[key], st = E.st[key]; if (!ev || !st) return;
    const PDFLib = global.PDFLib; const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle('Event waivers still missing: ' + ev.title); doc.setAuthor('Richardson Police Department Public Safety Cadets');
    const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold), FI = await doc.embedFont(StandardFonts.HelveticaOblique);
    let logo = null; try { const lb = await evLogo(); if (lb) logo = await doc.embedPng(lb); } catch (e) { logo = null; }
    const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    const NAVY = hex('#1B2A4A'), RED = hex('#C41E3A'), GOLD = hex('#C5A55A'), BG = hex('#7A8BA0'), INK = rgb(0.1, 0.1, 0.1), RULE = hex('#DDE2EA');
    const W = 612, H = 792, L = 55, R = W - 55, CW = R - L, BOTTOM = 64, LEAD = 12;
    const safe = s => String(s == null ? '' : s).replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/[  -​ ]/g, ' ').replace(/[^\n\x20-\x7E¡-ÿ]/g, '?');
    const wrap = (font, size, text, maxW) => { const out = []; safe(text).split('\n').forEach(par => { let line = ''; par.split(' ').forEach(word => { while (font.widthOfTextAtSize(word, size) > maxW) { let cut = word.length; while (cut > 1 && font.widthOfTextAtSize((line ? line + ' ' : '') + word.slice(0, cut), size) > maxW) cut--; if (line && cut <= 1) { out.push(line); line = ''; continue; } out.push((line ? line + ' ' : '') + word.slice(0, cut)); line = ''; word = word.slice(cut); } const test = line ? line + ' ' + word : word; if (font.widthOfTextAtSize(test, size) <= maxW) line = test; else { if (line) out.push(line); line = word; } }); out.push(line); }); return out; };
    const pages = []; let page = null, y = 0;
    const rtext = (t, xr, yy, size, font, color) => page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
    const asOf = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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
      page.drawText('Event Waivers: Still Missing', { x: tx, y: top - 64, size: 9, font: F, color: BG });
      rtext('CONFIDENTIAL', R, top - 64, 8, FB, BG);
      rtext('As of ' + safe(asOf), R, top - 76, 8, F, BG);
      y = H - 134 - 6;
    }
    function newPage() { page = doc.addPage(); page.setSize(W, H); pages.push(page); header(); }
    function need(h) { if (y - h < BOTTOM) newPage(); }
    function section(title) { need(40); y -= 8; page.drawText(safe(title).toUpperCase(), { x: L, y, size: 9.5, font: FB, color: NAVY }); page.drawLine({ start: { x: L, y: y - 4 }, end: { x: R, y: y - 4 }, thickness: 0.5, color: GOLD }); y -= 18; }
    function para(text, font, size, indent) { wrap(font, size, text, CW - (indent || 0)).forEach(t => { need(LEAD); page.drawText(t, { x: L + (indent || 0), y, size, font, color: INK }); y -= LEAD; }); }
    const who = n => { const r = evRank(n); return (r ? r + ' ' : '') + n; };
    newPage();
    page.drawText(safe(ev.title), { x: L, y, size: 13, font: FB, color: NAVY }); y -= 16;
    para(fmtIsoLong(ev.date) + (ev.location ? '. ' + ev.location : '') + '. Code ' + formatCode(ev.code) + (ev.closed ? ' (closed)' : ', closes ' + fmtDate(ev.exp)) + '.', F, 9.5);
    const tally = evTally(ev, st); const names = Object.keys(ev.cadets || {}).sort((a, b) => a.localeCompare(b));
    para(names.length + (names.length === 1 ? ' cadet' : ' cadets') + ' on this event. ' + tally.done + ' complete. ' + tally.missing + ' still missing something.', F, 9.5);
    y -= 2; section('Still missing');
    const miss = names.filter(n => !tally.doneSet.has(n));
    if (!miss.length) para('Nothing is missing.', FI, 9.5);
    miss.forEach(name => {
      const c = ev.cadets[name] || {}; const cs = st.cadets[name];
      const items = (c.forms || []).filter(k => !(((ev.paper || {})[name] || {})[k]) && !(cs && cs.forms[k] && cs.forms[k].complete)).map(k => {
        const f = cs && cs.forms[k]; let label = FORMS[k].title;
        if (f && Object.keys(f.signed).length) label += ' (signed by ' + Object.keys(f.signed).map(r => f.signed[r].name).join(', ') + '; waiting on ' + f.waiting.map(roleLabel).join(' and ') + ')';
        else if (f) label += ' (needs ' + f.needed.map(roleLabel).join(' and ') + ')';
        return wrap(F, 9, label, CW - 34);
      });
      need(Math.min(16 + items.reduce((n, l) => n + l.length * LEAD, 0) + 8, 200));
      page.drawText(safe(who(name)), { x: L, y, size: 10.5, font: FB, color: INK });
      rtext(items.length + ' missing', R, y, 8.5, FB, RED); y -= 16;
      items.forEach(lines => { need(lines.length * LEAD); page.drawRectangle({ x: L + 12, y: y - 1.5, width: 8, height: 8, borderColor: INK, borderWidth: 0.8 }); lines.forEach(t => { page.drawText(t, { x: L + 28, y, size: 9, font: F, color: INK }); y -= LEAD; }); });
      y -= 3; page.drawLine({ start: { x: L, y: y + 4 }, end: { x: R, y: y + 4 }, thickness: 0.4, color: RULE }); y -= 7;
    });
    const paperRows = []; names.forEach(n => Object.keys((ev.paper || {})[n] || {}).forEach(k => { if (FORMS[k]) paperRows.push(who(n) + ': ' + FORMS[k].title + ', paper, ' + fmtDate(ev.paper[n][k].at) + (ev.paper[n][k].by ? ' (' + ev.paper[n][k].by + ')' : '')); }));
    if (paperRows.length) { section('Signed on paper'); paperRows.forEach(t => para(t, F, 9, 12)); }
    const skips = []; names.forEach(n => { const c = ev.cadets[n] || {}; Object.keys(c.skip || {}).forEach(k => { if (FORMS[k]) skips.push(who(n) + ': ' + FORMS[k].title + (c.skip[k] === 'online' ? ', already signed online' : (c.skip[k] === 'age' ? ', 21 or older' : ''))); }); });
    if (skips.length) { section('Not needed'); skips.forEach(t => para(t, F, 9, 12)); }
    pages.forEach((p, i) => { p.drawLine({ start: { x: L, y: 45 }, end: { x: R, y: 45 }, thickness: 0.5, color: GOLD }); const addr = '200 N. Greenville Ave, Richardson, TX 75081  |  (972) 744-4801'; p.drawText(addr, { x: (W - F.widthOfTextAtSize(addr, 7)) / 2, y: 34, size: 7, font: F, color: BG }); p.drawText('CADET/EVENTWV V1', { x: L, y: 22, size: 7, font: F, color: BG }); p.drawText('Page ' + (i + 1) + ' of ' + pages.length, { x: R - F.widthOfTextAtSize('Page ' + (i + 1) + ' of ' + pages.length, 7), y: 22, size: 7, font: F, color: BG }); });
    dlBytes(await doc.save(), 'Event_Waivers_Missing_' + fileSafe(ev.title) + '_' + dateIso() + '.pdf');
  }
  let evLogoBytes = null;
  async function evLogo() {
    if (evLogoBytes) return evLogoBytes;
    const r = await fetch('/logo_transparent.png'); if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    try { const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = 400; c.height = Math.round(400 * bmp.height / bmp.width); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); const out = await new Promise(res => c.toBlob(res, 'image/png')); if (out) { evLogoBytes = new Uint8Array(await out.arrayBuffer()); return evLogoBytes; } } catch (e) { }
    evLogoBytes = new Uint8Array(buf); return evLogoBytes;
  }
  /* ── event section: rendering ── */
  function evFill() { const el = evHostEl(); if (!el) return; el.innerHTML = evHtml(); }
  function evHtml() {
    if (!P.ready) return '';
    if (!E.data) return P.host.admin ? '<div class="wve"><div class="wve-head"><span class="wvo-l">Event waivers</span><span class="wvo-muted">' + (E.err ? 'Could not read the events right now.' : 'Not available: this page needs roster.js VERSION 38 or later.') + '</span></div></div>' : '';
    const evs = Object.values(E.data.events || {}).filter(ev => ev && ev.key).sort((a, b) => (!!a.closed === !!b.closed) ? String(b.date || '').localeCompare(String(a.date || '')) : (a.closed ? 1 : -1));
    let html = '<div class="wve"><div class="wve-head"><span class="wvo-l">Event waivers</span><span class="wvo-muted">One shared code per special event: every family enters it at rpdcadets.com/waivers, picks the cadet, and signs.</span>' + (P.host.admin ? `<button type="button" class="wvo-btn gen" data-wve="newform">${E.form ? 'Cancel' : 'New event'}</button>` : '') + '</div>';
    if (E.err) html += '<div class="wvo-f wait">Could not read the events right now; tap Refresh on the tracker.</div>';
    if (P.host.admin && E.form) html += evFormHtml();
    if (!evs.length && !E.form) html += '<div class="wvo-muted">No events yet.' + (P.host.admin ? ' New event makes a shared code for a trip or a training day.' : '') + '</div>';
    evs.forEach(ev => { html += evCardHtml(ev); });
    return html + '</div>';
  }
  function evFormNote(k) { return k === 'sim' ? 'Everyone signs it again, except cadets whose Simunitions release was already signed online' : (k === 'medtrip' ? 'A parent or guardian signs for every cadet under 21' : 'The cadet signs; a parent or guardian also signs for a minor'); }
  function evFormHtml() {
    const names = evActive(); const today = dateIso();
    return `<form class="wve-form" data-wve-form="new" autocomplete="off">
      <label class="wve-l" for="wveTitle">Event title</label><input type="text" id="wveTitle" name="title" class="wve-in" placeholder="Active Shooter Simunitions Training at Garland ISD" maxlength="90">
      <div class="wve-two"><div><label class="wve-l" for="wveDate">Event date</label><input type="date" id="wveDate" name="date" class="wve-in" min="${today}"></div><div><label class="wve-l" for="wveCloses">Code closes</label><input type="date" id="wveCloses" name="closes" class="wve-in" min="${today}"><div class="wvo-muted">The day after the event unless you change it</div></div></div>
      <label class="wve-l" for="wveLoc">Location</label><input type="text" id="wveLoc" name="location" class="wve-in" value="${esc(GISD_LOCATION)}" maxlength="120"><div class="wvo-muted">Filled in for the Garland ISD waiver; change it for any other place</div>
      <label class="wve-l">Forms in the packet</label>
      <div class="wve-checks">${EVENT_KEYS.map(k => `<label class="wve-chk"><input type="checkbox" name="forms" value="${k}" checked><span>${esc(FORMS[k].title)}<small>${esc(evFormNote(k))}</small></span></label>`).join('')}</div>
      <label class="wve-l">Cadets <span class="wvo-muted" data-wve-count>(${names.length} of ${names.length})</span></label>
      <div class="wve-acts"><button type="button" class="wvo-btn" data-wve="checkall">Everyone</button><button type="button" class="wvo-btn" data-wve="checknone">No one</button></div>
      <div class="wve-checks cadets">${names.map(p => `<label class="wve-chk"><input type="checkbox" name="cadets" value="${esc(p.name)}" checked><span>${p.rank ? esc(p.rank) + ' ' : ''}${esc(p.name)}</span></label>`).join('')}</div>
      <div class="wvo-f wait" data-wve-err></div>
      <div class="wve-acts"><button type="submit" class="wvo-btn go">Create event and code</button><button type="button" class="wvo-btn" data-wve="newform">Cancel</button></div>
    </form>`;
  }
  function evCardHtml(ev) {
    const st = E.st[ev.key]; const open = (E.open[ev.key] !== undefined) ? E.open[ev.key] : !ev.closed;
    const names = Object.keys(ev.cadets || {}); const tally = evTally(ev, st); const filt = E.filter[ev.key] || 'all';
    const expired = !ev.closed && ev.exp && Date.now() > ev.exp;
    let body = '';
    if (open) {
      const list = names.slice().sort((a, b) => a.localeCompare(b)).filter(n => filt === 'all' || !tally.doneSet.has(n));
      const rows = list.length ? list.map(n => evRowHtml(ev, st, n)).join('') : '<div class="wvo-muted">' + (filt === 'all' ? 'No cadets on this event yet.' : 'Everyone is done.') + '</div>';
      body = `<div class="wvo-head"><span class="wvo-l">Event code</span><span class="wvo-code">${esc(formatCode(ev.code))}</span><span class="wvo-muted">${ev.closed ? 'closed ' + esc(fmtDate(ev.closedAt || ev.exp)) : (expired ? 'expired ' : 'closes ') + esc(fmtDate(ev.exp))}${ev.by ? ' · made by ' + esc(ev.by) : ''}</span></div>
      ${st ? '' : '<div class="wvo-f wait">Could not read the signing status for this event right now.</div>'}
      <div class="wvo-acts">
        ${ev.closed ? '' : `<button type="button" class="wvo-btn" data-wve="copy">Copy link</button><button type="button" class="wvo-btn" data-wve="share">Share</button><button type="button" class="wvo-btn" data-wve="qr">QR</button>`}
        <button type="button" class="wvo-btn" data-wve="refresh">Refresh</button>
        ${P.host.admin ? `${ev.closed ? '' : '<button type="button" class="wvo-btn" data-wve="editcadets">Cadets</button>'}${(ev.forms || []).filter(k => FORMS[k]).map(k => `<button type="button" class="wvo-btn" data-wve="pdfall" data-wve-form="${k}">All ${esc(FORMS[k].short)} PDFs</button>`).join('')}<button type="button" class="wvo-btn" data-wve="missingpdf">Print still missing</button>${ev.closed ? `<button type="button" class="wvo-btn" data-wve="reopen">Reopen</button><button type="button" class="wvo-btn danger" data-wve="delete">Delete</button>` : `<button type="button" class="wvo-btn danger" data-wve="close">Close event</button>`}` : ''}
      </div>
      <div class="wve-filter"><button type="button" class="wve-f${filt === 'all' ? ' on' : ''}" data-wve="filter" data-wve-f="all">Everyone (${names.length})</button><button type="button" class="wve-f${filt === 'missing' ? ' on' : ''}" data-wve="filter" data-wve-f="missing">Still missing (${tally.missing})</button></div>
      <div class="wve-rows">${rows}</div>`;
    }
    return `<div class="wve-card${ev.closed ? ' closed' : ''}" data-wve-key="${esc(ev.key)}">
      <div class="wve-title"><button type="button" class="wve-toggle" data-wve="toggle" aria-label="${open ? 'Collapse' : 'Expand'}">${open ? '&#9662;' : '&#9656;'}</button><div class="wve-tt"><div class="wve-t">${esc(ev.title)}</div><div class="wve-sub">${esc(fmtIsoLong(ev.date))}${ev.location ? ' · ' + esc(ev.location) : ''}</div></div><div class="wve-tally${tally.missing ? '' : ' ok'}">${ev.closed ? 'Closed · ' : (expired ? 'Code expired · ' : '')}${esc(tally.done + ' of ' + names.length + ' complete')}</div></div>${body}</div>`;
  }
  function evRowHtml(ev, st, name) {
    const c = (ev.cadets || {})[name] || {}; const cs = st && st.cadets[name];
    const cells = (ev.forms || []).filter(k => FORMS[k]).map(k => {
      const F = FORMS[k]; const paper = ((ev.paper || {})[name] || {})[k];
      let cls = 'need', s = 'Not signed', b = '';
      if (paper) { cls = 'paper'; s = 'Paper ' + fmtDate(paper.at); b = paper.by ? 'by ' + paper.by : ''; }
      else if (!(c.forms || []).includes(k)) { cls = 'skip'; s = 'Not needed'; b = (c.skip || {})[k] === 'online' ? 'already signed online' : ((c.skip || {})[k] === 'age' ? '21 or older' : ''); }
      else if (cs && cs.forms[k]) {
        const f = cs.forms[k];
        if (f.complete) { cls = 'ok'; s = 'Signed ' + fmtDate(f.at); b = f.by.length ? 'by ' + f.by.join(', ') : ''; }
        else { s = 'Waiting on ' + f.waiting.map(roleLabel).join(' and '); const have = Object.keys(f.signed).map(r => f.signed[r].name); if (have.length) { cls = 'part'; b = 'signed by ' + have.join(', '); } }
      }
      return `<button type="button" class="wve-cell ${cls}" data-wve="cell" data-wve-form="${k}" data-wve-name="${esc(name)}" title="${esc(F.title)}"><span class="l">${esc(F.short)}</span><span class="s">${esc(s)}</span>${b ? `<span class="b">${esc(b)}</span>` : ''}</button>`;
    }).join('');
    const rank = evRank(name);
    const signedForms = cs ? Object.keys(cs.forms).filter(k => Object.keys(cs.forms[k].signed).length) : [];
    const acts = (P.host.admin && signedForms.length) ? `<div class="wvo-acts">${signedForms.map(k => `<button type="button" class="wvo-btn" data-wve="pdf" data-wve-form="${k}" data-wve-name="${esc(name)}">${esc(FORMS[k].short)} PDF${cs.forms[k].complete ? '' : ' (partial)'}</button>`).join('')}<button type="button" class="wvo-btn danger" data-wve="clear" data-wve-name="${esc(name)}">Clear signatures</button></div>` : '';
    return `<div class="wve-row"><div class="wve-who">${rank ? `<span class="wve-rank">${esc(rank)}</span>` : ''}<span class="wve-name">${esc(name)}</span>${(cs && cs.extraParents.length) ? `<span class="wvo-muted">extra parent not counted: ${esc(cs.extraParents.join(', '))}</span>` : ''}</div><div class="wve-cells">${cells}</div>${acts}</div>`;
  }
  // Admin: pick which cadets are on an event (active roster plus anyone already on it).
  function evCadetsModal(key) {
    const ev = E.data.events[key]; if (!ev) return; const st = E.st[key];
    const names = evActive().map(p => p.name); Object.keys(ev.cadets || {}).forEach(n => { if (!names.includes(n)) names.push(n); });
    const signed = n => !!(st && st.cadets[n] && Object.keys(st.cadets[n].forms).some(k => Object.keys(st.cadets[n].forms[k].signed).length));
    const m = evModal(`<div class="wvo-l">Cadets on "${esc(ev.title)}"</div><p class="wvo-muted" style="margin:6px 0 10px">Cadets added now get the forms they still need; a cadet who has signed keeps those signatures.</p>
      <div class="wve-acts"><button type="button" class="wvo-btn" data-wvem="all">Everyone</button><button type="button" class="wvo-btn" data-wvem="none">No one</button></div>
      <div class="wve-checks cadets">${names.map(n => { const on = !!(ev.cadets || {})[n]; const r = evRank(n); return `<label class="wve-chk"><input type="checkbox" name="cadets" value="${esc(n)}"${on ? ' checked' : ''}><span>${r ? esc(r) + ' ' : ''}${esc(n)}${signed(n) ? '<small>has signed</small>' : ''}</span></label>`; }).join('')}</div>
      <div class="wve-acts" style="margin-top:10px"><button type="button" class="wvo-btn go" data-wvem="save">Save</button><button type="button" class="wvo-btn" data-wvem="cancel">Cancel</button></div>`);
    m.querySelector('.wve-modal-card').addEventListener('click', async e => {
      const b = e.target.closest('[data-wvem]'); if (!b) return;
      const boxes = Array.from(m.querySelectorAll('input[name=cadets]'));
      if (b.dataset.wvem === 'all') { boxes.forEach(x => x.checked = true); return; }
      if (b.dataset.wvem === 'none') { boxes.forEach(x => x.checked = false); return; }
      if (b.dataset.wvem === 'cancel') { m.remove(); return; }
      const picked = boxes.filter(x => x.checked).map(x => x.value);
      const dropped = Object.keys(ev.cadets || {}).filter(n => !picked.includes(n) && signed(n));
      if (dropped.length && !confirm('Remove ' + dropped.join(', ') + ' from the event? Their signatures stay stored but are hidden until they are added back.')) return;
      b.disabled = true; try { await evSaveCadets(key, picked); } catch (err) { evToast('Could not save: ' + (err && err.message ? err.message : err)); } m.remove();
    });
  }
  function evModal(inner) {
    let m = document.getElementById('wveModal'); if (m) m.remove();
    m = document.createElement('div'); m.id = 'wveModal'; m.className = 'wve-modal';
    m.innerHTML = '<div class="wve-modal-card">' + inner + '</div>';
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    document.body.appendChild(m); return m;
  }
  function evField(form, n) { return form.elements.namedItem(n); }
  function evFormVals(form) {
    const fv = n => { const el = evField(form, n); return el ? String(el.value || '') : ''; };
    const v = { title: fv('title').trim().replace(/\s+/g, ' '), date: fv('date'), closes: fv('closes'), location: fv('location').trim(), forms: Array.from(form.querySelectorAll('input[name=forms]:checked')).map(x => x.value), cadets: Array.from(form.querySelectorAll('input[name=cadets]:checked')).map(x => x.value) };
    if (!v.title) return { err: 'Give the event a title.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return { err: 'Pick the event date.' };
    if (!v.closes) { const d = new Date(v.date + 'T12:00:00'); d.setDate(d.getDate() + 1); v.closes = dateIso(d.getTime()); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.closes)) return { err: 'Pick the day the code closes.' };
    v.exp = new Date(v.closes + 'T23:59:59').getTime();
    if (v.exp < Date.now()) return { err: 'The code would already be closed. Pick a later closing day.' };
    if (!v.forms.length) return { err: 'Pick at least one form.' };
    if (!v.cadets.length) return { err: 'Pick at least one cadet.' };
    return v;
  }
  async function evAct(act, btn) {
    const card = btn.closest('[data-wve-key]'); const key = card ? card.dataset.wveKey : ''; const ev = key && E.data && E.data.events[key];
    const name = btn.dataset.wveName || '', k = btn.dataset.wveForm || '';
    try {
      if (act === 'newform') { E.form = !E.form; evFill(); return; }
      if (act === 'checkall' || act === 'checknone') { const f = btn.closest('form'); f.querySelectorAll('input[name=cadets]').forEach(x => x.checked = (act === 'checkall')); evCount(f); return; }
      if (!ev) return;
      const url = link(ev.code);
      if (act === 'toggle') { E.open[key] = !((E.open[key] !== undefined) ? E.open[key] : !ev.closed); evFill(); return; }
      if (act === 'filter') { E.filter[key] = btn.dataset.wveF || 'all'; evFill(); return; }
      if (act === 'copy') { await navigator.clipboard.writeText(url); evToast('Link copied'); return; }
      if (act === 'share') { if (navigator.share) { await navigator.share({ title: 'Event waivers to sign', text: 'Richardson PD Public Safety Cadets: waivers for ' + ev.title + ' (' + fmtIsoLong(ev.date) + '). Enter code ' + formatCode(ev.code) + ', pick your cadet, and sign.', url }); } else { await navigator.clipboard.writeText(url); evToast('Sharing is not available here; link copied instead'); } return; }
      if (act === 'qr') { qrPopup(url, formatCode(ev.code), ev.title); return; }
      if (act === 'refresh') { btn.disabled = true; await pRefresh(); return; }
      if (act === 'cell') {
        const c = (ev.cadets || {})[name] || {}; const cs = E.st[key] && E.st[key].cadets[name]; const paper = ((ev.paper || {})[name] || {})[k];
        if (!paper && !(c.forms || []).includes(k)) { evToast((c.skip || {})[k] === 'online' ? name + ' already signed the Simunitions release online; nothing to do.' : ((c.skip || {})[k] === 'age' ? 'The medical consent covers participants under 21 only.' : 'Not in this cadet\'s packet.')); return; }
        if (!paper && cs && cs.forms[k] && Object.keys(cs.forms[k].signed).length) { evToast(cs.forms[k].complete ? 'Signed online.' + (P.host.admin ? ' Use the PDF button on the row.' : '') : 'Partly signed online; waiting on ' + cs.forms[k].waiting.map(roleLabel).join(' and ') + '.'); return; }
        if (ev.closed && !P.host.admin) { evToast('This event is closed.'); return; }
        btn.disabled = true; await evPaper(key, name, k); return;
      }
      if (!P.host.admin) return;
      if (act === 'editcadets') { evCadetsModal(key); return; }
      if (act === 'pdf') { btn.disabled = true; try { await evPdf(key, name, k); } finally { btn.disabled = false; } return; }
      if (act === 'pdfall') { btn.disabled = true; try { await evPdfAll(key, k); } finally { btn.disabled = false; } return; }
      if (act === 'missingpdf') { btn.disabled = true; try { await evMissingPdf(key); } finally { btn.disabled = false; } return; }
      if (act === 'clear') { btn.disabled = true; await evClear(key, name); return; }
      if (act === 'close') { await evClose(key); return; }
      if (act === 'reopen') { btn.disabled = true; await evReopen(key); return; }
      if (act === 'delete') { btn.disabled = true; await evDelete(key); return; }
    } catch (e) { evToast('That did not work: ' + (e && e.message ? e.message : e)); evFill(); }
  }
  function evCount(form) { const el = form.querySelector('[data-wve-count]'); if (!el) return; const all = form.querySelectorAll('input[name=cadets]').length, on = form.querySelectorAll('input[name=cadets]:checked').length; el.textContent = '(' + on + ' of ' + all + ')'; }
  function evBind() {
    const el = evHostEl(); if (!el || E.bound) return; E.bound = true;
    el.addEventListener('click', e => { const b = e.target.closest('[data-wve]'); if (b) evAct(b.dataset.wve, b); });
    el.addEventListener('change', e => {
      const form = e.target.closest('form[data-wve-form]'); if (!form) return;
      if (e.target.name === 'cadets') evCount(form);
      const loc = evField(form, 'location'), closes = evField(form, 'closes');
      if (e.target.name === 'forms' && e.target.value === 'gisd' && loc) { if (e.target.checked && !loc.value.trim()) loc.value = GISD_LOCATION; else if (!e.target.checked && loc.value.trim() === GISD_LOCATION) loc.value = ''; }
      if (e.target.name === 'date' && e.target.value && closes && !closes.value) { const d = new Date(e.target.value + 'T12:00:00'); if (!isNaN(d)) { d.setDate(d.getDate() + 1); closes.value = dateIso(d.getTime()); } }
    });
    el.addEventListener('submit', async e => {
      const form = e.target.closest('form[data-wve-form]'); if (!form) return; e.preventDefault();
      const err = form.querySelector('[data-wve-err]'); const v = evFormVals(form);
      if (v.err) { if (err) err.textContent = v.err; return; }
      const sb = form.querySelector('button[type=submit]'); if (sb) sb.disabled = true;
      try { await evCreate(v); } catch (ex) { if (sb) sb.disabled = false; if (err) err.textContent = 'Could not create the event: ' + (ex && ex.message ? ex.message : ex); }
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
.wvo-qr-x{position:absolute;top:10px;right:12px;background:none;border:none;font-size:26px;line-height:1;color:#5b6b82;cursor:pointer;padding:4px}
.wve{margin:0 0 14px;padding:12px;border:1px solid rgba(212,169,82,0.35);border-radius:12px;background:var(--card-bg);display:flex;flex-direction:column;gap:10px;font-size:12.5px;color:#c6d0de}
.wve-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.wve-head .wvo-btn{margin-left:auto}
.wve-card{border:1px dashed rgba(212,169,82,0.35);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.wve-card.closed{border-style:solid;border-color:var(--card-border);opacity:.8}
.wve-title{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}
.wve-tt{flex:1 1 200px;min-width:0}
.wve-toggle{background:none;border:none;color:var(--gold);font-size:20px;line-height:1;cursor:pointer;padding:0 2px}
.wve-t{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:17px;letter-spacing:.5px;color:#fff;overflow-wrap:anywhere}
.wve-sub{color:var(--text-muted);font-size:12px;line-height:1.4}
.wve-tally{margin-left:auto;white-space:nowrap;font-family:'Barlow Condensed',sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--gold-light);padding-top:3px}
.wve-tally.ok{color:#8fe3b3}
.wve-filter{display:flex;flex-wrap:wrap;gap:6px}
.wve-f{background:rgba(255,255,255,0.03);border:1px solid var(--card-border);color:#c6d0de;border-radius:20px;padding:6px 12px;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;cursor:pointer}
.wve-f.on{border-color:var(--gold);color:var(--gold-light);background:rgba(212,169,82,0.1)}
.wve-rows{display:flex;flex-direction:column;gap:6px}
.wve-row{border-top:1px solid var(--card-border);padding-top:8px;display:flex;flex-direction:column;gap:6px}
.wve-who{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.wve-rank{font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--gold)}
.wve-name{font-weight:600;color:#fff;font-size:14px}
.wve-cells{display:flex;flex-wrap:wrap;gap:6px}
.wve-cell{text-align:left;background:rgba(255,255,255,0.03);border:1px solid var(--card-border);border-radius:9px;padding:7px 10px;color:#c6d0de;cursor:pointer;flex:1 1 150px;min-width:150px;font-family:'Barlow',sans-serif}
.wve-cell .l{display:block;font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted)}
.wve-cell .s{display:block;font-size:12.5px;font-weight:600;color:#fff}
.wve-cell .b{display:block;font-size:11.5px;color:var(--text-muted)}
.wve-cell.ok{border-color:rgba(39,174,96,0.45)}.wve-cell.ok .s{color:#8fe3b3}
.wve-cell.paper{border-color:rgba(39,174,96,0.3)}.wve-cell.paper .s{color:#8fe3b3}
.wve-cell.part .s{color:var(--gold-light)}
.wve-cell.need .s{color:#f8a3a3}
.wve-cell.skip{opacity:.6;cursor:default}
.wve-form{display:flex;flex-direction:column;gap:4px;border:1px solid var(--card-border);border-radius:10px;padding:10px 12px 12px}
.wve-l{display:block;font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--gold);margin-top:8px}
.wve-in{width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:11px 12px;color:#fff;font-family:'Barlow',sans-serif;font-size:15px;outline:none;color-scheme:dark}
.wve-in:focus{border-color:var(--gold)}
.wve-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:520px){.wve-two{grid-template-columns:1fr}}
.wve-checks{display:flex;flex-direction:column;gap:2px}
.wve-checks.cadets{max-height:260px;overflow:auto;border:1px solid var(--card-border);border-radius:9px;padding:6px 10px}
.wve-chk{display:flex;align-items:flex-start;gap:9px;font-size:14px;color:#dbe3ee;padding:5px 0;cursor:pointer;line-height:1.3}
.wve-chk input{width:18px;height:18px;margin-top:1px;flex:none;accent-color:var(--gold)}
.wve-chk small{display:block;color:var(--text-muted);font-size:12px}
.wve-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.wve-modal{display:flex;position:fixed;inset:0;background:rgba(6,11,22,0.86);z-index:1700;align-items:center;justify-content:center;padding:18px}
.wve-modal-card{background:#141d33;border:1px solid rgba(212,169,82,0.35);border-radius:16px;padding:18px;max-width:440px;width:100%;max-height:90vh;overflow:auto;color:#c6d0de;font-size:13px;box-shadow:0 30px 80px rgba(0,0,0,0.5)}`;
    document.head.appendChild(s);
  }

  global.RPDWv = {
    SALT: WV_SALT, FORMS, PAPER, PAPER_KEYS, ONLINE_KEYS, CONSENT, DAYS, LINK_BASE, ROOT,
    EVENT_KEYS, EVENT_TRACKER, DEFAULT_AGENCY, GISD_LOCATION,   // v4
    normalizeCode, formatCode, newCode, derive, link, newToken,
    keyEncrypt, keyDecrypt, envelope, b64ToArr, arrToB64,
    decodeSigs, assignRoles, status, roleLabel, dateIso, fmtDate, fmtDateTime, fmtDateUS, esc, normName,
    eventCadetInvite, eventStatus, fmtIsoUS, fmtIsoLong, isAtLeast,   // v4
    fillPdf, qrSvg,
    panel: { init: pInit, bind: pBind, refresh: pRefresh, fill: pFill, contactsHtml: pContactsHtml, state: P, blockHtml: pBlockHtml, pdf: pPdf,
             liabFor: name => (P.st[name] && P.st[name].liab) || null,   // Build v3: the Release of Liability version the online signing points to
             events: { fill: evFill, state: E } }   // Build v4: the event section (rendered into #wveHost, or host.eventsHost)
  };
})(window);
