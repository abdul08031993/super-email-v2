// ============================================
// SUPER EMAIL v2.0 - Renderer Application Logic
// ============================================

const pages = ['dashboard','campaigns','contacts','groups','templates','scraper','monitoring','analytics','validator','accounts','blacklist','settings'];
let currentPage = 'dashboard';
let allCampaigns=[], allContacts=[], allTemplates=[], allAccounts=[], allGroups=[], allLogs=[], campaignsMap={};
let scrapeResults=[], currentScrapeSource='google', validationResults=[];
let campaignAttachments=[], activeSendingCampaignId=null, editingGroupId=null;

// ============== NAVIGATION ==============
function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  loadPageData(page);
}
document.querySelectorAll('.nav-item').forEach(i => i.addEventListener('click', () => navigateTo(i.dataset.page)));

// Window Controls
document.getElementById('btn-minimize').addEventListener('click', () => window.electronAPI?.minimizeWindow());
document.getElementById('btn-maximize').addEventListener('click', () => window.electronAPI?.maximizeWindow());
document.getElementById('btn-close').addEventListener('click', () => window.electronAPI?.closeWindow());

async function loadPageData(page) {
  const loaders = {
    dashboard: loadDashboard, campaigns: loadCampaigns, contacts: loadContacts,
    groups: loadGroups, templates: loadTemplates, monitoring: loadMonitoring,
    analytics: loadAnalytics, accounts: loadAccounts, blacklist: loadBlacklist
  };
  if (loaders[page]) await loaders[page]();
}

// ============== DASHBOARD ==============
async function loadDashboard() {
  if (!window.electronAPI) return;
  try {
    const s = await window.electronAPI.getStats();
    animateNumber('stat-sent', s.totalSent||0);
    animateNumber('stat-campaigns', s.totalCampaigns||0);
    animateNumber('stat-contacts', s.totalContacts||0);
    animateNumber('stat-accounts', s.totalAccounts||0);
    document.getElementById('stat-groups').textContent = s.totalGroups||0;
    document.getElementById('stat-blacklisted').textContent = s.totalBlacklisted||0;
    document.getElementById('stat-active').textContent = s.activeSending||0;

    const total = (s.totalSent||0)+(s.totalFailed||0);
    const rate = total>0 ? Math.round((s.totalSent/total)*100) : 0;
    document.getElementById('donut-value').textContent = rate+'%';
    document.getElementById('legend-sent').textContent = s.totalSent||0;
    document.getElementById('legend-failed').textContent = s.totalFailed||0;
    if(total>0){
      const sentDash=(s.totalSent/total)*314;
      document.getElementById('chart-sent').style.strokeDashoffset=314-sentDash;
      const fDash=(s.totalFailed/total)*314;
      const fEl=document.getElementById('chart-failed');
      fEl.style.strokeDashoffset=314-fDash;
      fEl.style.strokeDasharray=`${fDash} ${314-fDash}`;
      fEl.setAttribute('transform',`rotate(${(sentDash/314)*360-90} 60 60)`);
    }
    const rc=document.getElementById('recent-campaigns');
    if(s.recentCampaigns?.length>0){
      rc.innerHTML=s.recentCampaigns.map(c=>`<div class="recent-campaign-item"><div class="recent-campaign-info"><h4>${esc(c.name)}</h4><span>${c.subject||''} · ${fmtDate(c.created_at)}</span></div><span class="badge badge-${c.status}">${statusLabel(c.status)}</span></div>`).join('');
    } else { rc.innerHTML='<div class="empty-state small"><span class="material-icons-round">inbox</span><p>Belum ada kampanye</p></div>'; }
  } catch(e){ console.error(e); }
}

function animateNumber(id,target){
  const el=document.getElementById(id); const start=parseInt(el.textContent)||0;
  const dur=600,st=Date.now();
  (function tick(){const p=Math.min((Date.now()-st)/dur,1);el.textContent=Math.round(start+(target-start)*(1-Math.pow(1-p,3))).toLocaleString();if(p<1)requestAnimationFrame(tick)})();
}

// ============== CAMPAIGNS ==============
async function loadCampaigns(){
  if(!window.electronAPI)return;
  allCampaigns=await window.electronAPI.getCampaigns();
  renderCampaigns(); await loadAccountsForForm();
}

function renderCampaigns(){
  const f=document.getElementById('campaign-filter').value;
  let c=allCampaigns; if(f!=='all')c=c.filter(x=>x.status===f);
  const tb=document.getElementById('campaigns-tbody'),em=document.getElementById('campaigns-empty');
  if(!c.length){tb.innerHTML='';em.style.display='flex';return;}
  em.style.display='none';
  tb.innerHTML=c.map(c=>`<tr>
    <td style="font-weight:600;color:var(--text-primary)">${esc(c.name)}</td>
    <td>${esc(c.subject||'')}</td><td>${c.total_recipients||0}</td>
    <td><span class="text-success">${c.sent_count||0}</span></td>
    <td><span class="text-danger">${c.failed_count||0}</span></td>
    <td><span class="badge badge-${c.status}">${statusLabel(c.status)}</span></td>
    <td>${c.scheduled_at?fmtDate(c.scheduled_at):fmtDate(c.created_at)}</td>
    <td><div class="table-actions">
      ${c.status==='draft'?`<button class="btn btn-sm btn-primary" onclick="sendCampaign('${c.id}')" title="Kirim"><span class="material-icons-round">send</span></button>`:''}
      ${c.status==='paused'?`<button class="btn btn-sm btn-success" onclick="resumeCampaign('${c.id}')" title="Lanjut"><span class="material-icons-round">play_arrow</span></button>`:''}
      <button class="btn btn-sm btn-outline" onclick="duplicateCampaign('${c.id}')" title="Duplikat"><span class="material-icons-round">content_copy</span></button>
      <button class="btn btn-sm btn-ghost" onclick="viewCampaignLogs('${c.id}')" title="Log"><span class="material-icons-round">receipt_long</span></button>
      <button class="btn btn-sm btn-ghost text-danger" onclick="deleteCampaign('${c.id}')" title="Hapus"><span class="material-icons-round">delete</span></button>
    </div></td></tr>`).join('');
}
document.getElementById('campaign-filter').addEventListener('change',renderCampaigns);

document.getElementById('btn-new-campaign').addEventListener('click',()=>{
  document.getElementById('campaign-list-card').style.display='none';
  document.getElementById('campaign-form-card').style.display='block';
  document.getElementById('campaign-form-title').textContent='Buat Kampanye Baru';
  document.getElementById('campaign-form').reset();
  campaignAttachments=[];
  document.getElementById('attachment-list').innerHTML='';
  loadAccountsForForm();
});
document.getElementById('btn-cancel-campaign').addEventListener('click',closeCampaignForm);
document.getElementById('btn-cancel-form').addEventListener('click',closeCampaignForm);
function closeCampaignForm(){document.getElementById('campaign-list-card').style.display='block';document.getElementById('campaign-form-card').style.display='none';}

