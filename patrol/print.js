/* patrol/print.js | Build v3 | 2026-10-04 | Auto language: asks the printer device.languages on each job and sends the bitmap as ZPL (^GFA) when the printer is in a zpl mode, else CPCL (EG). Field finding: the 10/2026 e-citation rollout set printers to hybrid_xml_zpl; the September units were line_print. v2: Drain before close: after a job, send a status query and wait (up to 30 s) for the printer's reply so the Windows COM buffer empties before the port closes (fixes silent drops of large jobs on the 'Serial Printer (COMx)' path after the 10/2026 MDC update). Open retried 3 times. v1: 2026-09-22
   Shared print engine for the in-car Zebra ZQ520 (4 inch, 203 dpi, line-print mode).
   Path: Chrome Web Serial over the printer's paired Bluetooth (Serial Port Profile). No driver, no install.
   Language: CPCL or ZPL, chosen per printer. Slips are drawn on a canvas in the browser and sent as a 1-bit bitmap (EG command),
   so any font, logo, or layout prints exactly as drawn. Nothing is written to the printer's settings.
   Usage:
     RPDPrint.supported()                 -> true if this browser can print directly
     RPDPrint.printCanvas(canvas, copies) -> sends the canvas as one CPCL label, copies times
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
    log('Pick the entry labeled Serial Printer (COMx). Do not pick the one showing only the printer serial number.');
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

  var langCache = null;
  async function queryLanguage(port){
    try{
      await writeAll(port, enc('\r\n! U1 getvar "device.languages"\r\n'));
      var ans = (await readFor(port, 1500)).replace(/["\s]/g, '').toLowerCase();
      if(ans) langCache = ans;
    }catch(e){}
    return langCache || '';
  }
  function wantsZPL(lang){ return /zpl/.test(lang) && !/line_print|cpcl/.test(lang); }

  // Open once: ask the printer its language, send the bitmap in that language, drain, close.
  async function printCanvas(canvas, copies){
    var rows = canvasToRows(canvas);
    var port = await getPort();
    await openPort(port);
    try{
      var lang = await queryLanguage(port);
      var zpl = wantsZPL(lang);
      log('Printer language: ' + (lang || 'unknown') + ' -> sending ' + (zpl ? 'ZPL' : 'CPCL') + '.');
      var bytes = enc(zpl ? rowsToZPL(rows, copies) : rowsToCPCL(rows, copies));
      await writeAll(port, bytes);
      log('Sent ' + Math.round(bytes.length / 1024) + ' KB to the printer. Waiting for it to finish...');
      await drain(port, bytes.length);
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
    sendText: sendText, info: info, forget: forget, explain: explain, queryLanguage: queryLanguage,
    set log(fn){ log = (typeof fn === 'function') ? fn : function(){}; }
  };
})(window);
