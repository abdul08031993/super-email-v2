const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('dns');

// Database setup
let db;
try {
  const Database = require('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), 'super-email.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  initDatabase(db);
} catch (e) {
  console.log('SQLite not available, using in-memory storage');
}

function initDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      provider TEXT NOT NULL,
      smtp_host TEXT,
      smtp_port INTEGER,
      imap_host TEXT,
      imap_port INTEGER,
      username TEXT,
      password TEXT,
      secure INTEGER DEFAULT 1,
      daily_limit INTEGER DEFAULT 500,
      sent_today INTEGER DEFAULT 0,
      last_reset TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      body_type TEXT DEFAULT 'html',
      from_name TEXT,
      reply_to TEXT,
      account_ids TEXT,
      recipient_list TEXT,
      attachments TEXT DEFAULT '[]',
      enable_spintax INTEGER DEFAULT 0,
      enable_unsubscribe INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      paused_at TEXT,
      resume_index INTEGER DEFAULT 0,
      total_recipients INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      open_count INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT,
      account_id TEXT,
      recipient_email TEXT,
      recipient_name TEXT,
      status TEXT,
      error_message TEXT,
      sent_at TEXT,
      opened_at TEXT,
      clicked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS email_contacts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      company TEXT,
      phone TEXT,
      source TEXT,
      tags TEXT,
      is_valid INTEGER DEFAULT 1,
      validation_status TEXT DEFAULT 'unknown',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id TEXT PRIMARY KEY,
      name TEXT,
      source TEXT,
      query TEXT,
      status TEXT DEFAULT 'pending',
      results_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      preview_text TEXT,
      category TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contact_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#6c5ce7',
      member_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS blacklist (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      reason TEXT,
      source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS unsubscribes (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      campaign_id TEXT,
      unsubscribed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

let mainWindow;
// Sending state for pause/resume/cancel
let sendingState = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#06070d',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  startScheduler();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// =========== SPINTAX ENGINE ===========
function processSpintax(text) {
  const regex = /\{([^{}]+)\}/g;
  return text.replace(regex, (match, group) => {
    const options = group.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

function personalizeContent(text, data) {
  let result = text;
  result = result.replace(/\{\{name\}\}/gi, data.name || '');
  result = result.replace(/\{\{email\}\}/gi, data.email || '');
  result = result.replace(/\{\{company\}\}/gi, data.company || '');
  result = result.replace(/\{\{phone\}\}/gi, data.phone || '');
  result = result.replace(/\{\{date\}\}/gi, new Date().toLocaleDateString('id-ID'));
  result = result.replace(/\{\{day\}\}/gi, new Date().toLocaleDateString('id-ID', { weekday: 'long' }));
  result = result.replace(/\{\{unsubscribe\}\}/gi, `<a href="mailto:unsubscribe@superemail.local?subject=UNSUBSCRIBE-${data.email}" style="color:#999;font-size:11px;">Berhenti langganan</a>`);
  return result;
}

// =========== SCHEDULER ===========
function startScheduler() {
  // Check every 60 seconds for scheduled campaigns
  setInterval(() => {
    if (!db) return;
    try {
      const now = new Date().toISOString();
      const scheduled = db.prepare(
        "SELECT * FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?"
      ).all(now);
      
      for (const campaign of scheduled) {
        db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(campaign.id);
        executeSendCampaign(campaign.id).catch(e => console.error('Scheduled send error:', e));
      }
    } catch (e) {
      console.error('Scheduler error:', e);
    }
  }, 60000);
}

// =========== IPC HANDLERS ===========

// Window controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.restore();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// =========== EMAIL ACCOUNTS ===========
ipcMain.handle('get-accounts', () => {
  if (!db) return [];
  return db.prepare('SELECT * FROM email_accounts ORDER BY created_at DESC').all();
});

ipcMain.handle('add-account', (event, account) => {
  if (!db) return { success: false, error: 'Database not available' };
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  try {
    db.prepare(`
      INSERT INTO email_accounts (id, name, email, provider, smtp_host, smtp_port, imap_host, imap_port, username, password, secure, daily_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, account.name, account.email, account.provider, account.smtp_host, account.smtp_port,
      account.imap_host, account.imap_port, account.username, account.password, account.secure ? 1 : 0, account.daily_limit || 500);
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('update-account', (event, account) => {
  if (!db) return { success: false };
  try {
    db.prepare(`
      UPDATE email_accounts SET name=?, email=?, provider=?, smtp_host=?, smtp_port=?, username=?, password=?, daily_limit=?, active=?
      WHERE id=?
    `).run(account.name, account.email, account.provider, account.smtp_host, account.smtp_port,
      account.username, account.password, account.daily_limit, account.active ? 1 : 0, account.id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-account', (event, id) => {
  if (!db) return { success: false };
  db.prepare('DELETE FROM email_accounts WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('test-account', async (event, account) => {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.username, pass: account.password },
      tls: { rejectUnauthorized: false }
    });
    await transporter.verify();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// =========== CAMPAIGNS ===========
ipcMain.handle('get-campaigns', () => {
  if (!db) return [];
  return db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
});

ipcMain.handle('create-campaign', (event, campaign) => {
  if (!db) return { success: false };
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  try {
    const status = campaign.scheduled_at ? 'scheduled' : 'draft';
    db.prepare(`
      INSERT INTO campaigns (id, name, subject, body, body_type, from_name, reply_to, account_ids, recipient_list, attachments, enable_spintax, enable_unsubscribe, status, scheduled_at, total_recipients)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, campaign.name, campaign.subject, campaign.body, campaign.body_type || 'html',
      campaign.from_name, campaign.reply_to, JSON.stringify(campaign.account_ids),
      JSON.stringify(campaign.recipients), JSON.stringify(campaign.attachments || []),
      campaign.enable_spintax ? 1 : 0, campaign.enable_unsubscribe ? 1 : 0,
      status, campaign.scheduled_at || null,
      campaign.recipients ? campaign.recipients.length : 0);
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('update-campaign', (event, campaign) => {
  if (!db) return { success: false };
  try {
    db.prepare(`
      UPDATE campaigns SET name=?, subject=?, body=?, from_name=?, reply_to=?, account_ids=?, recipient_list=?, attachments=?, enable_spintax=?, enable_unsubscribe=?, status=?, scheduled_at=?, total_recipients=?
      WHERE id=?
    `).run(campaign.name, campaign.subject, campaign.body, campaign.from_name,
      campaign.reply_to, JSON.stringify(campaign.account_ids),
      JSON.stringify(campaign.recipients), JSON.stringify(campaign.attachments || []),
      campaign.enable_spintax ? 1 : 0, campaign.enable_unsubscribe ? 1 : 0,
      campaign.status, campaign.scheduled_at || null,
      campaign.recipients ? campaign.recipients.length : 0, campaign.id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-campaign', (event, id) => {
  if (!db) return { success: false };
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  db.prepare('DELETE FROM email_logs WHERE campaign_id = ?').run(id);
  return { success: true };
});

ipcMain.handle('duplicate-campaign', (event, id) => {
  if (!db) return { success: false };
  const { v4: uuidv4 } = require('uuid');
  try {
    const orig = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (!orig) return { success: false, error: 'Campaign not found' };
    const newId = uuidv4();
    db.prepare(`
      INSERT INTO campaigns (id, name, subject, body, body_type, from_name, reply_to, account_ids, recipient_list, attachments, enable_spintax, enable_unsubscribe, status, total_recipients)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `).run(newId, orig.name + ' (Copy)', orig.subject, orig.body, orig.body_type,
      orig.from_name, orig.reply_to, orig.account_ids, orig.recipient_list,
      orig.attachments || '[]', orig.enable_spintax, orig.enable_unsubscribe, orig.total_recipients);
    return { success: true, id: newId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// =========== SEND CAMPAIGN (with spintax, personalization, attachment, blacklist, pause/resume) ===========
async function executeSendCampaign(campaignId) {
  if (!db) throw new Error('Database not available');
  const nodemailer = require('nodemailer');
  const { v4: uuidv4 } = require('uuid');
  
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  
  const accountIds = JSON.parse(campaign.account_ids || '[]');
  const recipients = JSON.parse(campaign.recipient_list || '[]');
  const attachmentPaths = JSON.parse(campaign.attachments || '[]');
  const accounts = accountIds.map(id => db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(id)).filter(Boolean);
  
  if (accounts.length === 0) throw new Error('No valid accounts selected');
  if (recipients.length === 0) throw new Error('No recipients');
  
  // Get blacklisted emails
  const blacklisted = new Set();
  db.prepare('SELECT email FROM blacklist').all().forEach(b => blacklisted.add(b.email.toLowerCase()));
  db.prepare('SELECT email FROM unsubscribes').all().forEach(u => blacklisted.add(u.email.toLowerCase()));
  
  const startIndex = campaign.resume_index || 0;
  db.prepare('UPDATE campaigns SET status=?, started_at=? WHERE id=?').run('sending', new Date().toISOString(), campaignId);
  
  // Init sending state
  sendingState[campaignId] = { paused: false, cancelled: false };
  
  let sent = campaign.sent_count || 0;
  let failed = campaign.failed_count || 0;
  let accountIndex = startIndex;
  
  // Build attachments array for nodemailer
  const mailAttachments = attachmentPaths.filter(p => {
    try { return fs.existsSync(p); } catch(e) { return false; }
  }).map(p => ({ filename: path.basename(p), path: p }));
  
  for (let i = startIndex; i < recipients.length; i++) {
    // Check pause/cancel
    if (sendingState[campaignId]?.cancelled) {
      db.prepare('UPDATE campaigns SET status=?, resume_index=? WHERE id=?').run('cancelled', i, campaignId);
      break;
    }
    
    while (sendingState[campaignId]?.paused) {
      db.prepare('UPDATE campaigns SET status=?, paused_at=?, resume_index=? WHERE id=?').run('paused', new Date().toISOString(), i, campaignId);
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (sendingState[campaignId]?.cancelled) break;
    }
    
    if (sendingState[campaignId]?.cancelled) {
      db.prepare('UPDATE campaigns SET status=?, resume_index=? WHERE id=?').run('cancelled', i, campaignId);
      break;
    }
    
    const recipient = recipients[i];
    const recipientEmail = typeof recipient === 'string' ? recipient : recipient.email;
    const recipientName = typeof recipient === 'object' ? recipient.name : '';
    const recipientCompany = typeof recipient === 'object' ? recipient.company : '';
    
    // Skip blacklisted
    if (blacklisted.has(recipientEmail.toLowerCase())) {
      db.prepare(`INSERT INTO email_logs (id, campaign_id, account_id, recipient_email, recipient_name, status, error_message, sent_at) VALUES (?, ?, ?, ?, ?, 'skipped', 'Blacklisted', ?)`)
        .run(uuidv4(), campaignId, '', recipientEmail, recipientName, new Date().toISOString());
      mainWindow?.webContents.send('send-progress', { campaignId, sent, failed, total: recipients.length, current: i + 1, skipped: recipientEmail });
      continue;
    }
    
    const account = accounts[accountIndex % accounts.length];
    accountIndex++;
    
    try {
      const transporter = nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_port === 465,
        auth: { user: account.username, pass: account.password },
        tls: { rejectUnauthorized: false },
        pool: true,
        maxConnections: 3
      });
      
      // Process subject and body with spintax + personalization
      let emailSubject = campaign.subject;
      let emailBody = campaign.body;
      
      const personData = { name: recipientName, email: recipientEmail, company: recipientCompany, phone: '' };
      
      if (campaign.enable_spintax) {
        emailSubject = processSpintax(emailSubject);
        emailBody = processSpintax(emailBody);
      }
      
      emailSubject = personalizeContent(emailSubject, personData);
      emailBody = personalizeContent(emailBody, personData);
      
      // Add unsubscribe link if enabled
      if (campaign.enable_unsubscribe) {
        emailBody += `<br><hr style="border:none;border-top:1px solid #eee;margin:30px 0 10px;"><p style="text-align:center;font-size:11px;color:#999;">Tidak ingin menerima email lagi? <a href="mailto:unsubscribe@superemail.local?subject=UNSUBSCRIBE-${recipientEmail}" style="color:#6c5ce7;">Berhenti langganan</a></p>`;
      }
      
      const mailOptions = {
        from: `"${campaign.from_name || account.name}" <${account.email}>`,
        to: recipientName ? `"${recipientName}" <${recipientEmail}>` : recipientEmail,
        replyTo: campaign.reply_to || account.email,
        subject: emailSubject,
        html: emailBody,
      };
      
      if (mailAttachments.length > 0) {
        mailOptions.attachments = mailAttachments;
      }
      
      await transporter.sendMail(mailOptions);
      
      db.prepare(`INSERT INTO email_logs (id, campaign_id, account_id, recipient_email, recipient_name, status, sent_at) VALUES (?, ?, ?, ?, ?, 'sent', ?)`)
        .run(uuidv4(), campaignId, account.id, recipientEmail, recipientName, new Date().toISOString());
      sent++;
      
      mainWindow?.webContents.send('send-progress', { campaignId, sent, failed, total: recipients.length, current: i + 1 });
      
      // Update counts periodically
      if (sent % 10 === 0) {
        db.prepare('UPDATE campaigns SET sent_count=?, failed_count=?, resume_index=? WHERE id=?').run(sent, failed, i + 1, campaignId);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      db.prepare(`INSERT INTO email_logs (id, campaign_id, account_id, recipient_email, recipient_name, status, error_message, sent_at) VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`)
        .run(uuidv4(), campaignId, account.id, recipientEmail, recipientName, e.message, new Date().toISOString());
      failed++;
      
      // Auto-blacklist after 3 bounces
      const bounceCount = db.prepare("SELECT COUNT(*) as c FROM email_logs WHERE recipient_email = ? AND status = 'failed'").get(recipientEmail).c;
      if (bounceCount >= 3) {
        try {
          db.prepare("INSERT OR IGNORE INTO blacklist (id, email, reason, source) VALUES (?, ?, 'Auto-blacklisted after 3 bounces', 'auto')").run(uuidv4(), recipientEmail);
        } catch(e) {}
      }
      
      mainWindow?.webContents.send('send-progress', { campaignId, sent, failed, total: recipients.length, current: i + 1 });
    }
  }
  
  const finalStatus = sendingState[campaignId]?.cancelled ? 'cancelled' : 'completed';
  db.prepare('UPDATE campaigns SET status=?, completed_at=?, sent_count=?, failed_count=? WHERE id=?')
    .run(finalStatus, new Date().toISOString(), sent, failed, campaignId);
  
  delete sendingState[campaignId];
  return { success: true, sent, failed };
}

ipcMain.handle('send-campaign', async (event, campaignId) => {
  try {
    return await executeSendCampaign(campaignId);
  } catch (e) {
    if (db) db.prepare('UPDATE campaigns SET status=? WHERE id=?').run('failed', campaignId);
    return { success: false, error: e.message };
  }
});

// Pause/Resume/Cancel
ipcMain.handle('pause-campaign', (event, campaignId) => {
  if (sendingState[campaignId]) {
    sendingState[campaignId].paused = true;
    return { success: true };
  }
  return { success: false, error: 'Campaign not sending' };
});

ipcMain.handle('resume-campaign', async (event, campaignId) => {
  if (sendingState[campaignId]) {
    sendingState[campaignId].paused = false;
    if (db) db.prepare("UPDATE campaigns SET status='sending', paused_at=NULL WHERE id=?").run(campaignId);
    return { success: true };
  }
  // Resume a previously paused campaign that was closed
  if (db) {
    const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ? AND status = 'paused'").get(campaignId);
    if (campaign) {
      try {
        return await executeSendCampaign(campaignId);
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  }
  return { success: false, error: 'Campaign not found' };
});

ipcMain.handle('cancel-campaign', (event, campaignId) => {
  if (sendingState[campaignId]) {
    sendingState[campaignId].cancelled = true;
    return { success: true };
  }
  if (db) {
    db.prepare("UPDATE campaigns SET status='cancelled' WHERE id=?").run(campaignId);
  }
  return { success: true };
});

// =========== EMAIL LOGS ===========
ipcMain.handle('get-logs', (event, campaignId) => {
  if (!db) return [];
  if (campaignId) {
    return db.prepare('SELECT * FROM email_logs WHERE campaign_id = ? ORDER BY sent_at DESC').all(campaignId);
  }
  return db.prepare('SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT 1000').all();
});

// =========== CONTACTS ===========
ipcMain.handle('get-contacts', () => {
  if (!db) return [];
  return db.prepare('SELECT * FROM email_contacts ORDER BY created_at DESC').all();
});

ipcMain.handle('add-contact', (event, contact) => {
  if (!db) return { success: false };
  const { v4: uuidv4 } = require('uuid');
  try {
    db.prepare(`INSERT OR REPLACE INTO email_contacts (id, email, name, company, phone, source, tags) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), contact.email, contact.name, contact.company, contact.phone, contact.source, JSON.stringify(contact.tags));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-contact', (event, id) => {
  if (!db) return { success: false };
  db.prepare('DELETE FROM email_contacts WHERE id = ?').run(id);
  db.prepare('DELETE FROM group_members WHERE contact_id = ?').run(id);
  return { success: true };
});

ipcMain.handle('delete-contacts-bulk', (event, ids) => {
  if (!db) return { success: false };
  const del = db.prepare('DELETE FROM email_contacts WHERE id = ?');
  const delGm = db.prepare('DELETE FROM group_members WHERE contact_id = ?');
  const delMany = db.transaction((ids) => {
    for (const id of ids) { del.run(id); delGm.run(id); }
  });
  delMany(ids);
  return { success: true };
});

ipcMain.handle('import-contacts', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Data Files', extensions: ['csv', 'xlsx', 'xls', 'txt'] }]
  });
  if (result.canceled) return { success: false };
  
  try {
    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    let contacts = [];
    
    if (ext === '.csv' || ext === '.txt') {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = [];
      for (const line of lines) {
        const matches = line.match(emailRegex);
        if (matches) emails.push(...matches);
      }
      contacts = [...new Set(emails)].map(email => ({ email }));
    } else if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws);
      contacts = data.map(row => ({
        email: row.email || row.Email || row.EMAIL || '',
        name: row.name || row.Name || row.NAME || '',
        company: row.company || row.Company || '',
        phone: row.phone || row.Phone || '',
      })).filter(c => c.email);
    }
    
    if (!db) return { success: true, count: contacts.length, contacts };
    
    const { v4: uuidv4 } = require('uuid');
    let imported = 0;
    for (const contact of contacts) {
      try {
        db.prepare(`INSERT OR IGNORE INTO email_contacts (id, email, name, company, phone, source) VALUES (?, ?, ?, ?, ?, 'import')`)
          .run(uuidv4(), contact.email, contact.name || '', contact.company || '', contact.phone || '');
        imported++;
      } catch (e) {}
    }
    
    return { success: true, count: imported };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-contacts', async () => {
  if (!db) return { success: false };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'contacts.csv',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });
  if (result.canceled) return { success: false };
  
  const contacts = db.prepare('SELECT * FROM email_contacts').all();
  const csv = ['Email,Name,Company,Phone,Source,Created'].concat(
    contacts.map(c => `"${c.email}","${c.name || ''}","${c.company || ''}","${c.phone || ''}","${c.source || ''}","${c.created_at || ''}"`)
  ).join('\n');
  
  fs.writeFileSync(result.filePath, csv);
  return { success: true, count: contacts.length };
});

// =========== CONTACT GROUPS ===========
ipcMain.handle('get-groups', () => {
  if (!db) return [];
  const groups = db.prepare('SELECT * FROM contact_groups ORDER BY created_at DESC').all();
  // Update member counts
  for (const g of groups) {
    g.member_count = db.prepare('SELECT COUNT(*) as c FROM group_members WHERE group_id = ?').get(g.id).c;
  }
  return groups;
});

ipcMain.handle('create-group', (event, group) => {
  if (!db) return { success: false };
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  try {
    db.prepare('INSERT INTO contact_groups (id, name, description, color) VALUES (?, ?, ?, ?)')
      .run(id, group.name, group.description || '', group.color || '#6c5ce7');
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('update-group', (event, group) => {
  if (!db) return { success: false };
  try {
    db.prepare('UPDATE contact_groups SET name=?, description=?, color=? WHERE id=?')
      .run(group.name, group.description, group.color, group.id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-group', (event, id) => {
  if (!db) return { success: false };
  db.prepare('DELETE FROM contact_groups WHERE id = ?').run(id);
  db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
  return { success: true };
});

ipcMain.handle('get-group-members', (event, groupId) => {
  if (!db) return [];
  return db.prepare(`
    SELECT ec.* FROM email_contacts ec
    INNER JOIN group_members gm ON ec.id = gm.contact_id
    WHERE gm.group_id = ?
    ORDER BY ec.email
  `).all(groupId);
});

ipcMain.handle('add-to-group', (event, { groupId, contactIds }) => {
  if (!db) return { success: false };
  const { v4: uuidv4 } = require('uuid');
  let added = 0;
  for (const contactId of contactIds) {
    try {
      db.prepare('INSERT OR IGNORE INTO group_members (id, group_id, contact_id) VALUES (?, ?, ?)')
        .run(uuidv4(), groupId, contactId);
      added++;
    } catch (e) {}
  }
  return { success: true, count: added };
});

ipcMain.handle('remove-from-group', (event, { groupId, contactId }) => {
  if (!db) return { success: false };
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND contact_id = ?').run(groupId, contactId);
  return { success: true };
});

ipcMain.handle('get-group-emails', (event, groupId) => {
  if (!db) return [];
  return db.prepare(`
    SELECT ec.email, ec.name, ec.company FROM email_contacts ec
    INNER JOIN group_members gm ON ec.id = gm.contact_id
    WHERE gm.group_id = ?
  `).all(groupId);
});

// =========== EMAIL VALIDATION ===========
ipcMain.handle('validate-emails', async (event, emails) => {
  const results = [];
  
  for (const email of emails) {
    const result = { email, valid: false, reason: '' };
    
    // Syntax check
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      result.reason = 'Format email tidak valid';
      results.push(result);
      continue;
    }
    
    // MX Record check
    const domain = email.split('@')[1];
    try {
      const addresses = await new Promise((resolve, reject) => {
        dns.resolveMx(domain, (err, addresses) => {
          if (err) reject(err);
          else resolve(addresses);
        });
      });
      
      if (addresses && addresses.length > 0) {
        result.valid = true;
        result.reason = `MX valid (${addresses[0].exchange})`;
      } else {
        result.reason = 'Tidak ada MX record';
      }
    } catch (e) {
      result.reason = 'Domain tidak ditemukan';
    }
    
    // Update contact validation status in DB
    if (db) {
      db.prepare('UPDATE email_contacts SET is_valid=?, validation_status=? WHERE email=?')
        .run(result.valid ? 1 : 0, result.valid ? 'valid' : 'invalid', email);
    }
    
    results.push(result);
    
    // Send progress
    mainWindow?.webContents.send('validation-progress', { 
      current: results.length, total: emails.length, email, valid: result.valid 
    });
  }
  
  return results;
});

// =========== BLACKLIST ===========
ipcMain.handle('get-blacklist', () => {
  if (!db) return [];
  return db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC').all();
});

ipcMain.handle('add-to-blacklist', (event, { email, reason }) => {
  if (!db) return { success: false };
  const { v4: uuidv4 } = require('uuid');
  try {
    db.prepare('INSERT OR IGNORE INTO blacklist (id, email, reason, source) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), email.toLowerCase(), reason || 'Manual', 'manual');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('add-bulk-blacklist', (event, emails) => {
  if (!db) return { success: false };
  const { v4: uuidv4 } = require('uuid');
  let added = 0;
  for (const email of emails) {
    try {
      db.prepare('INSERT OR IGNORE INTO blacklist (id, email, reason, source) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), email.toLowerCase(), 'Bulk add', 'manual');
      added++;
    } catch (e) {}
  }
  return { success: true, count: added };
});

ipcMain.handle('remove-from-blacklist', (event, id) => {
  if (!db) return { success: false };
  db.prepare('DELETE FROM blacklist WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('clear-blacklist', () => {
  if (!db) return { success: false };
  db.prepare('DELETE FROM blacklist').run();
  return { success: true };
});

// =========== UNSUBSCRIBES ===========
ipcMain.handle('get-unsubscribes', () => {
  if (!db) return [];
  return db.prepare('SELECT * FROM unsubscribes ORDER BY unsubscribed_at DESC').all();
});

// =========== ATTACHMENTS ===========
ipcMain.handle('select-attachments', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
    ]
  });
  
  if (result.canceled) return { success: false };
  
  const files = result.filePaths.map(fp => ({
    path: fp,
    name: path.basename(fp),
    size: fs.statSync(fp).size
  }));
  
  return { success: true, files };
});

// =========== ANALYTICS ===========
ipcMain.handle('get-analytics', () => {
  if (!db) return {};
  
  // Daily stats for last 7 days
  const dailyStats = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const sent = db.prepare("SELECT COUNT(*) as c FROM email_logs WHERE status='sent' AND DATE(sent_at) = ?").get(dateStr)?.c || 0;
    const failed = db.prepare("SELECT COUNT(*) as c FROM email_logs WHERE status='failed' AND DATE(sent_at) = ?").get(dateStr)?.c || 0;
    
    dailyStats.push({
      date: dateStr,
      label: date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' }),
      sent,
      failed,
      total: sent + failed
    });
  }
  
  // Campaign comparison
  const campaignStats = db.prepare(`
    SELECT name, sent_count, failed_count, total_recipients, 
    CASE WHEN total_recipients > 0 THEN ROUND(CAST(sent_count AS FLOAT) / total_recipients * 100) ELSE 0 END as success_rate
    FROM campaigns ORDER BY created_at DESC LIMIT 10
  `).all();
  
  // Top sources
  const sourceStats = db.prepare(`
    SELECT source, COUNT(*) as count FROM email_contacts WHERE source IS NOT NULL GROUP BY source ORDER BY count DESC LIMIT 5
  `).all();
  
  // Provider usage
  const providerStats = db.prepare(`
    SELECT provider, COUNT(*) as count FROM email_accounts GROUP BY provider ORDER BY count DESC
  `).all();
  
  // Overall totals
  const totalSent = db.prepare("SELECT COUNT(*) as c FROM email_logs WHERE status='sent'").get().c;
  const totalFailed = db.prepare("SELECT COUNT(*) as c FROM email_logs WHERE status='failed'").get().c;
  const totalContacts = db.prepare("SELECT COUNT(*) as c FROM email_contacts").get().c;
  const totalBlacklisted = db.prepare("SELECT COUNT(*) as c FROM blacklist").get().c;
  const totalGroups = db.prepare("SELECT COUNT(*) as c FROM contact_groups").get().c;
  
  return { dailyStats, campaignStats, sourceStats, providerStats, totalSent, totalFailed, totalContacts, totalBlacklisted, totalGroups };
});

// =========== SCRAPING ===========
ipcMain.handle('scrape-emails', async (event, options) => {
  const { source, query, maxResults = 100 } = options;
  const axios = require('axios');
  const cheerio = require('cheerio');
  const { v4: uuidv4 } = require('uuid');
  
  const jobId = uuidv4();
  const emails = new Set();
  
  if (db) {
    db.prepare(`INSERT INTO scrape_jobs (id, name, source, query, status) VALUES (?, ?, ?, ?, 'running')`)
      .run(jobId, `${source}: ${query}`, source, query);
  }
  
  mainWindow?.webContents.send('scrape-progress', { jobId, status: 'running', message: `Starting scrape from ${source}...` });
  
  try {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    
    if (source === 'google') {
      for (let page = 0; page < 5 && emails.size < maxResults; page++) {
        try {
          const url = `https://www.google.com/search?q=${encodeURIComponent(query + ' email "@"')}&start=${page * 10}&num=20`;
          const res = await axios.get(url, {
            headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 15000
          });
          const matches = res.data.match(emailRegex) || [];
          matches.forEach(e => emails.add(e.toLowerCase()));
          mainWindow?.webContents.send('scrape-progress', { jobId, count: emails.size, message: `Google halaman ${page + 1}: ${emails.size} email ditemukan` });
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
        } catch (e) {
          mainWindow?.webContents.send('scrape-progress', { jobId, message: `Halaman ${page + 1} gagal: ${e.message}` });
        }
      }
    } else if (source === 'google_maps') {
      mainWindow?.webContents.send('scrape-progress', { jobId, count: 0, message: 'Searching Google Maps...' });
      try {
        const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        const res = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 30000
        });
        const found = res.data.match(emailRegex) || [];
        found.forEach(e => emails.add(e.toLowerCase()));
      } catch (e) {}
      
      // Also try google search with maps context
      try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query + ' email contact site:google.com/maps')}&num=50`;
        const res = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 15000
        });
        const found = res.data.match(emailRegex) || [];
        found.forEach(e => emails.add(e.toLowerCase()));
      } catch (e) {}
    } else if (source === 'website') {
      try {
        const baseUrl = query.startsWith('http') ? query : `https://${query}`;
        const res = await axios.get(baseUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
          timeout: 30000
        });
        const $ = cheerio.load(res.data);
        
        // From text content
        const text = $.text();
        const found = text.match(emailRegex) || [];
        found.forEach(e => emails.add(e.toLowerCase()));
        
        // From mailto links
        $('a[href^="mailto:"]').each((i, el) => {
          const href = $(el).attr('href');
          const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
          if (email.includes('@')) emails.add(email);
        });
        
        // Also try contact/about pages  
        const links = [];
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href');
          if (href && (href.includes('contact') || href.includes('about') || href.includes('kontak'))) {
            const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
            links.push(fullUrl);
          }
        });
        
        for (const link of links.slice(0, 3)) {
          try {
            mainWindow?.webContents.send('scrape-progress', { jobId, message: `Scanning: ${link}` });
            const subRes = await axios.get(link, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
            const subFound = subRes.data.match(emailRegex) || [];
            subFound.forEach(e => emails.add(e.toLowerCase()));
            await new Promise(r => setTimeout(r, 1000));
          } catch (e) {}
        }
      } catch (e) {
        mainWindow?.webContents.send('scrape-progress', { jobId, status: 'error', message: `Error: ${e.message}` });
      }
    } else if (source === 'bing') {
      for (let page = 0; page < 3 && emails.size < maxResults; page++) {
        try {
          const url = `https://www.bing.com/search?q=${encodeURIComponent(query + ' email')}&first=${page * 10 + 1}`;
          const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 15000
          });
          const matches = res.data.match(emailRegex) || [];
          matches.forEach(e => emails.add(e.toLowerCase()));
          mainWindow?.webContents.send('scrape-progress', { jobId, count: emails.size, message: `Bing halaman ${page + 1}: ${emails.size} email` });
          await new Promise(r => setTimeout(r, 1500));
        } catch (e) {}
      }
    }
    
    // Filter invalid
    const validEmails = [...emails].filter(e => {
      const invalidDomains = ['example.com', 'test.com', 'placeholder.com', 'sentry.io', 'wixpress.com', 'googleapis.com'];
      return !invalidDomains.some(d => e.includes(d)) && e.length < 100 && !e.endsWith('.png') && !e.endsWith('.jpg');
    }).slice(0, maxResults);
    
    if (db) {
      for (const email of validEmails) {
        try {
          db.prepare(`INSERT OR IGNORE INTO email_contacts (id, email, source, tags) VALUES (?, ?, ?, ?)`)
            .run(uuidv4(), email, source, JSON.stringify([source, query]));
        } catch (e) {}
      }
      db.prepare('UPDATE scrape_jobs SET status=?, results_count=?, completed_at=? WHERE id=?')
        .run('completed', validEmails.length, new Date().toISOString(), jobId);
    }
    
    mainWindow?.webContents.send('scrape-progress', {
      jobId, status: 'completed', count: validEmails.length,
      emails: validEmails, message: `Scraping selesai! Ditemukan ${validEmails.length} email.`
    });
    
    return { success: true, emails: validEmails, count: validEmails.length };
  } catch (e) {
    if (db) db.prepare('UPDATE scrape_jobs SET status=? WHERE id=?').run('failed', jobId);
    mainWindow?.webContents.send('scrape-progress', { jobId, status: 'failed', message: e.message });
    return { success: false, error: e.message };
  }
});

// =========== TEMPLATES ===========
ipcMain.handle('get-templates', () => {
  if (!db) return [];
  return db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
});

ipcMain.handle('save-template', (event, template) => {
  if (!db) return { success: false };
  const { v4: uuidv4 } = require('uuid');
  const id = template.id || uuidv4();
  try {
    if (template.id) {
      db.prepare('UPDATE templates SET name=?, subject=?, body=?, preview_text=?, category=? WHERE id=?')
        .run(template.name, template.subject, template.body, template.preview_text, template.category, template.id);
    } else {
      db.prepare(`INSERT INTO templates (id, name, subject, body, preview_text, category) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, template.name, template.subject, template.body, template.preview_text, template.category);
    }
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-template', (event, id) => {
  if (!db) return { success: false };
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  return { success: true };
});

// =========== STATS ===========
ipcMain.handle('get-stats', () => {
  if (!db) return {};
  const totalCampaigns = db.prepare('SELECT COUNT(*) as c FROM campaigns').get().c;
  const totalContacts = db.prepare('SELECT COUNT(*) as c FROM email_contacts').get().c;
  const totalSent = db.prepare('SELECT COUNT(*) as c FROM email_logs WHERE status="sent"').get().c;
  const totalFailed = db.prepare('SELECT COUNT(*) as c FROM email_logs WHERE status="failed"').get().c;
  const totalAccounts = db.prepare('SELECT COUNT(*) as c FROM email_accounts').get().c;
  const totalGroups = db.prepare('SELECT COUNT(*) as c FROM contact_groups').get().c;
  const totalBlacklisted = db.prepare('SELECT COUNT(*) as c FROM blacklist').get().c;
  const recentCampaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 5').all();
  const activeSending = Object.keys(sendingState).length;
  return { totalCampaigns, totalContacts, totalSent, totalFailed, totalAccounts, totalGroups, totalBlacklisted, recentCampaigns, activeSending };
});

// Open URL in browser
ipcMain.on('open-url', (event, url) => {
  shell.openExternal(url);
});
