
MedTrack

MedTrack is a web-based medication tracking application that helps users manage daily medications, track pill counts, view weekly adherence, and quickly contact pharmacies or caregivers. The app uses Firebase for authentication and data storage, and OpenStreetMap for free, real-world pharmacy data.

This project was built as a course assignment and focuses on practicality, usability, and working within real-world constraints such as API costs and time limits.

Features
Medication Tracking

Add, edit, and delete medications

Set dosage, time, frequency, and days

Mark medications as Taken

Automatically track pills remaining

Visual refill warnings when pills are running low

Weekly Schedule

Weekly table view showing medication adherence

Uses date-based logs (YYYY-MM-DD) for accuracy

Pharmacy Search (OpenStreetMap)

Finds nearby pharmacies using OpenStreetMap Overpass API

No paid API keys required

Displays:

Pharmacy name

Address (when available)

Phone number (when available)

Distance from user

“Get Directions” button opens Google Maps

Users can select a preferred pharmacy

Refill Requests

One-click Request Refill button

Calls the selected pharmacy using the device’s phone system (tel: link)

Caregiver Contact

Store caregiver name, relationship, phone, and notes

Quick call button for emergencies or reminders

Authentication & Data Storage

Firebase Authentication (email/password)

Firestore stores user-specific data:

Medications

Caregiver info

Preferred pharmacy

Tech Stack

React (Create React App)

Firebase Authentication

Firebase Firestore

OpenStreetMap Overpass API

Lucide React Icons

Plain CSS (no UI frameworks)

Why OpenStreetMap?

Most pharmacy lookup features rely on paid APIs (Google Places, Yelp, etc.).
To keep this project free and accessible, MedTrack uses OpenStreetMap via the Overpass API.

This provides real-world data with no billing required, though some entries may be missing phone numbers or hours depending on community coverage.

Project Structure (Key Files)
src/
├── App.js              # Main application logic
├── App.css             # UI styling
├── firebase.js         # Firebase configuration
├── index.js            # React entry point

Setup & Installation

Clone the repository:

git clone https://github.com/your-username/medtrack.git
cd medtrack


Install dependencies:

npm install


Create a Firebase project and add your config to firebase.js:

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);


Run the app:

npm start

Known Limitations

Pharmacy data quality depends on OpenStreetMap contributions

Some pharmacies may not list phone numbers or hours

Pill recognition / scanning was explored but not implemented due to:

API costs

Data reliability

Time constraints

Future Improvements

Push notifications for refill reminders

SMS/email caregiver alerts

Mobile-first UI improvements

Optional integration with paid pharmacy APIs

Prescription image scanning (with a proper dataset/API)

Academic Note

This project was completed under real-world constraints. Some planned features were intentionally scoped down to avoid paid APIs and to ensure a stable, working application within the available timeframe.

License

This project is for educational purposes.
