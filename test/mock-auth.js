const A={currentUser:null};
export const getAuth=()=>A;
export class GoogleAuthProvider{setCustomParameters(){}}
export const signInWithPopup=async()=>{};export const signInWithRedirect=async()=>{};export const getRedirectResult=async()=>null;
export const signOut=async()=>{};
export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>{A.currentUser={uid:window.__UID,email:window.__UID+'@gmail.com',displayName:window.__NAME,getIdToken:async()=>'tok-'+window.__UID};cb(A.currentUser)},50);return()=>{}};