// Spintax toggle
document.getElementById('camp-spintax').addEventListener('change',(e)=>{
  document.getElementById('spintax-helper').style.display=e.target.checked?'block':'none';
});
// Schedule toggle
document.getElementById('camp-schedule').addEventListener('change',(e)=>{
  document.getElementById('btn-schedule-campaign').style.display=e.target.value?'inline-flex':'none';
});

function insertVariable(v){
  const ta=document.getElementById('camp-body');
  const s=ta.selectionStart;
  ta.value=ta.value.substring(0,s)+v+ta.value.substring(ta.selectionEnd);
  ta.focus(); ta.selectionStart=ta.selectionEnd=s+v.length;
}

async function loadAccountsForForm(){
  if(!window.electronAPI)return;
  const accs=await window.electronAPI.getAccounts();
  const c=document.getElementById('camp-accounts');
  if(!accs.length){c.innerHTML='<span style="font-size:12px;color:var(--text-tertiary)">Belum ada akun. <a href="#" onclick="navigateTo(\'accounts\')">Tambah akun</a></span>';return;}
  c.innerHTML=accs.map(a=>`<label class="checkbox-item"><input type="checkbox" value="${a.id}" name="camp-account"><span>${esc(a.email)} (${a.provider})</span></label>`).join('');
}

// Load contacts / groups to campaign
document.getElementById('btn-load-contacts').addEventListener('click',async()=>{
  if(!window.electronAPI)return;
  const contacts=await window.electronAPI.getContacts();
  if(!contacts.length){showToast('Belum ada kontak','warning');return;}
  const ta=document.getElementById('camp-recipients');
  const existing=ta.value.trim();
  const emails=contacts.map(c=>c.email).join('\n');
  ta.value=existing?existing+'\n'+emails:emails;
  updateRecipientCount();
  showToast(`${contacts.length} kontak dimuat`,'success');
});

document.getElementById('btn-load-group').addEventListener('click',async()=>{
  if(!window.electronAPI)return;
  const groups=await window.electronAPI.getGroups();
  if(!groups.length){showToast('Belum ada grup','warning');return;}
  const list=document.getElementById('group-picker-list');
  list.innerHTML=groups.map(g=>`<div class="group-selector-item" onclick="loadGroupToCampaign('${g.id}','${esc(g.name)}')"><span class="group-selector-dot" style="background:${g.color}"></span><span>${esc(g.name)} (${g.member_count} anggota)</span></div>`).join('');
  openModal('modal-group-picker');
});

async function loadGroupToCampaign(gid,name){
  closeModal('modal-group-picker');
  const emails=await window.electronAPI.getGroupEmails(gid);
  if(!emails.length){showToast('Grup kosong','warning');return;}
  const ta=document.getElementById('camp-recipients');
  const existing=ta.value.trim();
  const text=emails.map(e=>e.email).join('\n');
  ta.value=existing?existing+'\n'+text:text;
  updateRecipientCount();
  showToast(`${emails.length} email dari "${name}" dimuat`,'success');
}

document.getElementById('btn-import-file-campaign').addEventListener('click',async()=>{
  if(!window.electronAPI)return;
  const r=await window.electronAPI.importContacts();
  if(r.success){showToast(`${r.count} email diimpor`,'success');loadContacts();}
});

document.getElementById('camp-recipients').addEventListener('input',updateRecipientCount);
function updateRecipientCount(){
  const t=document.getElementById('camp-recipients').value.trim();
  const n=t?t.split(/[\n,;]+/).filter(e=>e.trim()).length:0;
  document.getElementById('recipient-count').textContent=`${n} penerima`;
}

// Attachments
document.getElementById('btn-add-attachment').addEventListener('click',async()=>{
  if(!window.electronAPI)return;
  const r=await window.electronAPI.selectAttachments();
  if(!r.success)return;
  campaignAttachments.push(...r.files);
  renderAttachments();
});
function renderAttachments(){
  document.getElementById('attachment-list').innerHTML=campaignAttachments.map((f,i)=>`<span class="attachment-item"><span class="material-icons-round">attach_file</span>${esc(f.name)} (${(f.size/1024).toFixed(1)}KB)<button class="attachment-remove" onclick="removeAttachment(${i})"><span class="material-icons-round">close</span></button></span>`).join('');
}
function removeAttachment(i){campaignAttachments.splice(i,1);renderAttachments();}

// Submit Campaign
document.getElementById('campaign-form').addEventListener('submit',async(e)=>{e.preventDefault();await submitCampaign(true);});
document.getElementById('btn-save-draft').addEventListener('click',async()=>{await submitCampaign(false);});
document.getElementById('btn-schedule-campaign').addEventListener('click',async()=>{await submitCampaign(false,true);});

async function submitCampaign(sendNow,schedule=false){
  if(!window.electronAPI)return;
  const aids=[...document.querySelectorAll('input[name="camp-account"]:checked')].map(c=>c.value);
  if(!aids.length){showToast('Pilih minimal satu akun','error');return;}
  const rt=document.getElementById('camp-recipients').value.trim();
  const recs=rt.split(/[\n,;]+/).map(e=>e.trim()).filter(e=>e&&e.includes('@'));
  if(!recs.length){showToast('Masukkan minimal satu penerima','error');return;}
  
  const campaign={
    name:document.getElementById('camp-name').value,
    subject:document.getElementById('camp-subject').value,
    body:document.getElementById('camp-body').value,
    from_name:document.getElementById('camp-from-name').value,
    reply_to:document.getElementById('camp-reply-to').value,
    account_ids:aids,
    recipients:recs.map(e=>({email:e})),
    attachments:campaignAttachments.map(f=>f.path),
    enable_spintax:document.getElementById('camp-spintax').checked,
    enable_unsubscribe:document.getElementById('camp-unsubscribe').checked,
    scheduled_at:schedule?document.getElementById('camp-schedule').value:null
  };
  
  const r=await window.electronAPI.createCampaign(campaign);
  if(r.success){
    if(sendNow){
      showToast('Memulai pengiriman...','info');
      closeCampaignForm();activeSendingCampaignId=r.id;
      navigateTo('monitoring');
      document.getElementById('live-progress-card').style.display='block';
      const sr=await window.electronAPI.sendCampaign(r.id);
      if(sr.success)showToast(`Selesai: ${sr.sent} terkirim, ${sr.failed} gagal`,'success');
      else showToast('Gagal: '+sr.error,'error');
      document.getElementById('live-progress-card').style.display='none';
      loadCampaigns();
    } else {
      showToast(schedule?'Kampanye dijadwalkan':'Draft tersimpan','success');
      closeCampaignForm();loadCampaigns();
    }
  } else showToast('Gagal: '+r.error,'error');
}

