// firebase-sync.js — TOP-RIGHT floating Sync button (no toolbar integration)
//
// Drop-in instructions:
// 1) Replace your existing `firebase-sync.js` with this file.
// 2) Keep your existing script tags, e.g.:
//      <script src="firebase-sync.js"></script>
//      <script src="sync-hook.js"></script>
//      <script> FirebaseSync.init(); </script>
// 3) The button appears at the TOP‑RIGHT, above everything, not blocked by OS taskbars.
//
// Features:
// • Robust mount: always-visible top-right floating button (high z-index).
// • Status-aware label: “Sign In / Sync” → “Cloud: Signed In” when authenticated.
// • Google sign-in fallback: popup → redirect; handles redirect result on init.
// • Email link sign-in supported; Anonymous sign-in for quick tests (no cross-device sync).
// • Same modal as before: Email link, Google, Anon, Sign Out, List Files.
//
// Config baked-in for your project:
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAyusvJlBlsciBmm0LdZy8hPrR0DAOFQD8",
  authDomain: "gamesheets-62e13.firebaseapp.com",
  projectId: "gamesheets-62e13",
  storageBucket: "gamesheets-62e13.appspot.com",
  messagingSenderId: "1000189959909",
  appId: "1:1000189959909:web:ead1ca915f1cf8c8347e0c"
};

