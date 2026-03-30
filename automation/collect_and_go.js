const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG = {
  siteUrl: 'https://www.collectandgo.be',
  cookiePath: path.join(__dirname, 'cookies.json'),
  statePath: path.join(__dirname, 'state.json'),
  itemsPath: path.join(__dirname, 'shopping_list.json'),
  telegramToken: process.env.TELEGRAM_ENOBASE_TOKEN,
  telegramChatId: process.env.TELEGRAM_KARLIEN_CHAT_ID || '8706736945'
};

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function sendTelegram(message) {
  if (!CONFIG.telegramToken) {
    console.log('[TELEGRAM] Token not set, skipping notification');
    return Promise.resolve();
  }
  const payload = JSON.stringify({
    chat_id: CONFIG.telegramChatId,
    text: message
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) resolve(console.log('[TELEGRAM] Sent:', message));
          else reject(new Error(`Telegram failed: ${res.statusCode} ${data}`));
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function waitAndClick(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
}

async function waitAndType(page, selector, text, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text);
}

async function collectAndGo() {
  console.log('[START] Collect&Go automation');
  
  const items = loadJson(CONFIG.itemsPath);
  if (!items || !items.length) {
    throw new Error('No items found in shopping_list.json');
  }
  console.log('[ITEMS]', items.map(i => i.name).join(', '));

  const state = loadJson(CONFIG.statePath) || { needsLogin: true, step: 'init' };
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Load cookies if available
  const cookies = loadJson(CONFIG.cookiePath);
  if (cookies) {
    await page.setCookie(...cookies);
    console.log('[COOKIES] Loaded session');
  }

  try {
    // Navigate to homepage
    console.log('[NAV] Going to Collect&Go');
    await page.goto(CONFIG.siteUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Check if logged in
    const loginBtn = await page.$('a[href*="login"], button:has-text("Inloggen"), a:has-text("Aanmelden")');
    state.needsLogin = !!loginBtn;
    
    if (state.needsLogin && !state.awaiting2FA) {
      console.log('[AUTH] Need to login');
      // This would need credentials - for now just notify
      await sendTelegram('🤖 Collect&Go: Please provide login credentials to start automation');
      state.step = 'login';
      saveJson(CONFIG.statePath, state);
      await browser.close();
      return;
    }

    if (state.awaiting2FA) {
      console.log('[2FA] Waiting for code from user...');
      // Would need manual 2FA entry
      await sendTelegram('🤖 Collect&Go: Please enter the SMS code in the browser, then reply "done"');
      state.step = '2fa_pending';
      saveJson(CONFIG.statePath, state);
      await browser.close();
      return;
    }

    // If logged in, proceed to add items
    console.log('[SESSION] Already logged in');
    
    // Navigate to shopping
    await page.goto(`${CONFIG.siteUrl}/nl/shopping`, { waitUntil: 'networkidle2' });
    
    // Add items to cart - this is site-specific and would need actual product pages
    // For now we just got to the shopping page
    console.log('[CART] Would add items here - need product URLs');
    
    // Save cookies for next run
    const newCookies = await page.cookies();
    saveJson(CONFIG.cookiePath, newCookies);
    
    state.step = 'items_added';
    state.needsLogin = false;
    saveJson(CONFIG.statePath, state);
    
    await sendTelegram('🤖 Collect&Go: Logged in and on shopping page. Need product URLs to add items. Waiting for your list with URLs.');
    
  } catch (err) {
    console.error('[ERROR]', err.message);
    await sendTelegram(`🤖 Collect&Go error: ${err.message}`);
  } finally {
    await browser.close();
  }
}

// CLI
const args = process.argv.slice(2);
if (args[0] === 'run') {
  collectAndGo().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
  });
} else if (args[0] === '2fa') {
  const code = args[1];
  console.log('[2FA] Received code:', code);
  // Would continue the session with this code
} else {
  console.log('Usage: node collect_and_go.js run | 2fa <code>');
}