async function sendCampaign(id){
  if(!confirm('Kirim kampanye ini?'))return;
  showToast('Memulai pengiriman...','info');
  activeSendingCampaignId=id;navigateTo('monitoring');
  document.getElementById('live-progress-card').style.display='block';
  const r=await window.electronAPI.sendCampaign(id);
  if(r.success)showToast(`Selesai: ${r.sent} terkirim, ${r.failed} gagal`,'success');
  else showToast('Gagal: '+r.error,'error');
  document.getElementById('live-progress-card').style.display='none';
  loadMonitoring();
}

async function resumeCampaign(id){
  showToast('Melanjutkan pengiriman...','info');
  activeSendingCampaignId=id;navigateTo('monitoring');
  document.getElementById('live-progress-card').style.display='block';
  const r=await window.electronAPI.resumeCampaign(id);
  if(r.success)showToast(`Selesai: ${r.sent} terkirim, ${r.failed} gagal`,'success');
  document.getElementById('live-progress-card').style.display='none';
  loadMonitoring();
}

async function duplicateCampaign(id){
  const r=await window.electronAPI.duplicateCampaign(id);
  if(r.success){showToast('Kampanye diduplikat','success');loadCampaigns();}
}

async function deleteCampaign(id){
  if(!confirm('Hapus kampanye ini?'))return;
  const r=await window.electronAPI.deleteCampaign(id);
  if(r.success){showToast('Dihapus','success');loadCampaigns();}
}

function viewCampaignLogs(cid){navigateTo('monitoring');loadMonitoring(cid);}

// Preview
document.getElementById('btn-preview-email').addEventListener('click',()=>{
  const b=document.getElementById('camp-body').value,s=document.getElementById('camp-subject').value;
  document.getElementById('preview-iframe').srcdoc=`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;padding:20px;}</style></head><body><div style="background:#f5f5f5;padding:10px 20px;margin-bottom:20px;border-radius:4px;"><strong>Subject:</strong> ${esc(s)}</div>${b}</body></html>`;
  openModal('modal-preview');
});

document.getElementById('btn-load-template').addEventListener('click',async()=>{
  if(!window.electronAPI)return;
  const tpls=await window.electronAPI.getTemplates();
  const all=[...builtInTemplates,...tpls];
  if(!all.length){showToast('Belum ada template','warning');return;}
  const names=all.map((t,i)=>`${i+1}. ${t.name}`).join('\n');
  const ch=prompt(`Pilih template:\n${names}\n\nMasukkan nomor:`);
  if(!ch)return;
  const idx=parseInt(ch)-1;
  if(idx>=0&&idx<all.length){
    document.getElementById('camp-subject').value=all[idx].subject||'';
    document.getElementById('camp-body').value=all[idx].body||'';
    showToast(`Template "${all[idx].name}" dimuat`,'success');
  }
});

// ============== CONTACTS ==============
async function loadContacts(){
  if(!window.electronAPI)return;
  allContacts=await window.electronAPI.getContacts();renderContacts();
}
function renderContacts(filter=''){
  let c=allContacts;
  if(filter){const q=filter.toLowerCase();c=c.filter(x=>(x.email||'').toLowerCase().includes(q)||(x.name||'').toLowerCase().includes(q)||(x.company||'').toLowerCase().includes(q));}
  const tb=document.getElementById('contacts-tbody'),em=document.getElementById('contacts-empty');
  if(!c.length){tb.innerHTML='';em.style.display='flex';return;}
  em.style.display='none';
  tb.innerHTML=c.map(x=>`<tr>
    <td><input type="checkbox" class="contact-cb" value="${x.id}" data-email="${esc(x.email)}"></td>
    <td style="font-weight:500;color:var(--accent-primary-light)">${esc(x.email)}</td>
    <td>${esc(x.name||'-')}</td><td>${esc(x.company||'-')}</td>
    <td><span class="badge badge-draft">${esc(x.source||'manual')}</span></td>
    <td><span class="badge badge-${x.validation_status==='valid'?'valid':x.validation_status==='invalid'?'invalid':'draft'}">${x.validation_status||'?'}</span></td>
    <td><button class="btn btn-sm btn-ghost text-danger" onclick="deleteContact('${x.id}')"><span class="material-icons-round">delete</span></button></td>
  </tr>`).join('');
  updateContactBulkButtons();
}
document.getElementById('contacts-search').addEventListener('input',(e)=>renderContacts(e.target.value));
document.getElementById('select-all-contacts').addEventListener('change',(e)=>{document.querySelectorAll('.contact-cb').forEach(c=>c.checked=e.target.checked);updateContactBulkButtons();});
document.addEventListener('change',(e)=>{if(e.target.classList.contains('contact-cb'))updateContactBulkButtons();});
function updateContactBulkButtons(){
  const checked=document.querySelectorAll('.contact-cb:checked').length;
  document.getElementById('btn-delete-selected').style.display=checked?'inline-flex':'none';
  document.getElementById('btn-add-selected-to-group').style.display=checked?'inline-flex':'none';
}
document.getElementById('btn-add-contact').addEventListener('click',()=>{document.getElementById('contact-form').reset();openModal('modal-add-contact');});
document.getElementById('btn-save-contact').addEventListener('click',async()=>{
  if(!window.electronAPI)return;
  const email=document.getElementById('contact-email').value.trim();
  if(!email){showToast('Email wajib','error');return;}
  const r=await window.electronAPI.addContact({email,name:document.getElementById('contact-name').value,company:document.getElementById('contact-company').value,phone:document.getElementById('contact-phone').value,source:'manual',tags:[]});
  if(r.success){showToast('Kontak ditambahkan','success');closeModal('modal-add-contact');loadContacts();}
  else showToast('Gagal: '+(r.error||''),'error');
});
async function deleteContact(id){if(!confirm('Hapus kontak?'))return;await window.electronAPI.deleteContact(id);showToast('Dihapus','success');loadContacts();}
document.getElementById('btn-delete-selected').addEventListener('click',async()=>{
  const ids=[...document.querySelectorAll('.contact-cb:checked')].map(c=>c.value);
  if(!ids.length||!confirm(`Hapus ${ids.length} kontak?`))return;
  await window.electronAPI.deleteContactsBulk(ids);
  showToast(`${ids.length} kontak dihapus`,'success');loadContacts();
});
document.getElementById('btn-import-contacts').addEventListener('click',async()=>{const r=await window.electronAPI.importContacts();if(r.success){showToast(`${r.count} diimpor`,'success');loadContacts();}});
document.getElementById('btn-export-contacts').addEventListener('click',async()=>{const r=await window.electronAPI.exportContacts();if(r.success)showToast(`${r.count} diekspor`,'success');});
document.getElementById('btn-validate-selected').addEventListener('click',async()=>{
  const checked=[...document.querySelectorAll('.contact-cb:checked')];
  const emails=checked.length?checked.map(c=>c.dataset.email):allContacts.map(c=>c.email);
  if(!emails.length){showToast('Tidak ada email','warning');return;}
  navigateTo('validator');
  document.getElementById('validate-emails-input').value=emails.join('\n');
});
document.getElementById('btn-add-selected-to-group').addEventListener('click',async()=>{
  const groups=await window.electronAPI.getGroups();
  if(!groups.length){showToast('Buat grup terlebih dahulu','warning');return;}
  const list=document.getElementById('group-selector-list');
  list.innerHTML=groups.map(g=>`<div class="group-selector-item" onclick="addSelectedToGroup('${g.id}','${esc(g.name)}')"><span class="group-selector-dot" style="background:${g.color}"></span><span>${esc(g.name)}</span></div>`).join('');
  openModal('modal-add-to-group');
});
async function addSelectedToGroup(gid,name){
  closeModal('modal-add-to-group');
  const ids=[...document.querySelectorAll('.contact-cb:checked')].map(c=>c.value);
  const r=await window.electronAPI.addToGroup({groupId:gid,contactIds:ids});
  showToast(`${r.count||0} kontak ditambahkan ke "${name}"`,'success');
}

