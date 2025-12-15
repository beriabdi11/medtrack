import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDEHpvuoNHxzW1XGTDBFRo3diubQ6afwB4",
  authDomain: "medtrack-3821f.firebaseapp.com",
  projectId: "medtrack-3821f",
  storageBucket: "medtrack-3821f.appspot.com",
  messagingSenderId: "11128645952",
  appId: "1:11128645952:web:2b9e895573fe932ca8f2a5"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);