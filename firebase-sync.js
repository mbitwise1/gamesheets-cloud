// firebase-sync.js — Cross-device sync with forced-online Firestore + robust migrate
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAyusvJlBlsciBmm0LdZy8hPrR0DAOFQD8",
  authDomain: "gamesheets-62e13.firebaseapp.com",
  projectId: "gamesheets-62e13",
  messagingSenderId: "1000189959909",
  appId: "1:1000189959909:web:ead1ca915f1cf8c8347e0c"
};
const GS_BUCKET = "gs://gamesheets-62e13.firebasestorage.app";

const FirebaseSync = (function(){
  let app, auth, storage, db, user;
  let btn;

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  async function loadFirebase(){
    if(window.firebase && window.firebase.app) return;
    const scripts = [
      "https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js",
      "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth-compat.js",
      "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage-compat.js",
      "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore-compat.js"
    ];
    for(const src of scripts){
      await new Promise((res, rej)=>{
        const s = document.createElement('script'); s.src = src; s.async = true;
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
  }

  async function ensureOnline(){
    try{
      if(firebase && firebase.firestore && firebase.firestore().enableNetwork){
        await firebase.firestore().enableNetwork();
      }else if(db && db.enableNetwork){
        await db.enableNetwork();
      }
    }catch(e){}
  }

  async function init(config = FIREBASE_CONFIG){
    await loadFirebase();
    app = firebase.initializeApp(config);
    auth = firebase.auth();
    storage = firebase.storage();
    db = firebase.firestore();

    await ensureOnline();

    if(auth.isSignInWithEmailLink(window.location.href)){
      const savedEmail = window.localStorage.getItem('gs_email_for_signin');
      const email = savedEmail || window.prompt('Confirm your email to complete sign-in:');
      await auth.signInWithEmailLink(email, window.location.href);
      window.localStorage.removeItem('gs_email_for_signin');
      history.replaceState({}, document.title, window.location.pathname);
    }
    try{ await auth.getRedirectResult(); }catch(_e){}

    user = auth.currentUser;
    auth.onAuthStateChanged(u => { user = u || null; updateButtonLabel(); });

    mountTopRightButton();
    return true;
  }

  async function signInWithEmail(email){
    await auth.sendSignInLinkToEmail(email, { url: window.location.origin + window.location.pathname, handleCodeInApp: true });
    window.localStorage.setItem('gs_email_for_signin', email);
    alert('Check your email for a sign-in link');
  }
  async function signInWithGoogle(){
    const provider = new firebase.auth.GoogleAuthProvider();
    try{
      if(auth.currentUser && auth.currentUser.isAnonymous){
        await auth.currentUser.linkWithPopup(provider);
      }else{
        await auth.signInWithPopup(provider);
      }
    }catch(e){
      const code = e && e.code || '';
      if(code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user'){
        try{
          if(auth.currentUser && auth.currentUser.isAnonymous){
            await auth.currentUser.linkWithRedirect(provider);
          }else{
            await auth.signInWithRedirect(provider);
          }
          return;
        }catch(e2){ showError('Google redirect failed: ' + e2.message); return; }
      }
      if(code === 'auth/operation-not-allowed' || code === 'auth/unauthorized-domain'){
        showError('Enable Google provider and add your domain in Firebase Auth settings.');
        return;
      }
      showError('Google sign-in failed: ' + e.message);
    }
  }
  async function signInAnonymously(){ await auth.signInAnonymously(); }
  async function signOut(){ await auth.signOut(); }
  function requireUser(){ if(!user) throw new Error('Not signed in.'); return user; }

  function dirRef(uid){ return storage.refFromURL(`${GS_BUCKET}/workbooks/${uid}`); }
  function fileRef(uid, fileId, ext='xlsx'){ return storage.refFromURL(`${GS_BUCKET}/workbooks/${uid}/${fileId}.${ext}`); }

  async function uploadWorkbook(fileId, name, arrayBuffer, meta = {}){
    const u = requireUser();
    const ref = fileRef(u.uid, fileId, 'xlsx');
    await ref.put(new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const docRef = db.collection('users').doc(u.uid).collection('files').doc(fileId);
    await ensureOnline();
    await docRef.set({ name, updated_at: Date.now(), meta }, { merge: true });
    return true;
  }
  async function downloadWorkbook(fileId){
    const u = requireUser();
    const ref = fileRef(u.uid, fileId, 'xlsx');
    const url = await ref.getDownloadURL();
    const resp = await fetch(url);
    const ab = await resp.arrayBuffer();
    const docRef = db.collection('users').doc(u.uid).collection('files').doc(fileId);
    await ensureOnline();
    const snap = await docRef.get();
    const meta = snap.exists ? snap.data() : {};
    return { arrayBuffer: ab, meta };
  }
  async function listFiles(){
    const u = requireUser();
    await ensureOnline();
    const col = await db.collection('users').doc(u.uid).collection('files').orderBy('updated_at', 'desc').get();
    return col.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async function listStorage(){
    const u = requireUser();
    const dir = dirRef(u.uid);
    const out = [];
    const res = await dir.listAll();
    for(const it of res.items){
      const meta = await it.getMetadata();
      const m = it.name.match(/^(.+)\.xlsx$/i);
      const id = m ? m[1] : it.name;
      out.push({ id, name: it.name, updated: meta.updated || meta.timeCreated || null });
    }
    out.sort((a,b)=> (new Date(b.updated||0)) - (new Date(a.updated||0)));
    return out;
  }
  async function migrateStorageToFirestore(){
    const u = requireUser();
    await ensureOnline();
    let attempts = 0, maxAttempts = 4;
    while(true){
      try{
        const dir = dirRef(u.uid);
        const res = await dir.listAll();
        let count = 0;
        for(const it of res.items){
          const m = it.name.match(/^(.+)\.xlsx$/i);
          if(!m) continue;
          const fileId = m[1];
          const docRef = db.collection('users').doc(u.uid).collection('files').doc(fileId);
          const snap = await docRef.get();
          if(!snap.exists){
            await docRef.set({ name: it.name, updated_at: Date.now(), meta: { backfilled:true } }, { merge: true });
            count++;
          }
        }
        return count;
      }catch(e){
        attempts++;
        if(attempts >= maxAttempts) throw e;
        await ensureOnline();
        await sleep(400 * attempts);
      }
    }
  }

  function mountTopRightButton(){
    if(btn && document.contains(btn)) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sync-floating';
    Object.assign(btn.style, {
      position:'fixed', top:'12px', right:'12px', zIndex:'2147483647',
      padding:'8px 10px', borderRadius:'10px',
      boxShadow:'0 6px 18px rgba(0,0,0,.18)',
      background:'linear-gradient( to bottom right, rgba(255,255,255,.9), rgba(245,245,245,.9) )',
      border:'1px solid rgba(0,0,0,.08)', cursor:'pointer'
    });
    btn.onclick = openSyncModal;
    document.body.appendChild(btn);
    updateButtonLabel();
  }
  function updateButtonLabel(){
    if(!btn) return;
    if(user){
      const label = user.email ? `Cloud: ${user.email}` : 'Cloud: Signed In';
      btn.textContent = label;
      btn.title = 'Open Cloud Sync';
    }else{
      btn.textContent = 'Sign In / Sync';
      btn.title = 'Sign in to sync across devices';
    }
  }

  function openSyncModal(){
    const div = document.createElement('div');
    div.className = 'sync-modal';
    const emailTxt = user && user.email ? user.email : '(not signed in)';
    const uidTxt = user && user.uid ? user.uid : '—';
    div.innerHTML = `
      <div class="box" style="position:fixed; left:50%; top:18%; transform:translateX(-50%); background:#fff; padding:14px; border-radius:10px; box-shadow: 0 10px 30px rgba(0,0,0,.12); min-width: 400px; z-index:2147483646;">
        <div style="font-weight:700; margin-bottom:10px;">Cloud Sync</div>
        <div style="font-size:12px; margin-bottom:10px; color:#444;">
          <div><b>Status:</b> ${user ? 'Signed In' : 'Signed Out'}</div>
          <div><b>Email:</b> ${emailTxt}</div>
          <div><b>UID:</b> ${uidTxt}</div>
          <div><b>Bucket:</b> ${GS_BUCKET}</div>
        </div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <input id="gs_email" type="email" placeholder="email for sign-in" style="flex:1; padding:6px;">
          <button id="gs_send" class="btn">Email Link</button>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
          <button id="gs_google" class="btn">Sign in with Google</button>
          <button id="gs_anon" class="btn">Anon</button>
          <button id="gs_signout" class="btn">Sign Out</button>
          <button id="gs_listfs" class="btn">List Files</button>
          <button id="gs_listst" class="btn">List Storage (debug)</button>
          <button id="gs_migrate" class="btn">Migrate Storage → Firestore</button>
          <button id="gs_refresh" class="btn">Refresh</button>
          <button id="gs_close" class="btn">Close</button>
        </div>
        <div id="gs_out" style="margin-top:8px; font-size:12px; max-height:44vh; overflow:auto; white-space:pre-wrap;"></div>
      </div>`;
    document.body.appendChild(div);
    const out = div.querySelector('#gs_out');
    const setOut = (t)=> out.textContent = t;

    div.querySelector('#gs_send').onclick = async ()=>{
      const email = div.querySelector('#gs_email').value.trim();
      if(!email){ alert('enter email'); return; }
      try{ await signInWithEmail(email); setOut('Email link sent.'); }catch(e){ setOut(e.message); }
    };
    div.querySelector('#gs_google').onclick = async ()=>{
      try{ await signInWithGoogle(); updateButtonLabel(); setOut('Google sign-in complete (or redirecting).'); }catch(e){ setOut(e.message); }
    };
    div.querySelector('#gs_anon').onclick = async ()=>{
      try{ await signInAnonymously(); updateButtonLabel(); setOut('Signed in anonymously.'); }catch(e){ setOut(e.message); }
    };
    div.querySelector('#gs_signout').onclick = async ()=>{
      try{ await signOut(); updateButtonLabel(); setOut('Signed out.'); }catch(e){ setOut(e.message); }
    };
    div.querySelector('#gs_listfs').onclick = async ()=>{
      try{
        const files = await listFiles();
        setOut(JSON.stringify(files,null,2) || '(empty)');
        if(!files || files.length === 0){
          setOut('(No Firestore metadata yet for this UID.)\nClick "List Storage (debug)" to verify objects, then "Migrate Storage → Firestore".');
        }
      }catch(e){ setOut('List Files error: ' + e.message); }
    };
    div.querySelector('#gs_listst').onclick = async ()=>{
      try{
        const items = await listStorage();
        if(!items || items.length === 0){
          setOut('(No Storage objects under this UID path). Make sure you are signed into the same Google account as the device that uploaded.');
        }else{
          setOut(items.map(it => `• ${it.name}  (${it.updated||''})`).join('\n'));
        }
      }catch(e){ setOut('List Storage error: ' + e.message); }
    };
    div.querySelector('#gs_migrate').onclick = async ()=>{
      try{
        setOut('Backfilling Firestore metadata…');
        const n = await migrateStorageToFirestore();
        setOut('Backfilled ' + n + ' metadata docs. Now click "List Files".');
      }catch(e){ setOut('Migrate error: ' + e.message + '\nHint: if you still see "offline", check ad-block / network restrictions, or hard-reload so Firestore reinitializes online.'); }
    };
    div.querySelector('#gs_refresh').onclick = ()=>{ setOut(''); };
    div.querySelector('#gs_close').onclick = ()=> div.remove();
  }

  return { init, uploadWorkbook, downloadWorkbook, listFiles, openSyncModal };
})();

window.FirebaseSync = FirebaseSync;