// ============== GROUPS ==============
async function loadGroups(){
  if(!window.electronAPI)return;
  allGroups=await window.electronAPI.getGroups();renderGroups();
}
function renderGroups(){
  const grid=document.getElementById('groups-grid'),em=document.getElementById('groups-empty');
  const mc=document.getElementById('group-members-card');
  if(!allGroups.length){grid.innerHTML='';em.style.display='flex';return;}
  em.style.display='none';
  grid.innerHTML=allGroups.map(g=>`<div class="group-card" onclick="viewGroupMembers('${g.id}')">
    <div class="group-card-stripe" style="background:${g.color}"></div>
    <div class="group-card-header"><div class="group-card-icon" style="background:${g.color}"><span class="material-icons-round">folder_shared</span></div><h4>${esc(g.name)}</h4></div>
    <div class="group-card-desc">${esc(g.description||'Tanpa deskripsi')}</div>
    <div class="group-card-footer"><span class="group-member-count"><span class="material-icons-round">people</span>${g.member_count} anggota</span>
    <div class="table-actions"><button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();editGroup('${g.id}')" title="Edit"><span class="material-icons-round">edit</span></button><button class="btn btn-sm btn-ghost text-danger" onclick="event.stopPropagation();deleteGroup('${g.id}')" title="Hapus"><span class="material-icons-round">delete</span></button></div></div>
  </div>`).join('');
}
document.getElementById('btn-new-group').addEventListener('click',()=>{
  editingGroupId=null;document.getElementById('group-modal-title').textContent='Buat Grup Baru';
  document.getElementById('group-name').value='';document.getElementById('group-desc').value='';
  document.querySelectorAll('.color-opt').forEach((c,i)=>c.classList.toggle('active',i===0));
  openModal('modal-create-group');
});
document.querySelectorAll('.color-opt').forEach(o=>o.addEventListener('click',()=>{
  document.querySelectorAll('.color-opt').forEach(x=>x.classList.remove('active'));o.classList.add('active');
}));
document.getElementById('btn-save-group').addEventListener('click',async()=>{
  const name=document.getElementById('group-name').value.trim();if(!name){showToast('Nama grup wajib','error');return;}
  const color=document.querySelector('.color-opt.active')?.dataset.color||'#6c5ce7';
  const desc=document.getElementById('group-desc').value;
  if(editingGroupId){await window.electronAPI.updateGroup({id:editingGroupId,name,description:desc,color});}
  else{await window.electronAPI.createGroup({name,description:desc,color});}
  showToast(editingGroupId?'Grup diperbarui':'Grup dibuat','success');
  closeModal('modal-create-group');loadGroups();
});
function editGroup(id){
  const g=allGroups.find(x=>x.id===id);if(!g)return;
  editingGroupId=id;document.getElementById('group-modal-title').textContent='Edit Grup';
  document.getElementById('group-name').value=g.name;document.getElementById('group-desc').value=g.description||'';
  document.querySelectorAll('.color-opt').forEach(o=>o.classList.toggle('active',o.dataset.color===g.color));
  openModal('modal-create-group');
}
async function deleteGroup(id){if(!confirm('Hapus grup?'))return;await window.electronAPI.deleteGroup(id);showToast('Grup dihapus','success');loadGroups();}
async function viewGroupMembers(gid){
  const g=allGroups.find(x=>x.id===gid);if(!g)return;
  document.getElementById('group-members-title').textContent=g.name;
  const members=await window.electronAPI.getGroupMembers(gid);
  const tb=document.getElementById('group-members-tbody');
  tb.innerHTML=members.map(m=>`<tr><td>${esc(m.email)}</td><td>${esc(m.name||'-')}</td><td>${esc(m.company||'-')}</td>
    <td><button class="btn btn-sm btn-ghost text-danger" onclick="removeFromGroup('${gid}','${m.id}')"><span class="material-icons-round">remove_circle</span></button></td></tr>`).join('');
  document.getElementById('group-members-card').style.display='block';
}
function closeGroupMembers(){document.getElementById('group-members-card').style.display='none';}
async function removeFromGroup(gid,cid){await window.electronAPI.removeFromGroup({groupId:gid,contactId:cid});showToast('Dihapus dari grup','success');viewGroupMembers(gid);loadGroups();}

