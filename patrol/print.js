/* patrol/print.js | Build v8 | 2026-10-05 | Two pieces instead of many strips: the first piece ends at the first blank row after the logo (so the seam is in white space and nothing smears), the rest goes as one job. Progress is still confirmed by the printer. v7: Real progress: the slip is sent as horizontal strips (about 1 inch each), each followed by a status query the printer can only answer once that strip is in; printCanvas(canvas, copies, onProgress) reports the true fraction received. Printer starts printing strip 1 while later strips arrive. v6: Speed: no language query (CPCL prints fine in hybrid_xml_zpl mode); slip sent as a run-length-compressed 1-bit PCX inside CPCL (about a tenth of the raw hex size). Compatibility mode (raw EG hex) via RPDPrint.setMode("eg"), remembered per computer. v5: Language query made patient: settle 800 ms after open, flush, ask with a 4 s window, retry once, and remember the answer per computer (localStorage rpd_printer_lang) so later prints do not depend on a reply. Raw reply logged. v4: Picker hint wording. v3: Auto language: asks the printer device.languages on each job and sends the bitmap as ZPL (^GFA) when the printer is in a zpl mode, else CPCL (EG). Field finding: the 10/2026 e-citation rollout set printers to hybrid_xml_zpl; the September units were line_print. v2: Drain before close: after a job, send a status query and wait (up to 30 s) for the printer's reply so the Windows COM buffer empties before the port closes (fixes silent drops of large jobs on the 'Serial Printer (COMx)' path after the 10/2026 MDC update). Open retried 3 times. v1: 2026-09-22
   Shared print engine for the in-car Zebra ZQ520 (4 inch, 203 dpi, line-print mode).
   Path: Chrome Web Serial over the printer's paired Bluetooth (Serial Port Profile). No driver, no install.
   Language: CPCL or ZPL, chosen per printer. Slips are drawn on a canvas in the browser and sent as a 1-bit bitmap (EG command),
   so any font, logo, or layout prints exactly as drawn. Nothing is written to the printer's settings.
   Usage:
     RPDPrint.supported()                 -> true if this browser can print directly
     RPDPrint.printCanvas(canvas, copies, onProgress) -> sends the canvas in strips; onProgress(fraction, done, total) is real
     RPDPrint.sendText(cpclString)        -> sends a raw CPCL / line-mode string
     RPDPrint.info()                      -> read-only settings query, returns array of strings
     RPDPrint.forget()                    -> forget the remembered printer so the next print asks again
     RPDPrint.log = function(msg){}       -> optional hook for status messages
*/
(function(global){
  'use strict';
  var DOTS_WIDE = 832;
  var log = function(){};
  function enc(s){ return new TextEncoder().encode(s); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  function supported(){ return ('serial' in navigator); }

  async function getPort(){
    if(!supported()) throw new Error('This browser cannot print directly. Use Chrome or Edge on the squad computer.');
    var ports = await navigator.serial.getPorts();
    if(ports.length){ log('Using remembered printer.'); return ports[0]; }
    log('Pick the entry that says Serial Printer followed by a COM number, for example Serial Printer (COM8). Do not pick the one showing only the printer serial number.');
    return await navigator.serial.requestPort();
  }

  async function openPort(port){
    var last;
    for(var i = 0; i < 3; i++){
      try{ await port.open({ baudRate:115200, bufferSize:65536 }); return; }
      catch(e){
        last = e;
        if(e && e.name === 'InvalidStateError'){ try{ await port.close(); }catch(x){} }
        if(i < 2){ log('Printer busy or waking up, retrying...'); await sleep(1500); }
      }
    }
    throw last;
  }

  async function writeAll(port, bytes){
    var writer = port.writable.getWriter(), CH = 8192;
    try{
      for(var i = 0; i < bytes.length; i += CH){ await writer.write(bytes.subarray(i, i + CH)); }
    } finally { writer.releaseLock(); }
  }

  // stopOnFirst: resolve as soon as any bytes arrive (used to detect that the link has drained)
  async function readFor(port, ms, stopOnFirst){
    var out = '', reader = port.readable.getReader(), done = false;
    var timer = setTimeout(function(){ done = true; reader.cancel().catch(function(){}); }, ms);
    try{
      while(!done){
        var r = await reader.read();
        if(r.value){ out += new TextDecoder().decode(r.value); if(stopOnFirst){ done = true; clearTimeout(timer); timer = setTimeout(function(){ reader.cancel().catch(function(){}); }, 250); } }
        if(r.done) break;
      }
    }
    catch(e){} finally{ clearTimeout(timer); try{ reader.releaseLock(); }catch(e){} }
    return out;
  }

  // Windows discards whatever is still queued in a COM port when it is closed, and Bluetooth drains
  // slowly, so after the job we send a status query and wait for the reply: it cannot arrive until the
  // whole job has gone through. If no reply comes, we still wait a size-based minimum.
  async function drain(port, bytes){
    var minWait = 1500 + bytes / 6, maxWait = Math.max(30000, minWait + 5000), t0 = Date.now();
    try{ await writeAll(port, enc('\r\n! U1 getvar "device.unique_id"\r\n')); }catch(e){}
    var got = await readFor(port, maxWait, true);
    var elapsed = Date.now() - t0;
    if(got){ log('Printer confirmed it received the job (' + (elapsed / 1000).toFixed(1) + ' s).'); }
    else{ log('No reply from printer; waited ' + (elapsed / 1000).toFixed(1) + ' s for the link to drain.'); }
    if(elapsed < minWait) await sleep(minWait - elapsed);
    await sleep(400);
  }

  async function sendBytes(bytes){
    var port = await getPort();
    await openPort(port);
    try{
      await writeAll(port, bytes);
      log('Sent ' + Math.round(bytes.length / 1024) + ' KB to the printer. Waiting for it to finish...');
      await drain(port, bytes.length);
    } finally { try{ await port.close(); }catch(e){} }
  }

  function sendText(s){ return sendBytes(enc(s)); }

  // Convert a canvas (any width; scaled to DOTS_WIDE if needed) into packed 1-bit rows as hex.
  function canvasToRows(canvas){
    var w = DOTS_WIDE, h = Math.round(canvas.height * w / canvas.width);
    var c = canvas;
    if(canvas.width !== w){
      c = document.createElement('canvas'); c.width = w; c.height = h;
      var cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
      cx.imageSmoothingEnabled = true; cx.drawImage(canvas, 0, 0, w, h);
    }
    var data = c.getContext('2d').getImageData(0, 0, w, h).data;
    var bytesPerRow = w / 8, hex = '0123456789ABCDEF', out = new Array(h);
    for(var y = 0; y < h; y++){
      var row = '';
      for(var bx = 0; bx < bytesPerRow; bx++){
        var b = 0;
        for(var bit = 0; bit < 8; bit++){
          var i = ((y * w) + bx * 8 + bit) * 4;
          var lum = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) / 1000;
          var a = data[i+3];
          if(a > 127 && lum < 160) b |= (0x80 >> bit);   // dark pixel = 1 = black
        }
        row += hex[b >> 4] + hex[b & 15];
      }
      out[y] = row;
    }
    return { hex: out.join(''), h: h, bytesPerRow: bytesPerRow };
  }
  function rowsToCPCL(r, copies){
    var q = Math.max(1, Math.min(9, copies | 0 || 1));
    return '! 0 200 200 ' + r.h + ' ' + q + '\r\nEG ' + r.bytesPerRow + ' ' + r.h + ' 0 0 ' + r.hex + '\r\nPRINT\r\n';
  }
  function rowsToZPL(r, copies){
    var q = Math.max(1, Math.min(9, copies | 0 || 1)), total = r.bytesPerRow * r.h;
    return '^XA^MNN^PW' + DOTS_WIDE + '^LL' + (r.h + 8) + '^LH0,0^FO0,0^GFA,' + total + ',' + total + ',' + r.bytesPerRow + ',' + r.hex + '^FS^PQ' + q + '^XZ\r\n';
  }
  function canvasToCPCL(canvas, copies){ return rowsToCPCL(canvasToRows(canvas), copies); }

  // ---- image encoders ----
  // Raw 1-bit rows -> PCX (version 5, 1 bpp, RLE). In PCX, bit 1 = palette index 1 = white, so rows are inverted.
  function rowsToPCX(canvasRows){
    var w = DOTS_WIDE, h = canvasRows.h, bpl = canvasRows.bytesPerRow, hex = canvasRows.hex;
    var out = [], hdr = new Uint8Array(128);
    function le16(o, v){ hdr[o] = v & 255; hdr[o+1] = (v >> 8) & 255; }
    hdr[0] = 0x0A; hdr[1] = 5; hdr[2] = 1; hdr[3] = 1;
    le16(4, 0); le16(6, 0); le16(8, w - 1); le16(10, h - 1); le16(12, 203); le16(14, 203);
    hdr[16] = 0; hdr[17] = 0; hdr[18] = 0; hdr[19] = 255; hdr[20] = 255; hdr[21] = 255;   // palette: 0 black, 1 white
    hdr[65] = 1; le16(66, bpl); le16(68, 1); le16(70, w); le16(72, h);
    out.push(hdr);
    var body = [], run = 0, prev = -1;
    function flush(){ if(run === 0) return; if(run > 1 || (prev & 0xC0) === 0xC0) body.push(0xC0 | run); body.push(prev); run = 0; }
    for(var y = 0; y < h; y++){
      run = 0; prev = -1;
      for(var i = 0; i < bpl; i++){
        var b = (~parseInt(hex.substr((y * bpl + i) * 2, 2), 16)) & 255;
        if(b === prev && run < 63) run++; else { flush(); prev = b; run = 1; }
      }
      flush();
    }
    out.push(Uint8Array.from(body));
    return out;
  }
  function concat(parts){
    var n = 0; parts.forEach(function(p){ n += p.length; });
    var r = new Uint8Array(n), o = 0; parts.forEach(function(p){ r.set(p, o); o += p.length; }); return r;
  }
  var mode = 'pcx';
  try{ mode = localStorage.getItem('rpd_print_mode') === 'eg' ? 'eg' : 'pcx'; }catch(e){}
  function setMode(m){ mode = (m === 'eg') ? 'eg' : 'pcx'; try{ localStorage.setItem('rpd_print_mode', mode); }catch(e){} }
  function getMode(){ return mode; }

  function sliceRows(rows, y0, y1){
    return { hex: rows.hex.substr(y0 * rows.bytesPerRow * 2, (y1 - y0) * rows.bytesPerRow * 2), h: y1 - y0, bytesPerRow: rows.bytesPerRow };
  }
  function buildJob(rows){
    if(mode === 'eg') return enc(rowsToCPCL(rows, 1));
    var pcx = rowsToPCX(rows);
    return concat([enc('! 0 200 200 ' + rows.h + ' 1\r\nPCX 0 0\r\n')].concat(pcx).concat([enc('\r\nPRINT\r\n')]));
  }
  // Wait until the printer has consumed everything sent so far: a status query is answered only
  // after the bytes ahead of it have been read. Returns true if the printer answered.
  async function ack(port, maxMs){
    try{ await writeAll(port, enc('\r\n! U1 getvar "device.unique_id"\r\n')); }catch(e){ return false; }
    var got = await readFor(port, maxMs, true);
    return !!got;
  }

  // Split point: first fully blank row after the logo area (search 80..420 rows, prefer near 1 inch).
  function splitRow(rows){
    var bpr = rows.bytesPerRow, blankRow = new Array(bpr * 2 + 1).join('0');
    function blank(y){ return rows.hex.substr(y * bpr * 2, bpr * 2) === blankRow; }
    var best = -1, bestD = 1e9;
    for(var y = 80; y < Math.min(rows.h - 40, 420); y += 8){
      if(blank(y) && blank(y + 1)){ var d = Math.abs(y - 208); if(d < bestD){ best = y; bestD = d; } }
    }
    return best > 0 ? best : Math.min(208, rows.h);
  }
  async function printCanvas(canvas, copies, onProgress){
    var rows = canvasToRows(canvas), q = Math.max(1, Math.min(9, copies | 0 || 1));
    var strips = [], cut = splitRow(rows);
    if(rows.h > cut + 16){ strips.push(sliceRows(rows, 0, cut)); strips.push(sliceRows(rows, cut, rows.h)); }
    else strips.push(rows);
    var total = strips.length * q, done = 0, sentBytes = 0, t0 = Date.now(), silent = 0;
    function report(){ if(typeof onProgress === 'function'){ try{ onProgress(done / total, done, total); }catch(e){} } }
    var port = await getPort();
    await openPort(port);
    try{
      report();
      for(var c = 0; c < q; c++){
        for(var i = 0; i < strips.length; i++){
          var bytes = buildJob(strips[i]);
          await writeAll(port, bytes); sentBytes += bytes.length;
          if(await ack(port, 20000)) silent = 0; else silent++;
          done++; report();
        }
      }
      var secs = ((Date.now() - t0) / 1000).toFixed(1);
      if(silent) log('Sent ' + Math.round(sentBytes / 1024) + ' KB in ' + total + ' strips; printer did not confirm the last ' + silent + '. Waited ' + secs + ' s.');
      else log('Printer received all ' + total + ' strips (' + Math.round(sentBytes / 1024) + ' KB, ' + (mode === 'eg' ? 'compatibility' : 'compressed') + ') in ' + secs + ' s.');
      await sleep(300);
    } finally { try{ await port.close(); }catch(e){} }
  }

  async function info(){
    var keys = ['device.languages', 'ezpl.print_width', 'ezpl.media_type', 'appl.name', 'device.friendly_name'];
    var port = await getPort(), replies = [];
    await openPort(port);
    try{
      for(var i = 0; i < keys.length; i++){
        await writeAll(port, enc('! U1 getvar "' + keys[i] + '"\r\n'));
        var ans = await readFor(port, 1200);
        replies.push(keys[i] + ' = ' + (ans.trim() || '(no reply)'));
      }
    } finally { try{ await port.close(); }catch(e){} }
    return replies;
  }

  async function forget(){
    if(!supported()) return;
    var ports = await navigator.serial.getPorts();
    for(var i = 0; i < ports.length; i++){ if(ports[i].forget) await ports[i].forget(); }
  }

  function explain(e){
    var n = e && e.name, msg = (e && e.message) || String(e);
    if(n === 'NotFoundError') return 'No printer was picked. If the list was empty, turn the printer on and make sure it is paired in Windows Bluetooth settings.';
    if(n === 'SecurityError') return 'Chrome blocked direct printing on this computer (browser policy).';
    if(n === 'NetworkError') return 'Could not open the printer. Make sure it is on, in range, and not being used by another program.';
    return msg;
  }

  global.RPDPrint = {
    DOTS_WIDE: DOTS_WIDE,
    supported: supported, printCanvas: printCanvas, canvasToCPCL: canvasToCPCL,
    sendText: sendText, info: info, forget: forget, explain: explain, setMode: setMode, getMode: getMode,
    set log(fn){ log = (typeof fn === 'function') ? fn : function(){}; }
  };
})(window);
