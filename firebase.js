import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCoMfEYbPgkzAdcDIlCFUTMo0RTK107ukE",
  authDomain: "philaopersonal.firebaseapp.com",
  projectId: "philaopersonal",
  storageBucket: "philaopersonal.firebasestorage.app",
  messagingSenderId: "966795699161",
  appId: "1:966795699161:web:8ca9d0dfaa2f9e7fe42fc8",
  measurementId: "G-Y36VQMM6G3"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);