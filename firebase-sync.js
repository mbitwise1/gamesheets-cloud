// firebase-sync.js — force-online, bucket-pinned, exposes internals for progress sync
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
    }catch(_e){}
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
        }catch(e2){ alert('Google redirect failed: ' + e2.message); return; }
      }
      alert('Google sign-in failed: ' + e.message);
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
    btn.onclick = () => alert('Cloud Sync ready');
    document.body.appendChild(btn);
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

  return {
    init, uploadWorkbook, downloadWorkbook, listFiles, listStorage,
    _internals: { get auth(){return auth;}, get db(){return db;}, ensureOnline }
  };
})();

window.FirebaseSync = FirebaseSync;
