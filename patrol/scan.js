/* patrol/scan.js | Build v2 | 2026-10-18 | VIN guide frame is now label-shaped (about 2:1) instead of a thin strip, and the hint says the bars or the square code both work, since newer door-jamb labels (GM, for one) carry the VIN in a QR code; field finding 10/18/26. v1: Shared camera scanner for the /patrol field tools. Reads the PDF417 barcode on the back of a driver license or ID (AAMVA layout, all US states and Canadian provinces) and the VIN barcode on a vehicle's door-jamb label, using the phone's camera inside the page. Decoding runs in the browser with the self-hosted zxing-wasm reader (/patrol/vendor/zxing-wasm/3.1.5/, loaded only when a scan starts); nothing is uploaded, nothing is stored, and the caller decides which parsed fields to keep. Also looks a VIN up at the NHTSA vPIC service for year, make, and model (only the VIN is sent).
   Usage:
     RPDScan.supported()                -> true if this browser can open the camera here (secure page, getUserMedia, WebAssembly)
     RPDScan.scanLicense()              -> Promise {ok:true, fields:{last, first, middle, id, state, ...}, ms} or {ok:false, reason:'cancel'|'error', message}
     RPDScan.scanVIN()                  -> Promise {ok:true, vin, valid, ms} or {ok:false, ...}
     RPDScan.decodeVIN(vin)             -> Promise {year, make, model} or null (NHTSA vPIC, 8 s limit)
     RPDScan.parseAAMVA(text)           -> fields or null (pure function, used by the tests)
     RPDScan.vinValid(vin)              -> check-digit test
     RPDScan.explain(err)               -> plain-language message for a camera or reader error
     RPDScan.log = function(msg){}      -> optional hook for status messages
*/
(function(global){
  'use strict';
  var VENDOR = '/patrol/vendor/zxing-wasm/3.1.5/';
  var VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';
  var log = function(){};

  /* AAMVA issuer identification numbers -> jurisdiction (the issuing state is the first six digits after "ANSI "). */
  var IIN = {
    '636033':'AL','636059':'AK','604432':'AB','636026':'AZ','636021':'AR','636028':'BC','636014':'CA','636020':'CO','636006':'CT',
    '636011':'DE','636043':'DC','636010':'FL','636055':'GA','636047':'HI','636050':'ID','636035':'IL','636037':'IN','636018':'IA',
    '636022':'KS','636046':'KY','636007':'LA','636041':'ME','636048':'MB','636003':'MD','636002':'MA','636032':'MI','636038':'MN',
    '636051':'MS','636030':'MO','636008':'MT','636054':'NE','636049':'NV','636017':'NB','636039':'NH','636036':'NJ','636009':'NM',
    '636001':'NY','636016':'NL','636004':'NC','636034':'ND','636013':'NS','604433':'NU','636023':'OH','636058':'OK','636012':'ON',
    '636029':'OR','636025':'PA','604426':'PE','604428':'QC','636052':'RI','636044':'SK','636005':'SC','636042':'SD','636053':'TN',
    '636015':'TX','636040':'UT','636024':'VT','636000':'VA','636045':'WA','636061':'WV','636031':'WI','636060':'WY','604429':'YT'
  };

  function supported(){
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && global.isSecureContext !== false && typeof WebAssembly === 'object';
  }

  /* ---- decoder (loaded once, on first use) ---- */
  var decoderReady = null;
  function loadDecoder(){
    if(decoderReady) return decoderReady;
    decoderReady = new Promise(function(resolve, reject){
      if(global.ZXingWASM) return resolve();
      var s = document.createElement('script');
      s.src = VENDOR + 'index.js';
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error('Could not load the barcode reader. Check the connection and try again.')); };
      document.head.appendChild(s);
    }).then(function(){
      return global.ZXingWASM.prepareZXingModule({
        overrides: { locateFile: function(path, prefix){ return /\.wasm$/.test(path) ? VENDOR + path : prefix + path; } },
        fireImmediately: true
      });
    }).catch(function(e){ decoderReady = null; throw e; });
    return decoderReady;
  }
  var FORMATS = { license: ['PDF417'], vin: ['Code39', 'Code128', 'DataMatrix', 'QRCode'] };
  async function readOnce(source, kind){
    var res = await global.ZXingWASM.readBarcodes(source, { formats: FORMATS[kind], tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 1, textMode: 'Plain' });
    if(!res || !res.length) return null;
    var r = res[0];
    var text = r.text || '';
    if(r.bytes && r.bytes.length){ try{ text = new TextDecoder('latin1').decode(r.bytes); }catch(e){} }
    return { text: text, format: r.format };
  }

  /* ---- AAMVA (driver license / ID barcode) parsing ---- */
  function clean(s){
    s = (s === undefined || s === null) ? '' : String(s).replace(/,+\s*$/, '').trim();
    return /^(NONE|N\/A|NA|UNAVL|UNAVAILABLE|UNK|UNKNOWN)$/i.test(s) ? '' : s;
  }
  // US cards write dates MMDDCCYY, Canadian cards CCYYMMDD; a leading pair above 12 can only be a year.
  function fmtDate(s, canada){
    s = (s || '').replace(/\D/g, '');
    if(s.length !== 8) return clean(s);
    var mm = parseInt(s.slice(0, 2), 10);
    if(canada || mm > 12 || mm === 0) return s.slice(4, 6) + '/' + s.slice(6, 8) + '/' + s.slice(0, 4);
    return s.slice(0, 2) + '/' + s.slice(2, 4) + '/' + s.slice(4, 8);
  }
  function fmtSex(s){ s = clean(s).toUpperCase(); return s === '1' ? 'M' : s === '2' ? 'F' : s === '9' ? 'X' : (/^(M|F|X)$/.test(s) ? s : s); }
  function fmtHeight(s){
    s = clean(s);
    var m3 = /^(\d)(\d\d)$/.exec(s);                                  // 2000-era cards: "504" = 5 ft 4 in
    if(m3 && parseInt(m3[2], 10) < 12) return m3[1] + "'" + parseInt(m3[2], 10) + '"';
    var m = /^(\d{1,3})\s*(IN|in)?$/.exec(s);
    if(/CM/i.test(s)){ var cm = parseInt(s, 10); if(cm) { var tot = Math.round(cm / 2.54); return Math.floor(tot / 12) + "'" + (tot % 12) + '"'; } }
    if(m){ var n = parseInt(m[1], 10); return Math.floor(n / 12) + "'" + (n % 12) + '"'; }
    return s;
  }
  function parseAAMVA(text){
    if(!text) return null;
    var t = String(text).replace(/\r\n/g, '\n');
    var ansi = t.indexOf('ANSI ');
    if(ansi < 0) ansi = t.indexOf('AAMVA');
    var base = ansi >= 0 ? Math.max(0, t.lastIndexOf('@', ansi)) : 0;
    var raw = {}, subfiles = [], iin = '', ver = 0;
    if(ansi >= 0){
      var hdr = t.substr(ansi + 5);
      iin = hdr.substr(0, 6); ver = parseInt(hdr.substr(6, 2), 10) || 0;
      var pos = ver >= 2 ? 10 : 8;                       // jurisdiction version field exists from version 2 on
      var n = parseInt(hdr.substr(pos, 2), 10); pos += 2;
      if(!(n >= 1 && n <= 10)) n = 1;
      for(var i = 0; i < n; i++){
        var type = hdr.substr(pos + i * 10, 2), off = parseInt(hdr.substr(pos + i * 10 + 2, 4), 10), len = parseInt(hdr.substr(pos + i * 10 + 6, 4), 10);
        if(/^(DL|ID|EN)$/.test(type) && !isNaN(off)){
          var data = t.substr(base + off, (!isNaN(len) && len > 0) ? len : undefined);
          if(data) subfiles.push({ type: type, data: data });
        }
      }
    }
    if(!subfiles.length) subfiles.push({ type: 'DL', data: t });
    var found = 0, cardType = '';
    subfiles.forEach(function(sf){
      if(!cardType && (sf.type === 'DL' || sf.type === 'ID')) cardType = sf.type;
      var d = sf.data.replace(/^(DL|ID|EN)/, '');
      d.split(/[\r\n]+/).forEach(function(line){
        var m = /^([A-Z]{3})(.*)$/.exec(line.trim());
        if(m && raw[m[1]] === undefined){ raw[m[1]] = m[2].trim(); found++; }
      });
    });
    if(!found) return null;
    var last = raw.DCS || raw.DAB || '', first = raw.DAC || '', middle = raw.DAD || '';
    if(!first && raw.DCT){ var pt = raw.DCT.split(/[ ,]+/).filter(Boolean); first = pt[0] || ''; if(!middle) middle = pt.slice(1).join(' '); }
    if(!last && raw.DAA){ var pa = raw.DAA.split(/,|\s+/).filter(Boolean); last = pa[0] || ''; if(!first) first = pa[1] || ''; if(!middle) middle = pa.slice(2).join(' '); }
    var canada = /^(CAN|CA)$/i.test(clean(raw.DCG)) || /^6044/.test(iin);
    var f = {
      last: clean(last).toUpperCase(), first: clean(first).toUpperCase(), middle: clean(middle).toUpperCase(),
      id: clean(raw.DAQ).replace(/\s+/g, '').toUpperCase(), state: IIN[iin] || clean(raw.DAJ).toUpperCase(),
      dob: fmtDate(raw.DBB, canada), exp: fmtDate(raw.DBA, canada), issued: fmtDate(raw.DBD, canada),
      sex: fmtSex(raw.DBC), height: fmtHeight(raw.DAU), weight: clean(raw.DAW).replace(/\D/g, ''), eyes: clean(raw.DAY).toUpperCase(), hair: clean(raw.DAZ).toUpperCase(),
      street: clean(raw.DAG).toUpperCase(), street2: clean(raw.DAH).toUpperCase(), city: clean(raw.DAI).toUpperCase(), addressState: clean(raw.DAJ).toUpperCase(),
      zip: clean(raw.DAK).replace(/[^0-9A-Za-z]/g, '').slice(0, 5), country: clean(raw.DCG).toUpperCase(),
      cardType: cardType || 'DL', issuer: iin, aamvaVersion: ver
    };
    if(!f.last && !f.id) return null;
    return f;
  }

  /* ---- VIN ---- */
  function vinValid(v){
    v = (v || '').toUpperCase();
    if(v.length !== 17 || /[IOQ]/.test(v) || /[^A-Z0-9]/.test(v)) return false;
    var map = {A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
    var wt = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2], sum = 0;
    for(var i = 0; i < 17; i++){ var ch = v[i]; sum += (/\d/.test(ch) ? +ch : map[ch]) * wt[i]; }
    var r = sum % 11; return v[8] === (r === 10 ? 'X' : String(r));
  }
  // Pull a VIN out of barcode text: door-jamb labels print it plain, sometimes with an "I" prefix or other data around it.
  function vinFrom(text){
    var s = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if(!s) return null;
    for(var i = 0; i + 17 <= s.length; i++){ var c = s.substr(i, 17); if(vinValid(c)) return { vin: c, valid: true }; }
    if(s.length === 18 && s[0] === 'I') s = s.slice(1);
    if(s.length === 17 && !/[IOQ]/.test(s)) return { vin: s, valid: false };
    return null;
  }
  async function decodeVIN(vin){
    vin = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if(vin.length !== 17) return null;
    var ctl = ('AbortController' in global) ? new AbortController() : null, timer = ctl ? setTimeout(function(){ ctl.abort(); }, 8000) : null;
    try{
      var r = await fetch(VPIC + encodeURIComponent(vin) + '?format=json', ctl ? { signal: ctl.signal } : undefined);
      if(!r.ok) return null;
      var j = await r.json(), v = (j && j.Results && j.Results[0]) || {};
      var out = { year: String(v.ModelYear || '').trim(), make: String(v.Make || '').trim(), model: String(v.Model || '').trim() };
      return (out.year || out.make || out.model) ? out : null;
    }catch(e){ return null; }
    finally{ if(timer) clearTimeout(timer); }
  }

  /* ---- overlay ---- */
  var cssDone = false;
  function injectCss(){
    if(cssDone) return; cssDone = true;
    var st = document.createElement('style');
    st.textContent =
      '.rpdscan{position:fixed;inset:0;z-index:9999;background:#000;color:#fff;font-family:"Barlow","Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;}' +
      '.rpdscan video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}' +
      '.rpdscan .mask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}' +
      '.rpdscan .frame{border:3px solid rgba(255,255,255,.9);border-radius:14px;box-shadow:0 0 0 2000px rgba(0,0,0,.45);transition:border-color .15s;}' +
      '.rpdscan .frame.license{width:min(86vw,560px);aspect-ratio:1.586;}' +
      '.rpdscan .frame.vin{width:min(88vw,600px);aspect-ratio:2.1;}' +
      '.rpdscan .frame.hit{border-color:#5fd38d;}' +
      '.rpdscan .top{position:relative;padding:max(14px,env(safe-area-inset-top)) 18px 10px;background:linear-gradient(180deg,rgba(0,0,0,.65),rgba(0,0,0,0));}' +
      '.rpdscan .top h3{margin:0;font-family:"Barlow Condensed",sans-serif;font-size:22px;letter-spacing:.04em;text-transform:uppercase;color:#f2d28b;}' +
      '.rpdscan .top p{margin:4px 0 0;font-size:15px;line-height:1.35;color:rgba(255,255,255,.9);}' +
      '.rpdscan .bottom{position:relative;margin-top:auto;padding:14px 18px max(18px,env(safe-area-inset-bottom));background:linear-gradient(0deg,rgba(0,0,0,.7),rgba(0,0,0,0));display:grid;gap:10px;}' +
      '.rpdscan .status{font-size:14px;min-height:18px;color:rgba(255,255,255,.85);text-align:center;}' +
      '.rpdscan .row{display:flex;gap:10px;} .rpdscan .row button{flex:1;}' +
      '.rpdscan button{font-family:"Barlow Condensed",sans-serif;font-size:20px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;min-height:54px;padding:10px 14px;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;}' +
      '.rpdscan button.cancel{background:#b8923a;color:#0b1f3a;}' +
      '.rpdscan button.hidden{display:none;}' +
      '.rpdscan input[type=file]{display:none;}';
    document.head.appendChild(st);
  }
  var COPY = {
    license: { title: 'Scan license', hint: 'Hold the BACK of the license flat inside the frame, 6 to 8 inches away. It reads on its own.' },
    vin:     { title: 'Scan VIN',     hint: 'Open the driver door and point at the sticker on the door jamb. The bars or the square code both work. It reads on its own.' }
  };
  function buildOverlay(kind){
    injectCss();
    var root = document.createElement('div'); root.className = 'rpdscan';
    root.innerHTML =
      '<video playsinline autoplay muted></video>' +
      '<div class="mask"><div class="frame ' + kind + '"></div></div>' +
      '<div class="top"><h3>' + COPY[kind].title + '</h3><p>' + COPY[kind].hint + '</p></div>' +
      '<div class="bottom"><div class="status"></div>' +
      '<div class="row"><button type="button" class="torch hidden">Light</button><button type="button" class="photo">Take a photo instead</button></div>' +
      '<button type="button" class="cancel">Cancel</button>' +
      '<input type="file" accept="image/*" capture="environment"></div>';
    document.body.appendChild(root);
    var prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return {
      root: root, video: root.querySelector('video'), frame: root.querySelector('.frame'), status: root.querySelector('.status'),
      torch: root.querySelector('.torch'), photo: root.querySelector('.photo'), cancel: root.querySelector('.cancel'), file: root.querySelector('input[type=file]'),
      close: function(){ document.body.style.overflow = prevOverflow; if(root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  function explain(e){
    var n = e && e.name, msg = (e && e.message) || String(e);
    if(n === 'NotAllowedError' || n === 'SecurityError') return 'Camera access was blocked. Allow the camera for this site in the browser settings, then try again.';
    if(n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
    if(n === 'NotReadableError' || n === 'AbortError') return 'The camera is in use by another app. Close it and try again.';
    return msg;
  }

  function accept(kind, r){
    if(!r || !r.text) return null;
    if(kind === 'license'){ var f = parseAAMVA(r.text); return f ? { ok: true, fields: f, format: r.format } : null; }
    var v = vinFrom(r.text); return v ? { ok: true, vin: v.vin, valid: v.valid, format: r.format } : null;
  }

  async function scan(kind){
    if(!supported()) return { ok: false, reason: 'error', message: 'This browser cannot open the camera here. Use the phone, or type the information.' };
    var ui = buildOverlay(kind), stream = null, done = false, t0 = Date.now();
    var work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
    function finish(res){ done = true; return res; }
    var result = await new Promise(async function(resolve){
      ui.cancel.addEventListener('click', function(){ resolve(finish({ ok: false, reason: 'cancel' })); });
      ui.photo.addEventListener('click', function(){ ui.file.value = ''; ui.file.click(); });
      ui.file.addEventListener('change', async function(){
        var file = ui.file.files && ui.file.files[0]; if(!file) return;
        ui.status.textContent = 'Reading the photo...';
        try{ await loadDecoder(); var got = accept(kind, await readOnce(file, kind)); if(got){ ui.frame.classList.add('hit'); resolve(finish(got)); } else ui.status.textContent = 'No ' + (kind === 'license' ? 'license barcode' : 'VIN barcode') + ' found in that photo. Try again closer, with more light.'; }
        catch(e){ ui.status.textContent = explain(e); }
      });
      var decoder = loadDecoder();
      decoder.catch(function(e){ ui.status.textContent = explain(e); });
      try{
        ui.status.textContent = 'Starting camera...';
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        ui.video.srcObject = stream;
        await ui.video.play();
        var track = stream.getVideoTracks()[0];
        try{ var caps = track.getCapabilities ? track.getCapabilities() : {}; if(caps && caps.torch){ ui.torch.classList.remove('hidden'); var on = false; ui.torch.addEventListener('click', function(){ on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(function(){}); ui.torch.textContent = on ? 'Light off' : 'Light'; }); } }catch(e){}
        try{ if(track.getCapabilities && (track.getCapabilities().focusMode || []).indexOf('continuous') >= 0) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); }catch(e){}
        await decoder;
        var s = track.getSettings ? track.getSettings() : {};
        log('Camera ' + (s.width || '?') + 'x' + (s.height || '?') + ', reader loaded in ' + (Date.now() - t0) + ' ms.');
        ui.status.textContent = 'Looking for the barcode...';
        var tries = 0, lastErr = '';
        while(!done){
          var vw = ui.video.videoWidth, vh = ui.video.videoHeight;
          if(vw && vh){
            // Decode the whole camera frame, not just the on-screen guide: a portrait phone shows only the middle of a
            // landscape frame, so the guide is a suggestion and anything the camera sees counts.
            var k = Math.min(1, 1600 / Math.max(vw, vh));
            work.width = Math.round(vw * k); work.height = Math.round(vh * k);
            wctx.drawImage(ui.video, 0, 0, vw, vh, 0, 0, work.width, work.height);
            try{
              var got = accept(kind, await readOnce(wctx.getImageData(0, 0, work.width, work.height), kind));
              tries++;
              if(got){ ui.frame.classList.add('hit'); got.ms = Date.now() - t0; got.tries = tries; log((kind === 'license' ? 'License' : 'VIN') + ' read after ' + tries + ' frames, ' + got.ms + ' ms.'); resolve(finish(got)); break; }
              if(tries % 12 === 0) ui.status.textContent = 'Still looking. Move closer, hold still, add light, or take a photo instead.';
            }catch(e){ lastErr = explain(e); ui.status.textContent = lastErr; }
          }
          await new Promise(function(r){ setTimeout(r, 70); });
        }
      }catch(e){
        if(!done){ log('Camera error: ' + explain(e)); ui.status.textContent = explain(e) + ' You can still take a photo.'; }
      }
    });
    try{ if(stream) stream.getTracks().forEach(function(tr){ tr.stop(); }); }catch(e){}
    try{ ui.video.srcObject = null; }catch(e){}
    ui.close();
    return result;
  }

  global.RPDScan = {
    supported: supported, scanLicense: function(){ return scan('license'); }, scanVIN: function(){ return scan('vin'); },
    decodeVIN: decodeVIN, parseAAMVA: parseAAMVA, vinValid: vinValid, vinFrom: vinFrom, explain: explain, loadDecoder: loadDecoder,
    set log(fn){ log = (typeof fn === 'function') ? fn : function(){}; }
  };
})(window);