const FirebaseSync = (function(){
  let app, auth, storage, db, user;
  let btn; // floating button

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
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
  }

  async function init(config = FIREBASE_CONFIG){
    await loadFirebase();
    app = firebase.initializeApp(config);
    auth = firebase.auth();
    storage = firebase.storage();
    db = firebase.firestore();

    // Complete email link sign-in if returning via link
    if(auth.isSignInWithEmailLink(window.location.href)){
      const savedEmail = window.localStorage.getItem('gs_email_for_signin');
      const email = savedEmail || window.prompt('Confirm your email to complete sign-in:');
      await auth.signInWithEmailLink(email, window.location.href);
      window.localStorage.removeItem('gs_email_for_signin');
      history.replaceState({}, document.title, window.location.pathname);
    }

    // Handle Google redirect fallback result
    try{ await auth.getRedirectResult(); }catch(e){ console.warn('[FirebaseSync] redirect result:', e.message); }

    user = auth.currentUser;
    auth.onAuthStateChanged(u => { user = u || null; updateButtonLabel(); });

    mountTopRightButton();
    return true;
  }

  // ---- Auth helpers ----
  async function signInWithEmail(email){
    await auth.sendSignInLinkToEmail(email, {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true
    });
    window.localStorage.setItem('gs_email_for_signin', email);
    alert('Check your email for a sign-in link');
  }

  async function signInWithGoogle(){
    try{
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    }catch(e){
      const code = (e && e.code) || '';
      if(code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user'){
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithRedirect(provider);
        return;
      }
      if(code === 'auth/operation-not-allowed' || code === 'auth/unauthorized-domain'){
        showError(`Google sign-in isn’t enabled or this domain isn’t authorized in Firebase Auth.\n\nFirebase Console → Authentication → Sign-in method:\n  • Enable Google\n  • Add this domain under Authorized domains`);
        return;
      }
      showError('Google sign-in failed: ' + e.message);
    }
  }

  async function signInAnonymously(){ await auth.signInAnonymously(); }
  async function signOut(){ await auth.signOut(); }

  function requireUser(){ if(!user) throw new Error('Not signed in.'); return user; }

  // ---- Cloud ops ----
  async function uploadWorkbook(fileId, name, arrayBuffer, meta = {}){
    const u = requireUser();
    const ref = storage.ref().child(`workbooks/${u.uid}/${fileId}.xlsx`);
    await ref.put(new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const docRef = db.collection('users').doc(u.uid).collection('files').doc(fileId);
    await docRef.set({ name, updated_at: Date.now(), meta }, { merge: true });
    return true;
  }
  async function downloadWorkbook(fileId){
    const u = requireUser();
    const ref = storage.ref().child(`workbooks/${u.uid}/${fileId}.xlsx`);
    const url = await ref.getDownloadURL();
    const resp = await fetch(url);
    const ab = await resp.arrayBuffer();
    const docRef = db.collection('users').doc(u.uid).collection('files').doc(fileId);
    const snap = await docRef.get();
    const meta = snap.exists ? snap.data() : {};
    return { arrayBuffer: ab, meta };
  }
  async function listFiles(){
    const u = requireUser();
    const col = await db.collection('users').doc(u.uid).collection('files').orderBy('updated_at', 'desc').get();
    return col.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ---- UI: Floating button + modal ----
  function mountTopRightButton(){
    if(btn && document.contains(btn)) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sync-floating';
    btn.setAttribute('aria-label', 'Cloud Sync');
    btn.style.position = 'fixed';
    btn.style.top = '12px';
    btn.style.right = '12px';
    btn.style.zIndex = '2147483647'; // very high
    btn.style.padding = '8px 10px';
    btn.style.borderRadius = '10px';
    btn.style.boxShadow = '0 6px 18px rgba(0,0,0,.18)';
    btn.style.backdropFilter = 'blur(4px)';
    btn.style.background = 'linear-gradient( to bottom right, rgba(255,255,255,.85), rgba(245,245,245,.85) )';
    btn.style.border = '1px solid rgba(0,0,0,.08)';
    btn.style.cursor = 'pointer';
    btn.onclick = openSyncModal;
    document.body.appendChild(btn);
    updateButtonLabel();

    // Re-assert position on resize/orientation (some mobile UIs adjust viewport)
    window.addEventListener('orientationchange', ()=> { btn.style.top='12px'; btn.style.right='12px'; }, {passive:true});
    window.addEventListener('resize', ()=> { btn.style.top='12px'; btn.style.right='12px'; }, {passive:true});
  }

  function updateButtonLabel(){
    if(!btn) return;
    if(user){
      btn.textContent = 'Cloud: Signed In';
      btn.title = 'Open Cloud Sync';
    }else{
      btn.textContent = 'Sign In / Sync';
      btn.title = 'Sign in to sync across devices';
    }
  }

  function showError(msg){
    console.error('[FirebaseSync]', msg);
    const out = document.querySelector('.sync-modal #gs_out');
    if(out){ out.textContent = String(msg); }
  }

  function openSyncModal(){
    const div = document.createElement('div');
    div.className = 'sync-modal';
    div.innerHTML = `
      <div class="box" style="position:fixed; left:50%; top:20%; transform:translateX(-50%); background:#fff; padding:14px; border-radius:10px; box-shadow: 0 10px 30px rgba(0,0,0,.12); min-width: 320px; z-index:2147483646;">
        <div style="font-weight:700; margin-bottom:10px;">Cloud Sync</div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <input id="gs_email" type="email" placeholder="email for sign-in" style="flex:1; padding:6px;">
          <button id="gs_send" class="btn">Email Link</button>
        </div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <button id="gs_google" class="btn">Sign in with Google</button>
          <button id="gs_anon" class="btn">Anon</button>
          <button id="gs_signout" class="btn">Sign Out</button>
        </div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <button id="gs_list" class="btn">List Files</button>
          <button id="gs_close" class="btn">Close</button>
        </div>
        <div id="gs_out" style="margin-top:8px; font-size:12px; max-height:40vh; overflow:auto;"></div>
      </div>`;
    document.body.appendChild(div);
    const out = div.querySelector('#gs_out');
    div.querySelector('#gs_send').onclick = async ()=>{
      const email = div.querySelector('#gs_email').value.trim();
      if(!email){ alert('enter email'); return; }
      try{ await signInWithEmail(email); out.textContent = 'Email link sent.'; }
      catch(e){ showError(e.message); }
    };
    div.querySelector('#gs_google').onclick = async ()=>{
      try{ await signInWithGoogle(); updateButtonLabel(); out.textContent = 'Google sign-in complete (or redirecting).'; }
      catch(e){ showError(e.message); }
    };
    div.querySelector('#gs_anon').onclick = async ()=>{
      await signInAnonymously(); updateButtonLabel(); out.textContent = 'Signed in anonymously (no cross-device sync).';
    };
    div.querySelector('#gs_signout').onclick = async ()=>{
      await signOut(); updateButtonLabel(); out.textContent = 'Signed out';
    };
    div.querySelector('#gs_list').onclick = async ()=>{
      try{ const files = await listFiles(); out.textContent = JSON.stringify(files,null,2); }
      catch(e){ showError(e.message); }
    };
    div.querySelector('#gs_close').onclick = ()=> div.remove();
  }

  // Public API (in case you need to remount programmatically later)
  return { init, uploadWorkbook, downloadWorkbook, listFiles, openSyncModal };
})();

window.FirebaseSync = FirebaseSync;
