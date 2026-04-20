const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  openURL: (url) => ipcRenderer.send('open-url', url),

  // Accounts
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (account) => ipcRenderer.invoke('add-account', account),
  updateAccount: (account) => ipcRenderer.invoke('update-account', account),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  testAccount: (account) => ipcRenderer.invoke('test-account', account),

  // Campaigns
  getCampaigns: () => ipcRenderer.invoke('get-campaigns'),
  createCampaign: (campaign) => ipcRenderer.invoke('create-campaign', campaign),
  updateCampaign: (campaign) => ipcRenderer.invoke('update-campaign', campaign),
  deleteCampaign: (id) => ipcRenderer.invoke('delete-campaign', id),
  duplicateCampaign: (id) => ipcRenderer.invoke('duplicate-campaign', id),
  sendCampaign: (id) => ipcRenderer.invoke('send-campaign', id),
  pauseCampaign: (id) => ipcRenderer.invoke('pause-campaign', id),
  resumeCampaign: (id) => ipcRenderer.invoke('resume-campaign', id),
  cancelCampaign: (id) => ipcRenderer.invoke('cancel-campaign', id),

  // Logs
  getLogs: (campaignId) => ipcRenderer.invoke('get-logs', campaignId),

  // Contacts
  getContacts: () => ipcRenderer.invoke('get-contacts'),
  addContact: (contact) => ipcRenderer.invoke('add-contact', contact),
  deleteContact: (id) => ipcRenderer.invoke('delete-contact', id),
  deleteContactsBulk: (ids) => ipcRenderer.invoke('delete-contacts-bulk', ids),
  importContacts: () => ipcRenderer.invoke('import-contacts'),
  exportContacts: () => ipcRenderer.invoke('export-contacts'),

  // Contact Groups
  getGroups: () => ipcRenderer.invoke('get-groups'),
  createGroup: (group) => ipcRenderer.invoke('create-group', group),
  updateGroup: (group) => ipcRenderer.invoke('update-group', group),
  deleteGroup: (id) => ipcRenderer.invoke('delete-group', id),
  getGroupMembers: (groupId) => ipcRenderer.invoke('get-group-members', groupId),
  addToGroup: (data) => ipcRenderer.invoke('add-to-group', data),
  removeFromGroup: (data) => ipcRenderer.invoke('remove-from-group', data),
  getGroupEmails: (groupId) => ipcRenderer.invoke('get-group-emails', groupId),

  // Validation
  validateEmails: (emails) => ipcRenderer.invoke('validate-emails', emails),

  // Blacklist
  getBlacklist: () => ipcRenderer.invoke('get-blacklist'),
  addToBlacklist: (data) => ipcRenderer.invoke('add-to-blacklist', data),
  addBulkBlacklist: (emails) => ipcRenderer.invoke('add-bulk-blacklist', emails),
  removeFromBlacklist: (id) => ipcRenderer.invoke('remove-from-blacklist', id),
  clearBlacklist: () => ipcRenderer.invoke('clear-blacklist'),
  getUnsubscribes: () => ipcRenderer.invoke('get-unsubscribes'),

  // Attachments
  selectAttachments: () => ipcRenderer.invoke('select-attachments'),

  // Scraping
  scrapeEmails: (options) => ipcRenderer.invoke('scrape-emails', options),

  // Templates
  getTemplates: () => ipcRenderer.invoke('get-templates'),
  saveTemplate: (template) => ipcRenderer.invoke('save-template', template),
  deleteTemplate: (id) => ipcRenderer.invoke('delete-template', id),

  // Stats & Analytics
  getStats: () => ipcRenderer.invoke('get-stats'),
  getAnalytics: () => ipcRenderer.invoke('get-analytics'),

  // Events
  onSendProgress: (callback) => ipcRenderer.on('send-progress', (event, data) => callback(data)),
  onScrapeProgress: (callback) => ipcRenderer.on('scrape-progress', (event, data) => callback(data)),
  onValidationProgress: (callback) => ipcRenderer.on('validation-progress', (event, data) => callback(data)),
  removeSendProgress: () => ipcRenderer.removeAllListeners('send-progress'),
  removeScrapeProgress: () => ipcRenderer.removeAllListeners('scrape-progress'),
  removeValidationProgress: () => ipcRenderer.removeAllListeners('validation-progress'),
});