// ============== TEMPLATES ==============
const builtInTemplates=[
  {id:'builtin-promo',name:'Template Promosi',category:'marketing',subject:'🔥 Promo Spesial untuk Anda!',body:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#6c5ce7,#a55eea);padding:40px 30px;text-align:center;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:28px">🔥 PROMO SPESIAL!</h1><p style="color:rgba(255,255,255,0.9);margin-top:10px">Penawaran terbatas hanya untuk Anda</p></div><div style="background:#ffffff;padding:30px;border:1px solid #eee"><h2 style="color:#333">{Halo|Hi|Hey} {{name}}!</h2><p style="color:#666;line-height:1.6">Kami punya penawaran {spesial|istimewa|menarik} yang sayang dilewatkan.</p><div style="text-align:center;margin:30px 0"><a href="#" style="background:#6c5ce7;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">DAPATKAN SEKARANG</a></div></div></div>`},
  {id:'builtin-newsletter',name:'Template Newsletter',category:'newsletter',subject:'📬 Newsletter Mingguan',body:`<div style="font-family:Arial;max-width:600px;margin:0 auto;background:#f8f9fa"><div style="background:#2d3436;padding:30px;text-align:center"><h1 style="color:white;margin:0;font-size:24px">📬 Newsletter</h1></div><div style="padding:30px;background:white"><h3 style="color:#333;border-bottom:2px solid #6c5ce7;padding-bottom:10px">Berita Terbaru</h3><p style="color:#666;line-height:1.6">{Halo|Hi} {{name}}, ini update terbaru untuk Anda.</p></div></div>`},
  {id:'builtin-welcome',name:'Template Selamat Datang',category:'transactional',subject:'🎉 Selamat Datang!',body:`<div style="font-family:Arial;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#00b894,#00cec9);padding:50px 30px;text-align:center;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:32px">🎉 Selamat Datang!</h1></div><div style="background:white;padding:30px;border:1px solid #eee"><h2 style="color:#333">{Halo|Hi} {{name}}!</h2><p style="color:#666;line-height:1.7">Terima kasih telah bergabung bersama kami.</p></div></div>`},
  {id:'builtin-invitation',name:'Template Undangan',category:'invitation',subject:'📩 Anda Diundang!',body:`<div style="font-family:Arial;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#e17055,#fdcb6e);padding:40px;text-align:center;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:28px">📩 Undangan Spesial</h1></div><div style="background:white;padding:30px;border:1px solid #eee"><h2 style="color:#333">{Halo|Dear} {{name}},</h2><p style="color:#666">Dengan {senang hati|bangga} kami mengundang Anda untuk hadir di acara kami.</p><div style="text-align:center;margin:30px 0"><a href="#" style="background:#e17055;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">KONFIRMASI KEHADIRAN</a></div></div></div>`},
  {id:'builtin-followup',name:'Template Follow-up',category:'followup',subject:'🔄 Follow-up: Penawaran Kami',body:`<div style="font-family:Arial;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#0984e3,#74b9ff);padding:30px;text-align:center;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:24px">🔄 Follow-up</h1></div><div style="background:white;padding:30px;border:1px solid #eee"><p style="color:#333">{Halo|Hi} {{name}},</p><p style="color:#666;line-height:1.6">Kami ingin menindaklanjuti penawaran yang telah kami kirimkan sebelumnya. Apakah ada yang bisa kami bantu?</p></div></div>`},
  {id:'builtin-announce',name:'Template Pengumuman',category:'notification',subject:'📢 Pengumuman Penting',body:`<div style="font-family:Arial;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#2d3436,#636e72);padding:40px;text-align:center;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:28px">📢 Pengumuman</h1></div><div style="background:white;padding:30px;border:1px solid #eee"><p style="color:#333">{Halo|Kepada} {{name}},</p><p style="color:#666;line-height:1.6">Kami ingin menginformasikan bahwa ada perubahan penting yang perlu Anda ketahui.</p></div></div>`}
];

async function loadTemplates(){
  if(window.electronAPI){try{allTemplates=await window.electronAPI.getTemplates();}catch(e){allTemplates=[];}}
  renderTemplates();
}
function renderTemplates(){
  const grid=document.getElementById('templates-grid'),em=document.getElementById('templates-empty');
  const combined=[...builtInTemplates,...allTemplates];
  if(!combined.length){grid.innerHTML='';em.style.display='flex';return;}
  em.style.display='none';
  grid.innerHTML=combined.map(t=>{const bi=t.id.startsWith('builtin-');return`<div class="template-card" onclick="editTemplate('${t.id}')"><div class="template-card-header"><div class="template-card-icon"><span class="material-icons-round">${getCatIcon(t.category)}</span></div><span class="template-card-category">${t.category||'other'}</span></div><h4>${esc(t.name)}</h4><p class="template-card-preview">${esc(t.subject||'')}</p><div class="template-card-actions"><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();useTemplate('${t.id}')"><span class="material-icons-round">content_copy</span> Gunakan</button>${!bi?`<button class="btn btn-sm btn-ghost text-danger" onclick="event.stopPropagation();deleteTemplate('${t.id}')"><span class="material-icons-round">delete</span></button>`:''}</div></div>`;}).join('');
}
function getCatIcon(c){return{marketing:'campaign',newsletter:'newspaper',transactional:'receipt',notification:'notifications',invitation:'mail',followup:'replay',other:'article'}[c]||'article';}
function editTemplate(id){const t=[...builtInTemplates,...allTemplates].find(x=>x.id===id);if(!t)return;document.getElementById('template-modal-title').textContent=t.id.startsWith('builtin-')?'Template Bawaan':'Edit Template';document.getElementById('tpl-name').value=t.name||'';document.getElementById('tpl-subject').value=t.subject||'';document.getElementById('tpl-body').value=t.body||'';document.getElementById('tpl-category').value=t.category||'other';openModal('modal-template');}
function useTemplate(id){const t=[...builtInTemplates,...allTemplates].find(x=>x.id===id);if(!t)return;navigateTo('campaigns');document.getElementById('btn-new-campaign').click();setTimeout(()=>{document.getElementById('camp-subject').value=t.subject||'';document.getElementById('camp-body').value=t.body||'';showToast(`Template "${t.name}" dimuat`,'success');},100);}
document.getElementById('btn-new-template').addEventListener('click',()=>{document.getElementById('template-modal-title').textContent='Buat Template Baru';document.getElementById('template-form').reset();openModal('modal-template');});
document.getElementById('btn-save-template').addEventListener('click',async()=>{if(!window.electronAPI)return;const t={name:document.getElementById('tpl-name').value,subject:document.getElementById('tpl-subject').value,body:document.getElementById('tpl-body').value,category:document.getElementById('tpl-category').value};if(!t.name){showToast('Nama wajib','error');return;}const r=await window.electronAPI.saveTemplate(t);if(r.success){showToast('Template disimpan','success');closeModal('modal-template');loadTemplates();}});
async function deleteTemplate(id){if(!confirm('Hapus template?'))return;await window.electronAPI.deleteTemplate(id);showToast('Dihapus','success');loadTemplates();}

// ============== SCRAPER ==============
document.querySelectorAll('.pill[data-source]').forEach(p=>{p.addEventListener('click',()=>{
  document.querySelectorAll('.pill[data-source]').forEach(x=>x.classList.remove('active'));p.classList.add('active');
  currentScrapeSource=p.dataset.source;
  const lbl=document.getElementById('scrape-query-label'),inp=document.getElementById('scrape-query');
  if(currentScrapeSource==='website'){lbl.textContent='URL Website';inp.placeholder='https://contoh.com';}
  else if(currentScrapeSource==='google_maps'){lbl.textContent='Kata Kunci Maps';inp.placeholder='restoran padang jakarta';}
  else{lbl.textContent='Kata Kunci';inp.placeholder='restoran jakarta email';}
});});
document.getElementById('btn-start-scrape').addEventListener('click',async()=>{
  if(!window.electronAPI)return;
  const q=document.getElementById('scrape-query').value.trim();if(!q){showToast('Masukkan kata kunci','error');return;}
  const max=parseInt(document.getElementById('scrape-max').value)||100;
  const con=document.getElementById('scrape-console');con.innerHTML='';
  addConsoleLine('info','Memulai scraping...');addConsoleLine('info',`Sumber: ${currentScrapeSource} | Query: ${q}`);
  document.getElementById('btn-start-scrape').disabled=true;
  document.getElementById('btn-start-scrape').innerHTML='<span class="material-icons-round" style="animation:spin 1s linear infinite">autorenew</span> Scraping...';
  try{
    const r=await window.electronAPI.scrapeEmails({source:currentScrapeSource,query:q,maxResults:max});
    if(r.success){scrapeResults=r.emails||[];addConsoleLine('success',`✓ Ditemukan ${r.count} email!`);
      document.getElementById('scrape-results-card').style.display='block';document.getElementById('scrape-results-count').textContent=scrapeResults.length;
      document.getElementById('scrape-emails-list').innerHTML=scrapeResults.map(e=>`<span class="scrape-email-tag"><span class="material-icons-round" style="font-size:14px">email</span>${esc(e)}</span>`).join('');
    }else addConsoleLine('error','✗ '+r.error);
  }catch(e){addConsoleLine('error','✗ '+e.message);}
  document.getElementById('btn-start-scrape').disabled=false;
  document.getElementById('btn-start-scrape').innerHTML='<span class="material-icons-round">travel_explore</span> Mulai Scraping';
});
document.getElementById('btn-copy-scrape-results').addEventListener('click',()=>{if(!scrapeResults.length)return;navigator.clipboard.writeText(scrapeResults.join('\n')).then(()=>showToast('Disalin ke clipboard','success'));});
document.getElementById('btn-add-scrape-to-contacts').addEventListener('click',async()=>{
  if(!window.electronAPI||!scrapeResults.length)return;let a=0;
  for(const e of scrapeResults){const r=await window.electronAPI.addContact({email:e,name:'',company:'',phone:'',source:'scraper',tags:['scraped']});if(r.success)a++;}
  showToast(`${a} email ditambahkan ke kontak`,'success');
});
function addConsoleLine(type,msg){const con=document.getElementById('scrape-console');const d=document.createElement('div');d.className=`console-line ${type}`;d.innerHTML=`<span class="console-time">[${new Date().toLocaleTimeString()}]</span><span>${msg}</span>`;con.appendChild(d);con.scrollTop=con.scrollHeight;}
if(window.electronAPI){window.electronAPI.onScrapeProgress(d=>{if(d.message)addConsoleLine(d.status==='failed'?'error':'info',d.message);});}

// ============== MONITORING ==============
async function loadMonitoring(filterCid){
  if(!window.electronAPI)return;
  const [logs,campaigns]=await Promise.all([window.electronAPI.getLogs(filterCid),window.electronAPI.getCampaigns()]);
  allLogs=logs;campaignsMap={};campaigns.forEach(c=>campaignsMap[c.id]=c);
  const sent=logs.filter(l=>l.status==='sent').length,failed=logs.filter(l=>l.status==='failed').length;
  const total=sent+failed,rate=total>0?Math.round((sent/total)*100):0;
  document.getElementById('monitor-sent').textContent=sent;document.getElementById('monitor-failed').textContent=failed;
  document.getElementById('monitor-pending').textContent=0;document.getElementById('monitor-rate').textContent=rate+'%';
  renderLogs();
}
function renderLogs(){
  const f=document.getElementById('log-filter').value;let logs=allLogs;if(f!=='all')logs=logs.filter(l=>l.status===f);
  const tb=document.getElementById('logs-tbody'),em=document.getElementById('logs-empty');
  if(!logs.length){tb.innerHTML='';em.style.display='flex';return;}
  em.style.display='none';
  tb.innerHTML=logs.slice(0,500).map(l=>{const c=campaignsMap[l.campaign_id];return`<tr><td style="font-weight:500">${esc(l.recipient_email)}</td><td>${c?esc(c.name):'-'}</td><td><span class="badge badge-${l.status}">${statusLabel(l.status)}</span></td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.error_message||'-')}</td><td>${fmtDate(l.sent_at)}</td></tr>`;}).join('');
}
document.getElementById('log-filter').addEventListener('change',renderLogs);
document.getElementById('btn-refresh-logs').addEventListener('click',()=>{loadMonitoring();showToast('Log diperbarui','info');});
// Pause/Resume/Cancel
document.getElementById('btn-pause-send').addEventListener('click',async()=>{if(!activeSendingCampaignId)return;await window.electronAPI.pauseCampaign(activeSendingCampaignId);showToast('Pengiriman dijeda','warning');document.getElementById('btn-pause-send').style.display='none';document.getElementById('btn-resume-send').style.display='inline-flex';});
document.getElementById('btn-resume-send').addEventListener('click',async()=>{if(!activeSendingCampaignId)return;await window.electronAPI.resumeCampaign(activeSendingCampaignId);showToast('Dilanjutkan','info');document.getElementById('btn-resume-send').style.display='none';document.getElementById('btn-pause-send').style.display='inline-flex';});
document.getElementById('btn-cancel-send').addEventListener('click',async()=>{if(!activeSendingCampaignId||!confirm('Batalkan pengiriman?'))return;await window.electronAPI.cancelCampaign(activeSendingCampaignId);showToast('Dibatalkan','warning');document.getElementById('live-progress-card').style.display='none';activeSendingCampaignId=null;});
// Send progress listener
if(window.electronAPI){window.electronAPI.onSendProgress(d=>{
  const pc=document.getElementById('live-progress-card');pc.style.display='block';
  const total=d.total||1,cur=d.sent+d.failed,pct=Math.round((cur/total)*100);
  document.getElementById('progress-text').textContent=`Mengirim ${cur}/${total}...`;
  document.getElementById('progress-percent').textContent=pct+'%';
  document.getElementById('progress-bar').style.width=pct+'%';
  document.getElementById('progress-sent').textContent=d.sent;
  document.getElementById('progress-failed').textContent=d.failed;
  document.getElementById('progress-remaining').textContent=total-cur;
  if(cur>=total)setTimeout(()=>{pc.style.display='none';loadMonitoring();},2000);
});}

// ============== ANALYTICS ==============
async function loadAnalytics(){
  if(!window.electronAPI)return;
  const a=await window.electronAPI.getAnalytics();
  document.getElementById('an-total-sent').textContent=(a.totalSent||0).toLocaleString();
  document.getElementById('an-total-failed').textContent=(a.totalFailed||0).toLocaleString();
  const total=(a.totalSent||0)+(a.totalFailed||0);
  document.getElementById('an-success-rate').textContent=(total>0?Math.round(a.totalSent/total*100):0)+'%';
  // Daily chart
  const dc=document.getElementById('daily-chart');
  if(a.dailyStats?.length){
    const maxVal=Math.max(...a.dailyStats.map(d=>d.total),1);
    dc.innerHTML=a.dailyStats.map(d=>{const sh=Math.max((d.sent/maxVal)*140,2);const fh=Math.max((d.failed/maxVal)*140,d.failed?2:0);
      return`<div class="chart-bar-group"><div class="chart-bar-value">${d.sent+d.failed}</div><div class="chart-bars"><div class="chart-bar sent" style="height:${sh}px" title="Terkirim: ${d.sent}"></div><div class="chart-bar failed" style="height:${fh}px" title="Gagal: ${d.failed}"></div></div><div class="chart-bar-label">${d.label}</div></div>`;
    }).join('');
  } else dc.innerHTML='<div class="empty-state small"><p>Belum ada data</p></div>';
  // Campaign compare
  const cc=document.getElementById('campaign-compare');
  if(a.campaignStats?.length){
    cc.innerHTML=a.campaignStats.map(c=>{const t=c.total_recipients||1;const sp=Math.round((c.sent_count||0)/t*100);const fp=Math.round((c.failed_count||0)/t*100);
      return`<div class="campaign-compare-item"><span class="campaign-compare-name" title="${esc(c.name)}">${esc(c.name)}</span><div class="campaign-compare-bar"><div class="campaign-compare-sent" style="width:${sp}%"></div><div class="campaign-compare-failed" style="width:${fp}%"></div></div><span class="campaign-compare-rate">${c.success_rate||0}%</span></div>`;}).join('');
  } else cc.innerHTML='<p style="font-size:12px;color:var(--text-tertiary)">Belum ada data</p>';
  // Source stats
  const ss=document.getElementById('source-stats');
  ss.innerHTML=(a.sourceStats||[]).map(s=>`<div class="source-stat-item"><span class="source-stat-name">${esc(s.source)}</span><span class="source-stat-count">${s.count}</span></div>`).join('')||'<p style="font-size:12px;color:var(--text-tertiary)">Belum ada data</p>';
  // Provider stats
  const ps=document.getElementById('provider-stats');
  ps.innerHTML=(a.providerStats||[]).map(p=>`<div class="source-stat-item"><span class="source-stat-name">${esc(p.provider)}</span><span class="source-stat-count">${p.count}</span></div>`).join('')||'<p style="font-size:12px;color:var(--text-tertiary)">Belum ada data</p>';
}

// ============== VALIDATOR ==============
document.getElementById('btn-load-contacts-validate').addEventListener('click',async()=>{
  if(!window.electronAPI)return;const contacts=await window.electronAPI.getContacts();
  if(!contacts.length){showToast('Belum ada kontak','warning');return;}
  document.getElementById('validate-emails-input').value=contacts.map(c=>c.email).join('\n');
  showToast(`${contacts.length} kontak dimuat`,'success');
});
document.getElementById('btn-start-validate').addEventListener('click',async()=>{
  if(!window.electronAPI)return;
  const text=document.getElementById('validate-emails-input').value.trim();
  const emails=text.split(/[\n,;]+/).map(e=>e.trim()).filter(e=>e&&e.includes('@'));
  if(!emails.length){showToast('Masukkan email','error');return;}
  document.getElementById('validation-results-card').style.display='block';
  document.getElementById('val-count').textContent=emails.length;
  document.getElementById('val-progress-bar').style.width='0%';
  document.getElementById('validation-tbody').innerHTML='<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-tertiary)"><span class="material-icons-round" style="animation:spin 1s linear infinite">autorenew</span> Memvalidasi...</td></tr>';
  validationResults=await window.electronAPI.validateEmails(emails);
  const tb=document.getElementById('validation-tbody');
  tb.innerHTML=validationResults.map(r=>`<tr><td style="font-weight:500">${esc(r.email)}</td><td><span class="badge badge-${r.valid?'valid':'invalid'}">${r.valid?'Valid':'Invalid'}</span></td><td style="font-size:11px;color:var(--text-tertiary)">${esc(r.reason)}</td></tr>`).join('');
  document.getElementById('val-progress-bar').style.width='100%';
  showToast(`Validasi selesai: ${validationResults.filter(r=>r.valid).length} valid, ${validationResults.filter(r=>!r.valid).length} invalid`,'success');
});
if(window.electronAPI){window.electronAPI.onValidationProgress(d=>{
  document.getElementById('val-progress-bar').style.width=Math.round((d.current/d.total)*100)+'%';
});}
document.getElementById('btn-blacklist-invalid').addEventListener('click',async()=>{
  const invalid=validationResults.filter(r=>!r.valid).map(r=>r.email);
  if(!invalid.length){showToast('Tidak ada email invalid','info');return;}
  if(!confirm(`Blacklist ${invalid.length} email invalid?`))return;
  await window.electronAPI.addBulkBlacklist(invalid);showToast(`${invalid.length} email di-blacklist`,'success');
});

// ============== ACCOUNTS ==============
const providerConfigs={gmail:{smtp_host:'smtp.gmail.com',smtp_port:587},yahoo:{smtp_host:'smtp.mail.yahoo.com',smtp_port:587},outlook:{smtp_host:'smtp-mail.outlook.com',smtp_port:587},zoho:{smtp_host:'smtp.zoho.com',smtp_port:587},yandex:{smtp_host:'smtp.yandex.com',smtp_port:465},custom:{smtp_host:'',smtp_port:587}};
async function loadAccounts(){if(!window.electronAPI)return;allAccounts=await window.electronAPI.getAccounts();renderAccounts();}
function renderAccounts(){
  const grid=document.getElementById('accounts-grid'),em=document.getElementById('accounts-empty');
  if(!allAccounts.length){grid.innerHTML='';em.style.display='flex';return;}
  em.style.display='none';
  grid.innerHTML=allAccounts.map(a=>`<div class="account-card"><div class="account-card-header"><div class="account-avatar ${a.provider}"><span class="material-icons-round">mail</span></div><div class="account-info"><h4>${esc(a.name)}</h4><span>${esc(a.email)}</span></div></div><div class="account-meta"><span><span class="material-icons-round">dns</span>${esc(a.smtp_host||'N/A')}</span><span><span class="material-icons-round">speed</span>Limit: ${a.daily_limit}/hari</span><span class="badge ${a.active?'badge-sent':'badge-failed'}">${a.active?'Aktif':'Nonaktif'}</span></div><div class="account-actions"><button class="btn btn-sm btn-outline" onclick="testExistingAccount('${a.id}')"><span class="material-icons-round">electrical_services</span> Test</button><button class="btn btn-sm btn-ghost text-danger" onclick="deleteAccount('${a.id}')"><span class="material-icons-round">delete</span></button></div></div>`).join('');
  const b=document.getElementById('accounts-badge');b.textContent=allAccounts.length;b.style.display=allAccounts.length?'inline':'none';
}
document.getElementById('btn-add-account').addEventListener('click',()=>{document.getElementById('account-form').reset();updateProviderFields('gmail');openModal('modal-add-account');});
document.getElementById('acc-provider').addEventListener('change',e=>updateProviderFields(e.target.value));
function updateProviderFields(p){const c=providerConfigs[p];document.getElementById('acc-smtp-host').value=c.smtp_host;document.getElementById('acc-smtp-port').value=c.smtp_port;}
document.getElementById('btn-test-account').addEventListener('click',async()=>{if(!window.electronAPI)return;const a=getAccountFormData();const btn=document.getElementById('btn-test-account');btn.disabled=true;btn.innerHTML='<span class="material-icons-round" style="animation:spin 1s linear infinite">autorenew</span> Testing...';const r=await window.electronAPI.testAccount(a);showToast(r.success?'✓ Koneksi berhasil!':'✗ Gagal: '+r.error,r.success?'success':'error');btn.disabled=false;btn.innerHTML='<span class="material-icons-round">electrical_services</span> Test';});
document.getElementById('btn-save-account').addEventListener('click',async()=>{if(!window.electronAPI)return;const a=getAccountFormData();if(!a.email||!a.name||!a.password){showToast('Lengkapi semua field','error');return;}const r=await window.electronAPI.addAccount(a);if(r.success){showToast('Akun ditambahkan','success');closeModal('modal-add-account');loadAccounts();}else showToast('Gagal: '+r.error,'error');});
function getAccountFormData(){return{name:document.getElementById('acc-name').value,email:document.getElementById('acc-email').value,provider:document.getElementById('acc-provider').value,smtp_host:document.getElementById('acc-smtp-host').value,smtp_port:parseInt(document.getElementById('acc-smtp-port').value)||587,username:document.getElementById('acc-username').value||document.getElementById('acc-email').value,password:document.getElementById('acc-password').value,daily_limit:parseInt(document.getElementById('acc-daily-limit').value)||500,secure:true};}
async function testExistingAccount(id){const a=allAccounts.find(x=>x.id===id);if(!a)return;showToast('Testing...','info');const r=await window.electronAPI.testAccount(a);showToast(r.success?'✓ Berhasil!':'✗ Gagal: '+r.error,r.success?'success':'error');}
async function deleteAccount(id){if(!confirm('Hapus akun ini?'))return;await window.electronAPI.deleteAccount(id);showToast('Dihapus','success');loadAccounts();}

// ============== BLACKLIST ==============
async function loadBlacklist(){
  if(!window.electronAPI)return;
  const [bl,unsubs]=await Promise.all([window.electronAPI.getBlacklist(),window.electronAPI.getUnsubscribes()]);
  const tb=document.getElementById('blacklist-tbody'),em=document.getElementById('blacklist-empty');
  if(!bl.length){tb.innerHTML='';em.style.display='flex';}
  else{em.style.display='none';tb.innerHTML=bl.map(b=>`<tr><td style="font-weight:500">${esc(b.email)}</td><td>${esc(b.reason||'-')}</td><td><span class="badge badge-draft">${esc(b.source)}</span></td><td>${fmtDate(b.created_at)}</td><td><button class="btn btn-sm btn-ghost text-danger" onclick="removeBlacklist('${b.id}')"><span class="material-icons-round">delete</span></button></td></tr>`).join('');}
  const ut=document.getElementById('unsubscribes-tbody'),ue=document.getElementById('unsub-empty');
  if(!unsubs.length){ut.innerHTML='';ue.style.display='flex';}
  else{ue.style.display='none';ut.innerHTML=unsubs.map(u=>`<tr><td>${esc(u.email)}</td><td>${fmtDate(u.unsubscribed_at)}</td></tr>`).join('');}
}
document.getElementById('btn-add-blacklist').addEventListener('click',()=>{document.getElementById('blacklist-emails').value='';document.getElementById('blacklist-reason').value='';openModal('modal-add-blacklist');});
document.getElementById('btn-save-blacklist').addEventListener('click',async()=>{
  const text=document.getElementById('blacklist-emails').value.trim();const reason=document.getElementById('blacklist-reason').value;
  const emails=text.split(/[\n,;]+/).map(e=>e.trim()).filter(e=>e&&e.includes('@'));
  if(!emails.length){showToast('Masukkan email','error');return;}
  if(emails.length===1)await window.electronAPI.addToBlacklist({email:emails[0],reason});
  else await window.electronAPI.addBulkBlacklist(emails);
  showToast(`${emails.length} email di-blacklist`,'success');closeModal('modal-add-blacklist');loadBlacklist();
});
async function removeBlacklist(id){await window.electronAPI.removeFromBlacklist(id);showToast('Dihapus','success');loadBlacklist();}
document.getElementById('btn-clear-blacklist').addEventListener('click',async()=>{if(!confirm('Hapus semua blacklist?'))return;await window.electronAPI.clearBlacklist();showToast('Blacklist dikosongkan','success');loadBlacklist();});

// ============== UTILITIES ==============
function esc(t){if(!t)return'';const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function fmtDate(s){if(!s)return'-';try{return new Date(s).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch(e){return s;}}
function statusLabel(s){return{draft:'Draft',sending:'Mengirim',completed:'Selesai',failed:'Gagal',sent:'Terkirim',pending:'Menunggu',scheduled:'Terjadwal',paused:'Dijeda',cancelled:'Dibatalkan',skipped:'Dilewati'}[s]||s;}
function openModal(id){document.getElementById(id).style.display='flex';}
function closeModal(id){document.getElementById(id).style.display='none';}
document.querySelectorAll('.modal-overlay').forEach(o=>{o.addEventListener('click',e=>{if(e.target===o)o.style.display='none';});});
function togglePassword(id,btn){const i=document.getElementById(id);i.type=i.type==='password'?'text':'password';btn.querySelector('.material-icons-round').textContent=i.type==='password'?'visibility_off':'visibility';}
function insertHtmlTag(tag,attr){const ta=document.getElementById('camp-body');const s=ta.selectionStart,e=ta.selectionEnd,sel=ta.value.substring(s,e);let ins;if(tag==='br')ins='<br>\n';else if(attr)ins=`<${tag} ${attr}>${sel}</${tag}>`;else ins=`<${tag}>${sel}</${tag}>`;ta.value=ta.value.substring(0,s)+ins+ta.value.substring(e);ta.focus();ta.selectionStart=ta.selectionEnd=s+ins.length;}
function showToast(msg,type='info'){const c=document.getElementById('toast-container');const t=document.createElement('div');t.className=`toast ${type}`;const icons={success:'check_circle',error:'error',warning:'warning',info:'info'};t.innerHTML=`<span class="material-icons-round">${icons[type]||'info'}</span><span>${msg}</span>`;c.appendChild(t);setTimeout(()=>{t.classList.add('toast-exit');setTimeout(()=>t.remove(),300);},4000);}

// ============== INIT ==============
document.addEventListener('DOMContentLoaded',()=>{
  loadDashboard();
  document.querySelectorAll('.stat-card').forEach((c,i)=>{c.style.opacity='0';c.style.transform='translateY(20px)';setTimeout(()=>{c.style.transition='all 0.4s ease';c.style.opacity='1';c.style.transform='translateY(0)';},i*100);});
});
