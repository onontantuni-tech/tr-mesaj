export const getAuth=()=>({});
export class GoogleAuthProvider{setCustomParameters(){}}
export const signInWithPopup=async()=>{};export const signInWithRedirect=async()=>{};export const getRedirectResult=async()=>null;
export const signOut=async()=>{};
export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb({uid:window.__UID,email:window.__UID+'@gmail.com',displayName:window.__NAME}),50);return()=>{}};
