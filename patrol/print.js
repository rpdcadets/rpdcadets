/* patrol/print.js | Build v1 | 2026-09-22
   Shared print engine for the in-car Zebra ZQ520 (4 inch, 203 dpi, line-print mode).
   Path: Chrome Web Serial over the printer's paired Bluetooth (Serial Port Profile). No driver, no install.
   Language: CPCL. Slips are drawn on a canvas in the browser and sent as a 1-bit bitmap (EG command),
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
    log('Pick the printer from the list. Its name matches the serial number on the printer.');
    return await navigator.serial.requestPort();
  }

  async function openPort(port){
    try{ await port.open({ baudRate:115200, bufferSize:65536 }); }
    catch(e){
      if(e && e.name === 'InvalidStateError'){ try{ await port.close(); }catch(x){} await port.open({ baudRate:115200, bufferSize:65536 }); }
      else throw e;
    }
  }

  async function writeAll(port, bytes){
    var writer = port.writable.getWriter(), CH = 8192;
    try{
      for(var i = 0; i < bytes.length; i += CH){ await writer.write(bytes.subarray(i, i + CH)); }
    } finally { writer.releaseLock(); }
  }

  async function readFor(port, ms){
    var out = '', reader = port.readable.getReader(), done = false;
    var timer = setTimeout(function(){ done = true; reader.cancel().catch(function(){}); }, ms);
    try{ while(!done){ var r = await reader.read(); if(r.value) out += new TextDecoder().decode(r.value); if(r.done) break; } }
    catch(e){} finally{ clearTimeout(timer); try{ reader.releaseLock(); }catch(e){} }
    return out;
  }

  async function sendBytes(bytes){
    var port = await getPort();
    await openPort(port);
    try{
      await writeAll(port, bytes);
      log('Sent ' + Math.round(bytes.length / 1024) + ' KB to the printer.');
      await sleep(Math.min(3000, 400 + bytes.length / 40));   // let the Bluetooth link drain before closing
    } finally { try{ await port.close(); }catch(e){} }
  }

  function sendText(s){ return sendBytes(enc(s)); }

  // Convert a canvas (any width; scaled to DOTS_WIDE if needed) into a CPCL label with one EG bitmap.
  function canvasToCPCL(canvas, copies){
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
    var q = Math.max(1, Math.min(9, copies | 0 || 1));
    return '! 0 200 200 ' + h + ' ' + q + '\r\n' +
           'EG ' + bytesPerRow + ' ' + h + ' 0 0 ' + out.join('') + '\r\n' +
           'PRINT\r\n';
  }

  function printCanvas(canvas, copies){ return sendText(canvasToCPCL(canvas, copies)); }

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
    sendText: sendText, info: info, forget: forget, explain: explain,
    set log(fn){ log = (typeof fn === 'function') ? fn : function(){}; }
  };
})(window);
