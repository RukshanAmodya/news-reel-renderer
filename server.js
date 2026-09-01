const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN || 'upId6SmxAji4Y1iwbpDi7IFjwuptENibN5wwRlaWMhObgn2C';
const BROWSERLESS_URL = process.env.BROWSERLESS_URL || ('https://browserless-production-e0a9.up.railway.app/function?token=' + BROWSERLESS_TOKEN + '&timeout=180000');
const DEFAULT_AUDIO_URL = process.env.AUDIO_URL || 'https://files.catbox.moe/rb1u7s.mp3';
const DEFAULT_SLOGAN = "Dernière Heure • L'actualité en temps réel";

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'News Reel Renderer', version: '3.1.0 (3:4 portrait + Base64 AI Image support)', time: new Date().toISOString() });
});

app.post('/render-reel', async (req, expressResponse) => {
  const {
    title,
    imageUrl,
    audioUrl = DEFAULT_AUDIO_URL,
    badgeText = 'FLASH INFO',
    subtitleText = DEFAULT_SLOGAN
  } = req.body;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return expressResponse.status(400).json({ error: 'Valid title is required' });
  }
  if (!imageUrl || typeof imageUrl !== 'string' || (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:image'))) {
    return expressResponse.status(400).json({ error: 'Valid imageUrl (http or data:image) is required' });
  }

  const cleanTitle = title.trim();
  const cleanBadge = (badgeText || 'FLASH INFO').trim().toUpperCase();
  const cleanSubtitle = (subtitleText || DEFAULT_SLOGAN).trim();

  const requestId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const tempImgPath = path.join('/tmp', 'img_' + requestId + '.png');
  const tempAudPath = path.join('/tmp', 'aud_' + requestId + '.mp3');
  const outVideoPath = path.join('/tmp', 'out_' + requestId + '.mp4');

  try {
    let imageDataUrl = '';
    if (imageUrl.startsWith('data:image')) {
      console.log('[' + requestId + '] 1. Using provided Base64 Data URL Image...');
      imageDataUrl = imageUrl;
    } else {
      console.log('[' + requestId + '] 1. Downloading image from ' + imageUrl + '...');
      const imgRes = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (!imgRes.ok) throw new Error('Image fetch failed with status ' + imgRes.status);
      const imgArr = await imgRes.arrayBuffer();
      imageDataUrl = 'data:image/jpeg;base64,' + Buffer.from(imgArr).toString('base64');
    }

    console.log('[' + requestId + '] 2. Rendering 3:4 (1080x1440) Template D in Browserless...');
    const code = `export default async ({ page, context }) => {
      const { title, imageDataUrl, badgeText, subtitleText } = context;

      await page.setContent('<div style="position:relative; width:1080px; height:1440px;"><canvas id="c" width="1080" height="1440" style="background:#070d1e; width:1080px; height:1440px;"></canvas></div>');

      await page.evaluate(async () => {
        const link = document.createElement('link');
        link.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&display=swap';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
        await document.fonts.ready;
      });

      await page.evaluate(async (title, imageDataUrl, badgeText, subtitleText) => {
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        const W = 1080, H = 1440;

        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imageDataUrl;
          if (img.complete) resolve();
        });

        const HEAVY = "Inter, system-ui, -apple-system, sans-serif";

        function cover(ctx, img, x, y, w, h, zoom, ox, oy){
          const s = Math.max(w/img.width, h/img.height) * zoom;
          const dw = img.width*s, dh = img.height*s;
          const dx = x + (w-dw)/2 + ox*(dw-w)/2;
          const dy = y + (h-dh)/2 + oy*(dh-h)/2;
          ctx.drawImage(img, dx, dy, dw, dh);
        }
        function tokenize(text, hi){
          const words = (text||'').trim().split(/\\s+/).filter(Boolean);
          const out = words.map(w=>({w, hi:false}));
          const H = (hi||'').trim();
          if(!H) return out;
          const norm = s => s.toUpperCase().replace(/[^\\p{L}\\p{N}]/gu,'');
          const hw = H.split(/\\s+/).map(norm).filter(Boolean);
          if(!hw.length) return out;
          const nw = words.map(norm);
          outer: for(let i=0;i<=nw.length-hw.length;i++){
            for(let j=0;j<hw.length;j++) if(nw[i+j]!==hw[j]) continue outer;
            for(let j=0;j<hw.length;j++) out[i+j].hi = true;
            break;
          }
          return out;
        }
        function wrap(ctx, tokens, maxW){
          const sp = ctx.measureText(' ').width;
          const lines = []; let line = [], lw = 0;
          for(const t of tokens){
            const w = ctx.measureText(t.w).width;
            if(w > maxW) return null;
            if(line.length && lw + sp + w > maxW){ lines.push({toks:line, w:lw}); line=[t]; lw=w; }
            else { lw += (line.length? sp:0) + w; line.push(t); }
          }
          if(line.length) lines.push({toks:line, w:lw});
          return lines;
        }
        function setFace(ctx, face, size){
          const f = face || {family:'Anton', weight:''};
          ctx.font = (f.weight ? f.weight + ' ' : '') + size + 'px ' + f.family;
        }
        function fit(ctx, tokens, maxW, maxH, maxSize, lh, tracking, face){
          let size = Math.floor(maxSize);
          while(size > 10){
            ctx.letterSpacing = tracking;
            setFace(ctx, face, size);
            const lines = wrap(ctx, tokens, maxW);
            if(lines && lines.length*size*lh <= maxH) return {size, lines, lh, face};
            size = Math.floor(size*0.96);
          }
          setFace(ctx, face, size);
          return {size, lines: wrap(ctx, tokens, maxW) || [{toks:tokens, w:maxW}], lh, face};
        }
        function drawLines(ctx, L, x, y, align, base, accent){
          ctx.textBaseline = 'top';
          setFace(ctx, L.face, L.size);
          const sp = ctx.measureText(' ').width;
          L.lines.forEach((ln, i)=>{
            let cx = align==='center' ? x - ln.w/2 : x;
            const cy = y + i*L.size*L.lh;
            ln.toks.forEach((t, k)=>{
              ctx.fillStyle = t.hi ? accent : base;
              ctx.fillText(t.w, cx, cy);
              cx += ctx.measureText(t.w).width + (k<ln.toks.length-1 ? sp : 0);
            });
          });
          ctx.textBaseline = 'alphabetic';
        }
        function calendarIcon(ctx, x, y, s, color){
          ctx.save(); ctx.translate(x, y); ctx.scale(s/100, s/100);
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.roundRect(8, 18, 84, 74, 10); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0)';
          ctx.beginPath(); ctx.roundRect(4, 2, 14, 26, 6); ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.roundRect(22, 0, 14, 28, 6); ctx.fill();
          ctx.beginPath(); ctx.roundRect(64, 0, 14, 28, 6); ctx.fill();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillRect(18, 38, 64, 8);
          [0,1,2].forEach(r => [0,1,2].forEach(c => ctx.fillRect(22 + c*22, 54 + r*13, 12, 8)));
          ctx.globalCompositeOperation = 'source-over';
          ctx.restore();
        }

        // 1. Draw 16:9 Image at top portion (w:1080, h:777) with natural framing
        const photoH = H * 0.54;
        cover(ctx, img, 0, 0, W, photoH, 1.0, 0, 0);

        // 2. Seamless dark gradient fade into #070d1e
        const g = ctx.createLinearGradient(0, photoH * 0.40, 0, H * 0.65);
        g.addColorStop(0, 'rgba(7,13,30,0)');
        g.addColorStop(0.55, 'rgba(7,13,30,0.88)');
        g.addColorStop(1, 'rgba(7,13,30,1.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, photoH * 0.40, W, H - photoH * 0.40);

        const padX = W * 0.055;
        const bottom = H - H * 0.045;
        let y = bottom;

        // 3. Footer / Slogan with gold wings
        const sub = (subtitleText || "Dernière Heure • L'actualité en temps réel").trim();
        if(sub){
          const sf = Math.round(W * 0.031);
          ctx.letterSpacing = '0.01em';
          setFace(ctx, {family:HEAVY, weight:'500'}, sf);
          ctx.fillStyle = '#e6ecf5'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
          ctx.fillText(sub, W/2, y);
          const sw = ctx.measureText(sub).width;
          ctx.strokeStyle = '#c9a227'; ctx.lineWidth = Math.max(1, W * 0.0018);
          const startX1 = W/2 - sw/2 - W * 0.10;
          const endX1 = W/2 - sw/2 - W * 0.03;
          const startX2 = W/2 + sw/2 + W * 0.03;
          const endX2 = W/2 + sw/2 + W * 0.10;
          ctx.beginPath(); ctx.moveTo(startX1, y - sf*0.32); ctx.lineTo(endX1, y - sf*0.32); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(startX2, y - sf*0.32); ctx.lineTo(endX2, y - sf*0.32); ctx.stroke();
          ctx.textAlign = 'left';
          y -= sf * 2.2;
        }

        // 4. Gold rule with French tricolor
        const rw = W - padX * 2, rh = Math.max(2, H * 0.0042);
        ctx.fillStyle = '#c9a227'; ctx.fillRect(padX, y - rh, rw, rh);
        const cw = rw * 0.42, cx0 = W/2 - cw/2;
        const colors = ['#2b4fa8','#ffffff','#d0342c'];
        for(let i=0; i<3; i++){ ctx.fillStyle = colors[i]; ctx.fillRect(cx0 + cw/3*i, y - rh, cw/3, rh); }
        y -= H * 0.042;

        // 5. Dynamic Headline (sentence case / bold)
        const tokens = tokenize(title, '');
        const L = fit(ctx, tokens, W - padX * 2, H * 0.32, W * 0.080, 1.08, '-0.02em', {family:HEAVY, weight:'800'});
        y -= L.lines.length * L.size * L.lh;
        drawLines(ctx, L, padX, y, 'left', '#ffffff', '#f0b429');

        // 6. Dynamic Category Badge
        const bs = Math.round(W * 0.030);
        const label = (badgeText || "FLASH INFO").trim().toUpperCase();
        if(label){
          const bh = bs * 1.68;
          const by = y - H*0.028 - bh;
          ctx.letterSpacing = '0.06em';
          setFace(ctx, {family:HEAVY, weight:'700'}, bs);
          const tw = ctx.measureText(label).width;
          const icon = bs * 1.15, gap = bs * 0.62, ph = bs * 0.85;
          const bw = ph + icon + gap + tw + ph;
          ctx.fillStyle = '#123f70';
          ctx.beginPath(); ctx.roundRect(padX, by, bw, bh, bh * 0.28); ctx.fill();
          calendarIcon(ctx, padX + ph, by + (bh - icon)/2, icon, '#ffffff');
          ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
          ctx.fillText(label, padX + ph + icon + gap, by + bh/2 + bs * 0.04);
          ctx.textBaseline = 'alphabetic';
        }
      }, cleanTitle, imageDataUrl, cleanBadge, cleanSubtitle);

      const canvasEl = await page.$('#c');
      const screenshot = await canvasEl.screenshot({ type: 'png' });
      return { pngBase64: screenshot.toString('base64') };
    };`;

    const res = await fetch(BROWSERLESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        context: {
          title: cleanTitle,
          imageDataUrl,
          badgeText: cleanBadge,
          subtitleText: cleanSubtitle
        }
      })
    });

    const data = await res.json();
    let imgBuffer;
    if (data.pngBase64) {
      if (typeof data.pngBase64 === 'string' && data.pngBase64.includes(',')) {
        imgBuffer = Buffer.from(data.pngBase64.split(',').map(Number));
      } else {
        imgBuffer = Buffer.from(data.pngBase64, 'base64');
      }
    } else {
      throw new Error('Failed to render template from Browserless: ' + JSON.stringify(data));
    }
    fs.writeFileSync(tempImgPath, imgBuffer);

    console.log('[' + requestId + '] 3. Downloading audio from ' + audioUrl + '...');
    const audRes = await fetch(audioUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!audRes.ok) throw new Error('Audio download failed with status ' + audRes.status);
    const audArr = await audRes.arrayBuffer();
    fs.writeFileSync(tempAudPath, Buffer.from(audArr));

    console.log('[' + requestId + '] 4. Encoding 3:4 (1080x1440) MP4 video with FFmpeg...');
    const ffmpegCmd = 'ffmpeg -y -loop 1 -framerate 30 -i "' + tempImgPath + '" -i "' + tempAudPath + '" -c:v libx264 -preset ultrafast -tune stillimage -threads 2 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "' + outVideoPath + '"';
    execSync(ffmpegCmd, { stdio: 'pipe' });

    console.log('[' + requestId + '] 5. Sending video response...');
    const videoData = fs.readFileSync(outVideoPath);
    expressResponse.setHeader('Content-Type', 'video/mp4');
    expressResponse.setHeader('Content-Disposition', 'attachment; filename="reel.mp4"');
    expressResponse.send(videoData);
  } catch (err) {
    console.error('[' + requestId + '] Error:', err);
    expressResponse.status(500).json({ error: err.message });
  } finally {
    try { if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath); } catch(e){}
    try { if (fs.existsSync(tempAudPath)) fs.unlinkSync(tempAudPath); } catch(e){}
    try { if (fs.existsSync(outVideoPath)) fs.unlinkSync(outVideoPath); } catch(e){}
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 News Reel Renderer Service running on port ' + PORT);
});
if (PORT != 3000) {
  try { app.listen(3000, '0.0.0.0'); } catch(e){}
}
if (PORT != 8080) {
  try { app.listen(8080, '0.0.0.0'); } catch(e){}
}
